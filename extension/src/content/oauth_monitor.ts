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
 * Matched case-insensitively against the URL pathname.
 */
const OAUTH_PATH_KEYWORDS = [
  "oauth",
  "authorize",
  "consent",
  "login",
  "auth",
  "signin",
  "sign-in",
  "openid",
] as const;

/**
 * Query parameter names that carry a redirect URI in OAuth flows.
 */
const REDIRECT_PARAM_NAMES = [
  "redirect_uri",
  "redirect_url",
  "callback",
  "return_to",
  "return_url",
  "continue",
  "next",
  "callback_url",
  "post_login_redirect_uri",
] as const;

// --- URL analysis helpers ---

/**
 * Returns true when the URL looks like part of an OAuth / authorization flow.
 * Checks whether the pathname or query string contains any of the OAuth keywords.
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
  const lowerSearch = parsed.search.toLowerCase();

  for (const kw of OAUTH_PATH_KEYWORDS) {
    if (lowerPath.includes(kw) || lowerSearch.includes(kw)) return true;
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

  const actualReg = getRegistrableDomain(actualHost);
  const expectedReg = getRegistrableDomain(
    normalizeHost(flow.expectedCallbackDomain),
  );

  if (!actualReg || !expectedReg) return true;

  return actualReg !== expectedReg;
}

// --- Content-script-side state ---

/** Current OAuth flow state for this tab, forwarded from the SW. */
let currentFlow: OAuthFlowState | null = null;

/** True when the SW reported an unexpected OAuth callback redirect. */
let oauthRedirectMismatch = false;

/** True when opener manipulation was observed during an active OAuth flow. */
let oauthOpenerManipulation = false;

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
export function handleOAuthRuntimeMessage(message: any): boolean {
  if (!message) return false;

  if (message.type === "ns-oauth-flow-update") {
    currentFlow = message.flow ?? null;
    return true;
  }

  if (message.type === "ns-oauth-redirect-mismatch") {
    oauthRedirectMismatch = true;
    return true;
  }

  if (message.type === "ns-oauth-opener-manipulation") {
    oauthOpenerManipulation = true;
    return true;
  }

  return false;
}

// --- NRS signal accessors ---

/**
 * Returns true when the SW detected an OAuth callback redirect to an
 * unexpected domain. Used by NRS scoring (+30).
 */
export function isOAuthRedirectMismatch(): boolean {
  return oauthRedirectMismatch;
}

/**
 * Returns true when opener manipulation was observed during an active
 * OAuth consent flow. Used by NRS scoring (+45).
 */
export function isOAuthOpenerManipulation(): boolean {
  return oauthOpenerManipulation;
}

/**
 * Returns the current OAuth flow state for this tab, or null if no
 * flow is active.
 */
export function getOAuthFlowState(): OAuthFlowState | null {
  return currentFlow;
}

/**
 * Reset all OAuth monitoring state. Exposed for testing only.
 */
export function _resetOAuthState(): void {
  currentFlow = null;
  oauthRedirectMismatch = false;
  oauthOpenerManipulation = false;
}
