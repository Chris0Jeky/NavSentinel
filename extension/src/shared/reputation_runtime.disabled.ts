import type { ReputationLoadOptions, ReputationStatus } from "./reputation_runtime.types";

export const reputationEnabled = false;

export async function loadReputationFilter(_options: ReputationLoadOptions = {}): Promise<void> {
  // Interaction-only builds intentionally have no reputation asset or runtime.
}

export function isKnownBadDestination(
  _registrableDomain: string | null,
  _hostname: string | null,
): boolean {
  return false;
}

export async function checkReputationViaMessage(_domain: string): Promise<ReputationStatus> {
  return { knownBad: false, filterReady: false };
}

export function getReputationStatus(_domain: string): ReputationStatus {
  return { knownBad: false, filterReady: false };
}
