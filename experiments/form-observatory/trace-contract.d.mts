export const FORM_TRACE_SCHEMA: "navsentinel.observatory.form.v1";
export const FORM_TRACE_MODE: "synthetic";
export const FORM_SCENARIO_ID: "issue688-form-intent";
export const FORM_REQUIRED_OBSERVATION_MS: 2300;
export const FORM_EVIDENCE_POLICY: "FORM_DIAGNOSTIC_NOT_FOUR_ARM_CERTIFICATION";
export const FORM_PAIRED_VARIANTS: readonly string[];
export const FORM_CONTROL_VARIANTS: readonly string[];
export const FORM_VARIANTS: readonly string[];
export const expectedKeys: readonly string[];
export const FORM_GAP_CODES: readonly string[];
export interface RequiredFormReport { phase: string; primitive: string }
export function requiredFormReports(variant: string, protectedArm: boolean): RequiredFormReport[];
export function requiredFormReportsPresent(
  events: readonly { kind?: unknown; data?: Record<string, unknown> }[],
  variant: string,
  protectedArm: boolean,
): boolean;
