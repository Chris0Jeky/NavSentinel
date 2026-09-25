export interface ShadowGuardCorrelationInput {
  kind: string | undefined;
  receivedAtMs: number;
  promptShownAtMs: number;
  maxArrivalMs: number;
  messageUrl: string;
  promptUrl: string;
  messageTarget: string | undefined;
  promptTarget: string | undefined;
  /** Page-produced metadata; deliberately never used as clock authority. */
  producerTimestamp?: unknown;
}

/**
 * Correlate the MAIN-world shadow-anchor report with the local prompt using
 * only isolated-world receipt time and exact navigation identity.
 */
export function correlatesShadowGuardPrompt(
  input: ShadowGuardCorrelationInput,
): boolean {
  if (input.kind !== "shadow_anchor") return false;
  if (
    !Number.isFinite(input.receivedAtMs) ||
    !Number.isFinite(input.promptShownAtMs) ||
    !Number.isFinite(input.maxArrivalMs) ||
    input.maxArrivalMs < 0
  ) {
    return false;
  }

  const arrivalAgeMs = input.receivedAtMs - input.promptShownAtMs;
  if (arrivalAgeMs < 0 || arrivalAgeMs > input.maxArrivalMs) return false;
  if (input.messageUrl !== input.promptUrl) return false;

  const promptTarget = input.promptTarget ?? "_blank";
  const messageTarget = input.messageTarget || "_blank";
  return promptTarget === messageTarget;
}
