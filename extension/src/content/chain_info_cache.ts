/**
 * Redirect-chain info cache for the isolated-world content script (#389).
 *
 * The service worker owns per-tab redirect chains (`redirect_chain.ts`); the
 * content script asks for the current tab's chain with an async
 * `ns-get-chain-info` round-trip and caches the answer for NRS scoring.
 *
 * Ordering matters. NRS is computed synchronously inside the click handler —
 * a navigation decision must never await a message round-trip, because a
 * security control that arrives after the navigation is worse than one that
 * scores slightly low. So the request is *primed as early as possible* rather
 * than awaited: `primeChainInfoCache()` is called at module init (the content
 * script runs at `document_start`), not after the settings/allowlist storage
 * reads that `initSettings()` awaits. That removes several storage round-trips
 * from the head of the window in which the cache is still empty.
 *
 * RESIDUAL STALENESS (accepted, #389): priming does not *eliminate* the
 * first-eval gap. If a click is dispatched before the service worker's reply
 * lands — a scripted click at `document_start`, or a cold worker still
 * hydrating `swState` — `getFreshChainInfo()` returns null and that first
 * evaluation carries no `redirectChainDepth` / `knownRedirectorHops`, scoring
 * lower than a later navigation within the TTL. That is deliberate: the
 * alternatives were rejected as more dangerous than the under-score.
 *   - Gating the first decision on the reply would put an await on the click
 *     path (rejected outright).
 *   - Re-running NRS when the reply lands would re-score a navigation the user
 *     has already been prompted about, risking a duplicate prompt/alert for a
 *     decision already made.
 * The under-score is fail-open only relative to the chain factors; every other
 * NRS factor is unaffected, and the chain factors are re-applied on the next
 * navigation once the cache is warm.
 */

import type { RedirectChainInfo } from "../shared/redirect_chain";

/** How long a cached chain-info answer is considered representative. */
export const CHAIN_INFO_TTL_MS = 15_000;

/**
 * One bounded retry covers the case where the very first request loses its
 * reply — an MV3 worker that was asleep can close the message channel while
 * starting up, and today's fire-and-forget send has no recovery at all. It is
 * deliberately a single retry: this is a scoring hint, not a control, and an
 * unbounded poll would be a per-page message loop for no security gain.
 */
export const CHAIN_INFO_RETRY_DELAY_MS = 250;
const CHAIN_INFO_MAX_ATTEMPTS = 2;

let cachedChainInfo: RedirectChainInfo | null = null;
let cachedChainInfoAt = 0;
let primeStarted = false;

/**
 * Accept only a fully well-formed chain-info reply. The sender is our own
 * service worker, but the isolated world validates every inbound message
 * shape, and a partial object cached here would feed undefined fields into
 * NRS weighting. A malformed reply is treated as "no answer yet" so the retry
 * can still land a good one.
 */
function isChainInfo(value: unknown): value is RedirectChainInfo {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.depth === "number" &&
    Number.isFinite(candidate.depth) &&
    candidate.depth >= 0 &&
    typeof candidate.viaKnownRedirector === "boolean" &&
    typeof candidate.knownRedirectorHops === "number" &&
    Number.isFinite(candidate.knownRedirectorHops) &&
    candidate.knownRedirectorHops >= 0 &&
    typeof candidate.expiresAt === "number" &&
    Number.isFinite(candidate.expiresAt) &&
    candidate.expiresAt >= 0
  );
}

function requestChainInfo(attempt: number): void {
  try {
    chrome.runtime.sendMessage({ type: "ns-get-chain-info" }, (resp: unknown) => {
      if (chrome.runtime.lastError) {
        scheduleRetry(attempt);
        return;
      }
      if (!isChainInfo(resp)) {
        scheduleRetry(attempt);
        return;
      }
      cachedChainInfo = { ...resp };
      cachedChainInfoAt = Date.now();
    });
  } catch {
    // sendMessage throws synchronously when the extension context is gone.
    scheduleRetry(attempt);
  }
}

function scheduleRetry(attempt: number): void {
  if (attempt + 1 >= CHAIN_INFO_MAX_ATTEMPTS) return;
  setTimeout(() => {
    requestChainInfo(attempt + 1);
  }, CHAIN_INFO_RETRY_DELAY_MS);
}

/**
 * Start the (non-blocking) chain-info fetch. Safe to call once per content
 * script instance; repeat calls are ignored so a re-init cannot start a second
 * request chain.
 */
export function primeChainInfoCache(): void {
  if (primeStarted) return;
  primeStarted = true;
  requestChainInfo(0);
}

/**
 * Return the cached chain info if it is still within the TTL, else null.
 * Never triggers I/O — this is called from the synchronous click path.
 */
export function getFreshChainInfo(now: number = Date.now()): RedirectChainInfo | null {
  if (!cachedChainInfo) return null;
  if (now - cachedChainInfoAt > CHAIN_INFO_TTL_MS) return null;
  if (now >= cachedChainInfo.expiresAt) return null;
  return cachedChainInfo;
}

/**
 * A BFCache restore reuses this module instance after the worker has processed
 * the explicit history boundary. Drop the prior document snapshot and ask the
 * worker again before any later click can reuse unrelated chain factors.
 */
export function handleChainInfoPageShow(
  event: Pick<PageTransitionEvent, "persisted">,
): void {
  if (!event.persisted) return;
  cachedChainInfo = null;
  primeStarted = false;
  primeChainInfoCache();
}

/** Test-only: clear cache and priming state. */
export function _resetChainInfoCache(): void {
  cachedChainInfo = null;
  cachedChainInfoAt = 0;
  primeStarted = false;
}
