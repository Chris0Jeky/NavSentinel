import { EventEmitter } from "node:events";
import { expect, it } from "vitest";
import type { Page } from "@playwright/test";
import { attachFormDocumentObserver } from "./e2e/form_document_observer";
import { FormObservation } from "./e2e/form_observatory";
function fixture() {
  const wire = new EventEmitter(), pageEvents = new EventEmitter(), commands: string[] = [];
  const session = Object.assign(wire, { send: async (name: string) => { commands.push(name); if (name === "Page.getFrameTree") return { frameTree: { frame: { id: "top", loaderId: "load" }, childFrames: [{ frame: { id: "child", parentId: "top", loaderId: "load-child" } }] } }; return { identifier: "script-1" }; }, detach: async () => { commands.push("detach"); } });
  const page = Object.assign(pageEvents, { context: () => ({ newCDPSession: async () => session }), isClosed: () => false }) as unknown as Page;
  const trace = new FormObservation({ variant: "action-substitution", pairId: "a".repeat(64), protectedArm: true, documentBound: true,
    identity: { head: "b".repeat(40), tree: "c".repeat(40), extensionSha256: "d".repeat(64), fixtureSha256: "e".repeat(64) } });
  const context = (id = 4, frameId = "child") => wire.emit("Runtime.executionContextCreated", { context: { id, uniqueId: `realm-${id}`, origin: "http://localhost:1234", auxData: { isDefault: true, frameId } } });
  const payload = { phase: "input", primitive: "native", intent: { form: "f", submitter: "a", action: "benign", declaredAction: "benign", actionSource: "form", method: "POST", encoding: "urlencoded", target: "top", targetSource: "form", targetOverride: "absent", methodOverride: "absent", ownerMatches: true } };
  const report = (value: unknown = payload, executionContextId = 4) => wire.emit("Runtime.bindingCalled", { name: "__nsFormDocumentWire", executionContextId, payload: JSON.stringify(value) });
  return { wire, page, trace, context, payload, report, commands };
}
it("CDP envelope chooses identity and page input cannot overwrite it", async () => {
  const s = fixture(), observer = await attachFormDocumentObserver(s.page, s.trace, "http://localhost:1234");
  s.context(); s.report(); s.report({ ...s.payload, documentId: "document-99" }); await observer.dispose();
  const t = s.trace.finish(true); expect(t.events.find(e => e.kind === "form.intent")?.binding?.documentId).toBe("document-1"); expect(t.gaps).toContain("PROBE_REJECTED");
});
it("destroyed-source and unknown context reports cannot be attributed to current page", async () => {
  const s = fixture(), observer = await attachFormDocumentObserver(s.page, s.trace, "http://localhost:1234"); s.context();
  s.wire.emit("Runtime.executionContextDestroyed", { executionContextId: 4 }); s.report(); s.report(s.payload, 900);
  await observer.dispose(); const t = s.trace.finish(true); expect(t.events.some(e => e.kind === "form.intent")).toBe(false); expect(t.gaps).toContain("DOCUMENT_CONTEXT_UNKNOWN");
});
it("oversized and malformed wire JSON is rejected without retaining it", async () => {
  const s = fixture(), observer = await attachFormDocumentObserver(s.page, s.trace, "http://localhost:1234"); s.context();
  for (const payload of ["{SECRET", "SECRET".repeat(2000)]) s.wire.emit("Runtime.bindingCalled", { name: "__nsFormDocumentWire", executionContextId: 4, payload });
  await observer.dispose(); const t = s.trace.finish(true); expect(t.gaps).toContain("PROBE_REJECTED"); expect(JSON.stringify(t)).not.toContain("SECRET");
});
it("dispose removes listeners and unregisters the fixed binding", async () => {
  const s = fixture(), observer = await attachFormDocumentObserver(s.page, s.trace, "http://localhost:1234"); s.context(); await observer.dispose(); await observer.dispose();
  const first = s.trace.finish(true); s.report(); expect(s.trace.finish(true)).toEqual(first);
  expect(s.commands).toContain("Runtime.removeBinding"); expect(s.commands.filter(v => v === "detach")).toHaveLength(1); expect(s.wire.eventNames()).toHaveLength(0);
});
it("unexpected transport detachment is visible, planned browser close is not a fault", async () => {
  for (const planned of [false, true]) {
    const s = fixture(), observer = await attachFormDocumentObserver(s.page, s.trace, "http://localhost:1234"); s.context(); if (planned) observer.prepareToClose();
    s.wire.emit("Inspector.detached", { reason: "target_closed" }); await observer.dispose();
    expect(s.trace.finish(true).gaps.includes("DOCUMENT_TRANSPORT_LOST")).toBe(!planned);
  }
});
