import { describe, expect, it, vi } from "vitest";
import {
  PendingNavigationDecisionClient,
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
    extensionBaseUrl: "chrome-extension://test-extension-id/",
    now: 1_000,
    runtimeId: "test-extension-id",
    visible: true,
  };
  const responses: unknown[] = [];
  const sent: unknown[] = [];
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
  const onProceed = vi.fn();
  const dependencies: PendingNavigationDecisionClientDependencies = {
    runtimeId: () => state.runtimeId,
    extensionBaseUrl: () => state.extensionBaseUrl,
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
    pageHide: () => pageHideListener?.(),
    responses,
    sent,
    state,
    timers,
  };
}

describe("PendingNavigationDecisionClient", () => {
  it("burns the raw URL slot before one release and records only after an opened receipt", async () => {
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
      type: "ns-pending-decision-release",
      id: FIRST_ID,
      action: "proceed-once",
    };
    expect(harness.deliver(message, extensionSender({ id: "other-extension" }))).toEqual({
      ok: false,
      status: "rejected",
    });
    expect(
      harness.deliver(
        message,
        extensionSender({ url: "https://attacker.test/forged-sender" }),
      ),
    ).toEqual({ ok: false, status: "rejected" });
    expect(
      harness.deliver(message, extensionSender({ url: undefined, origin: "https://attacker.test" })),
    ).toEqual({ ok: false, status: "rejected" });
    expect(harness.deliver({ ...message, destinationUrl: DESTINATION_URL })).toEqual({
      ok: false,
      status: "rejected",
    });
    expect(harness.client.pendingCountForTest).toBe(1);

    expect(harness.deliver(message, extensionSender({ url: undefined, origin: undefined }))).toEqual({
      ok: true,
      status: "released",
      destinationUrl: DESTINATION_URL,
    });
    expect(harness.client.pendingCountForTest).toBe(0);
    expect(harness.client.awaitingOpenedCountForTest).toBe(1);
    expect(harness.onProceed).not.toHaveBeenCalled();
    expect(harness.deliver(message)).toEqual({ ok: false, status: "rejected" });

    harness.state.visible = false;
    const opened = {
      type: "ns-pending-decision-opened",
      id: FIRST_ID,
      action: "proceed-once",
    };
    expect(harness.deliver(opened)).toEqual({ ok: true, status: "acknowledged" });
    expect(harness.client.awaitingOpenedCountForTest).toBe(0);
    expect(harness.onProceed).toHaveBeenCalledTimes(1);
    expect(harness.deliver(opened)).toEqual({ ok: false, status: "rejected" });
  });

  it("accepts Firefox extension-origin background metadata", async () => {
    const harness = createHarness();
    harness.state.runtimeId = "navsentinel@navsentinel.app";
    harness.state.extensionBaseUrl = "moz-extension://test-runtime-uuid/";
    expect(await harness.create()).toBe(true);

    expect(
      harness.deliver(
        {
          type: "ns-pending-decision-release",
          id: FIRST_ID,
          action: "proceed-once",
        },
        {
          id: "navsentinel@navsentinel.app",
          url: "moz-extension://test-runtime-uuid/_generated_background_page.html",
          origin: "moz-extension://test-runtime-uuid",
        } as chrome.runtime.MessageSender,
      ),
    ).toEqual({
      ok: true,
      status: "released",
      destinationUrl: DESTINATION_URL,
    });
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
        type: "ns-pending-decision-release",
        id: FIRST_ID,
        action: "proceed-once",
      }),
    ).toEqual({ ok: false, status: "rejected" });
    expect(
      harness.deliver({
        type: "ns-pending-decision-release",
        id: SECOND_ID,
        action: "proceed-once",
      }),
    ).toMatchObject({ ok: true, status: "released" });
    expect(harness.client.awaitingOpenedCountForTest).toBe(1);

    harness.pageHide();
    expect(harness.client.pendingCountForTest).toBe(0);
    expect(harness.client.awaitingOpenedCountForTest).toBe(0);
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

  it("burns the raw slot on hidden, changed, or expired release", async () => {
    for (const arrange of [
      (harness: ReturnType<typeof createHarness>) => { harness.state.visible = false; },
      (harness: ReturnType<typeof createHarness>) => { harness.state.currentUrl += "#changed"; },
      (harness: ReturnType<typeof createHarness>) => { harness.state.now += 30_000; },
    ]) {
      const harness = createHarness();
      expect(await harness.create()).toBe(true);
      arrange(harness);
      const message = {
        type: "ns-pending-decision-release",
        id: FIRST_ID,
        action: "proceed-once",
      };
      expect(harness.deliver(message)).toEqual({ ok: false, status: "rejected" });
      expect(harness.client.pendingCountForTest).toBe(0);
      expect(harness.client.awaitingOpenedCountForTest).toBe(0);
      expect(harness.onProceed).not.toHaveBeenCalled();
      expect(harness.deliver(message)).toEqual({ ok: false, status: "rejected" });
    }
  });

  it("rejects a stale or context-changed opened receipt without recording an allow", async () => {
    for (const arrange of [
      (harness: ReturnType<typeof createHarness>) => { harness.state.currentUrl += "#changed"; },
      (harness: ReturnType<typeof createHarness>) => { harness.state.now += 30_000; },
    ]) {
      const harness = createHarness();
      expect(await harness.create()).toBe(true);
      expect(
        harness.deliver({
          type: "ns-pending-decision-release",
          id: FIRST_ID,
          action: "proceed-once",
        }),
      ).toMatchObject({ ok: true, status: "released" });
      arrange(harness);
      expect(
        harness.deliver({
          type: "ns-pending-decision-opened",
          id: FIRST_ID,
          action: "proceed-once",
        }),
      ).toEqual({ ok: false, status: "rejected" });
      expect(harness.client.awaitingOpenedCountForTest).toBe(0);
      expect(harness.onProceed).not.toHaveBeenCalled();
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
