// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import {
  PendingDecisionsPopupController,
  type PendingDecisionsPopupDependencies,
} from "../extension/src/popup/pending_decisions";

const ID = "a".repeat(32);
const TOKEN = "b".repeat(32);

function createHarness() {
  document.body.innerHTML = '<section id="pending"></section>';
  const host = document.getElementById("pending")!;
  const now = { value: 1_000 };
  const responses: unknown[] = [];
  const sent: unknown[] = [];
  let interval: (() => void) | undefined;
  const dependencies: PendingDecisionsPopupDependencies = {
    sendMessage: async (message) => {
      sent.push(structuredClone(message));
      return responses.shift();
    },
    now: () => now.value,
    setInterval: (callback) => {
      interval = callback;
      return 1;
    },
    clearInterval: () => {
      interval = undefined;
    },
  };
  const controller = new PendingDecisionsPopupController(host, dependencies);
  const decision = {
    id: ID,
    deliveryToken: TOKEN,
    kind: "navigation",
    reason: "blank-target-blocked",
    actions: ["proceed-once"],
    sourceOrigin: "https://source.test",
    topOrigin: "https://source.test",
    destinationOrigin: "https://destination.test",
    createdAt: now.value,
    expiresAt: now.value + 30_000,
    score: 81,
    signals: ["cross_site", "NRS-high"],
  };
  const listed = (decisions: unknown[] = [decision]) => ({
    ok: true,
    operation: "list",
    status: decisions.length > 0 ? "pending" : "missing",
    tabId: 7,
    windowId: 2,
    decisions,
  });
  return {
    controller,
    decision,
    host,
    listed,
    now,
    responses,
    sent,
    tick: () => interval?.(),
  };
}

describe("PendingDecisionsPopupController", () => {
  it("renders only URL-free authorized context and consumes with the broker token", async () => {
    const harness = createHarness();
    harness.responses.push(harness.listed());
    await harness.controller.refresh();

    expect(harness.host.hidden).toBe(false);
    expect(harness.host.textContent).toContain("From https://source.test");
    expect(harness.host.textContent).toContain("To https://destination.test");
    expect(harness.host.textContent).toContain("30s remaining");
    expect(harness.host.textContent).not.toContain("private");
    expect(harness.host.querySelectorAll("button")).toHaveLength(1);
    expect(harness.host.querySelector("button")?.textContent).toBe("Proceed once");

    harness.responses.push({
      ok: true,
      operation: "consume",
      status: "consumed",
      kind: "navigation",
      action: "proceed-once",
    });
    harness.host.querySelector<HTMLButtonElement>("button")!.click();
    await vi.waitFor(() => expect(harness.sent).toHaveLength(2));
    expect(harness.sent).toEqual([
      { type: "ns-pending-decision-list" },
      {
        type: "ns-pending-decision-consume",
        id: ID,
        deliveryToken: TOKEN,
        action: "proceed-once",
      },
    ]);
    expect(harness.host.textContent).toContain("Opened in a new tab.");
    expect(harness.host.querySelector("button")).toBeNull();
  });

  it("fails closed without a retry control after delivery failure", async () => {
    const harness = createHarness();
    harness.responses.push(harness.listed());
    await harness.controller.refresh();
    harness.responses.push({
      ok: false,
      operation: "consume",
      status: "delivery-failed",
    });

    harness.host.querySelector<HTMLButtonElement>("button")!.click();
    await vi.waitFor(() =>
      expect(harness.host.textContent).toContain("Navigation remains blocked."),
    );
    expect(harness.host.querySelector("button")).toBeNull();
  });

  it("drops expired or raw-URL-bearing views without rendering them", async () => {
    const expired = createHarness();
    expired.responses.push(expired.listed());
    await expired.controller.refresh();
    expired.now.value += 30_000;
    expired.tick();
    expect(expired.host.hidden).toBe(true);

    const leaking = createHarness();
    leaking.responses.push(
      leaking.listed([{ ...leaking.decision, destinationUrl: "https://destination.test/private" }]),
    );
    await leaking.controller.refresh();
    expect(leaking.host.hidden).toBe(true);
    expect(leaking.host.textContent).not.toContain("private");
  });

  it("shows a local fail-closed status when listing is unavailable", async () => {
    const harness = createHarness();
    harness.responses.push({ ok: false, operation: "list", status: "unavailable" });
    await harness.controller.refresh();
    expect(harness.host.hidden).toBe(false);
    expect(harness.host.textContent).toContain("Navigation remains blocked.");
  });
});
