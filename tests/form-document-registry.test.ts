import { describe, expect, it } from "vitest";
import { FormDocumentRegistry, type DocumentBinding } from "./e2e/form_document_registry";
const origin = "http://localhost:1234";
function setup(maxDocuments = 64) {
  const started: DocumentBinding[] = [], ended: { binding: DocumentBinding; reason: string }[] = [], rejected: string[] = [];
  const registry = new FormDocumentRegistry({ origin, maxDocuments, started: b => started.push(b), ended: (b, reason) => ended.push({ binding: b, reason }), rejected: reason => rejected.push(reason) });
  registry.frameNavigated({ id: "native-top", loaderId: "load-top" });
  registry.frameNavigated({ id: "native-child", parentId: "native-top", loaderId: "load-child" });
  const create = (id = 7, frameId = "native-child", uniqueId = `realm-${id}`) => registry.contextCreated({ id, uniqueId, origin, auxData: { isDefault: true, frameId } });
  return { registry, started, ended, rejected, create };
}
describe("browser-owned form document registry", () => {
  it("binds context to copied pseudonymous frame/document, never raw IDs", () => {
    const s = setup(); s.create(); const b = s.registry.resolve(7)!;
    expect(b).toEqual({ frameId: "frame-2", documentId: "document-1", scope: "child" });
    expect(JSON.stringify(s.started)).not.toContain("native");
    b.documentId = "mutated"; expect(s.registry.resolve(7)?.documentId).toBe("document-1");
  });
  it("same-origin same-URL siblings get different frame and document identity", () => {
    const s = setup(); s.create(); s.registry.frameNavigated({ id: "sibling", parentId: "native-top", loaderId: "load-sibling" }); s.create(8, "sibling");
    expect(s.registry.resolve(8)?.documentId).not.toBe(s.registry.resolve(7)?.documentId);
    expect(s.registry.resolve(8)?.frameId).not.toBe(s.registry.resolve(7)?.frameId);
  });
  it("navigation keeps the frame token but retires the old document", () => {
    const s = setup(); s.create(); const before = s.registry.resolve(7)!;
    s.registry.frameNavigated({ id: "native-child", parentId: "native-top", loaderId: "load-new" });
    expect(s.registry.resolve(7)).toBeNull(); s.create(8);
    expect(s.registry.resolve(8)?.frameId).toBe(before.frameId); expect(s.registry.resolve(8)?.documentId).not.toBe(before.documentId);
    expect(s.ended[0]?.reason).toBe("navigation");
  });
  it("repeated loader information does not fabricate a document change", () => {
    const s = setup(); s.create(); s.registry.frameNavigated({ id: "native-child", parentId: "native-top", loaderId: "load-child" }); expect(s.ended).toHaveLength(0);
  });
  it("top navigation invalidates descendant contexts too", () => {
    const s = setup(); s.create(); s.create(8, "native-top"); s.registry.frameNavigated({ id: "native-top", loaderId: "new-top" });
    expect(s.registry.resolve(7)).toBeNull(); expect(s.registry.resolve(8)).toBeNull(); expect(s.ended).toHaveLength(2);
  });
  it.each(["destroy", "clear", "detach"])("%s retires contexts and refuses later binding messages", action => {
    const s = setup(); s.create();
    if (action === "destroy") s.registry.contextDestroyed(7); else if (action === "clear") s.registry.contextsCleared(); else s.registry.frameDetached("native-child");
    expect(s.registry.resolve(7)).toBeNull(); expect(s.ended).toHaveLength(1); expect(s.rejected).toContain("DOCUMENT_CONTEXT_UNKNOWN");
  });
  it("numeric context ID reuse fails closed, never relabels a delayed callback", () => {
    const s = setup(); s.create(); s.registry.contextDestroyed(7); s.create(7, "native-child", "new-realm");
    expect(s.registry.resolve(7)).toBeNull(); expect(s.rejected).toContain("DOCUMENT_CONTEXT_REUSED");
  });
  it("a duplicate browser notification does not add another document", () => { const s = setup(); s.create(); s.create(); expect(s.started).toHaveLength(1); });
  it("ignores isolated worlds and nonfixture origins, but refuses their reports", () => {
    const s = setup();
    s.registry.contextCreated({ id: 1, uniqueId: "isolated", origin, auxData: { isDefault: false, frameId: "native-child" } });
    s.registry.contextCreated({ id: 2, uniqueId: "alien", origin: "http://127.0.0.1:1234", auxData: { isDefault: true, frameId: "native-child" } });
    expect(s.started).toHaveLength(0); expect(s.registry.resolve(1)).toBeNull(); expect(s.registry.resolve(2)).toBeNull();
  });
  it("missing frame association is not guessed", () => {
    const s = setup(); s.create(7, "missing"); expect(s.registry.resolve(7)).toBeNull(); expect(s.rejected).toContain("DOCUMENT_FRAME_UNKNOWN");
  });
  it("finite document budget stops admitting new identities", () => {
    const s = setup(1); s.create(); s.registry.contextDestroyed(7); s.create(8); expect(s.registry.resolve(8)).toBeNull(); expect(s.rejected).toContain("DOCUMENT_LIMIT");
  });
  it("close is idempotent and ignores later callbacks without resurrecting state", () => {
    const s = setup(); s.create(); s.registry.close(); s.registry.close(); s.create(9); expect(s.registry.resolve(9)).toBeNull(); expect(s.ended).toHaveLength(1);
  });
});
