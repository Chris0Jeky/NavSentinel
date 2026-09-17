/** Bounded test-only diagnostics. Page data cannot choose an authoritative source. */
import { randomUUID } from "node:crypto";
import type { FormIntentSample } from "./form_observatory_probe";
import {
  FORM_EVIDENCE_POLICY,
  FORM_GAP_CODES,
  FORM_REQUIRED_OBSERVATION_MS,
  FORM_SCENARIO_ID,
  FORM_TRACE_MODE,
  FORM_TRACE_SCHEMA,
  FORM_VARIANTS,
  requiredFormReportsPresent,
} from "../../experiments/form-observatory/trace-contract.mjs";
export { FORM_TRACE_SCHEMA, FORM_VARIANTS };
export interface FormIdentity { head: string; tree: string; extensionSha256: string; fixtureSha256: string }
export interface FormEvent { id: string; sequence: number; elapsedMs: number; source: "runner" | "page" | "browser" | "sink" | "extension"; kind: string; data: Record<string, unknown> }
const choices: Record<keyof Omit<FormIntentSample, "ownerMatches">, readonly string[]> = {
  form: ["f", "g", "other"], submitter: ["a", "b", "none", "other"], action: ["harm", "benign", "fixture", "other"], declaredAction: ["harm", "benign", "fixture", "other"],
  actionSource: ["form", "submitter"], method: ["GET", "POST", "DIALOG"], encoding: ["urlencoded", "multipart", "plain"], target: ["self", "top", "parent", "blank", "named"],
  targetSource: ["form", "submitter", "base", "default"], targetOverride: ["absent", "empty", "present"], methodOverride: ["absent", "empty", "present"],
};
export function isFormIntent(value: unknown): value is FormIntentSample {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).length === Object.keys(choices).length + 1 && typeof v.ownerMatches === "boolean" &&
    Object.entries(choices).every(([key, values]) => typeof v[key] === "string" && values.includes(v[key] as string));
}
const FAULTS = new Set(FORM_GAP_CODES);
export class FormObservation {
  readonly runId = randomUUID();
  private events: FormEvent[] = [];
  private gaps = new Set<string>();
  private dropped = 0;
  private lastTime = 0;
  private browserVersion = "not-recorded";
  private start: number;
  private finished: ReturnType<FormObservation["snapshot"]> | null = null;
  private options: { variant: string; pairId: string; protectedArm: boolean; identity: FormIdentity; clock: () => number; maxEvents: number };
  constructor(options: { variant: string; pairId: string; protectedArm: boolean; identity: FormIdentity; clock?: () => number; maxEvents?: number }) {
    const maxEvents = options.maxEvents ?? 256;
    if (!FORM_VARIANTS.includes(options.variant) || !/^[a-f0-9]{64}$/.test(options.pairId) || typeof options.protectedArm !== "boolean" || !Number.isInteger(maxEvents) || maxEvents < 40 || maxEvents > 512) throw new Error("FORM_RECORDER_OPTIONS");
    if (![options.identity.head, options.identity.tree].every(v => /^[a-f0-9]{40}$/.test(v)) || ![options.identity.extensionSha256, options.identity.fixtureSha256].every(v => /^[a-f0-9]{64}$/.test(v))) throw new Error("FORM_IDENTITY_INVALID");
    this.options = { ...options, identity: { ...options.identity }, clock: options.clock ?? (() => performance.now()), maxEvents };
    this.start = this.options.clock(); if (!Number.isFinite(this.start)) throw new Error("FORM_CLOCK_INVALID");
    this.add("runner", "run.start", {});
  }
  private add(source: FormEvent["source"], kind: string, data: Record<string, unknown>, ordinary = false): void {
    if (this.finished) throw new Error("FORM_RECORDER_FINISHED");
    if (this.events.length >= this.options.maxEvents - (ordinary ? 32 : kind === "observation.end" ? 0 : 1)) { this.dropped = Math.min(1000000, this.dropped + 1); this.gaps.add("EVENTS_DROPPED"); return; }
    const now = kind === "run.start" ? 0 : this.options.clock() - this.start;
    if (!Number.isFinite(now) || now < this.lastTime || now > 86400000) this.gaps.add("CLOCK_INVALID");
    else this.lastTime = now;
    const sequence = this.events.length + 1;
    this.events.push({ id: `e${sequence}`, sequence, elapsedMs: this.lastTime, source, kind, data: structuredClone(data) });
  }
  pageReport(value: unknown): void {
    if (this.finished) throw new Error("FORM_RECORDER_FINISHED");
    const v = value as Record<string, unknown> | null;
    if ((!v || typeof v !== "object" || Array.isArray(v)) || typeof v.phase !== "string" || typeof v.primitive !== "string" || Object.keys(v).sort().join() !== "intent,phase,primitive" || !["input", "operation", "submit-event", "late-mutation", "prepared"].includes(String(v.phase)) ||
        !["native", "submit", "requestSubmit", "location"].includes(String(v.primitive)) || !isFormIntent(v.intent)) return;
    this.add("page", "form.intent", { phase: v.phase, primitive: v.primitive, intent: v.intent }, true);
  }
  browser(version: string): void { if (this.finished) throw new Error("FORM_RECORDER_FINISHED"); if (!/^[0-9]+(?:\.[0-9]+){1,4}$/.test(version)) throw new Error("BROWSER_VERSION_INVALID"); this.browserVersion = version; }
  input(action: "click" | "synthetic-click" | "allow-once" | "fill-required"): void { this.add("runner", "input.dispatched", { action }); }
  receiver(receipt: { role: "harm" | "benign"; method: string; accepted: boolean; ordinal: number }): void {
    this.add("sink", "receiver.attempt", { role: receipt.role, method: ["GET", "POST"].includes(receipt.method) ? receipt.method : "OTHER", accepted: receipt.accepted, ordinal: receipt.ordinal });
  }
  health(phase: "start" | "end", value: { ok: boolean; sequence: number }): void {
    if (!value.ok) this.gaps.add("RECEIVER_UNHEALTHY");
    this.add("sink", "receiver.health", { phase, ok: value.ok, sequence: value.sequence });
  }
  navigation(scope: "top" | "child", destination: "fixture" | "harm" | "benign" | "other"): void { this.add("browser", "navigation.committed", { scope, destination }); }
  product(code: "form-blocked" | "navigation-blocked" | "navigation-rollback" | "other-decision"): void { this.add("extension", "decision.report", { code }); }
  fail(code: string): void { if (this.finished) throw new Error("FORM_RECORDER_FINISHED"); if (!FAULTS.has(code)) throw new Error("UNKNOWN_FORM_FAULT"); this.gaps.add(code); }
  private snapshot(completed: boolean) {
    return { schema: FORM_TRACE_SCHEMA, mode: FORM_TRACE_MODE, scenarioId: FORM_SCENARIO_ID, variant: this.options.variant, pairId: this.options.pairId,
      runId: this.runId, protectedArm: this.options.protectedArm, identity: { ...this.options.identity }, completed, browserVersion: this.browserVersion,
      requiredObservationMs: FORM_REQUIRED_OBSERVATION_MS, dropped: this.dropped, gaps: [...this.gaps], events: structuredClone(this.events), evidencePolicy: FORM_EVIDENCE_POLICY };
  }
  finish(completed: boolean) {
    if (!this.finished) {
      this.add("runner", "observation.end", {});
      if (completed) {
        const health = this.events.filter(event => event.kind === "receiver.health");
        const healthComplete = health.length === 2 &&
          health[0]?.data.phase === "start" && health[0]?.data.ok === true && health[0]?.data.sequence === 1 &&
          health[1]?.data.phase === "end" && health[1]?.data.ok === true && health[1]?.data.sequence === 2;
        const reportsComplete = requiredFormReportsPresent(this.events, this.options.variant, this.options.protectedArm);
        if (!healthComplete || !reportsComplete || this.browserVersion === "not-recorded") this.gaps.add("OBSERVATION_INCOMPLETE");
      }
      if (this.dropped !== 0 || this.gaps.size !== 0) completed = false;
      this.finished = this.snapshot(completed);
    }
    return structuredClone(this.finished);
  }
}
