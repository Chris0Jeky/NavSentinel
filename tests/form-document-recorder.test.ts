import { expect, it } from "vitest";
import { FormObservation } from "./e2e/form_observatory";
const identity = { head: "a".repeat(40), tree: "b".repeat(40), extensionSha256: "c".repeat(64), fixtureSha256: "d".repeat(64) };
const sample = () => ({ form: "f", submitter: "a", action: "benign", declaredAction: "benign", actionSource: "form", method: "POST", encoding: "urlencoded", target: "top", targetSource: "form", targetOverride: "absent", methodOverride: "absent", ownerMatches: true });
const bound = () => new FormObservation({ variant: "action-substitution", pairId: "e".repeat(64), protectedArm: true, identity, documentBound: true });
const binding = { frameId: "frame-2", documentId: "document-1", scope: "child" as const };
it("v2 requires a live browser binding for every page report", () => {
  const r = bound(); r.pageReport({ phase: "input", intent: sample(), primitive: "native" });
  expect(r.finish(true).gaps).toContain("DOCUMENT_BINDING_INVALID");
});
it("v2 records document lifecycle and copied source identity", () => {
  const r = bound(); r.documentStarted(binding); r.pageReport({ phase: "input", intent: sample(), primitive: "native" }, binding); r.documentEnded(binding, "navigation");
  const t = r.finish(true); expect(t.schema).toBe("navsentinel.observatory.form.v2");
  expect(t.events.find(e => e.kind === "form.intent")?.binding).toEqual(binding);
  expect(t.events.filter(e => e.kind.startsWith("document."))).toHaveLength(2);
});
it("a late message cannot be relabelled as the replacement document", () => {
  const r = bound(); r.documentStarted(binding); r.documentEnded(binding, "navigation");
  r.documentStarted({ ...binding, documentId: "document-2" });
  r.pageReport({ phase: "operation", intent: sample(), primitive: "native" }, binding);
  const t = r.finish(true); expect(t.gaps).toContain("DOCUMENT_BINDING_INVALID"); expect(t.events.some(e => e.kind === "form.intent")).toBe(false);
});
it("binding-shaped payloads remain untrusted and cannot set attribution", () => {
  const r = bound(); r.documentStarted(binding); r.pageReport({ phase: "input", primitive: "native", intent: sample(), binding }, binding);
  const t = r.finish(true); expect(t.gaps).toContain("PROBE_REJECTED"); expect(t.events.some(e => e.kind === "form.intent")).toBe(false);
});
it("receiver facts never inherit the most recent page document", () => {
  const r = bound(); r.documentStarted(binding); r.receiver({ role: "harm", method: "POST", ordinal: 1, accepted: true });
  expect(r.finish(true).events.find(e => e.kind === "receiver.attempt")?.binding).toBeUndefined();
});
it("lifecycle exercises are explicitly labeled and never masquerade as form campaigns", () => {
  const r = new FormObservation({ variant: "exact-request", pairId: "e".repeat(64), protectedArm: false, identity, documentBound: true, documentExperiment: "same-url-siblings" });
  expect(r.finish(true).experiment).toBe("same-url-siblings");
  expect(bound().finish(true).experiment).toBe("form-campaign");
});
it("document churn cannot consume the receiver and terminal reserve", () => {
  const r = new FormObservation({ variant: "exact-request", pairId: "e".repeat(64), protectedArm: false, identity, documentBound: true, maxEvents: 40 });
  for (let i = 1; i <= 30; i++) {
    const b = { frameId: "frame-1", documentId: `document-${i}`, scope: "child" as const };
    r.documentStarted(b); r.documentEnded(b, "navigation");
  }
  r.receiver({ role: "harm", method: "POST", ordinal: 1, accepted: true });
  const t = r.finish(true);
  expect(t.events.some(e => e.kind === "receiver.attempt" && e.data.role === "harm")).toBe(true);
  expect(t.events.at(-1)?.kind).toBe("observation.end"); expect(t.gaps).toContain("EVENTS_DROPPED");
});
it("child fixture navigation churn cannot consume consequential navigation or receiver capacity", () => {
  const r = new FormObservation({ variant: "exact-request", pairId: "e".repeat(64), protectedArm: false, identity, documentBound: true, maxEvents: 40 });
  for (let i = 0; i < 64; i++) r.navigation("child", "fixture");
  r.navigation("top", "harm");
  r.receiver({ role: "harm", method: "POST", ordinal: 1, accepted: true });
  const t = r.finish(false);
  expect(t.events.some(e => e.kind === "navigation.committed" && e.data.scope === "top" && e.data.destination === "harm")).toBe(true);
  expect(t.events.some(e => e.kind === "receiver.attempt" && e.data.role === "harm")).toBe(true);
  expect(t.events.at(-1)?.kind).toBe("observation.end");
  expect(t.events.filter(e => e.kind === "navigation.committed")).toHaveLength(8);
  expect(t.gaps).toContain("EVENTS_DROPPED");
});
