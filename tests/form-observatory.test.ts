// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
import { sampleFormIntent, formProbeScript } from "./e2e/form_observatory_probe";
import { FormObservation } from "./e2e/form_observatory";
const harm = "http://127.0.0.1:7000/sink/harm/private/accept", benign = "http://127.0.0.1:7000/sink/benign/private/accept";
let form: HTMLFormElement, button: HTMLButtonElement;
beforeEach(() => {
  document.head.innerHTML = '<base href="http://localhost:7000/child">';
  document.body.innerHTML = `<form id="f" action="${benign}" method="post" target="_top"><button id="a">Go</button><input value="SECRET"></form><form id="g"></form>`;
  form = document.querySelector("form")!; button = document.querySelector("button")!;
});
const sample = (submitter: HTMLButtonElement | null = button) => sampleFormIntent({ form, submitter, harmUrl: harm, benignUrl: benign });
it("samples effective intent without URLs, tokens or form values", () => {
  expect(sample()).toMatchObject({ form: "f", submitter: "a", action: "benign", declaredAction: "benign", method: "POST", encoding: "urlencoded", target: "top", actionSource: "form", ownerMatches: true });
  expect(JSON.stringify(sample())).not.toMatch(/private|SECRET|localhost|127\.0\.0\.1/);
});
it("separates submitter override from the form and submit() with no submitter", () => {
  form.action = harm; button.setAttribute("formaction", benign); expect(sample()).toMatchObject({ action: "benign", declaredAction: "harm", actionSource: "submitter" });
  expect(sample(null)).toMatchObject({ action: "harm", submitter: "none", actionSource: "form" });
});
it("explicit-empty target differs from absent target with base inheritance", () => {
  form.removeAttribute("target"); document.querySelector("base")!.target = "_top"; expect(sample().target).toBe("top");
  button.setAttribute("formtarget", ""); expect(sample()).toMatchObject({ target: "self", targetSource: "submitter", targetOverride: "empty" });
});
for (const value of ["", "invalid", " get "]) it(`method override ${JSON.stringify(value)} defaults to GET`, () => { button.setAttribute("formmethod", value); expect(sample().method).toBe("GET"); });
it("resolves relative action against current base", () => { form.setAttribute("action", "accept"); document.querySelector("base")!.href = harm.replace(/accept$/, ""); expect(sample().action).toBe("harm"); });
it("reports ownership mismatch without arbitrary DOM IDs", () => { document.querySelector("#g")!.append(button); expect(sample().ownerMatches).toBe(false); button.id = "SECRET"; expect(sample().submitter).toBe("other"); });
it("does not read the input value", () => { Object.defineProperty(document.querySelector("input"), "value", { get: () => { throw new Error("VALUE_READ"); } }); expect(sample().action).toBe("benign"); });
it("serialized probe is syntactically valid JavaScript", () => { const script = formProbeScript(harm, benign); expect(() => new Function(script)).not.toThrow(); expect(script).not.toContain("</script>"); });
const identity = { head: "a".repeat(40), tree: "b".repeat(40), extensionSha256: "c".repeat(64), fixtureSha256: "d".repeat(64) };
const make = (clock = () => 10, maxEvents = 128) => new FormObservation({ variant: "action-substitution", pairId: "e".repeat(64), protectedArm: true, identity, clock, maxEvents });
it("does not certify a completed run without observer evidence", () => { const t = make().finish(true); expect(t.completed).toBe(false); expect(t.gaps).toContain("OBSERVATION_INCOMPLETE"); });
it("certifies a completed run only after intent and health evidence", () => { const r = make(); r.health("start", { ok: true, sequence: 1 }); r.pageReport({ phase: "operation", intent: sample(), primitive: "requestSubmit" }); r.health("end", { ok: true, sequence: 2 }); const t = r.finish(true); expect(t.completed).toBe(true); expect(t.gaps).not.toContain("OBSERVATION_INCOMPLETE"); });
it("page cannot impersonate a receiver", () => { const r = make(); r.pageReport({ source: "sink", phase: "input", intent: sample(), primitive: "native" }); const t = r.finish(true); expect(t.dropped).toBe(1); expect(t.events.some(e => e.source === "sink")).toBe(false); });
it("unknown sensitive fields are refused", () => { const r = make(); r.pageReport({ phase: "input", intent: sample(), primitive: "native" }); r.pageReport({ phase: "input", intent: { ...sample(), password: "SECRET" }, primitive: "native" }); const t = r.finish(true); expect(t.dropped).toBe(1); expect(JSON.stringify(t)).not.toContain("SECRET"); });
it("preserves accepted and rejected receiver attempts", () => { const r = make(); r.receiver({ role: "harm", method: "POST", accepted: true, ordinal: 1 }); r.receiver({ role: "harm", method: "POST", accepted: false, ordinal: 2 }); expect(r.finish(true).events.filter(e => e.kind === "receiver.attempt")).toHaveLength(2); });
it("overflow retains the consequence and terminal record", () => { const r = make(() => 10, 40); for (let i = 0; i < 100; i++) r.pageReport({ phase: "input", intent: sample(), primitive: "native" }); r.receiver({ role: "harm", method: "POST", accepted: true, ordinal: 1 }); const t = r.finish(true); expect(t.events.length).toBeLessThanOrEqual(40); expect(t.dropped).toBeGreaterThan(0); expect(t.events.at(-1)?.kind).toBe("observation.end"); expect(t.events.some(e => e.kind === "receiver.attempt")).toBe(true); });
it("terminal failure retains positive evidence", () => { const r = make(); r.receiver({ role: "harm", method: "POST", accepted: true, ordinal: 1 }); r.fail("RUNNER_FAILED"); const t = r.finish(false); expect(t.completed).toBe(false); expect(t.gaps).toContain("RUNNER_FAILED"); expect(t.events.some(e => e.kind === "receiver.attempt")).toBe(true); });
it("finished snapshots cannot be mutated through references", () => { const r = make(); const t = r.finish(true); t.gaps.push("FORGED"); expect(r.finish(true).gaps).not.toContain("FORGED"); expect(() => r.input("click")).toThrow(/FINISHED/); });
it("reversed clock is explicit, not a backwards timeline", () => { let time = 10; const r = make(() => time); time = 20; r.input("click"); time = 5; const t = r.finish(true); expect(t.gaps).toContain("CLOCK_INVALID"); expect(t.events.at(-1)!.elapsedMs).toBeGreaterThanOrEqual(t.events[1]!.elapsedMs); });
it("failed health remains explicit", () => { const r = make(); r.health("start", { ok: true, sequence: 1 }); r.health("end", { ok: false, sequence: 1 }); expect(r.finish(true).gaps).toContain("RECEIVER_UNHEALTHY"); });
it("serialized probe executes and returns only a minimized snapshot", () => {
 const messages: unknown[] = [];
 const run = new Function("f", "a", "globalThis", formProbeScript(harm, benign) + ";__nsFormReport('operation',f,a,'requestSubmit');");
 run(form, button, { __nsFormObservation: (value: unknown) => { messages.push(value); } });
 expect(messages).toHaveLength(1); expect(messages[0]).toMatchObject({phase:"operation",intent:{action:"benign",submitter:"a"}});
});
it("serialized probe reports an absent observer instead of suppressing it", () => { const faults: unknown[] = []; const run = new Function("f", "a", "globalThis", formProbeScript(harm, benign) + ";__nsFormReport('operation',f,a,'requestSubmit');"); run(form, button, { __nsFormObservationFault: (code: unknown) => { faults.push(code); } }); expect(faults).toEqual(["PROBE_REJECTED"]); });
it("serialized probe reports a rejected receiver callback", async () => { const faults: unknown[] = []; const run = new Function("f", "a", "globalThis", formProbeScript(harm, benign) + ";__nsFormReport('operation',f,a,'requestSubmit');"); run(form, button, { __nsFormObservation: () => Promise.reject(new Error("receiver")), __nsFormObservationFault: (code: unknown) => { faults.push(code); } }); await Promise.resolve(); expect(faults).toEqual(["RECEIVER_CALLBACK_LOSS"]); });
it("page phase coercion cannot store a non-string object", () => { const r = make(); r.pageReport({phase:{toString:()=>"input"},primitive:"native",intent:sample()}); expect(r.finish(true).dropped).toBe(1); });
it("the initial boundary is exactly zero even if the clock advances between calls", () => { let time = 0; const r = make(() => (time += 10)); expect(r.finish(true).events[0]?.elapsedMs).toBe(0); });
it("unknown gap text cannot enter the report", () => { const r = make(); expect(() => r.fail("PRIVATE_TEXT")).toThrow(/UNKNOWN_FORM_FAULT/); expect(JSON.stringify(r.finish(false))).not.toContain("PRIVATE_TEXT"); });
