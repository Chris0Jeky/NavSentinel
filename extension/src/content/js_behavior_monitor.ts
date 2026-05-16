/**
 * JS Behavior Analysis Monitor (P4-02)
 *
 * Monitors JavaScript behavior patterns that indicate credential exfiltration
 * or form manipulation attacks. Runs in the main world alongside main_guard.ts.
 *
 * Detection targets:
 * - Form submit handlers POSTing to unexpected cross-origin endpoints
 * - fetch/XHR/beacon requests to third parties during form submission
 * - Credential field value reads by non-form code
 * - Dynamic form action attribute manipulation
 *
 * Privacy guarantees:
 * - Never stores, logs, or bridges actual credential values
 * - Network destinations reduced to origin only (no paths/queries/bodies)
 * - Debounced to prevent timing-based extension detection
 *
 * @see docs/design/js_behavior_analysis.md for full architecture
 */

// ============================================================================
// Interfaces
// ============================================================================

/** Signal emitted when a form with credentials submits to a suspicious destination. */
export interface JsFormSubmitSignal {
  /** Timestamp of the submit event */
  ts: number;
  /** Whether the form contains password-type inputs */
  hasCredentialFields: boolean;
  /** Whether the form action is cross-origin relative to the page */
  isCrossOrigin: boolean;
  /** Whether the action attribute was dynamically modified */
  actionDynamicallyChanged: boolean;
  /** The destination origin (not full URL, for privacy) */
  destinationOrigin: string;
}

/** Signal emitted when network exfiltration is suspected during form submission. */
export interface JsExfilNetworkSignal {
  /** Timestamp of the network request */
  ts: number;
  /** API used: 'fetch' | 'xhr' | 'beacon' */
  api: "fetch" | "xhr" | "beacon";
  /** Destination origin */
  destinationOrigin: string;
  /** Time since last form submission (ms), or -1 if no recent submit */
  msSinceFormSubmit: number;
  /** Whether password fields are present on the page */
  credentialFieldsPresent: boolean;
}

/** Signal emitted when a credential field value is read. */
export interface JsCredentialReadSignal {
  /** Timestamp of the read */
  ts: number;
  /** Input field type (always 'password' in initial implementation) */
  fieldType: string;
  /** Whether the read occurred during a form submit event */
  duringSubmit: boolean;
}

/** Aggregated JS behavior state tracked in the isolated world. */
export interface JsBehaviorState {
  /** Computed score for NRS integration (0 to NRS_WEIGHT_JS_BEHAVIOR_CAP) */
  score: number;
  /** Timestamp of last signal received */
  lastSignalTs: number;
  /** Individual signal counts within the current TTL window */
  signalCounts: {
    formSubmitSuspicious: number;
    exfilNetwork: number;
    exfilBeacon: number;
    credentialRead: number;
  };
}

/** Configuration for the behavior monitor. */
export interface JsBehaviorMonitorConfig {
  /** Whether debug logging is enabled */
  debug: boolean;
  /** Current extension mode */
  mode: "off" | "smart" | "strict";
  /** Function to post signals to the isolated world via the bridge */
  postSignal: (type: string, payload?: Record<string, unknown>) => void;
}

// ============================================================================
// Constants
// ============================================================================

/** How long after a form submit to correlate network requests (ms). */
const FORM_SUBMIT_CORRELATION_WINDOW_MS = 2000;

/** Debounce window for credential field value reads (ms). */
const CREDENTIAL_READ_DEBOUNCE_MS = 500;

/** Maximum tracked recent form submissions. */
const MAX_RECENT_FORM_SUBMITS = 10;

/** Maximum tracked recent network requests for correlation. */
const MAX_RECENT_NETWORK_REQUESTS = 20;

/** TTL for JS behavior score state (ms). Matches ClickFix TTL. */
export const JS_BEHAVIOR_STATE_TTL_MS = 30_000;

/** Maximum NRS points from JS behavior analysis. */
export const NRS_WEIGHT_JS_BEHAVIOR_CAP = 35;

// ============================================================================
// Score weights (used by isolated world to compute jsBehaviorScore)
// ============================================================================

/** Cross-origin form action on a form with credential fields. */
export const SCORE_CROSS_ORIGIN_CREDENTIAL_FORM = 15;

/** Form action attribute dynamically changed from its initial HTML value. */
export const SCORE_DYNAMIC_FORM_ACTION = 10;

/** Network request (fetch/XHR) to third-party within correlation window of form submit. */
export const SCORE_NETWORK_EXFIL_DURING_SUBMIT = 20;

/** sendBeacon to third-party while credential fields are present on page. */
export const SCORE_BEACON_EXFIL_CREDENTIAL_PAGE = 15;

/** Credential field value read outside of a form submit event flow. */
export const SCORE_CREDENTIAL_READ_OUTSIDE_SUBMIT = 10;

/** Bonus when 2+ independent signals fire within 5s. */
export const SCORE_MULTIPLE_SIGNALS_BONUS = 10;

// ============================================================================
// Internal State (module-scoped, reset per page load)
// ============================================================================

/** Recent form submissions tracked for correlation. */
interface FormSubmitRecord {
  ts: number;
  actionOrigin: string;
  hasCredentials: boolean;
}

/** Recent network requests tracked for correlation. */
interface NetworkRequestRecord {
  ts: number;
  destinationOrigin: string;
  api: "fetch" | "xhr" | "beacon";
}

// These are declared but unused until implementation slices 2-4.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let _recentFormSubmits: FormSubmitRecord[] = [];
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let _recentNetworkRequests: NetworkRequestRecord[] = [];
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let _lastCredentialReadTs = 0;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let _isInsideFormSubmit = false;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let _config: JsBehaviorMonitorConfig | null = null;

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize the JS behavior monitor. Called once from main_guard.ts after
 * all existing patches are applied.
 *
 * Installs prototype patches for:
 * - fetch() wrapper
 * - XMLHttpRequest.prototype.open() and .send()
 * - navigator.sendBeacon()
 * - HTMLInputElement.prototype.value getter (for password fields)
 *
 * Also registers a capturing 'submit' event listener for form monitoring.
 *
 * @param config - Monitor configuration including bridge post function
 *
 * TODO: Implement fetch() wrapper (Slice 3)
 * TODO: Implement XHR open/send wrapper (Slice 3)
 * TODO: Implement sendBeacon wrapper (Slice 3)
 * TODO: Implement value getter patch (Slice 4)
 * TODO: Implement form submit listener (Slice 2)
 */
export function initJsBehaviorMonitor(config: JsBehaviorMonitorConfig): void {
  _config = config;

  if (config.debug) {
    // Debug logging will use config.postSignal in implementation
  }

  // TODO (Slice 2): patchFormSubmitMonitoring(config);
  // TODO (Slice 3): patchFetchMonitoring(config);
  // TODO (Slice 3): patchXHRMonitoring(config);
  // TODO (Slice 3): patchBeaconMonitoring(config);
  // TODO (Slice 4): patchCredentialValueGetter(config);
}

/**
 * Check whether a form contains credential-type input fields.
 *
 * Looks for inputs with type="password" within the form. Future versions
 * may also check for email/username fields in sensitive contexts.
 *
 * @param form - The form element to inspect
 * @returns true if the form contains password inputs
 *
 * TODO: Implement (Slice 2)
 */
export function formHasCredentialFields(form: HTMLFormElement): boolean {
  // Stub: will check for input[type="password"] within the form
  void form;
  return false;
}

/**
 * Determine whether a URL is cross-origin relative to the current page.
 *
 * Compares the origin (protocol + host + port) of the given URL against
 * `location.origin`. Relative URLs are resolved against the current page.
 *
 * @param url - The URL to check (absolute or relative)
 * @returns true if the URL resolves to a different origin
 *
 * TODO: Implement (Slice 2)
 */
export function isCrossOriginUrl(url: string): boolean {
  void url;
  return false;
}

/**
 * Extract the origin from a URL string for privacy-safe logging.
 *
 * Returns only protocol + host + port (e.g., "https://evil.com:443").
 * Returns empty string for invalid or relative URLs that cannot be resolved.
 *
 * @param url - The URL to extract origin from
 * @returns The origin string, or empty string on failure
 *
 * TODO: Implement (Slice 2)
 */
export function extractOrigin(url: string): string {
  void url;
  return "";
}

/**
 * Check whether a network request correlates with a recent form submission.
 *
 * Returns true if a form with credential fields was submitted within
 * FORM_SUBMIT_CORRELATION_WINDOW_MS of the network request timestamp.
 *
 * @param requestTs - Timestamp of the network request
 * @returns Whether the request correlates with a credential form submit
 *
 * TODO: Implement (Slice 3)
 */
export function correlatesWithFormSubmit(requestTs: number): boolean {
  void requestTs;
  return false;
}

/**
 * Compute the JS behavior score from accumulated signals.
 *
 * Called by the isolated world when integrating signals into NRS.
 * The score is capped at NRS_WEIGHT_JS_BEHAVIOR_CAP (35 points).
 *
 * @param state - Current aggregated behavior state
 * @returns Computed score (0 to NRS_WEIGHT_JS_BEHAVIOR_CAP)
 *
 * TODO: Implement (Slice 5)
 */
export function computeJsBehaviorScore(state: JsBehaviorState): number {
  void state;
  return 0;
}

/**
 * Create a fresh (empty) JS behavior state object.
 *
 * Used by the isolated world to initialize state on page load.
 */
export function createEmptyState(): JsBehaviorState {
  return {
    score: 0,
    lastSignalTs: 0,
    signalCounts: {
      formSubmitSuspicious: 0,
      exfilNetwork: 0,
      exfilBeacon: 0,
      credentialRead: 0,
    },
  };
}

/**
 * Check whether the JS behavior state has expired (past TTL).
 *
 * @param state - The state to check
 * @param now - Current timestamp (defaults to Date.now())
 * @returns true if the state is expired and should be reset
 */
export function isStateExpired(state: JsBehaviorState, now?: number): boolean {
  if (state.lastSignalTs === 0) return true;
  const currentTime = now ?? Date.now();
  return currentTime - state.lastSignalTs > JS_BEHAVIOR_STATE_TTL_MS;
}

/**
 * Reset internal module state. Exposed for testing only.
 */
export function _resetState(): void {
  _recentFormSubmits = [];
  _recentNetworkRequests = [];
  _lastCredentialReadTs = 0;
  _isInsideFormSubmit = false;
  _config = null;
}

// ============================================================================
// TODO List - Implementation Plan
// ============================================================================
//
// Slice 2 - Form Submit Monitoring:
//   [ ] Add capturing 'submit' event listener on document
//   [ ] Track form action at DOM parse time vs submit time (detect dynamic changes)
//   [ ] Emit ns-js-form-submit-suspicious signal when cross-origin + credentials
//   [ ] Maintain _recentFormSubmits ring buffer
//   [ ] Handle both .submit() and 'submit' event (programmatic + user)
//
// Slice 3 - Network Exfiltration Monitoring:
//   [ ] Patch window.fetch() to record destination + timing
//   [ ] Patch XMLHttpRequest.prototype.open() to capture URL
//   [ ] Patch XMLHttpRequest.prototype.send() to record timing + correlate
//   [ ] Patch navigator.sendBeacon() to record destination + timing
//   [ ] Correlate network requests with _recentFormSubmits window
//   [ ] Emit ns-js-exfil-network / ns-js-exfil-beacon signals
//   [ ] Maintain _recentNetworkRequests ring buffer
//
// Slice 4 - Credential Field Value Monitoring:
//   [ ] Patch HTMLInputElement.prototype value getter via Object.getOwnPropertyDescriptor
//   [ ] Only activate on type="password" elements
//   [ ] Debounce reads (500ms per field instance)
//   [ ] Track _isInsideFormSubmit flag for context
//   [ ] Emit ns-js-credential-read signal (metadata only, never the value)
//
// Slice 5 - NRS Integration:
//   [ ] Add jsBehaviorScore to NavigationContext in nrs.ts
//   [ ] Add NRS_WEIGHT_JS_BEHAVIOR_CAP constant and factor logic
//   [ ] Handle bridge messages in capture_isolated.ts
//   [ ] Maintain JsBehaviorState in isolated world (with TTL expiry)
//   [ ] Implement computeJsBehaviorScore() with proper capping
//
// Slice 6 - Unit Tests:
//   [ ] Test formHasCredentialFields() with various form structures
//   [ ] Test isCrossOriginUrl() edge cases (relative, blob:, data:)
//   [ ] Test correlation logic timing windows
//   [ ] Test score computation and capping
//   [ ] Test state expiry
//   [ ] Test debounce behavior for credential reads
//
// Slice 7 - E2E / Gym Tests:
//   [ ] Gym fixture: legitimate form with same-origin action (no signal)
//   [ ] Gym fixture: credential form with cross-origin action (signal)
//   [ ] Gym fixture: fetch to 3P during submit (signal)
//   [ ] Gym fixture: beacon exfiltration on credential page (signal)
//   [ ] Gym fixture: legitimate SPA fetch on non-credential page (no signal)
//   [ ] E2E test verifying NRS score elevation from JS behavior signals
//
// Performance validation:
//   [ ] Benchmark patch overhead (target: < 0.1ms per fetch/XHR call)
//   [ ] Benchmark value getter overhead (target: < 0.05ms per read)
//   [ ] Verify total per-navigation overhead stays under 100ms budget
//

// Suppress unused variable warnings for constants used in implementation slices
void FORM_SUBMIT_CORRELATION_WINDOW_MS;
void CREDENTIAL_READ_DEBOUNCE_MS;
void MAX_RECENT_FORM_SUBMITS;
void MAX_RECENT_NETWORK_REQUESTS;
