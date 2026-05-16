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

/** Signal emitted when a credential field value is read outside form submission. */
export interface JsCredentialReadSignal {
  /** Timestamp of the read */
  ts: number;
  /** Whether the read occurred during a form submit event */
  isInsideSubmitHandler: boolean;
  /** Number of password fields on the page */
  fieldCount: number;
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
export const CREDENTIAL_READ_DEBOUNCE_MS = 500;

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

let _recentFormSubmits: FormSubmitRecord[] = [];
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let _recentNetworkRequests: NetworkRequestRecord[] = [];
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let _lastCredentialReadTs = 0;
let _isInsideFormSubmit = false;
let _config: JsBehaviorMonitorConfig | null = null;
let _formSubmitPatched = false;

/** Tracks original form action values at DOM parse time. */
const _originalFormActions = new WeakMap<HTMLFormElement, string>();

// ============================================================================
// Form Submit Monitoring (Slice 2)
// ============================================================================

/** Record a form's initial action attribute for later comparison. */
function recordOriginalAction(form: HTMLFormElement): void {
  if (!_originalFormActions.has(form)) {
    _originalFormActions.set(form, form.getAttribute("action") ?? "");
  }
}

/** Scan existing forms on page and record their initial actions. */
function snapshotExistingForms(): void {
  const forms = document.querySelectorAll("form");
  for (let i = 0; i < forms.length; i++) {
    recordOriginalAction(forms[i] as HTMLFormElement);
  }
}

/** Handle a form submit event and emit signals if suspicious. */
function handleFormSubmit(form: HTMLFormElement): void {
  if (!_config || _config.mode === "off") return;

  const hasCredentials = formHasCredentialFields(form);
  const action = form.action || location.href;
  const crossOrigin = isCrossOriginUrl(action);
  const originalAction = _originalFormActions.get(form) ?? "";
  const resolvedOriginal = originalAction
    ? extractOrigin(originalAction)
    : location.origin;
  const resolvedCurrent = extractOrigin(action);
  const actionDynamicallyChanged =
    resolvedOriginal !== resolvedCurrent && originalAction !== (form.getAttribute("action") ?? "");

  const now = Date.now();

  _recentFormSubmits.push({
    ts: now,
    actionOrigin: resolvedCurrent,
    hasCredentials,
  });
  if (_recentFormSubmits.length > MAX_RECENT_FORM_SUBMITS) {
    _recentFormSubmits.shift();
  }

  _isInsideFormSubmit = true;
  setTimeout(() => { _isInsideFormSubmit = false; }, 0);

  const isSuspicious =
    (hasCredentials && crossOrigin) || actionDynamicallyChanged;

  if (isSuspicious) {
    const signal: JsFormSubmitSignal = {
      ts: now,
      hasCredentialFields: hasCredentials,
      isCrossOrigin: crossOrigin,
      actionDynamicallyChanged,
      destinationOrigin: resolvedCurrent,
    };
    _config.postSignal("ns-js-form-submit-suspicious", signal as unknown as Record<string, unknown>);
  }
}

/** Install form submit monitoring: capturing listener + prototype patch. */
function patchFormSubmitMonitoring(): void {
  if (_formSubmitPatched) return;
  _formSubmitPatched = true;

  snapshotExistingForms();

  // Observe newly added forms via MutationObserver
  const observer = new MutationObserver((mutations) => {
    for (let mi = 0; mi < mutations.length; mi++) {
      const added = mutations[mi]!.addedNodes;
      for (let ni = 0; ni < added.length; ni++) {
        const node = added[ni];
        if (node instanceof HTMLFormElement) {
          recordOriginalAction(node);
        } else if (node instanceof HTMLElement) {
          const forms = node.querySelectorAll("form");
          for (let fi = 0; fi < forms.length; fi++) {
            recordOriginalAction(forms[fi] as HTMLFormElement);
          }
        }
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Capturing submit event listener
  document.addEventListener("submit", (e) => {
    const form = e.target;
    if (form instanceof HTMLFormElement) {
      handleFormSubmit(form);
    }
  }, true);

  // Patch HTMLFormElement.prototype.submit for programmatic submits
  const originalSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function (this: HTMLFormElement) {
    handleFormSubmit(this);
    return originalSubmit.call(this);
  };

  // Note: requestSubmit() fires a 'submit' event which the capturing listener
  // above already handles. No prototype patch needed — patching it would double-fire.
}

// ============================================================================
// Credential Field Value Monitoring (Slice 4)
// ============================================================================

/** Per-input debounce tracking for credential reads. */
const _credReadDebounceMap = new WeakMap<HTMLInputElement, number>();

let _credentialGetterPatched = false;

/** Install value getter patch on HTMLInputElement to detect credential reads. */
function patchCredentialValueGetter(_cfg: JsBehaviorMonitorConfig): void {
  if (_credentialGetterPatched) return;
  void _cfg;

  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  );
  if (!descriptor || !descriptor.get) return;

  _credentialGetterPatched = true;

  const originalGetter = descriptor.get;
  const originalSetter = descriptor.set;

  Object.defineProperty(HTMLInputElement.prototype, "value", {
    get(this: HTMLInputElement) {
      const val = originalGetter.call(this);

      try {
        if (
          this.type === "password" &&
          val.length > 0 &&
          !_isInsideFormSubmit &&
          _config &&
          _config.mode !== "off"
        ) {
          const now = Date.now();
          const lastRead = _credReadDebounceMap.get(this) ?? 0;
          if (now - lastRead > CREDENTIAL_READ_DEBOUNCE_MS) {
            _credReadDebounceMap.set(this, now);
            _lastCredentialReadTs = now;
            const signal: JsCredentialReadSignal = {
              ts: now,
              isInsideSubmitHandler: false,
              fieldCount: document.querySelectorAll('input[type="password"]').length,
            };
            _config.postSignal(
              "ns-js-credential-read",
              signal as unknown as Record<string, unknown>
            );
          }
        }
      } catch {
        // Never break page scripts — swallow monitoring errors
      }

      return val;
    },
    set(this: HTMLInputElement, v: string) {
      if (originalSetter) {
        originalSetter.call(this, v);
      }
    },
    enumerable: descriptor.enumerable ?? true,
    configurable: true,
  });
}

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

  if (config.mode === "off") return;

  patchFormSubmitMonitoring();
  // TODO (Slice 3): patchFetchMonitoring(config);
  // TODO (Slice 3): patchXHRMonitoring(config);
  // TODO (Slice 3): patchBeaconMonitoring(config);
  patchCredentialValueGetter(config);
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
  return form.querySelector('input[type="password"]') !== null;
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
  if (!url) return false;
  const lc = url.trimStart().toLowerCase();
  if (lc.startsWith("data:") || lc.startsWith("javascript:") || lc.startsWith("blob:")) {
    return false;
  }
  try {
    const resolved = new URL(url, location.href);
    if (resolved.origin === "null") return false;
    return resolved.origin !== location.origin;
  } catch {
    return false;
  }
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
  if (!url) return "";
  try {
    const resolved = new URL(url, location.href);
    return resolved.origin;
  } catch {
    return "";
  }
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
  return _recentFormSubmits.some(
    (rec) => {
      const delta = requestTs - rec.ts;
      return rec.hasCredentials && delta >= 0 && delta <= FORM_SUBMIT_CORRELATION_WINDOW_MS;
    }
  );
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

// Suppress unused variable warnings for constants used in future implementation slices
void FORM_SUBMIT_CORRELATION_WINDOW_MS;
void MAX_RECENT_FORM_SUBMITS;
void MAX_RECENT_NETWORK_REQUESTS;
