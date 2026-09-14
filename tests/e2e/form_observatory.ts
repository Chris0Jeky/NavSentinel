/** Bounded test-only diagnostics. Page data cannot choose an authoritative source. */
import { randomUUID } from "node:crypto";
import type { DocumentBinding, DocumentEndReason } from "./form_document_registry";
import type { FormIntentSample } from "./form_observatory_probe";
export const FORM_DOCUMENT_EXPERIMENTS = ["form-campaign", "same-url-siblings", "same-frame-reload", "same-document-navigation", "frame-replacement", "spoofed-identity-disposal", "borrowed-reporting-function"] as const;
export type FormDocumentExperiment = typeof FORM_DOCUMENT_EXPERIMENTS[number];
export const FORM_TRACE_SCHEMA = "navsentinel.observatory.form.v1";
export const FORM_VARIANTS = ["alternate-submitter", "action-substitution", "target-mutation", "method-mutation", "enctype-mutation", "base-href", "base-target", "reassociation", "expired", "mismatch-burn", "synthetic", "location-same", "location-different", "late-submit", "exact-submit", "exact-request", "native", "server-redirect", "slow-response", "empty-target", "inherited-target", "empty-method", "invalid-method", "self", "dialog", "validation", "replay", "allow-once", "allow-mutated", "mixed"] as const;
export interface FormIdentity { head: string; tree: string; extensionSha256: string; fixtureSha256: string }
export interface FormEvent { id: string; sequence: number; elapsedMs: number; source: "runner" | "page" | "browser" | "sink" | "extension"; kind: string; data: Record<string, unknown>; binding?: DocumentBinding }
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
const FAULTS = ["RUNNER_FAILED", "CLOCK_INVALID", "RECEIVER_UNHEALTHY", "RECEIVER_CALLBACK_LOSS", "PAGE_ERROR", "CLEANUP_FAILED", "PROBE_REJECTED", "EVENTS_DROPPED", "PRODUCT_READ_FAILED", "DOCUMENT_BINDING_INVALID", "DOCUMENT_CONTEXT_UNKNOWN", "DOCUMENT_CONTEXT_REUSED", "DOCUMENT_FRAME_UNKNOWN", "DOCUMENT_LIMIT", "DOCUMENT_METADATA_INVALID", "DOCUMENT_TRANSPORT_LOST"];
export class FormObservation {
  readonly runId = randomUUID();
  private readonly seenDocuments = new Set<string>();
  private readonly activeDocuments = new Map<string, DocumentBinding>();
  private events: FormEvent[] = [];
  private gaps = new Set<string>();
  private dropped = 0;
  private lastTime = 0;
  private browserVersion = "not-recorded";
  private start: number;
  private finished: ReturnType<FormObservation["snapshot"]> | null = null;
  private options: { variant: string; pairId: string; protectedArm: boolean; identity: FormIdentity; documentBound?: boolean; documentExperiment?: FormDocumentExperiment; clock: () => number; maxEvents: number };
  constructor(options: { variant: string; pairId: string; protectedArm: boolean; identity: FormIdentity; documentBound?: boolean; documentExperiment?: FormDocumentExperiment; clock?: () => number; maxEvents?: number }) {
    if (options.documentExperiment && (!options.documentBound || !FORM_DOCUMENT_EXPERIMENTS.includes(options.documentExperiment))) throw new Error("FORM_EXPERIMENT_INVALID");
    const maxEvents = options.maxEvents ?? 256;
    if (!FORM_VARIANTS.includes(options.variant as typeof FORM_VARIANTS[number]) || !/^[a-f0-9]{64}$/.test(options.pairId) || typeof options.protectedArm !== "boolean" || !Number.isInteger(maxEvents) || maxEvents < 40 || maxEvents > 512) throw new Error("FORM_RECORDER_OPTIONS");
    if (![options.identity.head, options.identity.tree].every(v => /^[a-f0-9]{40}$/.test(v)) || ![options.identity.extensionSha256, options.identity.fixtureSha256].every(v => /^[a-f0-9]{64}$/.test(v))) throw new Error("FORM_IDENTITY_INVALID");
    this.options = { ...options, identity: { ...options.identity }, clock: options.clock ?? (() => performance.now()), maxEvents };
    this.start = this.options.clock(); if (!Number.isFinite(this.start)) throw new Error("FORM_CLOCK_INVALID");
    this.add("runner", "run.start", {});
  }
  private add(source: FormEvent["source"], kind: string, data: Record<string, unknown>, ordinary = false, binding?: DocumentBinding): void {
    if (this.finished) throw new Error("FORM_RECORDER_FINISHED");
    // Lifecycle churn is observation traffic, not a receiver consequence.
    ordinary ||= kind === "document.started" || kind === "document.ended";
    if (this.events.length >= this.options.maxEvents - (ordinary ? 32 : kind === "observation.end" ? 0 : 1)) { this.dropped = Math.min(1000000, this.dropped + 1); this.gaps.add("EVENTS_DROPPED"); return; }
    const now = kind === "run.start" ? 0 : this.options.clock() - this.start;
    if (!Number.isFinite(now) || now < this.lastTime || now > 86400000) this.gaps.add("CLOCK_INVALID");
    else this.lastTime = now;
    const sequence = this.events.length + 1;
    this.events.push({ id: `e${sequence}`, sequence, elapsedMs: this.lastTime, source, kind, data: structuredClone(data), ...(binding ? { binding: { ...binding } } : {}) });
  }
  private liveBinding(binding?: DocumentBinding): boolean {
    const active = binding && this.activeDocuments.get(binding.documentId);
    return !!active && !!binding && Object.keys(binding).sort().join() === "documentId,frameId,scope" && active.frameId === binding.frameId && active.scope === binding.scope;
  }
  documentStarted(binding: DocumentBinding): void {
    if (Object.keys(binding).sort().join() !== "documentId,frameId,scope" || this.seenDocuments.size >= 256 || !this.options.documentBound || !/^frame-[1-9][0-9]{0,2}$/.test(binding.frameId) || !/^document-[1-9][0-9]{0,2}$/.test(binding.documentId) || !["top", "child"].includes(binding.scope) || this.seenDocuments.has(binding.documentId)) { this.fail("DOCUMENT_BINDING_INVALID"); return; }
    this.seenDocuments.add(binding.documentId); this.activeDocuments.set(binding.documentId, { ...binding }); this.add("browser", "document.started", {}, false, binding);
  }
  documentEnded(binding: DocumentBinding, reason: DocumentEndReason): void {
    if (!this.liveBinding(binding)) { this.fail("DOCUMENT_BINDING_INVALID"); return; }
    this.activeDocuments.delete(binding.documentId); this.add("browser", "document.ended", { reason }, false, binding);
  }
  pageReport(value: unknown, binding?: DocumentBinding): void {
    if (this.finished) throw new Error("FORM_RECORDER_FINISHED");
    if (this.options.documentBound && !this.liveBinding(binding)) { this.fail("DOCUMENT_BINDING_INVALID"); return; }
    const v = value as Record<string, unknown> | null;
    if ((!v || typeof v !== "object" || Array.isArray(v)) || typeof v.phase !== "string" || typeof v.primitive !== "string" || Object.keys(v).sort().join() !== "intent,phase,primitive" || !["input", "operation", "submit-event", "late-mutation", "prepared"].includes(String(v.phase)) ||
        !["native", "submit", "requestSubmit", "location"].includes(String(v.primitive)) || !isFormIntent(v.intent)) {
      this.dropped = Math.min(1000000, this.dropped + 1); this.gaps.add("PROBE_REJECTED"); return;
    }
    this.add("page", "form.intent", { phase: v.phase, primitive: v.primitive, intent: v.intent }, true, binding);
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
  fail(code: string): void { if (this.finished) throw new Error("FORM_RECORDER_FINISHED"); if (!FAULTS.includes(code)) throw new Error("UNKNOWN_FORM_FAULT"); this.gaps.add(code); }
  currentEvents(): FormEvent[] { return structuredClone(this.events); }
  private snapshot(completed: boolean) {
    return { schema: this.options.documentBound ? "navsentinel.observatory.form.v2" : FORM_TRACE_SCHEMA, ...(this.options.documentBound ? { bindingPolicy: "CDP_DEFAULT_WORLD_DOCUMENT", experiment: this.options.documentExperiment ?? "form-campaign" } : {}), mode: "synthetic", scenarioId: "issue688-form-intent", variant: this.options.variant, pairId: this.options.pairId,
      runId: this.runId, protectedArm: this.options.protectedArm, identity: { ...this.options.identity }, completed, browserVersion: this.browserVersion,
      requiredObservationMs: 2300, dropped: this.dropped, gaps: [...this.gaps], events: structuredClone(this.events), evidencePolicy: "FORM_DIAGNOSTIC_NOT_FOUR_ARM_CERTIFICATION" };
  }
  finish(completed: boolean) { if (!this.finished) { for (const binding of this.activeDocuments.values()) this.documentEnded(binding, "collector-closed"); this.add("runner", "observation.end", {}); this.finished = this.snapshot(completed); } return structuredClone(this.finished); }
}
