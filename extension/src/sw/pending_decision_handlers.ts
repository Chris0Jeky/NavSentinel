import {
  PENDING_DECISION_MAX_DOCUMENT_ID_LENGTH,
  isExactHttpUrl,
  isOpaquePendingDecisionValue,
  isPendingDecisionAction,
  isPendingDecisionRuntimeMessage,
  parsePendingDecisionSemantics,
  toPendingDecisionView,
  type PendingDecision,
  type PendingDecisionRuntimeFailureResponse,
  type PendingDecisionRuntimeFailureStatus,
  type PendingDecisionRuntimeMessage,
  type PendingDecisionRuntimeOperation,
  type PendingDecisionRuntimeResponse,
  type PendingDecisionVerifiedContext,
} from "../shared/pending_decision";
import {
  PendingDecisionStore,
  type PendingDecisionLifecycleRemovalStatus,
} from "./pending_decision_store";

export interface PendingDecisionTabSnapshot {
  id?: number | undefined;
  windowId?: number | undefined;
  url?: string | undefined;
  pendingUrl?: string | undefined;
  active?: boolean | undefined;
}

export interface PendingDecisionFrameSnapshot {
  url?: string | undefined;
  documentId?: string | undefined;
  documentLifecycle?: string | undefined;
  errorOccurred?: boolean | undefined;
}

export interface PendingDecisionRuntimeBrokerDependencies {
  runtimeId: () => string | undefined;
  extensionBaseUrl: () => string | undefined;
  getTab: (tabId: number) => Promise<PendingDecisionTabSnapshot>;
  queryActiveTabs: () => Promise<readonly PendingDecisionTabSnapshot[]>;
  getFrame: (
    tabId: number,
    frameId: number,
  ) => Promise<PendingDecisionFrameSnapshot | null>;
}

interface ActiveTabContext {
  tabId: number;
  windowId: number;
  topUrl: string;
  topDocumentId: string;
}

interface LiveFrameContext {
  url: string;
  documentId: string;
}

const DOCUMENT_ID_RE = /^[A-Za-z0-9_-]+$/;
const SEMANTICS_REQUIRED_KEYS = ["actions", "destinationUrl", "kind", "reason"] as const;
const SEMANTICS_ALLOWED_KEYS = [
  ...SEMANTICS_REQUIRED_KEYS,
  "score",
  "signals",
] as const;

function defaultDependencies(): PendingDecisionRuntimeBrokerDependencies {
  return {
    runtimeId: () => chrome.runtime.id,
    extensionBaseUrl: () => chrome.runtime.getURL(""),
    getTab: (tabId) => chrome.tabs.get(tabId),
    queryActiveTabs: () => chrome.tabs.query({ active: true, lastFocusedWindow: true }),
    getFrame: (tabId, frameId) => chrome.webNavigation.getFrame({ tabId, frameId }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBrowserId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isDocumentId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= PENDING_DECISION_MAX_DOCUMENT_ID_LENGTH &&
    DOCUMENT_ID_RE.test(value)
  );
}

function hasExactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function hasAllowedKeys(
  value: unknown,
  required: readonly string[],
  allowed: readonly string[],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key)) && keys.every((key) => allowed.includes(key));
}

function operationFor(message: PendingDecisionRuntimeMessage): PendingDecisionRuntimeOperation {
  if (message.type === "ns-pending-decision-create") return "create";
  if (message.type === "ns-pending-decision-list") return "list";
  return "consume";
}

function failure(
  operation: PendingDecisionRuntimeOperation,
  status: PendingDecisionRuntimeFailureStatus,
): PendingDecisionRuntimeFailureResponse {
  return { ok: false, operation, status };
}

function asLiveFrame(frame: PendingDecisionFrameSnapshot | null): LiveFrameContext | null {
  if (
    !frame ||
    frame.documentLifecycle !== "active" ||
    frame.errorOccurred !== false ||
    !isExactHttpUrl(frame.url) ||
    !isDocumentId(frame.documentId)
  ) {
    return null;
  }
  return { url: frame.url, documentId: frame.documentId };
}

function activeContextsEqual(left: ActiveTabContext, right: ActiveTabContext): boolean {
  return (
    left.tabId === right.tabId &&
    left.windowId === right.windowId &&
    left.topUrl === right.topUrl &&
    left.topDocumentId === right.topDocumentId
  );
}

export class PendingDecisionRuntimeBroker {
  private readonly dependencies: PendingDecisionRuntimeBrokerDependencies;

  constructor(
    private readonly store: PendingDecisionStore,
    dependencies: Partial<PendingDecisionRuntimeBrokerDependencies> = {},
  ) {
    this.dependencies = { ...defaultDependencies(), ...dependencies };
  }

  hydrate(): Promise<void> {
    return this.store.hydrate();
  }

  removeForTabLifecycle(tabId: number): Promise<PendingDecisionLifecycleRemovalStatus> {
    return this.store.removeForTabLifecycle(tabId);
  }

  async handle(
    message: unknown,
    sender: chrome.runtime.MessageSender,
  ): Promise<PendingDecisionRuntimeResponse | null> {
    if (!isPendingDecisionRuntimeMessage(message)) return null;
    const operation = operationFor(message);
    try {
      if (message.type === "ns-pending-decision-create") {
        return await this.handleCreate(message, sender);
      }
      if (message.type === "ns-pending-decision-list") {
        return await this.handleList(message, sender);
      }
      return await this.handleConsume(message, sender);
    } catch {
      return failure(operation, "unavailable");
    }
  }

  private async handleCreate(
    message: PendingDecisionRuntimeMessage,
    sender: chrome.runtime.MessageSender,
  ): Promise<PendingDecisionRuntimeResponse> {
    if (
      message.type !== "ns-pending-decision-create" ||
      !hasExactKeys(message, ["type", "semantics"]) ||
      !hasAllowedKeys(message.semantics, SEMANTICS_REQUIRED_KEYS, SEMANTICS_ALLOWED_KEYS)
    ) {
      return failure("create", "invalid-request");
    }
    const semantics = parsePendingDecisionSemantics(message.semantics);
    if (!semantics) return failure("create", "invalid-request");
    if (!this.isOwnContentSender(sender)) return failure("create", "unauthorized");

    const verifiedContext = await this.resolveContentContext(sender);
    if (!verifiedContext) return failure("create", "context-changed");
    const created = await this.store.create(verifiedContext, semantics);
    if (created.status === "rejected-capacity") {
      return failure("create", "rejected-capacity");
    }
    return { ok: true, operation: "create", status: "created" };
  }

  private async handleList(
    message: PendingDecisionRuntimeMessage,
    sender: chrome.runtime.MessageSender,
  ): Promise<PendingDecisionRuntimeResponse> {
    if (message.type !== "ns-pending-decision-list" || !hasExactKeys(message, ["type"])) {
      return failure("list", "invalid-request");
    }
    if (!this.isOwnExtensionPageSender(sender)) return failure("list", "unauthorized");

    const activeBefore = await this.resolveActiveTab();
    if (!activeBefore) return failure("list", "no-active-http-tab");
    const listed = await this.store.listForVerifiedTab({
      tabId: activeBefore.tabId,
      windowId: activeBefore.windowId,
      topUrl: activeBefore.topUrl,
    });

    const liveDecisions: PendingDecision[] = [];
    if (listed.status === "pending") {
      for (const decision of listed.decisions) {
        const frame = asLiveFrame(
          await this.dependencies.getFrame(decision.tabId, decision.frameId),
        );
        if (
          frame &&
          decision.tabId === activeBefore.tabId &&
          decision.windowId === activeBefore.windowId &&
          frame.documentId === decision.documentId
        ) {
          liveDecisions.push(decision);
        }
      }
    }

    const activeAfter = await this.resolveActiveTab();
    if (!activeAfter || !activeContextsEqual(activeBefore, activeAfter)) {
      return failure("list", "context-changed");
    }
    return {
      ok: true,
      operation: "list",
      status: liveDecisions.length > 0 ? "pending" : "missing",
      tabId: activeAfter.tabId,
      windowId: activeAfter.windowId,
      decisions: liveDecisions.map(toPendingDecisionView),
    };
  }

  private async handleConsume(
    message: PendingDecisionRuntimeMessage,
    sender: chrome.runtime.MessageSender,
  ): Promise<PendingDecisionRuntimeResponse> {
    if (
      message.type !== "ns-pending-decision-consume" ||
      !hasExactKeys(message, ["type", "id", "deliveryToken", "action", "destinationUrl"]) ||
      !isOpaquePendingDecisionValue(message.id) ||
      !isOpaquePendingDecisionValue(message.deliveryToken) ||
      !isPendingDecisionAction(message.action) ||
      !isExactHttpUrl(message.destinationUrl)
    ) {
      return failure("consume", "invalid-request");
    }
    if (!this.isOwnExtensionPageSender(sender)) return failure("consume", "unauthorized");

    const activeBefore = await this.resolveActiveTab();
    if (!activeBefore) return failure("consume", "no-active-http-tab");
    const listed = await this.store.listForVerifiedTab({
      tabId: activeBefore.tabId,
      windowId: activeBefore.windowId,
      topUrl: activeBefore.topUrl,
    });
    const decision =
      listed.status === "pending"
        ? listed.decisions.find((candidate) => candidate.id === message.id)
        : undefined;
    if (!decision) return failure("consume", "missing");

    const frameBefore = asLiveFrame(
      await this.dependencies.getFrame(decision.tabId, decision.frameId),
    );
    if (!frameBefore || frameBefore.documentId !== decision.documentId) {
      return failure("consume", "context-changed");
    }
    const activeConfirmed = await this.resolveActiveTab();
    if (!activeConfirmed || !activeContextsEqual(activeBefore, activeConfirmed)) {
      return failure("consume", "context-changed");
    }

    const consumed = await this.store.consume(
      {
        tabId: activeConfirmed.tabId,
        windowId: activeConfirmed.windowId,
        frameId: decision.frameId,
        documentId: frameBefore.documentId,
        sourceUrl: frameBefore.url,
        topUrl: activeConfirmed.topUrl,
        destinationUrl: message.destinationUrl,
      },
      {
        id: message.id,
        deliveryToken: message.deliveryToken,
        action: message.action,
      },
    );
    if (consumed.status !== "consumed") return failure("consume", consumed.status);

    const activeAfter = await this.resolveActiveTab();
    const frameAfter = asLiveFrame(
      await this.dependencies.getFrame(decision.tabId, decision.frameId),
    );
    if (
      !activeAfter ||
      !activeContextsEqual(activeConfirmed, activeAfter) ||
      !frameAfter ||
      frameAfter.documentId !== frameBefore.documentId ||
      frameAfter.url !== frameBefore.url
    ) {
      return failure("consume", "context-changed");
    }
    return {
      ok: true,
      operation: "consume",
      status: "consumed",
      kind: consumed.decision.kind,
      action: consumed.action,
    };
  }

  private isOwnContentSender(sender: chrome.runtime.MessageSender): boolean {
    const runtimeId = this.dependencies.runtimeId();
    if (!runtimeId || sender.id !== runtimeId || !sender.tab) return false;
    if (
      !isBrowserId(sender.tab.id) ||
      !isBrowserId(sender.tab.windowId) ||
      sender.tab.active !== true ||
      sender.tab.pendingUrl !== undefined ||
      !isBrowserId(sender.frameId) ||
      !isDocumentId(sender.documentId) ||
      sender.documentLifecycle !== "active" ||
      !isExactHttpUrl(sender.url) ||
      !isExactHttpUrl(sender.tab.url)
    ) {
      return false;
    }
    return sender.origin === new URL(sender.url).origin;
  }

  private isOwnExtensionPageSender(sender: chrome.runtime.MessageSender): boolean {
    const runtimeId = this.dependencies.runtimeId();
    const extensionBaseUrl = this.dependencies.extensionBaseUrl();
    if (
      !runtimeId ||
      sender.id !== runtimeId ||
      extensionBaseUrl !== `chrome-extension://${runtimeId}/` ||
      typeof sender.url !== "string" ||
      !sender.url.startsWith(extensionBaseUrl)
    ) {
      return false;
    }
    return sender.origin === undefined || sender.origin === `chrome-extension://${runtimeId}`;
  }

  private async resolveContentContext(
    sender: chrome.runtime.MessageSender,
  ): Promise<PendingDecisionVerifiedContext | null> {
    if (!sender.tab || !isBrowserId(sender.tab.id) || !isBrowserId(sender.frameId)) return null;
    const tab = await this.dependencies.getTab(sender.tab.id);
    const sourceFrame = asLiveFrame(
      await this.dependencies.getFrame(sender.tab.id, sender.frameId),
    );
    const topFrame =
      sender.frameId === 0
        ? sourceFrame
        : asLiveFrame(await this.dependencies.getFrame(sender.tab.id, 0));
    if (
      !isBrowserId(tab.id) ||
      tab.id !== sender.tab.id ||
      !isBrowserId(tab.windowId) ||
      tab.windowId !== sender.tab.windowId ||
      tab.active !== true ||
      tab.pendingUrl !== undefined ||
      !isExactHttpUrl(tab.url) ||
      !sourceFrame ||
      sourceFrame.url !== sender.url ||
      sourceFrame.documentId !== sender.documentId ||
      !topFrame ||
      topFrame.url !== tab.url ||
      tab.url !== sender.tab.url
    ) {
      return null;
    }
    return {
      tabId: tab.id,
      windowId: tab.windowId,
      frameId: sender.frameId,
      documentId: sourceFrame.documentId,
      sourceUrl: sourceFrame.url,
      topUrl: topFrame.url,
    };
  }

  private async resolveActiveTab(): Promise<ActiveTabContext | null> {
    const tabs = await this.dependencies.queryActiveTabs();
    if (tabs.length !== 1) return null;
    const tab = tabs[0];
    if (
      !tab ||
      !isBrowserId(tab.id) ||
      !isBrowserId(tab.windowId) ||
      tab.active !== true ||
      tab.pendingUrl !== undefined ||
      !isExactHttpUrl(tab.url)
    ) {
      return null;
    }
    const topFrame = asLiveFrame(await this.dependencies.getFrame(tab.id, 0));
    if (!topFrame || topFrame.url !== tab.url) return null;
    return {
      tabId: tab.id,
      windowId: tab.windowId,
      topUrl: topFrame.url,
      topDocumentId: topFrame.documentId,
    };
  }
}
