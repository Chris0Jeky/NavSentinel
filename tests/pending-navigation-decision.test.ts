import { describe, expect, it, vi } from "vitest";
import {
  PendingNavigationDecisionClient,
  openDisownedBlankWindow,
  type PendingNavigationDecisionClientDependencies,
} from "../extension/src/content/pending_navigation_decision";
import type { PendingDecisionDeliveryResponse } from "../extension/src/shared/pending_decision";

const DESTINATION_URL = "https://destination.test/private/path?secret=value#fragment";
const SOURCE_URL = "https://source.test/current/page";
const FIRST_ID = "a".repeat(32);
const SECOND_ID = "b".repeat(32);

function extensionSender(overrides: Record<string, unknown> = {}): chrome.runtime.MessageSender {
  return {
    id: "test-extension-id",
    url: "chrome-extension://test-extension-id/service_worker.js",
    origin: "chrome-extension://test-extension-id",
    ...overrides,
  } as chrome.runtime.MessageSender;
}

function createHarness() {
  const state = {
    currentUrl: SOURCE_URL,
    now: 1_000,
    visible: true,
  };
  const responses: unknown[] = [];
  const sent: unknown[] = [];
  const opened: string[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  let messageListener:
    | ((
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: PendingDecisionDeliveryResponse) => void,
    ) => void)
    | undefined;
  let pageHideListener: (() => void) | undefined;
  const clientRef: { current?: PendingNavigationDecisionClient } = {};
  const onProceed = vi.fn();
  const openBlank = vi.fn((exactUrl: string): Window | null => {
    expect(clientRef.current?.pendingCountForTest).toBe(0);
    opened.push(exactUrl);
    return {} as Window;
  });
  const dependencies: PendingNavigationDecisionClientDependencies = {
    runtimeId: () => "test-extension-id",
    extensionBaseUrl: () => "chrome-extension://test-extension-id/",
    sendMessage: async (message) => {
      sent.push(structuredClone(message));
      return responses.shift();
    },
    addMessageListener: (listener) => {
      messageListener = listener;
    },
    addPageHideListener: (listener) => {
      pageHideListener = listener;
    },
    now: () => state.now,
    currentUrl: () => state.currentUrl,
    isVisible: () => state.visible,
    openBlank,
    setTimer: (callback) => {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id);
    },
  };
  const client = new PendingNavigationDecisionClient(dependencies);
  clientRef.current = client;

  function createResponse(
    id = FIRST_ID,
    replacedDecisionId?: string,
  ): Record<string, unknown> {
    return {
      ok: true,
      operation: "create",
      status: "created",
      id,
      expiresAt: state.now + 30_000,
      ...(replacedDecisionId ? { replacedDecisionId } : {}),
    };
  }

  async function create(response = createResponse()): Promise<boolean> {
    responses.push(response);
    return client.create({
      destinationUrl: DESTINATION_URL,
      score: 81,
      signals: ["cross_site", "NRS-high"],
      onProceed,
    });
  }

  function deliver(
    message: unknown,
    sender = extensionSender(),
  ): PendingDecisionDeliveryResponse | undefined {
    let response: PendingDecisionDeliveryResponse | undefined;
    messageListener?.(message, sender, (value) => {
      response = value;
    });
    return response;
  }

  return {
    client,
    create,
    createResponse,
    deliver,
    onProceed,
    openBlank,
    opened,
    pageHide: () => pageHideListener?.(),
    responses,
    sent,
    state,
    timers,
  };
}

describe("PendingNavigationDecisionClient", () => {
  it("severs the child opener before navigating to the approved destination", () => {
    const replace = vi.fn();
    const close = vi.fn();
    const child = {
      opener: {} as Window,
      location: { replace },
      close,
    } as unknown as Window;
    const openWindow = vi.fn(() => child);

    expect(openDisownedBlankWindow(DESTINATION_URL, openWindow)).toBe(child);
    expect(openWindow).toHaveBeenCalledWith("about:blank", "_blank");
    expect(child.opener).toBeNull();
    expect(replace).toHaveBeenCalledWith(DESTINATION_URL);
    expect(close).not.toHaveBeenCalled();
  });

  it("closes the inert child when navigation cannot be prepared", () => {
    const close = vi.fn();
    const child = {
      opener: {} as Window,
      location: { replace: vi.fn(() => { throw new Error("navigation failed"); }) },
      close,
    } as unknown as Window;

    expect(openDisownedBlankWindow(DESTINATION_URL, () => child)).toBeNull();
    expect(child.opener).toBeNull();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("keeps the raw URL in one ephemeral slot and opens it once after exact delivery", async () => {
    const harness = createHarness();
    expect(await harness.create()).toBe(true);
    expect(harness.client.pendingCountForTest).toBe(1);
    expect(harness.sent).toEqual([
      {
        type: "ns-pending-decision-create",
        semantics: {
          kind: "navigation",
          reason: "blank-target-blocked",
          actions: ["proceed-once"],
          destinationUrl: DESTINATION_URL,
          score: 81,
          signals: ["cross_site", "NRS-high"],
        },
      },
    ]);

    const message = {
      type: "ns-pending-decision-deliver",
      id: FIRST_ID,
      action: "proceed-once",
    };
    expect(harness.deliver(message, extensionSender({ id: "other-extension" }))).toEqual({
      ok: false,
      status: "rejected",
    });
    expect(harness.deliver({ ...message, destinationUrl: DESTINATION_URL })).toEqual({
      ok: false,
      status: "rejected",
    });
    expect(harness.client.pendingCountForTest).toBe(1);

    expect(harness.deliver(message)).toEqual({ ok: true, status: "opened" });
    expect(harness.opened).toEqual([DESTINATION_URL]);
    expect(harness.openBlank).toHaveBeenCalledWith(DESTINATION_URL);
    expect(harness.onProceed).toHaveBeenCalledTimes(1);
    expect(harness.deliver(message)).toEqual({ ok: false, status: "rejected" });
    expect(harness.openBlank).toHaveBeenCalledTimes(1);
  });

  it("replaces the same-scope slot and clears all ephemeral state on pagehide", async () => {
    const harness = createHarness();
    expect(await harness.create()).toBe(true);
    expect(
      await harness.create(harness.createResponse(SECOND_ID, FIRST_ID)),
    ).toBe(true);
    expect(harness.client.pendingCountForTest).toBe(1);
    expect(
      harness.deliver({
        type: "ns-pending-decision-deliver",
        id: FIRST_ID,
        action: "proceed-once",
      }),
    ).toEqual({ ok: false, status: "rejected" });

    harness.pageHide();
    expect(harness.client.pendingCountForTest).toBe(0);
    expect(harness.timers.size).toBe(0);
  });

  it("invalidates a create response that arrives after pagehide", async () => {
    const harness = createHarness();
    let resolveResponse: ((value: unknown) => void) | undefined;
    harness.responses.push(new Promise((resolve) => { resolveResponse = resolve; }));
    const creating = harness.client.create({
      destinationUrl: DESTINATION_URL,
      score: 81,
      signals: ["cross_site", "NRS-high"],
      onProceed: harness.onProceed,
    });

    harness.pageHide();
    resolveResponse?.(harness.createResponse());

    await expect(creating).resolves.toBe(false);
    expect(harness.client.pendingCountForTest).toBe(0);
    expect(harness.timers.size).toBe(0);
  });

  it("burns the slot on hidden, changed, expired, or failed-open delivery", async () => {
    for (const arrange of [
      (harness: ReturnType<typeof createHarness>) => { harness.state.visible = false; },
      (harness: ReturnType<typeof createHarness>) => { harness.state.currentUrl += "#changed"; },
      (harness: ReturnType<typeof createHarness>) => { harness.state.now += 30_000; },
      (harness: ReturnType<typeof createHarness>) => { harness.openBlank.mockReturnValueOnce(null); },
    ]) {
      const harness = createHarness();
      expect(await harness.create()).toBe(true);
      arrange(harness);
      const message = {
        type: "ns-pending-decision-deliver",
        id: FIRST_ID,
        action: "proceed-once",
      };
      expect(harness.deliver(message)).toEqual({ ok: false, status: "rejected" });
      expect(harness.client.pendingCountForTest).toBe(0);
      expect(harness.onProceed).not.toHaveBeenCalled();
      expect(harness.deliver(message)).toEqual({ ok: false, status: "rejected" });
    }
  });

  it("rejects create metadata that leaks a delivery token", async () => {
    const harness = createHarness();
    expect(
      await harness.create({ ...harness.createResponse(), deliveryToken: "c".repeat(32) }),
    ).toBe(false);
    expect(harness.client.pendingCountForTest).toBe(0);
  });
});
