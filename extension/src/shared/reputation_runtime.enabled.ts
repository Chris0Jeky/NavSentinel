import {
  checkReputationViaMessage,
  initReputation,
  isKnownBadDomain,
  reputationReady,
} from "./reputation";
import type { ReputationLoadOptions, ReputationStatus } from "./reputation_runtime.types";

export { checkReputationViaMessage };
export const reputationEnabled = true;

/** Maximum .bin file size we will read (2 MB + 16-byte header). */
const MAX_REPUTATION_FILE_BYTES = 2 * 1024 * 1024 + 16;

export async function loadReputationFilter(options: ReputationLoadOptions = {}): Promise<void> {
  try {
    const url = chrome.runtime.getURL("reputation_data.bin");
    const response = await fetch(url);
    if (!response.ok) {
      if (options.warnOnFailure) {
        console.warn("[NavSentinel] Reputation filter not found (HTTP", response.status, ")");
      }
      return;
    }
    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_REPUTATION_FILE_BYTES) {
      if (options.warnOnFailure) {
        console.warn("[NavSentinel] Reputation file too large (Content-Length:", contentLength, ")");
      }
      return;
    }
    const data = await response.arrayBuffer();
    if (data.byteLength > MAX_REPUTATION_FILE_BYTES) {
      if (options.warnOnFailure) {
        console.warn("[NavSentinel] Reputation file too large:", data.byteLength, "bytes");
      }
      return;
    }
    if (initReputation(data) && options.debug) {
      console.debug("[NavSentinel] Reputation bloom filter loaded:", data.byteLength, "bytes");
    }
  } catch (error) {
    if (options.warnOnFailure) {
      console.warn("[NavSentinel] Failed to load reputation filter:", error);
    }
  }
}

export function isKnownBadDestination(
  registrableDomain: string | null,
  hostname: string | null,
): boolean {
  if (!registrableDomain) return false;
  return isKnownBadDomain(registrableDomain) ||
    (hostname !== null && hostname !== registrableDomain && isKnownBadDomain(hostname));
}

export function getReputationStatus(domain: string): ReputationStatus {
  return {
    knownBad: domain ? isKnownBadDomain(domain) : false,
    filterReady: reputationReady(),
  };
}
