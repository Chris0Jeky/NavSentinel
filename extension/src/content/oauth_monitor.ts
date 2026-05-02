/**
 * OAuth consent flow monitoring.
 *
 * Detects OAuth redirect patterns in URLs, tracks the full
 * authorization flow (initial redirect -> consent page -> callback),
 * and flags suspicious flows:
 *   - redirect_uri mismatch between the initial request and the callback
 *   - window.opener manipulation during an active OAuth flow
 *
 * All detection is local-only: URLs are parsed in-process with no
 * network calls.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OAuthFlowEntry {
  /** Tab that initiated the flow (undefined in content-script context). */
  tabId?: number | undefined;
  /** The full URL that started the OAuth flow. */
  initiatingUrl: string;
  /** The redirect_uri extracted from the initiating URL, if any. */
  expectedRedirectUri?: string | undefined;
  /** Timestamp when the flow was first observed. */
  startedAt: number;
  /** Has the callback been observed yet? */
  callbackSeen: boolean;
  /** Was a redirect_uri mismatch detected? */
  redirectMismatch: boolean;
  /** Was opener manipulation detected during this flow? */
  openerManipulated: boolean;
}

export interface OAuthFlowState {
  active: boolean;
  currentFlow?: OAuthFlowEntry | undefined;
  recentFlows: OAuthFlowEntry[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How long an OAuth flow stays "active" before it is considered stale (ms). */
const OAUTH_FLOW_TTL_MS = 120_000; // 2 minutes

/** Maximum number of recent flows to retain. */
const MAX_RECENT_FLOWS = 20;

/**
 * URL path/query indicators that signal an OAuth/OIDC authorization flow.
 *
 * Ordered roughly by specificity so the most distinctive patterns are
 * checked first.  The list covers:
 *   - Standard OAuth 2.0 / OIDC endpoints and parameters
 *   - Common provider path segments (Google, GitHub, Microsoft, Facebook, etc.)
 */
const OAUTH_PATH_INDICATORS: readonly string[] = [
  // OAuth 2.0 / OIDC query parameters (highly specific)
  "response_type=",
  "client_id=",
  "redirect_uri=",
  "scope=",
  "grant_type=",
  // Standard endpoint path segments
  "/oauth",
  "/authorize",
  "/auth/callback",
  "/oauth2/",
  "/o/oauth2/",          // Google
  "/login/oauth/",       // GitHub
  "/common/oauth2/",     // Microsoft / Azure AD
  "/dialog/oauth",       // Facebook
  // Generic consent / login paths that often host OAuth flows
  "/consent",
  "/login",
];

/**
 * Standalone keywords that, when found in the URL, indicate an OAuth flow.
 * These are matched as whole words (surrounded by non-alphanumeric chars or
 * string boundaries) to avoid false positives on unrelated paths like
 * "/author" or "/authentication-service".
 */
const OAUTH_WORD_INDICATORS: readonly string[] = [
  "oauth",
  "authorize",
  "consent",
];

/**
 * Path patterns that commonly appear in OAuth callback / redirect URLs.
 */
const CALLBACK_PATH_PATTERNS: readonly string[] = [
  "/callback",
  "/auth/callback",
  "/oauth/callback",
  "/oauth2/callback",
  "/signin-oidc",
  "/login/callback",
  "/redirect",
  "/oauth/redirect",
];

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let currentFlow: OAuthFlowEntry | null = null;
const recentFlows: OAuthFlowEntry[] = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/**
 * Check whether `text` contains `word` as a whole word -- i.e. bounded by
 * non-alphanumeric characters or string boundaries.  This prevents
 * "author" from matching the "auth" indicator, etc.
 */
function containsWord(text: string, word: string): boolean {
  const idx = text.indexOf(word);
  if (idx === -1) return false;
  const before = idx > 0 ? text[idx - 1]! : "/";
  const after = idx + word.length < text.length ? text[idx + word.length]! : "/";
  const boundary = /[^a-zA-Z0-9]/;
  return boundary.test(before) && boundary.test(after);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the URL looks like part of an OAuth / OIDC
 * authorization flow.
 *
 * The check is intentionally broad: it will match most major providers
 * (Google, GitHub, Microsoft, Facebook, generic OIDC) as well as custom
 * OAuth implementations that follow standard parameter naming.
 *
 * False-positive mitigation:
 *   - Words like "auth" are matched as whole words so that "/author",
 *     "/authentication-service", etc. do NOT trigger.
 *   - Path indicators use prefix matching ("/oauth" matches
 *     "/oauth/authorize" but not "/my-oauth-wrapper" since it starts
 *     with "/my-").
 */
export function isOAuthFlow(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();

  // Fast path: check path/query indicators (substrings)
  for (const indicator of OAUTH_PATH_INDICATORS) {
    if (lower.includes(indicator)) return true;
  }

  // Whole-word indicators (avoids "author" matching "auth")
  for (const word of OAUTH_WORD_INDICATORS) {
    if (containsWord(lower, word)) return true;
  }

  return false;
}

/**
 * Record the start of an OAuth redirect flow.
 *
 * Call this when a navigation target is detected as an OAuth URL.
 * The function extracts `redirect_uri` from the query string (if present)
 * so it can later be compared against the actual callback URL.
 */
export function trackOAuthRedirect(url: string, tabId?: number): void {
  pruneStaleFlows();

  const parsed = safeUrl(url);
  const redirectUri = parsed
    ? (parsed.searchParams.get("redirect_uri") ?? undefined)
    : undefined;

  const entry: OAuthFlowEntry = {
    tabId,
    initiatingUrl: url,
    expectedRedirectUri: redirectUri,
    startedAt: Date.now(),
    callbackSeen: false,
    redirectMismatch: false,
    openerManipulated: false,
  };

  // Retire the previous current flow to recents (if it existed).
  if (currentFlow) {
    pushRecent(currentFlow);
  }

  currentFlow = entry;
}

/**
 * Evaluate whether an OAuth callback URL is suspicious.
 *
 * Returns `true` when the callback's origin or path does not match the
 * `redirect_uri` that was declared in the original authorization request.
 *
 * When `originalRedirectUri` is not provided the function falls back to
 * the `expectedRedirectUri` stored in the current flow state.
 */
export function isOAuthCallbackSuspicious(
  callbackUrl: string,
  originalRedirectUri?: string,
): boolean {
  const effectiveRedirectUri =
    originalRedirectUri ?? currentFlow?.expectedRedirectUri;

  // If we have no expected redirect_uri, we cannot detect a mismatch.
  if (!effectiveRedirectUri) return false;

  const cbParsed = safeUrl(callbackUrl);
  const expectedParsed = safeUrl(effectiveRedirectUri);

  if (!cbParsed || !expectedParsed) return false;

  // Origin mismatch is the primary signal.
  if (cbParsed.origin !== expectedParsed.origin) {
    markCurrentFlowMismatch();
    return true;
  }

  // Path mismatch (ignoring trailing slashes) is a secondary signal.
  const cbPath = cbParsed.pathname.replace(/\/+$/, "");
  const expectedPath = expectedParsed.pathname.replace(/\/+$/, "");
  if (cbPath !== expectedPath) {
    markCurrentFlowMismatch();
    return true;
  }

  return false;
}

/**
 * Mark the current flow as having detected opener manipulation.
 * Called when bridge signals indicate `window.opener` was tampered with
 * while an OAuth flow is active.
 */
export function markOpenerManipulated(): void {
  if (currentFlow) {
    currentFlow.openerManipulated = true;
  }
}

/**
 * Return a snapshot of the current OAuth flow monitoring state.
 */
export function getOAuthFlowState(): OAuthFlowState {
  pruneStaleFlows();
  return {
    active: currentFlow !== null && !isFlowStale(currentFlow),
    currentFlow: currentFlow ?? undefined,
    recentFlows: [...recentFlows],
  };
}

/**
 * Check if a URL looks like an OAuth callback.
 */
export function isOAuthCallback(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  for (const pattern of CALLBACK_PATH_PATTERNS) {
    if (lower.includes(pattern)) return true;
  }
  // Also check for "code=" in query (authorization code flow)
  if (lower.includes("code=") && lower.includes("state=")) return true;
  return false;
}

/**
 * Reset all OAuth monitoring state. Exposed for testing only.
 */
export function _resetOAuthState(): void {
  currentFlow = null;
  recentFlows.length = 0;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function isFlowStale(flow: OAuthFlowEntry): boolean {
  return Date.now() - flow.startedAt > OAUTH_FLOW_TTL_MS;
}

function pruneStaleFlows(): void {
  // Prune current flow if stale.
  if (currentFlow && isFlowStale(currentFlow)) {
    pushRecent(currentFlow);
    currentFlow = null;
  }

  // Prune old recent flows.
  while (recentFlows.length > MAX_RECENT_FLOWS) {
    recentFlows.shift();
  }
}

function pushRecent(flow: OAuthFlowEntry): void {
  recentFlows.push(flow);
  if (recentFlows.length > MAX_RECENT_FLOWS) {
    recentFlows.shift();
  }
}

function markCurrentFlowMismatch(): void {
  if (currentFlow) {
    currentFlow.redirectMismatch = true;
    currentFlow.callbackSeen = true;
  }
}
