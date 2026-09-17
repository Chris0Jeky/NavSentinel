/** Fixed, synthetic form-observatory trace contract shared by recorder and certifier. */
export const FORM_TRACE_SCHEMA = "navsentinel.observatory.form.v1";
export const FORM_TRACE_MODE = "synthetic";
export const FORM_SCENARIO_ID = "issue688-form-intent";
export const FORM_REQUIRED_OBSERVATION_MS = 2300;
export const FORM_EVIDENCE_POLICY = "FORM_DIAGNOSTIC_NOT_FOUR_ARM_CERTIFICATION";

export const FORM_PAIRED_VARIANTS = Object.freeze([
  "alternate-submitter", "action-substitution", "target-mutation", "method-mutation",
  "enctype-mutation", "base-href", "base-target", "reassociation", "expired",
  "mismatch-burn", "synthetic", "location-same", "location-different", "late-submit",
  "replay",
]);
export const FORM_CONTROL_VARIANTS = Object.freeze([
  "exact-submit", "exact-request", "native", "server-redirect", "slow-response",
  "empty-target", "inherited-target", "empty-method", "invalid-method", "self",
  "validation", "dialog", "allow-once", "allow-mutated", "mixed",
]);
export const FORM_VARIANTS = Object.freeze([...FORM_PAIRED_VARIANTS, ...FORM_CONTROL_VARIANTS]);
export const expectedKeys = Object.freeze([
  ...FORM_PAIRED_VARIANTS.flatMap((variant) => [`${variant}:false`, `${variant}:true`]),
  ...FORM_CONTROL_VARIANTS.map((variant) => `${variant}:true`),
].sort());

export const FORM_GAP_CODES = Object.freeze([
  "RUNNER_FAILED", "CLOCK_INVALID", "RECEIVER_UNHEALTHY", "RECEIVER_CALLBACK_LOSS",
  "PAGE_ERROR", "CLEANUP_FAILED", "PROBE_REJECTED", "EVENTS_DROPPED",
  "PRODUCT_READ_FAILED", "OBSERVATION_INCOMPLETE", "DOCUMENT_BINDING_INVALID",
  "DOCUMENT_CONTEXT_UNKNOWN", "DOCUMENT_CONTEXT_REUSED", "DOCUMENT_FRAME_UNKNOWN",
  "DOCUMENT_LIMIT", "DOCUMENT_METADATA_INVALID", "DOCUMENT_TRANSPORT_LOST",
]);

const prepared = Object.freeze({ phase: "prepared", primitive: "native" });
const input = Object.freeze({ phase: "input", primitive: "native" });
const request = Object.freeze({ phase: "operation", primitive: "requestSubmit" });
const submit = Object.freeze({ phase: "operation", primitive: "submit" });
const location = Object.freeze({ phase: "operation", primitive: "location" });
const submitEvent = Object.freeze({ phase: "submit-event", primitive: "native" });
const lateMutation = Object.freeze({ phase: "late-mutation", primitive: "native" });
const requestPrepared = Object.freeze({ phase: "prepared", primitive: "requestSubmit" });

const requestSubmitPaired = new Set([
  "alternate-submitter", "target-mutation", "method-mutation", "enctype-mutation",
  "base-href", "base-target", "expired", "synthetic",
]);
const nativeControls = new Set([
  "native", "server-redirect", "slow-response", "empty-target", "inherited-target",
  "empty-method", "invalid-method", "self", "dialog",
]);

/**
 * Required page-report prefix for one fixed arm. Additional trailing reports are allowed
 * only because a post-commit rollback can load a fresh child fixture and emit `prepared`.
 */
export function requiredFormReports(variant, protectedArm) {
  if (!FORM_VARIANTS.includes(variant) || typeof protectedArm !== "boolean") {
    throw new Error("FORM_TRACE_ARM_UNKNOWN");
  }
  if (variant === "action-substitution") return [prepared, input, submit];
  if (requestSubmitPaired.has(variant)) {
    return protectedArm
      ? [prepared, input, request]
      : [prepared, input, request, submitEvent];
  }
  if (variant === "reassociation") return [prepared, input, request];
  if (variant === "mismatch-burn") {
    return protectedArm
      ? [prepared, input, request, request]
      : [prepared, input, request, submitEvent, request, submitEvent];
  }
  if (variant === "replay") {
    return protectedArm
      ? [prepared, input, request, submitEvent, request]
      : [prepared, input, request, submitEvent, request, submitEvent];
  }
  if (variant === "location-same" || variant === "location-different") {
    return [prepared, input, location];
  }
  if (variant === "late-submit") return [prepared, input, submitEvent, lateMutation];
  if (variant === "exact-submit") return [prepared, input, submit];
  if (variant === "exact-request") return [prepared, input, request, submitEvent];
  if (nativeControls.has(variant)) return [prepared, input, submitEvent];
  if (variant === "validation") return [prepared, input, input, submitEvent];
  if (variant === "allow-once") return [prepared, request, submitEvent];
  if (variant === "allow-mutated") return [prepared, request, requestPrepared];
  if (variant === "mixed") return [prepared, input, request, input, submitEvent];
  throw new Error("FORM_TRACE_ARM_UNKNOWN");
}

export function requiredFormReportsPresent(events, variant, protectedArm) {
  if (!Array.isArray(events)) return false;
  let required;
  try {
    required = requiredFormReports(variant, protectedArm);
  } catch {
    return false;
  }
  const reports = events
    .filter((event) => event && typeof event === "object" && event.kind === "form.intent")
    .map((event) => ({ phase: event.data?.phase, primitive: event.data?.primitive }));
  if (reports.length < required.length) return false;
  return required.every((expected, index) => (
    reports[index]?.phase === expected.phase && reports[index]?.primitive === expected.primitive
  ));
}
