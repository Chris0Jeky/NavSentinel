// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  assertUiFocusFence,
  finalizeUiGuardLoader,
  UI_FENCE_STATE,
  UI_FOCUS_FENCE,
  uiGuardLoaderTemplate,
} from "../scripts/content-loader-contract.mjs";

type FenceRecord = { h: boolean; u: number; a: boolean };

// #1242: the document_start loader records focus before page script runs, and
// (#1244) answers the service worker's PiP query.
describe("document_start focus/PiP fence", () => {
  let deliver: (message: unknown, sender: unknown, respond: (open: unknown) => void) => void = () => {};
  let record: FenceRecord;
  const imports: string[] = [];
  const documentPip: { window: object | null } = { window: null };
  const ask = (message: unknown = { type: "ns-pip" }) => {
    const answers: unknown[] = [];
    deliver(message, {}, (open) => answers.push(open));
    return answers;
  };

  beforeAll(() => {
    vi.stubGlobal("chrome", {
      runtime: {
        getURL: (path: string) => path,
        onMessage: { addListener: (listener: typeof deliver) => { deliver = listener; } },
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

  it("answers a PiP query from this frame's ground truth at query time (#1244)", () => {
    expect(ask()).toEqual([false]);
    // No DOM event is involved: a video whose events never reached a listener still counts.
    Object.defineProperty(document, "pictureInPictureElement", { configurable: true, value: document.createElement("video") });
    expect(ask()).toEqual([true]);
    Reflect.deleteProperty(document, "pictureInPictureElement");
    expect(ask()).toEqual([false]);
    documentPip.window = {};
    expect(ask()).toEqual([true]);
    documentPip.window = null;
    expect(ask()).toEqual([false]);
  });

  it("also answers for a readable descendant frame, and skips one that throws (#1249 review)", () => {
    // happy-dom has no indexed frames: model window.length / window[i] for a two-level tree.
    const grandchild = { length: 0, document: { pictureInPictureElement: null as object | null } };
    const blocked = { length: 0, get document(): never { throw new DOMException("Blocked", "SecurityError"); } };
    const child = { length: 2, 0: blocked, 1: grandchild, document: { pictureInPictureElement: null } };
    Object.defineProperty(window, "length", { configurable: true, value: 1 });
    Object.defineProperty(window, 0, { configurable: true, value: child });
    try {
      expect(ask()).toEqual([false]);
      grandchild.document.pictureInPictureElement = {};
      expect(ask()).toEqual([true]);
    } finally {
      Reflect.deleteProperty(window, 0);
      Reflect.deleteProperty(window, "length");
    }
  });

  it("answers no other message", () => {
    expect(ask({ type: "ns-rollback" })).toEqual([]);
    expect(ask(null)).toEqual([]);
  });

  it("is asserted present, once, before the module import", () => {
    const { content } = finalizeUiGuardLoader(uiGuardLoaderTemplate("assets/capture.js"));
    expect(() => assertUiFocusFence(content)).not.toThrow();
    const moved = content.replace(UI_FOCUS_FENCE, "") + UI_FOCUS_FENCE;
    expect(() => assertUiFocusFence(moved)).toThrow("before the async module import");
    expect(() => assertUiFocusFence(content.replace("const S=", "const T="))).toThrow("missing");
  });
});
