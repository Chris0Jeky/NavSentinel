// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { samplePrimaryScene } from "./e2e/observatory_scene_sampler";

const identity = { frameId: "frame-2", documentId: "doc-1", parentFrameId: "frame-1" };
const input = { context: identity, frameRect: { x: 40, y: 80, width: 604, height: 404 },
  contentOffset: { x: 42, y: 82 }, viewport: { width: 900, height: 800 },
  harmUrl: "http://127.0.0.1/__navsentinel_fake_sink?role=attack&secret=SYNTHETIC_ONLY",
  benignUrl: "http://127.0.0.1/__navsentinel_fake_sink?role=benign&secret=SYNTHETIC_ONLY" };
function box(id: string, display = "block") {
  const node = document.createElement(id.startsWith("programme-overlay") ? "iframe" : "a");
  node.id = id; node.style.display = display; document.body.append(node);
  vi.spyOn(node, "getBoundingClientRect").mockReturnValue({ x: 5, y: 9, left: 5, top: 9, right: 105, bottom: 39, width: 100, height: 30, toJSON: () => ({}) });
  return node;
}
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
describe("single-turn primary document scene sampling", () => {
  it("returns measured and absent boxes synchronously with frame/document identity", () => {
    box("outside-toast-target");
    const result = samplePrimaryScene(input);
    expect(result).not.toBeInstanceOf(Promise);
    expect(result.boxes).toHaveLength(6);
    expect(result.boxes.find(b => b.id === "outside-toast-target")).toMatchObject({ ...identity, state: "visible", x: 47, y: 91, width: 100, height: 30 });
    expect(result.boxes.find(b => b.id === "programme-overlay-b")).toMatchObject({ state: "absent", width: 0 });
  });
  it("does not mistake a layout box for visible when CSS hides the layer", () => {
    box("programme-overlay-a", "none");
    expect(samplePrimaryScene(input).boxes.find(b => b.id === "programme-overlay-a")).toMatchObject({ state: "hidden", width: 0, height: 0 });
  });
  it("reads nested intent in the same turn and emits categories, never receiver URLs", () => {
    const layer = box("programme-overlay-a");
    const nested = document.implementation.createHTMLDocument("synthetic");
    const anchor = nested.createElement("a"); anchor.id = "container"; anchor.href = input.harmUrl; anchor.target = "_blank"; nested.body.append(anchor);
    Object.defineProperty(layer, "contentDocument", { value: nested, configurable: true });
    const result = samplePrimaryScene(input);
    expect(result.boxes.find(b => b.id === layer.id)).toMatchObject({ declaredTarget: "harm-receiver", effectiveTarget: "harm-receiver", targetScope: "new-context" });
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_ONLY");
  });
  it("does not retry or wait for a replaced nested document to appear", () => {
    const layer = box("programme-overlay-b");
    Object.defineProperty(layer, "contentDocument", { value: null, configurable: true });
    expect(samplePrimaryScene(input).boxes.find(b => b.id === layer.id)).toMatchObject({ state: "visible", declaredTarget: "unknown", effectiveTarget: "unknown" });
  });
  it("classifies the existing benign receiver link and preserves its target scope", () => {
    const anchor = box("observatory-benign-receiver"); anchor.setAttribute("href", input.benignUrl); anchor.setAttribute("target", "_self");
    expect(samplePrimaryScene(input).boxes.find(b => b.id === anchor.id)).toMatchObject({ effectiveTarget: "benign-receiver", targetScope: "current-context" });
  });
});
