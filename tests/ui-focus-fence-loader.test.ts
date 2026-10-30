// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  assertUiFocusFence,
  finalizeUiGuardLoader,
  UI_FENCE_STATE,
  UI_FOCUS_FENCE,
  uiGuardLoaderTemplate,
} from "../scripts/content-loader-contract.mjs";

type FenceRecord = { h: boolean; u: number; a: boolean; r: Set<number> };

// happy-dom marks every dispatched event untrusted; stand in for a browser-fired one.
const trusted = <E extends Event>(event: E): E => Object.defineProperty(event, "isTrusted", { value: true });

// #1242: the document_start loader records focus and PiP before page script runs.
describe("document_start focus/PiP fence", () => {
  const sent: unknown[] = [];
  let deliver: (message: unknown) => void = () => {};
  let record: FenceRecord;
  const imports: string[] = [];
  const documentPip = new EventTarget();

  beforeAll(() => {
    vi.stubGlobal("chrome", {
      runtime: {
        getURL: (path: string) => path,
        sendMessage: (message: unknown) => { sent.push(message); return Promise.resolve(); },
        onMessage: { addListener: (listener: (message: unknown) => void) => { deliver = listener; } },
      },
    });
    vi.stubGlobal("documentPictureInPicture", documentPip);
    const { content } = finalizeUiGuardLoader(uiGuardLoaderTemplate("assets/capture.js"));
    // Stand in for the module import; the fence itself runs unmodified.
    const loader = content.replace("await import(", "await __import(");
    vi.stubGlobal("__import", async (url: string) => { imports.push(url); return {}; });
    new Function(loader)();
    record = (globalThis as unknown as { [key: string]: FenceRecord })[UI_FENCE_STATE]!;
  });

  it("publishes a record and still imports the module", () => {
    expect(record).toMatchObject({ u: -Infinity, a: false });
    expect(record.r.size).toBe(0);
    expect(imports).toEqual(["assets/capture.js"]);
  });

  it("records a short blur that a later page capture listener stops", () => {
    // Registered after the loader, as any page script is.
    for (const type of ["blur", "focus"]) addEventListener(type, (e) => e.stopImmediatePropagation(), true);
    const focus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const before = performance.now();
    window.dispatchEvent(new FocusEvent("blur"));
    focus.mockReturnValue(true);
    window.dispatchEvent(new FocusEvent("focus"));
    expect(record.u).toBeGreaterThanOrEqual(before);
    expect(record.h).toBe(true);
    focus.mockRestore();
  });

  it("does not count a blur into a child frame or an element's blur", () => {
    record.u = -Infinity;
    const focus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    window.dispatchEvent(new FocusEvent("blur"));
    document.body.dispatchEvent(new FocusEvent("blur"));
    expect(record.u).toBe(-Infinity);
    focus.mockRestore();
  });

  it("records the document going hidden", () => {
    record.u = -Infinity;
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
    expect(record.u).toBeGreaterThan(-Infinity);
    hidden.mockRestore();
  });

  it("reports this frame's video PiP from ground truth, not from forged events", () => {
    const video = document.body.appendChild(document.createElement("video"));
    // A forged enter with no PiP window reports nothing.
    video.dispatchEvent(new Event("enterpictureinpicture", { bubbles: true }));
    expect(sent).toEqual([]);
    Object.defineProperty(document, "pictureInPictureElement", { configurable: true, value: video });
    video.dispatchEvent(new Event("enterpictureinpicture", { bubbles: true }));
    expect(sent).toEqual([{ type: "ns-pip", open: true }]);
    // A forged leave while PiP is still open reports nothing.
    video.dispatchEvent(new Event("leavepictureinpicture", { bubbles: true }));
    expect(sent).toHaveLength(1);
    // A real close of a detached video still reaches the element listener.
    video.remove();
    Reflect.deleteProperty(document, "pictureInPictureElement");
    video.dispatchEvent(new Event("leavepictureinpicture", { bubbles: true }));
    expect(sent).toEqual([{ type: "ns-pip", open: true }, { type: "ns-pip", open: false }]);
  });

  it("reports a Document PiP window until it really closes, ignoring a forged pagehide", () => {
    sent.length = 0;
    const pipWindow = new EventTarget();
    documentPip.dispatchEvent(Object.assign(new Event("enter"), { window: pipWindow }));
    expect(sent).toEqual([{ type: "ns-pip", open: true }]);
    // Page script can dispatch pagehide on the PiP window or its own window while PiP stays open.
    pipWindow.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pagehide"));
    expect(sent).toEqual([{ type: "ns-pip", open: true }]);
    pipWindow.dispatchEvent(trusted(new Event("pagehide")));
    expect(sent).toEqual([{ type: "ns-pip", open: true }, { type: "ns-pip", open: false }]);
  });

  it("tracks relayed PiP state per frame and ignores malformed relays", () => {
    deliver({ type: "ns-pip", open: true, frame: 4 });
    deliver({ type: "ns-pip", open: true, frame: "4" });
    deliver({ type: "ns-pip", open: "yes", frame: 5 });
    expect([...record.r]).toEqual([4]);
    deliver({ type: "ns-pip", open: false, frame: 4 });
    expect(record.r.size).toBe(0);
  });

  it("is asserted present, once, before the module import", () => {
    const { content } = finalizeUiGuardLoader(uiGuardLoaderTemplate("assets/capture.js"));
    expect(() => assertUiFocusFence(content)).not.toThrow();
    const moved = content.replace(UI_FOCUS_FENCE, "") + UI_FOCUS_FENCE;
    expect(() => assertUiFocusFence(moved)).toThrow("before the async module import");
    expect(() => assertUiFocusFence(content.replace("const S=", "const T="))).toThrow("missing");
  });
});
