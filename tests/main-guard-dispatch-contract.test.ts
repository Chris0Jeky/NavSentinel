// @vitest-environment happy-dom
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Real guard/bridge dispatch, with only the native navigation sinks replaced.
 * This pins native call count, argument/receiver fidelity, bridge records and
 * allowance consumption while factoring repeated allowed branches. It is not
 * evidence that Chromium accepted an extension or performed a navigation.
 */
const SOURCE = "__navsentinel__";
const SESSION = "dispatch-contract";
const messages: Array<Record<string, unknown>> = [];
const peer = new MessageChannel();
const open = vi.fn((_url?: string | URL, _target?: string, _features?: string) => null);
const submit = vi.fn();
const requestSubmit = vi.fn();
const nativeHasInstance = Function.prototype[Symbol.hasInstance];
let priorPongs = 0;

async function waitFor(test: () => boolean): Promise<void> {
  await vi.waitFor(() => expect(test()).toBe(true), { timeout: 2000, interval: 5 });
}

async function send(type: string, data: Record<string, unknown> = {}): Promise<void> {
  peer.port1.postMessage({ source: SOURCE, v: 1, session: SESSION, type, ...data });
  const next = ++priorPongs;
  peer.port1.postMessage({ source: SOURCE, v: 1, session: SESSION, type: "ns-ping" });
  await waitFor(() => messages.filter((message) => message.type === "ns-pong").length === next);
}

function form(): HTMLFormElement {
  const element = document.createElement("form");
  element.action = "https://example.test/submit";
  element.method = "post";
  document.body.appendChild(element);
  return element;
}

beforeAll(async () => {
  Object.defineProperty(MessagePort, Symbol.hasInstance, {
    configurable: true,
    value: (value: unknown) => nativeHasInstance.call(MessagePort, value) ||
      Object.getPrototypeOf(value) === Object.getPrototypeOf(peer.port1),
  });
  Object.defineProperty(window, "open", { value: open, writable: true, configurable: true });
  Object.defineProperty(Window.prototype, "open", { value: open, writable: true, configurable: true });
  HTMLFormElement.prototype.submit = submit;
  HTMLFormElement.prototype.requestSubmit = requestSubmit;
  if (typeof document.execCommand !== "function") {
    (document as unknown as { execCommand: () => boolean }).execCommand = () => false;
  }
  peer.port1.onmessage = (event: MessageEvent) => messages.push(event.data as Record<string, unknown>);
  peer.port1.start();
  peer.port2.start();
  await import("../extension/src/content/main_guard");
  const init = new MessageEvent("message", {
    data: { source: SOURCE, type: "ns-port-init", v: 1, session: SESSION },
    source: window,
  });
  Object.defineProperty(init, "ports", { value: [peer.port2] });
  window.dispatchEvent(init);
  await waitFor(() => messages.some((message) => message.type === "ns-challenge"));
  peer.port1.postMessage({ source: SOURCE, type: "ns-challenge-response", v: 1, session: SESSION,
    challenge: messages.find((message) => message.type === "ns-challenge")!.challenge });
  await waitFor(() => messages.some((message) => message.type === "ns-bridge-ready"));
});

beforeEach(async () => {
  document.body.replaceChildren();
  await send("ns-config", { mode: "smart", debug: false });
  await send("ns-allow", { allowOpen: false, allowRedirect: false });
  open.mockClear();
  submit.mockClear();
  requestSubmit.mockClear();
});

afterAll(() => {
  peer.port1.close();
  peer.port2.close();
  delete (MessagePort as unknown as Record<symbol, unknown>)[Symbol.hasInstance];
});

describe("native navigation dispatch through real main_guard", () => {
  it("allows one granted popup and does not duplicate native dispatch", async () => {
    await send("ns-allow", { allowOpen: true, allowRedirect: false });
    const start = messages.length;
    window.open("https://example.test/open", "_blank", "width=500");
    window.open("https://example.test/second", "_blank");
    await send("ns-config", { mode: "smart" });
    expect(open.mock.calls).toEqual([["https://example.test/open", "_blank", "width=500"]]);
    expect(open.mock.contexts).toEqual([window]);
    const records = messages.slice(start);
    expect(records.filter((message) => message.type === "ns-nav-allowed")).toHaveLength(1);
    const blocked = records.filter((message) => message.type === "ns-nav-blocked");
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).not.toHaveProperty("action");
    expect(blocked[0]).not.toHaveProperty("features");
  });

  it("a mismatched popup cannot spend the URL-bound one-shot allowance", async () => {
    await send("ns-allow-once", { url: "https://example.test/approved" });
    const start = messages.length;
    window.open("https://example.test/other", "_blank");
    window.open("https://example.test/approved", "_blank");
    window.open("https://example.test/approved", "_blank");
    await send("ns-config", { mode: "smart" });
    expect(open.mock.calls).toEqual([["https://example.test/approved", "_blank", undefined]]);
    const records = messages.slice(start);
    expect(records.filter((message) => message.type === "ns-nav-allowed")).toHaveLength(1);
    expect(records.filter((message) => message.type === "ns-nav-blocked")).toHaveLength(2);
  });

  it("forwards off-mode popups with the original optional arguments", async () => {
    await send("ns-config", { mode: "off" });
    window.open();
    window.open("https://example.test/open");
    expect(open.mock.calls).toEqual([
      [undefined, undefined, undefined], ["https://example.test/open", undefined, undefined],
    ]);
  });

  it("preserves the submitter object and its declared destination on requestSubmit", async () => {
    const element = form();
    const control = document.createElement("button");
    control.setAttribute("formaction", "https://example.test/override");
    element.appendChild(control);
    await send("ns-allow", { allowOpen: false, allowRedirect: true,
      restrictRedirectTarget: true, redirectTarget: "https://example.test/override" });
    const start = messages.length;
    element.requestSubmit(control);
    await send("ns-config", { mode: "smart" });
    expect(requestSubmit.mock.calls).toEqual([[control]]);
    expect(requestSubmit.mock.contexts).toEqual([element]);
    expect(messages.slice(start).find((message) => message.type === "ns-nav-allowed")?.url)
      .toBe("https://example.test/override");
  });

  for (const method of ["submit", "requestSubmit"] as const) {
    it(`keeps ${method} bounded to two calls for the one redirect grant`, async () => {
      const element = form();
      const native = method === "submit" ? submit : requestSubmit;
      await send("ns-allow", { allowOpen: false, allowRedirect: true });
      const start = messages.length;
      for (let n = 0; n < 3; n += 1) element[method]();
      await send("ns-config", { mode: "smart" });
      expect(native.mock.calls).toHaveLength(2);
      expect(native.mock.contexts).toEqual([element, element]);
      const records = messages.slice(start);
      expect(records.filter((message) => message.type === "ns-nav-allowed")).toHaveLength(2);
      expect(records.filter((message) => message.type === "ns-nav-blocked")).toHaveLength(1);
      expect(records.filter((message) => message.type === "ns-allow-target-nav")).toHaveLength(2);
    });

    it(`keeps ${method} blocked without a grant and rejects stale action approval`, async () => {
      const element = form();
      const native = method === "submit" ? submit : requestSubmit;
      const start = messages.length;
      element[method]();
      await send("ns-config", { mode: "smart" });
      const blocked = messages.slice(start).find((message) => message.type === "ns-nav-blocked");
      expect(blocked?.url).toBe("https://example.test/submit");
      expect(native).not.toHaveBeenCalled();
      element.action = "https://example.test/changed";
      await send("ns-allow-action", { id: blocked!.id });
      expect(native).not.toHaveBeenCalled();
    });

    it(`replays a blocked ${method} once on action approval with no marker (#750)`, async () => {
      const element = form();
      const native = method === "submit" ? submit : requestSubmit;
      const start = messages.length;
      element[method]();
      await send("ns-config", { mode: "smart" });
      const blocked = messages.slice(start).find((message) => message.type === "ns-nav-blocked");
      expect(blocked?.kind).toBe(method === "submit" ? "form_submit" : "form_request_submit");
      expect(native).not.toHaveBeenCalled();
      await send("ns-allow-action", { id: blocked!.id });
      // Allow-Once replay invokes the captured native directly: submit()
      // fires no submit event and carries no s:1-style marker, and none is
      // required — the isolated world's ns-allow-nav pre-approval covers the
      // SW commit for either submit flavor (sw.ts onCommittedHandler).
      expect(native.mock.calls).toEqual(method === "submit" ? [[]] : [[undefined]]);
      expect(native.mock.contexts).toEqual([element]);
      // The approval is one-shot: the same id replays nothing further.
      await send("ns-allow-action", { id: blocked!.id });
      expect(native).toHaveBeenCalledTimes(1);
    });

    it(`keeps native ${method} exceptions observable and preserves its argument count`, async () => {
      const element = form();
      const native = method === "submit" ? submit : requestSubmit;
      await send("ns-config", { mode: "off" });
      const error = new TypeError("native binding failure");
      native.mockImplementationOnce(() => { throw error; });
      expect(() => element[method]()).toThrow(error);
      expect(native.mock.calls).toEqual(method === "submit" ? [[]] : [[undefined]]);
    });

    it(`allows ${method} when protection is off without consuming a grant`, async () => {
      const element = form();
      const native = method === "submit" ? submit : requestSubmit;
      await send("ns-config", { mode: "off" });
      for (let n = 0; n < 3; n += 1) element[method]();
      expect(native.mock.calls).toHaveLength(3);
      expect(native.mock.contexts).toEqual([element, element, element]);
    });
  }
});
