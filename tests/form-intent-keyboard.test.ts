// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChildFormAuthority } from "../extension/src/content/child_form_authority";
import { implicitSubmitBinding } from "../extension/src/content/form_intent";

function captureBinding(target: Element, init: KeyboardEventInit): ReturnType<typeof implicitSubmitBinding> {
  let binding: ReturnType<typeof implicitSubmitBinding> = null;
  target.addEventListener("keydown", event => {
    binding = implicitSubmitBinding(event as KeyboardEvent);
  }, { once: true });
  target.dispatchEvent(new KeyboardEvent("keydown", {
    bubbles: true,
    composed: true,
    ...init,
  }));
  return binding;
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("implicit keyboard form authority (#688)", () => {
  it("binds Enter on a text field to its owner form without inventing a submitter", () => {
    document.body.innerHTML = '<form id="f" action="https://sink.test/accept" method="post" target="_top"><input id="q" name="q"></form>';
    const form = document.querySelector<HTMLFormElement>("#f")!;
    const input = document.querySelector<HTMLInputElement>("#q")!;

    const binding = captureBinding(input, { key: "Enter" });

    expect(binding).not.toBeNull();
    expect(binding?.form).toBe(form);
    expect(binding?.submitter).toBeNull();
    expect(binding?.intent).toEqual([
      "https://sink.test/accept",
      "post",
      "application/x-www-form-urlencoded",
      "_top",
      "self",
    ]);
  });

  it("supports form-associated text fields outside the form", () => {
    document.body.innerHTML = '<form id="f" action="https://sink.test/accept" target="_top"></form><input id="q" form="f">';
    const form = document.querySelector<HTMLFormElement>("#f")!;
    const input = document.querySelector<HTMLInputElement>("#q")!;

    const binding = captureBinding(input, { key: "Enter" });

    expect(binding?.form).toBe(form);
    expect(binding?.submitter).toBeNull();
  });

  it("defers to the existing trusted-click path when a submit control exists", () => {
    document.body.innerHTML = '<form action="https://sink.test/accept" target="_top"><input id="q"><button>Submit</button></form>';
    expect(captureBinding(document.querySelector("#q")!, { key: "Enter" })).toBeNull();
  });

  it("does not grant authority when native implicit submission is blocked by multiple text fields", () => {
    document.body.innerHTML = '<form action="https://sink.test/accept" target="_top"><input id="q"><input name="second"></form>';
    expect(captureBinding(document.querySelector("#q")!, { key: "Enter" })).toBeNull();
  });

  it.each([
    ["another key", '<input id="q">', { key: "a" }],
    ["composition", '<input id="q">', { key: "Enter", isComposing: true }],
    ["Alt+Enter", '<input id="q">', { key: "Enter", altKey: true }],
    ["Control+Enter", '<input id="q">', { key: "Enter", ctrlKey: true }],
    ["button input", '<input id="q" type="button">', { key: "Enter" }],
    ["textarea", '<textarea id="q"></textarea>', { key: "Enter" }],
  ] as const)("does not mint authority for %s", (_name, control, init) => {
    document.body.innerHTML = `<form id="f" action="https://sink.test/accept" target="_top">${control}</form>`;
    const target = document.querySelector<Element>("#q")!;

    expect(captureBinding(target, init)).toBeNull();
  });

  it("reports an approved replay submit to the worker", async () => {
    vi.useFakeTimers();
    const intent = [
      "https://sink.test/accept",
      "post",
      "application/x-www-form-urlencoded",
      "child-target",
      "other",
    ] as const;
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    const post = vi.fn();
    const authority = new ChildFormAuthority({ enabled: () => true, post, reject: vi.fn() });
    const form = document.createElement("form");
    form.action = intent[0]; form.method = "post"; form.target = "child-target";
    document.body.append(form);

    authority.recordBlocked({ id: "replay", kind: "form_submit", formIntent: intent });
    expect(authority.approveAction("replay")).toBe(true);
    expect(authority.handleBridge({ type: "ns-form-replay-request", id: "replay", formIntent: intent })).toBe(true);
    await Promise.resolve(); await Promise.resolve();
    const ready = post.mock.calls.find(([type]) => type === "ns-form-replay-ready")?.[1];
    expect(ready?.ok).toBe(true);

    sendMessage.mockClear();
    expect(authority.handleBridge({ type: "ns-form-intent-cancel", attemptId: ready.attemptId, s: 1 })).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith({ type: "ns-form-intent-cancel", attemptId: ready.attemptId, s: 1 });

    sendMessage.mockClear();
    const event = {
      target: form,
      submitter: null,
      isTrusted: true,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
    } as unknown as SubmitEvent;
    authority.submit(event);

    expect(sendMessage).not.toHaveBeenCalledWith({ type: "ns-form-intent-cancel", attemptId: ready.attemptId, s: 1 });
    vi.runOnlyPendingTimers();
    expect(sendMessage).toHaveBeenCalledWith({ type: "ns-form-intent-cancel", attemptId: ready.attemptId, s: 1 });
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("does not report a child submit that a later page listener cancels", async () => {
    vi.useFakeTimers();
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("chrome", { runtime: { sendMessage } });
    const post = vi.fn();
    const authority = new ChildFormAuthority({ enabled: () => true, post, reject: vi.fn() });
    const form = document.createElement("form");
    form.action = "https://sink.test/accept"; form.method = "post"; form.target = "child-target";
    document.body.append(form);
    const intent = [form.action, "post", "application/x-www-form-urlencoded", "child-target", "other"] as const;
    authority.recordBlocked({ id: "replay", kind: "form_submit", formIntent: intent });
    authority.approveAction("replay");
    authority.handleBridge({ type: "ns-form-replay-request", id: "replay", formIntent: intent });
    await Promise.resolve(); await Promise.resolve();
    const attemptId = post.mock.calls.find(([type]) => type === "ns-form-replay-ready")?.[1]?.attemptId;
    expect(attemptId).toMatch(/^[a-f0-9]{32}$/);
    sendMessage.mockClear();
    const event = { target: form, submitter: null, isTrusted: true, defaultPrevented: false,
      preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() } as unknown as SubmitEvent;
    authority.submit(event);
    (event as unknown as { defaultPrevented: boolean }).defaultPrevented = true;
    vi.runOnlyPendingTimers();
    expect(sendMessage).toHaveBeenCalledWith({ type: "ns-form-intent-cancel", attemptId, s: undefined });
    expect(sendMessage).not.toHaveBeenCalledWith({ type: "ns-form-intent-cancel", attemptId, s: 1 });
  });
});
