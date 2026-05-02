/**
 * PushState abuse detection for the isolated world.
 *
 * Detects the attack pattern where a page uses history.pushState or
 * history.replaceState to change the visible URL to something that
 * looks like a trusted domain immediately after a user gesture.
 *
 * The main_guard patches pushState/replaceState in the MAIN world and
 * sends an `ns-pushstate-suspicious` bridge message when it detects:
 *   1. A pushState/replaceState call within 2s of a user gesture
 *   2. The new URL path looks like a cross-origin navigation (contains
 *      domain-like segments that differ from the current hostname)
 *   3. Multiple rapid pushState calls in a short window
 *
 * This module tracks those signals and exposes `isPushStateAbuseActive()`
 * for NRS integration in capture_isolated.ts.
 */

// --- Constants ---

/** How long a pushState abuse signal remains active. */
const PUSHSTATE_ABUSE_STALE_MS = 10_000;

// --- State ---

let pushStateAbuseTs = 0;
let pushStateAbuseUrl = "";

// --- Public API ---

/**
 * Handle pushState-related bridge messages from main_guard.
 *
 * Called by capture_isolated.ts when the bridge dispatches:
 *   - ns-pushstate-suspicious
 *
 * Returns true if the message was handled.
 */
export function handlePushStateBridgeMessage(
  type: string,
  data: { ts?: number; url?: string; method?: string; reason?: string },
): boolean {
  if (type === "ns-pushstate-suspicious") {
    pushStateAbuseTs = typeof data.ts === "number" ? data.ts : Date.now();
    pushStateAbuseUrl = typeof data.url === "string" ? data.url : "";
    return true;
  }
  return false;
}

/**
 * Returns true when pushState abuse has been recently detected.
 * The signal expires after PUSHSTATE_ABUSE_STALE_MS.
 */
export function isPushStateAbuseActive(): boolean {
  if (pushStateAbuseTs <= 0) return false;
  return Date.now() - pushStateAbuseTs <= PUSHSTATE_ABUSE_STALE_MS;
}

/**
 * Returns the URL from the most recent pushState abuse detection.
 */
export function getPushStateAbuseUrl(): string {
  return pushStateAbuseUrl;
}

/**
 * Reset all pushState abuse state. Exposed for testing only.
 */
export function _resetPushStateState(): void {
  pushStateAbuseTs = 0;
  pushStateAbuseUrl = "";
}
