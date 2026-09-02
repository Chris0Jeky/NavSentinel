import {
  PENDING_DECISION_MAX_PER_TAB,
  PENDING_DECISION_TTL_MS,
  isExactHttpUrl,
  isOpaquePendingDecisionValue,
  type PendingDecisionDeliveryMessage,
  type PendingDecisionDeliveryResponse,
  type PendingDecisionSignalCode,
} from "../shared/pending_decision";
import {
  appendEvent,
  appendPromptOutcome,
  type NavOutcomeFeatures,
} from "../shared/storage";
import { showToast } from "./ui_toast";

export interface PendingBlankNavigationRequest {
  destinationUrl: string;
  score: number;
  signals: readonly PendingDecisionSignalCode[];
  onProceed: () => void;
}

export interface PendingBlankNavigationPromptRequest {
  title: string;
  destinationUrl: string;
  destinationHost: string;
  sourceDomain: string;
  score: number;
  signals: readonly PendingDecisionSignalCode[];
  outcomeFeatures: NavOutcomeFeatures;
  overlayHidden: boolean;
}

interface EphemeralBlankNavigation {
  destinationUrl: string;
  sourceUrl: string;
  expiresAt: number;
  timer: number;
  onProceed: () => void;
}

interface CreatedDecisionMetadata {
  id: string;
  expiresAt: number;
  replacedDecisionId?: string;
}

export interface PendingNavigationDecisionClientDependencies {
  runtimeId: () => string | undefined;
  extensionBaseUrl: () => string | undefined;
  sendMessage: (message: unknown) => Promise<unknown>;
  addMessageListener: (
    listener: (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: PendingDecisionDeliveryResponse) => void,
    ) => void,
  ) => void;
  addPageHideListener: (listener: () => void) => void;
  now: () => number;
  currentUrl: () => string;
  isVisible: () => boolean;
  openBlank: (exactUrl: string) => Window | null;
  setTimer: (callback: () => void, delayMs: number) => number;
  clearTimer: (timer: number) => void;
}

function defaultDependencies(): PendingNavigationDecisionClientDependencies {
  return {
    runtimeId: () => chrome.runtime.id,
    extensionBaseUrl: () => chrome.runtime.getURL(""),
    sendMessage: (message) =>
      new Promise((resolve) => {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) resolve(undefined);
          else resolve(response);
        });
      }),
    addMessageListener: (listener) => chrome.runtime.onMessage.addListener(listener),
    addPageHideListener: (listener) => window.addEventListener("pagehide", listener),
    now: Date.now,
    currentUrl: () => location.href,
    isVisible: () => document.visibilityState === "visible",
    openBlank: openDisownedBlankWindow,
    setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimer: (timer) => window.clearTimeout(timer),
  };
}

/**
 * Opens an inert same-origin child, severs its opener synchronously, and only
 * then navigates it to the approved destination. This prevents a suspicious
 * child from replacing the protected source tab via reverse tabnabbing.
 */
export function openDisownedBlankWindow(
  exactUrl: string,
  openWindow: (url?: string | URL, target?: string) => Window | null = window.open.bind(window),
): Window | null {
  let opened: Window | null = null;
  try {
    opened = openWindow("about:blank", "_blank");
    if (!opened) return null;
    opened.opener = null;
    opened.location.replace(exactUrl);
    return opened;
  } catch {
    try {
      opened?.close();
    } catch {
      // The one-shot broker capability is already burned by the caller.
    }
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

function parseCreatedDecision(value: unknown, now: number): CreatedDecisionMetadata | null {
  if (!isRecord(value)) return null;
  const expected = ["ok", "operation", "status", "id", "expiresAt"];
  if (value.replacedDecisionId !== undefined) expected.push("replacedDecisionId");
  if (
    !hasExactKeys(value, expected) ||
    value.ok !== true ||
    value.operation !== "create" ||
    value.status !== "created" ||
    !isOpaquePendingDecisionValue(value.id) ||
    !Number.isSafeInteger(value.expiresAt) ||
    (value.expiresAt as number) <= now ||
    (value.expiresAt as number) - now > PENDING_DECISION_TTL_MS ||
    (value.replacedDecisionId !== undefined &&
      !isOpaquePendingDecisionValue(value.replacedDecisionId))
  ) {
    return null;
  }
  return {
    id: value.id,
    expiresAt: value.expiresAt as number,
    ...(typeof value.replacedDecisionId === "string"
      ? { replacedDecisionId: value.replacedDecisionId }
      : {}),
  };
}

function parseDeliveryMessage(value: unknown): PendingDecisionDeliveryMessage | null {
  if (!isRecord(value) || !hasExactKeys(value, ["type", "id", "action"])) return null;
  if (
    value.type !== "ns-pending-decision-deliver" ||
    !isOpaquePendingDecisionValue(value.id) ||
    value.action !== "proceed-once"
  ) {
    return null;
  }
  return { type: value.type, id: value.id, action: value.action };
}

/**
 * Owns the only raw destination copy after broker creation. Records are
 * document-local, bounded, short-lived, and removed before navigation is tried.
 */
export class PendingNavigationDecisionClient {
  private readonly dependencies: PendingNavigationDecisionClientDependencies;
  private readonly pending = new Map<string, EphemeralBlankNavigation>();
  private requestGeneration = 0;

  constructor(dependencies: PendingNavigationDecisionClientDependencies = defaultDependencies()) {
    this.dependencies = dependencies;
    dependencies.addMessageListener((message, sender, sendResponse) => {
      const response = this.handleDelivery(message, sender);
      if (response) sendResponse(response);
    });
    dependencies.addPageHideListener(() => {
      this.requestGeneration++;
      this.clearAll();
    });
  }

  async create(request: PendingBlankNavigationRequest): Promise<boolean> {
    if (!isExactHttpUrl(request.destinationUrl)) return false;
    const generation = ++this.requestGeneration;
    const sourceUrl = this.dependencies.currentUrl();
    const response = await this.dependencies.sendMessage({
      type: "ns-pending-decision-create",
      semantics: {
        kind: "navigation",
        reason: "blank-target-blocked",
        actions: ["proceed-once"],
        destinationUrl: request.destinationUrl,
        score: request.score,
        signals: [...request.signals],
      },
    });
    const now = this.dependencies.now();
    const created = parseCreatedDecision(response, now);
    if (!created || generation !== this.requestGeneration || sourceUrl !== this.dependencies.currentUrl()) {
      return false;
    }

    if (created.replacedDecisionId) this.clearRecord(created.replacedDecisionId);
    this.clearExpired(now);
    while (this.pending.size >= PENDING_DECISION_MAX_PER_TAB) {
      const oldest = [...this.pending.entries()].sort(
        ([leftId, left], [rightId, right]) =>
          left.expiresAt - right.expiresAt || leftId.localeCompare(rightId),
      )[0];
      if (!oldest) break;
      this.clearRecord(oldest[0]);
    }
    const timer = this.dependencies.setTimer(
      () => this.clearRecord(created.id),
      Math.max(0, created.expiresAt - now),
    );
    this.pending.set(created.id, {
      destinationUrl: request.destinationUrl,
      sourceUrl,
      expiresAt: created.expiresAt,
      timer,
      onProceed: request.onProceed,
    });
    return true;
  }

  handleDelivery(
    message: unknown,
    sender: chrome.runtime.MessageSender,
  ): PendingDecisionDeliveryResponse | undefined {
    if (!isRecord(message) || message.type !== "ns-pending-decision-deliver") return undefined;
    const delivery = parseDeliveryMessage(message);
    if (!delivery || !this.isOwnExtensionSender(sender)) return { ok: false, status: "rejected" };
    const record = this.pending.get(delivery.id);
    if (!record) return { ok: false, status: "rejected" };

    const now = this.dependencies.now();
    if (
      record.expiresAt <= now ||
      record.sourceUrl !== this.dependencies.currentUrl() ||
      !this.dependencies.isVisible()
    ) {
      this.clearRecord(delivery.id);
      return { ok: false, status: "rejected" };
    }

    // Burn the content-side capability before the one protection-lowering side effect.
    this.clearRecord(delivery.id);
    let opened: Window | null = null;
    try {
      opened = this.dependencies.openBlank(record.destinationUrl);
    } catch {
      // The broker token is already consumed; failure cannot be retried.
    }
    if (!opened) return { ok: false, status: "rejected" };
    try {
      record.onProceed();
    } catch {
      // Outcome recording must not turn a completed navigation into a retry.
    }
    return { ok: true, status: "opened" };
  }

  get pendingCountForTest(): number {
    return this.pending.size;
  }

  private isOwnExtensionSender(sender: chrome.runtime.MessageSender): boolean {
    const runtimeId = this.dependencies.runtimeId();
    const extensionBaseUrl = this.dependencies.extensionBaseUrl();
    if (
      !runtimeId ||
      sender.id !== runtimeId ||
      extensionBaseUrl !== `chrome-extension://${runtimeId}/`
    ) {
      return false;
    }
    if (sender.url !== undefined && !sender.url.startsWith(extensionBaseUrl)) return false;
    return sender.origin === undefined || sender.origin === `chrome-extension://${runtimeId}`;
  }

  private clearExpired(now: number): void {
    for (const [id, record] of this.pending) {
      if (record.expiresAt <= now) this.clearRecord(id);
    }
  }

  private clearRecord(id: string): void {
    const record = this.pending.get(id);
    if (!record) return;
    this.dependencies.clearTimer(record.timer);
    this.pending.delete(id);
  }

  private clearAll(): void {
    for (const id of [...this.pending.keys()]) this.clearRecord(id);
  }
}

let pendingNavigationDecisions: PendingNavigationDecisionClient | null = null;

export function requestPendingBlankNavigation(request: PendingBlankNavigationRequest): Promise<boolean> {
  pendingNavigationDecisions ??= new PendingNavigationDecisionClient();
  return pendingNavigationDecisions.create(request);
}

export function showPendingBlankNavigationPrompt(
  request: PendingBlankNavigationPromptRequest,
): Promise<boolean> {
  const score = Math.max(0, Math.min(100, Math.round(request.score)));
  const sourceDomain = request.sourceDomain;
  const destinationHost = request.destinationHost;
  const outcomeFeatures = request.outcomeFeatures;
  void appendEvent({
    kind: "nav_blank_prompt",
    site: sourceDomain,
    destHost: destinationHost,
    ...(request.overlayHidden ? { extra: { overlayAutoDismissed: true } } : {}),
  }).catch(() => {});
  const pending = requestPendingBlankNavigation({
    destinationUrl: request.destinationUrl,
    score,
    signals: request.signals,
    onProceed: () => {
      void appendPromptOutcome({
        domain: sourceDomain,
        destDomain: destinationHost,
        type: "nav",
        score,
        outcome: "allow_once",
        ...outcomeFeatures,
      }).catch(() => {});
    },
  });
  void pending.then((created) => {
    showToast({
      message: created
        ? `${request.title}${request.overlayHidden ? " (overlay hidden)" : ""}: ${destinationHost}. Open NavSentinel to review.`
        : `${request.title}: ${destinationHost}. Navigation remains blocked.`,
      coalesce: !request.overlayHidden,
    });
  });
  return pending;
}
