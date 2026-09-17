import type { SceneBox } from "../../experiments/evidence-observatory/recorder.mjs";
export type SceneInput = {
  context: Pick<SceneBox, "frameId" | "documentId" | "parentFrameId">;
  frameRect: { x: number; y: number; width: number; height: number };
  contentOffset: { x: number; y: number };
  viewport: { width: number; height: number }; harmUrl: string; benignUrl: string;
};
/** Runs in one primary-document JS turn. No awaits or stale nested Frame handles.
 * The parent frame's viewport offset is sampled separately; this is a bounded
 * untransformed two-level fixture, not an atomic snapshot of arbitrary sites.
 */
export function samplePrimaryScene(input: SceneInput): { width: number; height: number; boxes: SceneBox[] } {
  const classify = (url: string | null): SceneBox["effectiveTarget"] => url === input.harmUrl ? "harm-receiver" : url === input.benignUrl ? "benign-receiver" : url === "#" ? "same-document" : url ? "unknown" : "none";
  const boxes: SceneBox[] = [{ id: "media-frame", ...input.context, kind: "frame", state: "visible",
    x: Math.round(input.frameRect.x), y: Math.round(input.frameRect.y), width: Math.round(input.frameRect.width), height: Math.round(input.frameRect.height),
    declaredTarget: "none", effectiveTarget: "none", targetScope: "none" }];
  const add = (id: string, kind: "control" | "attack"): void => {
    const node = document.getElementById(id);
    const rect = node?.getBoundingClientRect(), style = node ? getComputedStyle(node) : null;
    const visible = Boolean(rect && rect.width > 0 && rect.height > 0 && style?.display !== "none" && !["hidden", "collapse"].includes(style?.visibility ?? ""));
    let declaredTarget: SceneBox["declaredTarget"] = "none", effectiveTarget: SceneBox["effectiveTarget"] = "none", targetScope: SceneBox["targetScope"] = "none";
    if (node && (kind === "attack" || id === "observatory-benign-receiver")) {
      const anchor = kind === "attack" && node.tagName === "IFRAME" ? (node as HTMLIFrameElement).contentDocument?.getElementById("container") : node;
      if (anchor?.tagName === "A") {
        declaredTarget = classify(anchor.getAttribute("href")); effectiveTarget = classify((anchor as HTMLAnchorElement).href);
        const scope = anchor.getAttribute("target");
        targetScope = scope === "_blank" ? "new-context" : !scope || scope === "_self" ? "current-context" : "unknown";
      } else { declaredTarget = "unknown"; effectiveTarget = "unknown"; targetScope = "unknown"; }
    }
    boxes.push({ id, ...input.context, kind, state: !node ? "absent" : visible ? "visible" : "hidden",
      x: visible ? Math.round(rect!.x + input.contentOffset.x) : 0, y: visible ? Math.round(rect!.y + input.contentOffset.y) : 0,
      width: visible ? Math.round(rect!.width) : 0, height: visible ? Math.round(rect!.height) : 0,
      declaredTarget, effectiveTarget, targetScope });
  };
  for (const id of ["outside-toast-target", "programme-benign-control", "observatory-benign-receiver"]) add(id, "control");
  for (const id of ["programme-overlay-a", "programme-overlay-b"]) add(id, "attack");
  return { ...input.viewport, boxes };
}
