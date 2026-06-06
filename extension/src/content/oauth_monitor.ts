/**
 * OAuth consent flow monitoring.
 *
 * Detects OAuth consent phishing patterns where an attacker:
 *   1. Initiates a fake OAuth flow with a redirect_uri pointing to a
 *      malicious callback endpoint
 *   2. Manipulates window.opener during the consent phase
 *
 * Detection is purely URL-pattern-based -- no network calls.
 *
 * The service worker tracks per-tab OAuth flow state and forwards it
 * to the content script via runtime messages. This module processes
 * those messages and exposes signals for NRS scoring.
 *
 * Known limitation: MV3 service worker restarts lose in-memory flow
 * state (same pattern as DoubleClickjacking tracking). P3-10 will
 * address this with chrome.storage.session persistence.
 */

import { getRegistrableDomain, normalizeHost } from "../shared/domain";

// --- Public types ---

export interface OAuthFlowState {
  initiatorUrl: string;
  consentUrl: string;
  expectedCallbackDomain: string;
  startedAt: number;
  phase: "redirect" | "consent" | "callback" | "complete";
}

// --- Constants ---

/**
 * URL path segments that indicate an OAuth / authorization flow.
 * Matched at path-segment boundaries (preceded by "/" and followed by "/"
 * or end-of-path) to avoid substring matches inside unrelated words.
 */
const OAUTH_PATH_KEYWORDS = [
  "oauth",
  "oauth2",
  "authorize",
  "consent",
  "openid",
] as const;

/**
 * OAuth-specific query parameter names whose presence (together with a
 * path keyword) indicates a genuine OAuth flow. Generic params like
 * "continue" and "next" are excluded to avoid false positives on normal
 * login pages.
 */
const OAUTH_QUERY_PARAMS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "scope",
] as const;

/**
 * Query parameter names that carry a redirect URI in OAuth flows.
 * Only OAuth-specific names are kept; generic names like "continue" and
 * "next" were removed to reduce false positives.
 */
const REDIRECT_PARAM_NAMES = [
  "redirect_uri",
  "redirect_url",
  "callback_url",
  "return_url",
] as const;

/** TTL for OAuth flag expiry (ms). Flags auto-expire after this period. */
const OAUTH_FLAG_TTL_MS = 60_000;

/** Hosts treated as local development callbacks (never flag as mismatch). */
const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// --- URL analysis helpers ---

/**
 * Check whether a keyword appears at a path-segment boundary.
 * Matches "/keyword/", "/keyword?", "/keyword" at end of path.
 */
function hasPathSegment(lowerPath: string, keyword: string): boolean {
  let idx = 0;
  while (true) {
    idx = lowerPath.indexOf(keyword, idx);
    if (idx === -1) return false;
    // Must be preceded by '/'
    if (idx === 0 || lowerPath[idx - 1] !== "/") {
      idx += 1;
      continue;
    }
    // Must be followed by '/', '?', or end-of-string
    const afterIdx = idx + keyword.length;
    if (afterIdx >= lowerPath.length) return true;
    const after = lowerPath[afterIdx];
    if (after === "/" || after === "?") return true;
    idx += 1;
  }
}

/**
 * Returns true when the URL looks like part of an OAuth / authorization flow.
 *
 * To avoid false positives on normal login pages, the function requires BOTH:
 *   1. A path keyword at a segment boundary (e.g. "/oauth2/" not "oauth" in
 *      "myauthpage")
 *   2. At least one OAuth-specific query parameter (response_type, client_id,
 *      redirect_uri, scope)
 *
 * This two-gate approach prevents every /login page from being treated as OAuth.
 */
export function isOAuthUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  // Only consider HTTP(S) URLs
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  const lowerPath = parsed.pathname.toLowerCase();

  let hasKeyword = false;
  for (const kw of OAUTH_PATH_KEYWORDS) {
    if (hasPathSegment(lowerPath, kw)) {
      hasKeyword = true;
      break;
    }
  }
  if (!hasKeyword) return false;

  // Require at least one OAuth-specific query parameter
  for (const param of OAUTH_QUERY_PARAMS) {
    if (parsed.searchParams.has(param)) return true;
  }

  return false;
}

/**
 * Extract the redirect URI value from a URL's query parameters.
 * Returns the first match, or null if none found.
 */
export function extractRedirectUri(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  for (const name of REDIRECT_PARAM_NAMES) {
    const value = parsed.searchParams.get(name);
    if (value) return value;
  }

  return null;
}

/**
 * Determine whether an actual callback URL is "unexpected" relative to
 * the OAuth flow's expected callback domain.
 *
 * The callback is unexpected when its registrable domain differs from
 * the expected callback domain recorded at flow start.
 */
export function isUnexpectedCallback(
  flow: OAuthFlowState,
  actualCallbackUrl: string,
): boolean {
  if (!flow.expectedCallbackDomain) return false;

  let actualHost: string;
  try {
    actualHost = normalizeHost(new URL(actualCallbackUrl).hostname);
  } catch {
    // Malformed URL is inherently suspicious
    return true;
  }

  // Localhost callbacks are used in local development (e.g. desktop OAuth
  // flows). Never treat them as mismatches.
  if (LOCALHOST_HOSTS.has(actualHost)) return false;

  const actualReg = getRegistrableDomain(actualHost);
  const expectedReg = getRegistrableDomain(
    normalizeHost(flow.expectedCallbackDomain),
  );

  if (!actualReg || !expectedReg) return true;

  return actualReg !== expectedReg;
}

/**
 * Whether a URL carries an OAuth *response* — i.e. it is an actual callback, as
 * opposed to an authorization *request* or an unrelated navigation. The
 * distinguishing payload is an authorization `code` / `error` in the query, or an
 * `access_token` / `id_token` in the fragment (implicit/hybrid flows).
 *
 * `state` is deliberately NOT treated as a response indicator: it is a CSRF echo
 * that authorization REQUESTS also carry (e.g. a genuine provider hop such as
 * login.live.com/oauth20_authorize.srf?...&state=...), so keying on it would
 * mis-classify legitimate intermediate hops as callbacks and fire a false
 * redirect-mismatch. (#207)
 *
 * Limitation: this inspects only the URL (query + fragment). `response_mode=form_post`
 * delivers the response in the POST body, and a platform may omit the fragment from a
 * committed-navigation URL, so those callbacks are not detected here (URL-only by
 * design — see the module header). Tracked as a follow-up (#221).
 */
export function hasOAuthResponseParams(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const responseKeys = ["code", "error", "access_token", "id_token"];
  for (const key of responseKeys) {
    if (parsed.searchParams.has(key)) return true;
  }

  const fragment = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
  if (fragment) {
    const fragParams = new URLSearchParams(fragment);
    for (const key of responseKeys) {
      if (fragParams.has(key)) return true;
    }
  }

  return false;
}

// --- Content-script-side state ---

/** Current OAuth flow state for this tab, forwarded from the SW. */
let currentFlow: OAuthFlowState | null = null;

/**
 * Timestamp (ms) when the redirect-mismatch flag was set, or 0 if unset.
 * The flag auto-expires after OAUTH_FLAG_TTL_MS to prevent permanent
 * latching in SPAs where subsequent navigations would inherit the penalty.
 */
let oauthRedirectMismatchAt = 0;

/**
 * Timestamp (ms) when the opener-manipulation flag was set, or 0 if unset.
 * Same TTL-based expiry as oauthRedirectMismatchAt.
 */
let oauthOpenerManipulationAt = 0;

/**
 * Handle OAuth-related chrome.runtime.onMessage messages from the SW.
 *
 * Message types:
 *   - ns-oauth-flow-update: SW forwards the current flow state for this tab
 *   - ns-oauth-redirect-mismatch: SW detected unexpected callback domain
 *   - ns-oauth-opener-manipulation: SW correlated opener manipulation with
 *     an active OAuth flow
 *
 * Returns true if the message was handled, false otherwise.
 */
export function handleOAuthRuntimeMessage(
  message: { type?: string; flow?: OAuthFlowState | null; [key: string]: unknown } | null | undefined,
): boolean {
  if (!message) return false;

  if (message.type === "ns-oauth-flow-update") {
    currentFlow = message.flow ?? null;
    return true;
  }

  if (message.type === "ns-oauth-redirect-mismatch") {
    oauthRedirectMismatchAt = Date.now();
    return true;
  }

  if (message.type === "ns-oauth-opener-manipulation") {
    oauthOpenerManipulationAt = Date.now();
    return true;
  }

  return false;
}

// --- NRS signal accessors ---

/** Returns true if a timestamp is set and has not yet expired. */
function isFlagActive(setAt: number): boolean {
  return setAt > 0 && (Date.now() - setAt) < OAUTH_FLAG_TTL_MS;
}

/**
 * Returns true when the SW detected an OAuth callback redirect to an
 * unexpected domain. Used by NRS scoring (+30).
 * Auto-expires after OAUTH_FLAG_TTL_MS to prevent permanent latching.
 */
export function isOAuthRedirectMismatch(): boolean {
  if (!isFlagActive(oauthRedirectMismatchAt)) {
    oauthRedirectMismatchAt = 0;
    return false;
  }
  return true;
}

/**
 * Returns true when opener manipulation was observed during an active
 * OAuth consent flow. Used by NRS scoring (+45).
 * Auto-expires after OAUTH_FLAG_TTL_MS to prevent permanent latching.
 */
export function isOAuthOpenerManipulation(): boolean {
  if (!isFlagActive(oauthOpenerManipulationAt)) {
    oauthOpenerManipulationAt = 0;
    return false;
  }
  return true;
}

/**
 * Returns the current OAuth flow state for this tab, or null if no
 * flow is active. Also clears stale flow state that has expired.
 */
export function getOAuthFlowState(): OAuthFlowState | null {
  if (currentFlow && (Date.now() - currentFlow.startedAt) >= OAUTH_FLAG_TTL_MS) {
    currentFlow = null;
  }
  return currentFlow;
}

/**
 * Reset all OAuth monitoring state. Exposed for testing only.
 */
export function _resetOAuthState(): void {
  currentFlow = null;
  oauthRedirectMismatchAt = 0;
  oauthOpenerManipulationAt = 0;
}
