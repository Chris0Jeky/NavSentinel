// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _feedMutationRecordsForTesting,
  _getPendingMutationCountForTesting,
  _resetMutationState,
  getMutationAlerts,
  startMutationMonitor,
  stopMutationMonitor,
  type MutationAlert,
} from "../extension/src/content/mutation_monitor";
import { explainReasonCode } from "../extension/src/shared/explanations";

function attributeRecord(
  target: Element,
  attributeName: string,
  oldValue: string | null,
): MutationRecord {
  return {
    type: "attributes",
    target,
    attributeName,
    oldValue,
  } as unknown as MutationRecord;
}

async function drainQueuedMutations(): Promise<void> {
  expect(_getPendingMutationCountForTesting()).toBeGreaterThan(0);
  await vi.advanceTimersByTimeAsync(150);
}

function formMethodAlerts(alerts: MutationAlert[]): MutationAlert[] {
  return alerts.filter((alert) => String(alert.type) === "form_method_changed");
}

describe("mutation monitor form-authority telemetry (#812/#857)", () => {
  let nativeMutationObserver: typeof MutationObserver;
  let observedConfigs: MutationObserverInit[];

  beforeEach(() => {
    _resetMutationState();
    document.head.replaceChildren();
    document.body.replaceChildren();
    vi.useFakeTimers({ shouldAdvanceTime: true });

    nativeMutationObserver = globalThis.MutationObserver;
    observedConfigs = [];
    class QuietMutationObserver {
      constructor(_callback: MutationCallback) {}

      observe(_target: Node, options?: MutationObserverInit): void {
        observedConfigs.push(options ?? {});
      }

      disconnect(): void {}

      takeRecords(): MutationRecord[] {
        return [];
      }
    }
    vi.stubGlobal("MutationObserver", QuietMutationObserver);
  });

  afterEach(() => {
    _resetMutationState();
    document.head.replaceChildren();
    document.body.replaceChildren();
    vi.stubGlobal("MutationObserver", nativeMutationObserver);
    vi.useRealTimers();
  });

  it("requests old values for bounded transition reconstruction", () => {
    startMutationMonitor(document, () => {});
    expect(observedConfigs).not.toHaveLength(0);
    for (const options of observedConfigs) {
      expect(options.attributeOldValue).toBe(true);
      expect(options.attributeFilter).toEqual(
        expect.arrayContaining(["action", "formaction", "method", "formmethod"]),
      );
    }
  });

  it("detects the first hostile formaction added to a pre-existing submitter", async () => {
    const form = document.createElement("form");
    form.action = "/checkout";
    const button = document.createElement("button");
    button.type = "submit";
    form.appendChild(button);
    document.body.appendChild(form);

    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (alert) => alerts.push(alert));

    button.setAttribute("formaction", "https://evil.example/collect");
    _feedMutationRecordsForTesting([attributeRecord(button, "formaction", null)]);
    await drainQueuedMutations();

    const actionAlerts = alerts.filter((alert) => alert.type === "form_action_changed");
    expect(actionAlerts).toHaveLength(1);
    expect(actionAlerts[0]!.severity).toBe("high");
    expect(actionAlerts[0]!.details).toContain("evil.example/collect");
  });

  it("preserves a transient hostile formaction through the debounce window", async () => {
    const form = document.createElement("form");
    const button = document.createElement("button");
    button.type = "submit";
    button.setAttribute("formaction", "/checkout");
    form.appendChild(button);
    document.body.appendChild(form);

    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (alert) => alerts.push(alert));

    button.setAttribute("formaction", "/checkout");
    _feedMutationRecordsForTesting([
      attributeRecord(button, "formaction", "/checkout"),
      attributeRecord(button, "formaction", "https://evil.example/collect"),
    ]);
    await drainQueuedMutations();

    const actionAlerts = alerts.filter((alert) => alert.type === "form_action_changed");
    expect(actionAlerts).toHaveLength(1);
    expect(actionAlerts[0]!.severity).toBe("high");
    expect(actionAlerts[0]!.details).toContain("evil.example/collect");
  });

  it("classifies formaction using the submit-control type at mutation time", async () => {
    const form = document.createElement("form");
    const button = document.createElement("button");
    button.type = "submit";
    button.setAttribute("formaction", "/checkout");
    form.appendChild(button);
    document.body.appendChild(form);

    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (alert) => alerts.push(alert));

    button.setAttribute("formaction", "https://evil.example/collect");
    button.type = "button";
    _feedMutationRecordsForTesting([
      attributeRecord(button, "formaction", "/checkout"),
      attributeRecord(button, "type", "submit"),
    ]);
    await drainQueuedMutations();

    const actionAlerts = alerts.filter((alert) => alert.type === "form_action_changed");
    expect(actionAlerts).toHaveLength(1);
    expect(actionAlerts[0]!.severity).toBe("high");
  });

  it("does not reinterpret an inert override after a control becomes submit-capable", async () => {
    const form = document.createElement("form");
    const button = document.createElement("button");
    button.type = "button";
    form.appendChild(button);
    document.body.appendChild(form);

    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (alert) => alerts.push(alert));

    button.setAttribute("formaction", "https://evil.example/collect");
    button.type = "submit";
    _feedMutationRecordsForTesting([
      attributeRecord(button, "formaction", null),
      attributeRecord(button, "type", "button"),
    ]);
    await drainQueuedMutations();

    expect(alerts.filter((alert) => alert.type === "form_action_changed")).toHaveLength(0);
  });

  it("inherits the owning form method when a submitter adds formmethod=get", async () => {
    const form = document.createElement("form");
    form.method = "post";
    const button = document.createElement("button");
    button.type = "submit";
    form.appendChild(button);
    document.body.appendChild(form);

    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (alert) => alerts.push(alert));

    button.setAttribute("formmethod", "get");
    _feedMutationRecordsForTesting([attributeRecord(button, "formmethod", null)]);
    await drainQueuedMutations();

    const methodAlerts = formMethodAlerts(alerts);
    expect(methodAlerts).toHaveLength(1);
    expect(methodAlerts[0]!.severity).toBe("medium");
  });

  it("does not flag removal of formmethod=post while the owner remains POST", async () => {
    const form = document.createElement("form");
    form.method = "post";
    const button = document.createElement("button");
    button.type = "submit";
    button.setAttribute("formmethod", "post");
    form.appendChild(button);
    document.body.appendChild(form);

    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (alert) => alerts.push(alert));

    button.removeAttribute("formmethod");
    _feedMutationRecordsForTesting([attributeRecord(button, "formmethod", "post")]);
    await drainQueuedMutations();

    expect(formMethodAlerts(alerts)).toHaveLength(0);
  });

  it("detects a direct form method downgrade from POST to GET", async () => {
    const form = document.createElement("form");
    form.method = "post";
    document.body.appendChild(form);

    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (alert) => alerts.push(alert));

    form.method = "get";
    _feedMutationRecordsForTesting([attributeRecord(form, "method", "post")]);
    await drainQueuedMutations();

    expect(formMethodAlerts(alerts)).toHaveLength(1);
  });

  it("ignores formaction and formmethod churn on non-submit controls", async () => {
    const form = document.createElement("form");
    form.method = "post";
    const text = document.createElement("input");
    text.type = "text";
    const button = document.createElement("button");
    button.type = "button";
    form.append(text, button);
    document.body.appendChild(form);

    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (alert) => alerts.push(alert));

    text.setAttribute("formaction", "https://evil.example/text");
    text.setAttribute("formmethod", "get");
    button.setAttribute("formaction", "https://evil.example/button");
    button.setAttribute("formmethod", "get");
    _feedMutationRecordsForTesting([
      attributeRecord(text, "formaction", null),
      attributeRecord(text, "formmethod", null),
      attributeRecord(button, "formaction", null),
      attributeRecord(button, "formmethod", null),
    ]);
    await drainQueuedMutations();

    expect(alerts.filter((alert) => alert.type === "form_action_changed")).toHaveLength(0);
    expect(formMethodAlerts(alerts)).toHaveLength(0);
  });

  it("bounds page-controlled action values in mutation details", async () => {
    const form = document.createElement("form");
    form.setAttribute("action", "/login");
    const button = document.createElement("button");
    button.type = "submit";
    button.setAttribute("formaction", "/checkout");
    form.appendChild(button);
    document.body.appendChild(form);

    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (alert) => alerts.push(alert));

    const longFormAction = `https://evil.example/${"a".repeat(5000)}`;
    const longSubmitterAction = `https://evil.example/${"b".repeat(5000)}`;
    form.setAttribute("action", longFormAction);
    button.setAttribute("formaction", longSubmitterAction);
    _feedMutationRecordsForTesting([
      attributeRecord(form, "action", "/login"),
      attributeRecord(button, "formaction", "/checkout"),
    ]);
    await drainQueuedMutations();

    const actionAlerts = alerts.filter((alert) => alert.type === "form_action_changed");
    expect(actionAlerts).toHaveLength(2);
    for (const alert of actionAlerts) {
      expect(alert.details.length).toBeLessThan(600);
      expect(alert.details).toContain("…");
    }
  });

  it("registers a human-readable explanation for method downgrades", () => {
    expect(explainReasonCode("form_method_changed")).not.toBe("form_method_changed");
  });

  it("keeps the public alert snapshot bounded to monitor-owned records", () => {
    expect(getMutationAlerts()).toEqual([]);
  });
});
