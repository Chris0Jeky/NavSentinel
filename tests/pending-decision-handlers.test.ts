import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { PendingDecisionRuntimeMessage } from "../extension/src/shared/pending_decision";
import {
  PendingDecisionRuntimeBroker,
  type PendingDecisionFrameSnapshot,
  type PendingDecisionTabSnapshot,
} from "../extension/src/sw/pending_decision_handlers";
import {
  PENDING_DECISION_STORAGE_KEY,
  PendingDecisionStore,
  type PendingDecisionSessionStorage,
} from "../extension/src/sw/pending_decision_store";

const SOURCE_URL = "https://source.test/private/page?session=source-secret#source-fragment";
const DESTINATION_URL =
  "https://destination.test/private/continue?token=destination-secret#dest-fragment";
const TOP_DOCUMENT_ID = "document-top-7";

interface TestStorage extends PendingDecisionSessionStorage {
  data: Record<string, unknown>;
  failNextGet: boolean;
  failNextSet: boolean;
}

function createStorage(seed: Record<string, unknown> = {}): TestStorage {
  const data = structuredClone(seed);
  return {
    data,
    failNextGet: false,
    failNextSet: false,
    async get(key: string) {
      if (this.failNextGet) {
        this.failNextGet = false;
        throw new Error("session read failed with sensitive detail");
      }
      return { [key]: structuredClone(data[key]) };
    },
    async set(items: Record<string, unknown>) {
      if (this.failNextSet) {
        this.failNextSet = false;
        throw new Error("session write failed with sensitive detail");
      }
      Object.assign(data, structuredClone(items));
    },
  };
}

function opaqueGenerator(): () => string {
  let value = 1;
  return () => (value++).toString(16).padStart(32, "0");
}

function frameKey(tabId: number, frameId: number): string {
  return `${tabId}:${frameId}`;
}

function createHarness() {
  const storage = createStorage();
  const now = { value: 10_000 };
  const lifecycleGeneration = { value: 0 };
  const activeTab: PendingDecisionTabSnapshot = {
    id: 7,
    windowId: 2,
    url: SOURCE_URL,
    active: true,
  };
  const frames = new Map<string, PendingDecisionFrameSnapshot>([
    [
      frameKey(7, 0),
      {
        url: SOURCE_URL,
        documentId: TOP_DOCUMENT_ID,
        documentLifecycle: "active",
        errorOccurred: false,
      },
    ],
  ]);
  const getTab = vi.fn(async (_tabId: number) => ({ ...activeTab }));
  const queryActiveTabs = vi.fn(async () => [{ ...activeTab }]);
  const getFrame = vi.fn(async (tabId: number, frameId: number) => {
    const frame = frames.get(frameKey(tabId, frameId));
    return frame ? { ...frame } : null;
  });
  const store = new PendingDecisionStore({
    storage,
    now: () => now.value,
    generateOpaqueValue: opaqueGenerator(),
    fingerprintUrl: async (url) => createHash("sha256").update(url).digest("hex"),
  });
  const broker = new PendingDecisionRuntimeBroker(store, {
    runtimeId: () => "test-extension-id",
    extensionBaseUrl: () => "chrome-extension://test-extension-id/",
    getTab,
    queryActiveTabs,
    getFrame,
    getLifecycleGeneration: () => lifecycleGeneration.value,
  });
  return {
    activeTab,
    broker,
    frames,
    getFrame,
    getTab,
    lifecycleGeneration,
    now,
    queryActiveTabs,
    storage,
  };
}

function contentSender(
  overrides: Record<string, unknown> = {},
): chrome.runtime.MessageSender {
  return {
    id: "test-extension-id",
    url: SOURCE_URL,
    origin: "https://source.test",
    documentId: TOP_DOCUMENT_ID,
    documentLifecycle: "active",
    frameId: 0,
    tab: {
      id: 7,
      windowId: 2,
      url: SOURCE_URL,
      active: true,
    },
    ...overrides,
  } as unknown as chrome.runtime.MessageSender;
}

function extensionSender(
  overrides: Record<string, unknown> = {},
): chrome.runtime.MessageSender {
  return {
    id: "test-extension-id",
    url: "chrome-extension://test-extension-id/src/popup/popup.html",
    origin: "chrome-extension://test-extension-id",
    ...overrides,
  } as chrome.runtime.MessageSender;
}

function createMessage(): PendingDecisionRuntimeMessage {
  return {
    type: "ns-pending-decision-create",
    semantics: {
      kind: "navigation",
      reason: "navigation-blocked",
      actions: ["proceed-once"],
      destinationUrl: DESTINATION_URL,
      score: 81,
      signals: ["cross_site"],
    },
  };
}

async function createAndList(harness: ReturnType<typeof createHarness>) {
  expect(await harness.broker.handle(createMessage(), contentSender())).toEqual({
    ok: true,
    operation: "create",
    status: "created",
  });
  const listed = await harness.broker.handle(
    { type: "ns-pending-decision-list" },
    extensionSender(),
  );
  expect(listed).toMatchObject({
    ok: true,
    operation: "list",
    status: "pending",
    tabId: 7,
    windowId: 2,
  });
  if (!listed || !listed.ok || listed.operation !== "list" || listed.decisions.length !== 1) {
    throw new Error("Expected one listed pending decision");
  }
  return listed.decisions[0]!;
}

function consumeMessage(
  decision: { id: string; deliveryToken: string },
  overrides: Record<string, unknown> = {},
): PendingDecisionRuntimeMessage {
  return {
    type: "ns-pending-decision-consume",
    id: decision.id,
    deliveryToken: decision.deliveryToken,
    action: "proceed-once",
    destinationUrl: DESTINATION_URL,
    ...overrides,
  };
}

describe("PendingDecisionRuntimeBroker", () => {
  it("creates from browser provenance, lists a bounded view, and consumes exactly once", async () => {
    const harness = createHarness();
    const decision = await createAndList(harness);

    expect(decision).toMatchObject({
      kind: "navigation",
      reason: "navigation-blocked",
      actions: ["proceed-once"],
      sourceOrigin: "https://source.test",
      topOrigin: "https://source.test",
      destinationOrigin: "https://destination.test",
      score: 81,
      signals: ["cross_site"],
    });
    expect(JSON.stringify(decision)).not.toMatch(
      /sourceUrl|topUrl|destinationUrl|UrlHash|documentId|frameId|tabId|windowId/,
    );
    const persisted = JSON.stringify(harness.storage.data[PENDING_DECISION_STORAGE_KEY]);
    expect(persisted).not.toContain("/private/");
    expect(persisted).not.toContain("source-secret");
    expect(persisted).not.toContain("destination-secret");

    expect(
      await harness.broker.handle(consumeMessage(decision), extensionSender()),
    ).toEqual({
      ok: true,
      operation: "consume",
      status: "consumed",
      kind: "navigation",
      action: "proceed-once",
    });
    expect(
      await harness.broker.handle(consumeMessage(decision), extensionSender()),
    ).toEqual({ ok: false, operation: "consume", status: "missing" });
  });

  it("rejects malformed, identity-smuggling, and unverifiable create requests without writing", async () => {
    const cases: Array<{
      name: string;
      message?: unknown;
      sender?: chrome.runtime.MessageSender;
      mutate?: (harness: ReturnType<typeof createHarness>) => void;
      status: string;
    }> = [
      {
        name: "extra top-level key",
        message: { ...createMessage(), tabId: 99 },
        status: "invalid-request",
      },
      {
        name: "identity inside semantics",
        message: {
          ...createMessage(),
          semantics: { ...(createMessage() as { semantics: object }).semantics, documentId: "forged" },
        },
        status: "invalid-request",
      },
      {
        name: "wrong extension ID",
        sender: contentSender({ id: "other-extension" }),
        status: "unauthorized",
      },
      {
        name: "missing document ID",
        sender: contentSender({ documentId: undefined }),
        status: "unauthorized",
      },
      {
        name: "non-active sender lifecycle",
        sender: contentSender({ documentLifecycle: "cached" }),
        status: "unauthorized",
      },
      {
        name: "sender pending navigation",
        sender: contentSender({
          tab: {
            id: 7,
            windowId: 2,
            url: SOURCE_URL,
            active: true,
            pendingUrl: "https://next.test/",
          },
        }),
        status: "unauthorized",
      },
      {
        name: "live document mismatch",
        mutate: (harness) => {
          harness.frames.set(frameKey(7, 0), {
            url: SOURCE_URL,
            documentId: "replacement-document",
            documentLifecycle: "active",
            errorOccurred: false,
          });
        },
        status: "context-changed",
      },
      {
        name: "tab acquired pending navigation",
        mutate: (harness) => {
          harness.activeTab.pendingUrl = "https://next.test/";
        },
        status: "context-changed",
      },
    ];

    for (const testCase of cases) {
      const harness = createHarness();
      testCase.mutate?.(harness);
      const response = await harness.broker.handle(
        testCase.message ?? createMessage(),
        testCase.sender ?? contentSender(),
      );
      expect(response, testCase.name).toEqual({
        ok: false,
        operation: "create",
        status: testCase.status,
      });
      expect(harness.storage.data[PENDING_DECISION_STORAGE_KEY], testCase.name).toBeUndefined();
    }
  });

  it("requires an exact extension sender and exactly one active canonical HTTP tab", async () => {
    const harness = createHarness();
    await createAndList(harness);

    expect(
      await harness.broker.handle(
        { type: "ns-pending-decision-list" },
        extensionSender({ url: "chrome-extension://other/src/popup/popup.html" }),
      ),
    ).toEqual({ ok: false, operation: "list", status: "unauthorized" });

    harness.queryActiveTabs.mockResolvedValueOnce([]);
    expect(
      await harness.broker.handle({ type: "ns-pending-decision-list" }, extensionSender()),
    ).toEqual({ ok: false, operation: "list", status: "no-active-http-tab" });

    harness.queryActiveTabs.mockResolvedValueOnce([
      { ...harness.activeTab },
      { id: 8, windowId: 2, url: "https://other.test/", active: true },
    ]);
    expect(
      await harness.broker.handle({ type: "ns-pending-decision-list" }, extensionSender()),
    ).toEqual({ ok: false, operation: "list", status: "no-active-http-tab" });

    harness.queryActiveTabs.mockResolvedValueOnce([
      { id: 7, windowId: 2, url: "chrome://settings/", active: true },
    ]);
    expect(
      await harness.broker.handle({ type: "ns-pending-decision-list" }, extensionSender()),
    ).toEqual({ ok: false, operation: "list", status: "no-active-http-tab" });
  });

  it("filters a same-URL replacement document and retains its token after denial", async () => {
    const harness = createHarness();
    const decision = await createAndList(harness);
    harness.frames.set(frameKey(7, 0), {
      url: SOURCE_URL,
      documentId: "same-url-reload-document",
      documentLifecycle: "active",
      errorOccurred: false,
    });

    expect(
      await harness.broker.handle({ type: "ns-pending-decision-list" }, extensionSender()),
    ).toMatchObject({ ok: true, operation: "list", status: "missing", decisions: [] });
    expect(
      await harness.broker.handle(consumeMessage(decision), extensionSender()),
    ).toEqual({ ok: false, operation: "consume", status: "context-changed" });

    harness.frames.set(frameKey(7, 0), {
      url: SOURCE_URL,
      documentId: TOP_DOCUMENT_ID,
      documentLifecycle: "active",
      errorOccurred: false,
    });
    expect(
      await harness.broker.handle(consumeMessage(decision), extensionSender()),
    ).toMatchObject({ ok: true, operation: "consume", status: "consumed" });
  });

  it("rejects a delayed create after lifecycle cleanup has already run", async () => {
    const harness = createHarness();
    let releaseFrame!: () => void;
    const frameGate = new Promise<void>((resolve) => {
      releaseFrame = resolve;
    });
    harness.getFrame.mockImplementationOnce(async (tabId, frameId) => {
      await frameGate;
      const frame = harness.frames.get(frameKey(tabId, frameId));
      return frame ? { ...frame } : null;
    });

    const create = harness.broker.handle(createMessage(), contentSender());
    await vi.waitFor(() => expect(harness.getFrame).toHaveBeenCalledTimes(1));
    harness.lifecycleGeneration.value++;
    expect(await harness.broker.removeForTabLifecycle(7)).toEqual({
      status: "missing",
      removedCount: 0,
    });
    releaseFrame();

    expect(await create).toEqual({
      ok: false,
      operation: "create",
      status: "context-changed",
    });
    expect(harness.storage.data[PENDING_DECISION_STORAGE_KEY]).toBeUndefined();
  });

  it("binds token, action, and destination path/query/fragment without burning mismatches", async () => {
    const harness = createHarness();
    const decision = await createAndList(harness);
    const attempts = [
      {
        message: consumeMessage(decision, { deliveryToken: "Z".repeat(32) }),
        status: "mismatch",
      },
      {
        message: consumeMessage(decision, { action: "allow-route" }),
        status: "action-not-allowed",
      },
      {
        message: consumeMessage(decision, {
          destinationUrl:
            "https://destination.test/private/other?token=destination-secret#dest-fragment",
        }),
        status: "mismatch",
      },
      {
        message: consumeMessage(decision, {
          destinationUrl:
            "https://destination.test/private/continue?token=other#dest-fragment",
        }),
        status: "mismatch",
      },
      {
        message: consumeMessage(decision, {
          destinationUrl:
            "https://destination.test/private/continue?token=destination-secret#other",
        }),
        status: "mismatch",
      },
    ];

    for (const attempt of attempts) {
      expect(await harness.broker.handle(attempt.message, extensionSender())).toEqual({
        ok: false,
        operation: "consume",
        status: attempt.status,
      });
      expect(
        await harness.broker.handle({ type: "ns-pending-decision-list" }, extensionSender()),
      ).toMatchObject({ ok: true, status: "pending" });
    }
    expect(
      await harness.broker.handle(consumeMessage(decision), extensionSender()),
    ).toMatchObject({ ok: true, status: "consumed" });
  });

  it("serializes concurrent consumes so only one succeeds", async () => {
    const harness = createHarness();
    const decision = await createAndList(harness);
    const results = await Promise.all([
      harness.broker.handle(consumeMessage(decision), extensionSender()),
      harness.broker.handle(consumeMessage(decision), extensionSender()),
    ]);

    expect(results.filter((result) => result?.ok === true)).toHaveLength(1);
    expect(results).toContainEqual({ ok: false, operation: "consume", status: "missing" });
    expect(
      await harness.broker.handle(consumeMessage(decision), extensionSender()),
    ).toEqual({ ok: false, operation: "consume", status: "missing" });
  });

  it("burns the token when active context changes after consume", async () => {
    const harness = createHarness();
    const decision = await createAndList(harness);
    harness.frames.set(frameKey(8, 0), {
      url: "https://other.test/",
      documentId: "other-document",
      documentLifecycle: "active",
      errorOccurred: false,
    });
    let queryCount = 0;
    harness.queryActiveTabs.mockImplementation(async () => {
      queryCount++;
      return queryCount < 3
        ? [{ ...harness.activeTab }]
        : [{ id: 8, windowId: 2, url: "https://other.test/", active: true }];
    });

    expect(
      await harness.broker.handle(consumeMessage(decision), extensionSender()),
    ).toEqual({ ok: false, operation: "consume", status: "context-changed" });

    harness.queryActiveTabs.mockImplementation(async () => [{ ...harness.activeTab }]);
    expect(
      await harness.broker.handle(consumeMessage(decision), extensionSender()),
    ).toEqual({ ok: false, operation: "consume", status: "missing" });
  });

  it("fails closed on dependency/storage errors and permits a clean retry", async () => {
    const readHarness = createHarness();
    readHarness.storage.failNextGet = true;
    const readFailure = await readHarness.broker.handle(
      { type: "ns-pending-decision-list" },
      extensionSender(),
    );
    expect(readFailure).toEqual({ ok: false, operation: "list", status: "unavailable" });
    expect(JSON.stringify(readFailure)).not.toContain("sensitive detail");
    expect(
      await readHarness.broker.handle(
        { type: "ns-pending-decision-list" },
        extensionSender(),
      ),
    ).toMatchObject({ ok: true, operation: "list", status: "missing", decisions: [] });

    const writeHarness = createHarness();
    writeHarness.storage.failNextSet = true;
    const writeFailure = await writeHarness.broker.handle(createMessage(), contentSender());
    expect(writeFailure).toEqual({ ok: false, operation: "create", status: "unavailable" });
    expect(JSON.stringify(writeFailure)).not.toContain("sensitive detail");
    expect(await writeHarness.broker.handle(createMessage(), contentSender())).toEqual({
      ok: true,
      operation: "create",
      status: "created",
    });

    const dependencyHarness = createHarness();
    dependencyHarness.getFrame.mockRejectedValueOnce(
      new Error("frame lookup failed with sensitive detail"),
    );
    const dependencyFailure = await dependencyHarness.broker.handle(
      { type: "ns-pending-decision-list" },
      extensionSender(),
    );
    expect(dependencyFailure).toEqual({
      ok: false,
      operation: "list",
      status: "unavailable",
    });
    expect(JSON.stringify(dependencyFailure)).not.toContain("sensitive detail");
  });
});
