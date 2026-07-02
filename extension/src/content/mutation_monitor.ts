/**
 * DOM Mutation Monitoring module.
 *
 * Detects post-load DOM manipulations that indicate phishing or injection attacks:
 *   1. Delayed overlay injection (position: fixed/absolute/sticky, large coverage, high z-index)
 *   2. Form action attribute changes (especially cross-domain)
 *   3. Password field injection into existing forms
 *   4. Suspicious iframe injection (hidden, tiny, or cross-domain)
 *
 * Design:
 * - Starts observation >2 seconds after page load (avoids flagging SPA UI builds)
 * - Batches mutations with a 100ms debounce window
 * - Caps at 50 alerts per page to prevent memory bloat
 * - Auto-disconnects after 5 minutes to save resources
 * - Recursively observes open shadow DOM roots as they appear (#97)
 *
 * Runs in the ISOLATED content script world.
 */

import { matchProviderHostSrc, type ProviderHostEntry } from "../shared/iframe_provider";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MutationAlertType =
  | "overlay_injected"
  | "form_action_changed"
  | "password_injected"
  | "suspicious_iframe";

export type MutationAlertSeverity = "low" | "medium" | "high";

export interface MutationAlert {
  type: MutationAlertType;
  severity: MutationAlertSeverity;
  element: Element;
  details: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ALERTS = 50;
const DEBOUNCE_MS = 100;
const AUTO_DISCONNECT_MS = 5 * 60 * 1000; // 5 minutes
const MIN_OVERLAY_COVERAGE = 0.25;
const MIN_OVERLAY_ZINDEX = 100;
const TINY_IFRAME_PX = 10;

/**
 * Legitimate iframe providers to ignore (reCAPTCHA, analytics, ad frames, embeds).
 * Matched by the iframe src's parsed HOSTNAME at a registrable-suffix boundary
 * (host === entry.host or endsWith "." + entry.host), with an optional path prefix
 * for providers that share a host with non-embed content. This replaces the prior
 * unanchored substring regexes, which a spoofed src could satisfy by merely
 * embedding a provider name anywhere in the URL — e.g. evil.example/?u=hcaptcha.com
 * or attacker-cdn/recaptcha-badge.png (the same hostname-spoof class as #206). (#211)
 */
// Broader legit-iframe set (captcha providers + analytics/ads/social/embed hosts) — wider
// than clickfix's CAPTCHA_PROVIDERS by purpose. The two tables stay separate but share the
// matcher (matchProviderHostSrc), so the host/path validation logic cannot drift. Note the
// recaptcha.net/gstatic.com path-gating intentionally stays per-consumer; reconciling it is
// FP-sensitive (tightening here could flag a legit gstatic iframe) and out of scope. (#226)
const LEGIT_IFRAME_HOSTS: ProviderHostEntry[] = [
  { host: "google.com", pathPrefix: "/recaptcha" },
  { host: "recaptcha.net" },
  { host: "gstatic.com" },
  { host: "hcaptcha.com" },
  { host: "challenges.cloudflare.com" },
  { host: "funcaptcha.com" },
  { host: "arkoselabs.com" },
  { host: "googletagmanager.com" },
  { host: "google-analytics.com" },
  { host: "googlesyndication.com" },
  { host: "doubleclick.net" },
  { host: "youtube.com", pathPrefix: "/embed" },
  { host: "youtube-nocookie.com", pathPrefix: "/embed" },
  { host: "facebook.com", pathPrefix: "/plugins" },
  { host: "connect.facebook.net" },
  { host: "twitter.com", pathPrefix: "/widgets" },
  { host: "platform.twitter.com" },
  { host: "apis.google.com" },
  { host: "accounts.google.com" },
];

/**
 * Cookie consent banner patterns matched against element id + className.
 */
const COOKIE_CONSENT_PATTERNS: RegExp[] = [
  /cookie[-_]?consent/i,
  /cookie[-_]?banner/i,
  /cookie[-_]?notice/i,
  /onetrust/i,
  /cookiebot/i,
  /osano/i,
  /gdpr/i,
  /cc[-_]?banner/i,
  /consent[-_]?banner/i,
  /consent[-_]?modal/i,
];

/**
 * Chat widget patterns matched against element id + className.
 */
const CHAT_WIDGET_PATTERNS: RegExp[] = [
  /intercom/i,
  /drift/i,
  /crisp/i,
  /tawk/i,
  /zendesk/i,
  /tidio/i,
  /hubspot[-_]?chat/i,
  /livechat/i,
];

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let observer: MutationObserver | null = null;
let alertCallback: ((alert: MutationAlert) => void) | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let disconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pendingMutations: MutationRecord[] = [];
const alerts: MutationAlert[] = [];
let pageHost: string = "";

const observedShadowRoots = new WeakSet<ShadowRoot>();
const shadowObserversByHost = new Map<Element, MutationObserver>();

/**
 * Tracks original `action` attribute values for forms observed at startup.
 * Key: the form Element, Value: the original action string (or "" if absent).
 */
const originalFormActions = new WeakMap<Element, string>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url, location.href).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isCrossDomain(href: string): boolean {
  const h = hostFromUrl(href);
  if (!h) return false;
  return h !== pageHost;
}

function isLegitIframeSrc(src: string): boolean {
  // Host + segment-anchored path validation is shared with clickfix_detector via
  // matchProviderHostSrc so the two cannot drift; opaque/script schemes are rejected by it
  // (and handled separately by suspiciousIframeScheme). (#226, #211 R1)
  return matchProviderHostSrc(src, LEGIT_IFRAME_HOSTS);
}

// Opaque / script-bearing iframe URL schemes. An iframe injected after load with
// one of these runs attacker-controlled content (data:/blob: are their own
// opaque origin; javascript: executes in-page) but carries no hostname, so the
// cross-domain check (which keys off the URL host) never flags them.
const SUSPICIOUS_IFRAME_SCHEME_RE = /^(data|blob|javascript):/i;

function suspiciousIframeScheme(src: string): string | null {
  // Mirror how browsers sanitize a URL before parsing: strip ASCII tab/newline/CR
  // from ANYWHERE (so "da\tta:..." still resolves to data:), and trim LEADING
  // control/space chars (so "data:" or " data:" resolve to data:). Interior
  // spaces are NOT stripped — a space inside a would-be scheme makes it invalid,
  // so the browser treats e.g. "da ta:" as a relative URL and we must not flag it.
  let normalized = "";
  let trimmingLeading = true;
  for (const ch of src) {
    const code = ch.charCodeAt(0);
    if (code === 0x09 || code === 0x0a || code === 0x0d) continue; // tab / LF / CR, anywhere
    if (trimmingLeading && code <= 0x20) continue; // leading control / space
    trimmingLeading = false;
    normalized += ch;
  }
  const m = SUSPICIOUS_IFRAME_SCHEME_RE.exec(normalized);
  return m ? m[1]!.toLowerCase() : null;
}

function pushAlert(alert: MutationAlert): void {
  if (alerts.length >= MAX_ALERTS) return;
  alerts.push(alert);
  alertCallback?.(alert);
}

// ---------------------------------------------------------------------------
// Shadow DOM observation
// ---------------------------------------------------------------------------

const OBSERVE_CONFIG: MutationObserverInit = {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["action", "type", "src", "srcdoc", "style", "class"],
};

function tryGetShadowRoot(el: Element): ShadowRoot | null {
  if (el.shadowRoot) return el.shadowRoot;
  try {
    return (globalThis as Record<string, unknown> as {
      chrome?: { dom?: { openOrClosedShadowRoot?: (e: Element) => ShadowRoot | null } }
    }).chrome?.dom?.openOrClosedShadowRoot?.(el) ?? null;
  } catch { return null; }
}

const SELF_HOST_PATTERN = /^__(?:navsentinel|sentinelsuite)_/;

function isNavSentinelHost(el: Element): boolean {
  const id = el.id ?? "";
  return SELF_HOST_PATTERN.test(id);
}

function observeShadowRoot(sr: ShadowRoot): void {
  if (observedShadowRoots.has(sr)) return;

  const host = sr.host;
  if (isNavSentinelHost(host)) return;

  observedShadowRoots.add(sr);

  const shadowObs = new MutationObserver(onMutations);
  shadowObs.observe(sr, OBSERVE_CONFIG);
  shadowObserversByHost.set(host, shadowObs);

  snapshotFormActions(sr);

  scanForShadowRoots(sr);
}

function scanForShadowRoots(root: Element | ShadowRoot | Document): void {
  const elements = root.querySelectorAll("*");
  for (let i = 0; i < elements.length; i++) {
    const sr = tryGetShadowRoot(elements[i]!);
    if (sr) observeShadowRoot(sr);
  }
}

function checkAndObserveShadowRoot(el: Element): void {
  const sr = tryGetShadowRoot(el);
  if (sr) observeShadowRoot(sr);
}

// ---------------------------------------------------------------------------
// Detection: overlays
// ---------------------------------------------------------------------------

/**
 * Check if an element or its ancestors match any patterns in a list.
 * Tests against the concatenation of `id` and `className`.
 */
function matchesPatterns(el: Element, patterns: RegExp[]): boolean {
  let current: Element | null = el;
  // Walk up to 5 ancestors to check for wrapper elements
  for (let depth = 0; current && depth < 5; depth++) {
    const id = current.id ?? "";
    const cls = typeof current.className === "string" ? current.className : "";
    const haystack = id + " " + cls;
    for (const pat of patterns) {
      if (pat.test(haystack)) return true;
    }
    current = current.parentElement;
  }
  return false;
}

/**
 * Check if an element or its ancestors have dialog/modal ARIA roles.
 * Mirrors the logic in `dom_builder.ts:detectLegitModalBackdrop`.
 */
function hasDialogRole(el: Element): boolean {
  let current: Element | null = el;
  for (let depth = 0; current && depth < 5; depth++) {
    const role = (current.getAttribute("role") ?? "").toLowerCase();
    if (role === "dialog" || role === "alertdialog") return true;
    if ((current.getAttribute("aria-modal") ?? "").toLowerCase() === "true") return true;
    current = current.parentElement;
  }
  return false;
}

/**
 * Determine if an overlay-like element is likely benign (cookie banner,
 * chat widget, SPA modal with proper ARIA roles). Returns null if not
 * benign, or a reason string if the element should be downgraded to 'low'.
 */
function getBenignOverlayReason(el: Element): string | null {
  if (hasDialogRole(el)) return "dialog_role";
  if (matchesPatterns(el, COOKIE_CONSENT_PATTERNS)) return "cookie_consent";
  if (matchesPatterns(el, CHAT_WIDGET_PATTERNS)) return "chat_widget";
  return null;
}

function checkOverlay(el: Element): void {
  // Only check elements that could plausibly be overlays
  if (!(el instanceof HTMLElement)) return;

  const cs = getComputedStyle(el);
  const pos = cs.position;
  if (pos !== "fixed" && pos !== "absolute" && pos !== "sticky") return;
  if (cs.display === "none" || cs.visibility === "hidden") return;

  const z = cs.zIndex === "auto" ? 0 : Number.parseInt(cs.zIndex, 10);
  if (!Number.isFinite(z) || z < MIN_OVERLAY_ZINDEX) return;

  const rect = el.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return;

  const vw = Math.max(window.innerWidth, 1);
  const vh = Math.max(window.innerHeight, 1);
  const coverage = (rect.width * rect.height) / (vw * vh);
  if (coverage < MIN_OVERLAY_COVERAGE) return;

  // Check for benign overlays (cookie banners, chat widgets, ARIA dialogs).
  // These are downgraded to 'low' severity instead of suppressed entirely,
  // so we can still learn from them in telemetry.
  const benignReason = getBenignOverlayReason(el);
  const severity: MutationAlertSeverity = benignReason ? "low" : "high";
  const suffix = benignReason ? ` (downgraded: ${benignReason})` : "";

  pushAlert({
    type: "overlay_injected",
    severity,
    element: el,
    details: `Overlay injected: position=${pos}, z-index=${z}, coverage=${(coverage * 100).toFixed(1)}%${suffix}`,
    timestamp: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// Detection: form action changes
// ---------------------------------------------------------------------------

function snapshotFormActions(doc: Document | ShadowRoot): void {
  const forms = doc.querySelectorAll("form");
  for (let i = 0; i < forms.length; i++) {
    const form = forms[i]!;
    if (!originalFormActions.has(form)) {
      originalFormActions.set(form, form.getAttribute("action") ?? "");
    }
  }
}

function checkFormActionChange(form: Element): void {
  if (form.tagName !== "FORM") return;

  const original = originalFormActions.get(form);
  if (original === undefined) {
    // First time seeing this form -- record its action, don't alert
    originalFormActions.set(form, (form as HTMLFormElement).getAttribute("action") ?? "");
    return;
  }

  const current = (form as HTMLFormElement).getAttribute("action") ?? "";
  if (current === original) return;

  const crossDomain = current ? isCrossDomain(current) : false;
  const detail = crossDomain
    ? `Form action changed to cross-domain URL: "${current}" (was "${original}")`
    : `Form action changed: "${current}" (was "${original}")`;

  pushAlert({
    type: "form_action_changed",
    severity: crossDomain ? "high" : "medium",
    element: form,
    details: detail,
    timestamp: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// Detection: password field injection
// ---------------------------------------------------------------------------

function checkPasswordInjection(el: Element): void {
  if (el.tagName !== "INPUT") return;
  const input = el as HTMLInputElement;
  if (input.type !== "password") return;

  // Check if this password field was added inside an existing form
  const parentForm = input.closest("form");
  const detail = parentForm
    ? "Password field injected into existing form after page load"
    : "Password field injected into page after page load";

  pushAlert({
    type: "password_injected",
    severity: "high",
    element: el,
    details: detail,
    timestamp: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// Detection: suspicious iframes
// ---------------------------------------------------------------------------

function checkSuspiciousIframe(el: Element): void {
  if (el.tagName !== "IFRAME") return;
  const iframe = el as HTMLIFrameElement;
  const src = iframe.getAttribute("src") ?? "";
  const hasSrcdoc = iframe.hasAttribute("srcdoc");

  // Resolve the opaque/script scheme (data:/blob:/javascript:) FIRST. Its payload
  // is fully attacker-controlled, so it must NEVER be whitelisted by the legit-src
  // allowlist; isLegitIframeSrc now only accepts http(s) provider hostnames, but
  // checking the scheme first keeps that guarantee explicit and defensive.
  const scheme = src ? suspiciousIframeScheme(src) : null;
  const srcIsLegit = src !== "" && !scheme && isLegitIframeSrc(src);

  // A legitimate src with NO srcdoc is safe. But per the HTML spec srcdoc renders
  // OVER src (src is only a fallback), so a legit src paired with a malicious
  // srcdoc must still be inspected — don't short-circuit when srcdoc is present.
  if (srcIsLegit && !hasSrcdoc) return;

  const reasons: string[] = [];

  // Rendering checks apply regardless of src legitimacy.
  const cs = getComputedStyle(iframe);
  if (cs.display === "none") reasons.push("display:none");
  if (cs.visibility === "hidden") reasons.push("visibility:hidden");

  const rect = iframe.getBoundingClientRect();
  if (rect && rect.width < TINY_IFRAME_PX && rect.height < TINY_IFRAME_PX && rect.width >= 0 && rect.height >= 0) {
    reasons.push(`tiny (${Math.round(rect.width)}x${Math.round(rect.height)})`);
  }

  // Opaque/script-scheme src (data:/blob:/javascript:) has no hostname so
  // isCrossDomain can't flag it, but an injected one runs attacker-controlled
  // content. Flagged unconditionally (never exempted by the legit-src allowlist).
  // (Trade-off: a legitimate post-load data:/blob: preview iframe is also
  // flagged; acceptable for a medium informational alert since injecting such an
  // iframe after load is uncommon.)
  if (scheme) {
    reasons.push(`${scheme}-scheme src`);
  } else if (!srcIsLegit && src && isCrossDomain(src)) {
    // Cross-domain src (only meaningful for host-bearing, non-legit URLs).
    reasons.push(`cross-domain src: ${src}`);
  }

  // srcdoc runs attacker-provided inline HTML in an opaque origin with no src to
  // scheme-check — the same content-injection vector as a data: iframe. Checked
  // independently of the legit-src short-circuit above. (Trade-off: legitimate
  // post-load srcdoc usage exists — sandboxed previews, rich-text/email
  // renderers, code playgrounds — so this is a medium informational alert, not a
  // block; tracked for a possible benign-srcdoc allowlist if it proves noisy.)
  if (hasSrcdoc) {
    reasons.push("srcdoc (inline HTML)");
  }

  if (reasons.length === 0) return;

  pushAlert({
    type: "suspicious_iframe",
    severity: "medium",
    element: el,
    details: `Suspicious iframe injected: ${reasons.join(", ")}`,
    timestamp: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// Mutation processing
// ---------------------------------------------------------------------------

function processAddedNode(node: Node): void {
  if (!(node instanceof Element)) return;

  // Check the node itself
  checkOverlay(node);
  checkPasswordInjection(node);
  checkSuspiciousIframe(node);
  checkAndObserveShadowRoot(node);

  // Check descendants (e.g., a wrapper div containing a password field)
  const passwords = node.querySelectorAll('input[type="password"]');
  for (let i = 0; i < passwords.length; i++) {
    checkPasswordInjection(passwords[i]!);
  }

  const iframes = node.querySelectorAll("iframe");
  for (let i = 0; i < iframes.length; i++) {
    checkSuspiciousIframe(iframes[i]!);
  }

  // Check descendants for shadow roots
  const descendants = node.querySelectorAll("*");
  for (let i = 0; i < descendants.length; i++) {
    checkAndObserveShadowRoot(descendants[i]!);
  }
}

function disconnectShadowObserver(host: Element): void {
  // A host appearing in a removedNodes record has NOT necessarily left the DOM:
  // replacing a node with itself — replaceChild(host, host) / host.replaceWith(host)
  // — emits a single MutationRecord with the host in BOTH addedNodes and removedNodes
  // (WHATWG DOM "replace" algorithm), yet the host stays connected. The add-path runs
  // first and no-ops (root already observed), then the remove-path would tear the
  // observer down while the content is still live and visible. processBatch runs on the
  // debounce timer AFTER the whole synchronous mutation sequence, so isConnected here is
  // authoritative — only tear down observers for hosts that genuinely left the document.
  // Without this guard the recursion below would let one page JS call blind the monitor
  // for an entire nested shadow subtree (and even pre-recursion it silently killed the
  // host's own observer). Also covers a nested host re-parented into live DOM within the
  // debounce window. (#401 R1)
  if (host.isConnected) return;
  const obs = shadowObserversByHost.get(host);
  if (!obs) return;
  obs.disconnect();
  shadowObserversByHost.delete(host);
  const sr = tryGetShadowRoot(host);
  if (sr) {
    observedShadowRoots.delete(sr);
    // Nested shadow hosts live inside this root, which the light-DOM
    // querySelectorAll walk in processRemovedNode cannot pierce — without this
    // recursion their observers (and the strong Map references keeping the
    // detached elements alive) leak until the AUTO_DISCONNECT_MS timer (#401).
    // Cost is bounded: only hosts that actually had a registered observer pay
    // the shadow-root walk, and every observed nested host is in the Map, so
    // the recursion reaches arbitrarily deep observed nesting.
    const nested = sr.querySelectorAll("*");
    for (let i = 0; i < nested.length; i++) {
      disconnectShadowObserver(nested[i]!);
    }
  }
}

function processRemovedNode(node: Node): void {
  if (!(node instanceof Element)) return;

  // Fast path: this function only disconnects shadow observers, so with none
  // registered there is nothing to do — skip the O(subtree) querySelectorAll walk
  // entirely. This keeps the now-unconditional cleanup (#409) essentially free on
  // the common page that uses no shadow DOM. (#412 R2)
  if (shadowObserversByHost.size === 0) return;

  disconnectShadowObserver(node);

  const descendants = node.querySelectorAll("*");
  for (let i = 0; i < descendants.length; i++) {
    disconnectShadowObserver(descendants[i]!);
  }
}

function processAttributeChange(record: MutationRecord): void {
  const target = record.target;
  if (!(target instanceof Element)) return;

  if (record.attributeName === "action") {
    checkFormActionChange(target);
  }

  if (record.attributeName === "type" && target.tagName === "INPUT") {
    const input = target as HTMLInputElement;
    if (input.type === "password") {
      pushAlert({
        type: "password_injected",
        severity: "high",
        element: target,
        details: "Input type changed to password after page load",
        timestamp: Date.now(),
      });
    }
  }

  if (
    (record.attributeName === "src" || record.attributeName === "srcdoc") &&
    target.tagName === "IFRAME"
  ) {
    // Re-check on srcdoc too, so a two-step inject-then-set-srcdoc can't evade.
    checkSuspiciousIframe(target);
  }

  // Style or class attribute changes on existing elements could create overlays.
  // An attacker can inject a benign element then toggle a class to reveal it
  // as a phishing overlay (e.g., el.classList.add("active")).
  if (record.attributeName === "style" || record.attributeName === "class") {
    checkOverlay(target);
  }
}

function processBatch(): void {
  debounceTimer = null;

  // Always drain the queue, even once the alert cap is reached: the old early
  // `return` here left pendingMutations growing unbounded (onMutations keeps
  // pushing) and, worse, skipped removed-node CLEANUP so shadow-observer
  // disconnects stopped until AUTO_DISCONNECT_MS. Only the DETECTION work
  // (added-node scan + attribute-change alerts) is gated on the cap; removed-node
  // cleanup runs unconditionally. pushAlert also self-caps, so `detect` is a perf
  // skip, not the alert bound. (#409)
  const batch = pendingMutations;
  pendingMutations = [];

  for (const record of batch) {
    const detect = alerts.length < MAX_ALERTS;

    if (record.type === "childList") {
      if (detect) {
        for (let i = 0; i < record.addedNodes.length; i++) {
          if (alerts.length >= MAX_ALERTS) break;
          processAddedNode(record.addedNodes[i]!);
        }
      }
      for (let i = 0; i < record.removedNodes.length; i++) {
        processRemovedNode(record.removedNodes[i]!);
      }
    } else if (record.type === "attributes" && detect) {
      processAttributeChange(record);
    }
  }
}

function onMutations(records: MutationRecord[]): void {
  for (const r of records) {
    pendingMutations.push(r);
  }
  if (debounceTimer === null) {
    debounceTimer = setTimeout(processBatch, DEBOUNCE_MS);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start monitoring the document for suspicious DOM mutations.
 *
 * @param doc   The Document to observe (usually `document`)
 * @param onAlert  Callback invoked for each new MutationAlert
 */
export function startMutationMonitor(
  doc: Document,
  onAlert: (alert: MutationAlert) => void
): void {
  // Prevent double-start
  if (observer) {
    stopMutationMonitor();
  }

  pageHost = location.hostname.toLowerCase();
  alertCallback = onAlert;
  alerts.length = 0;

  // Snapshot current form actions so we can detect changes later
  snapshotFormActions(doc);

  observer = new MutationObserver(onMutations);
  observer.observe(doc.documentElement, OBSERVE_CONFIG);

  // Scan existing DOM for shadow roots to observe
  scanForShadowRoots(doc);

  // Auto-disconnect after 5 minutes
  disconnectTimer = setTimeout(() => {
    stopMutationMonitor();
  }, AUTO_DISCONNECT_MS);
}

/**
 * Stop the mutation monitor and clean up.
 */
export function stopMutationMonitor(): void {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  for (const [, obs] of shadowObserversByHost) {
    obs.disconnect();
  }
  shadowObserversByHost.clear();
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (disconnectTimer !== null) {
    clearTimeout(disconnectTimer);
    disconnectTimer = null;
  }
  pendingMutations = [];
  alertCallback = null;
}

/**
 * Return all alerts collected so far. The returned array is a snapshot copy.
 */
export function getMutationAlerts(): MutationAlert[] {
  return alerts.slice();
}

/**
 * Return the number of alerts collected so far (cheap for debug overlay).
 */
export function getMutationAlertCount(): number {
  return alerts.length;
}

/** Exposed for testing only. */
export function _resetMutationState(): void {
  stopMutationMonitor();
  alerts.length = 0;
}

/** Exposed for testing only: number of live per-shadow-root observers. */
export function _getShadowObserverCountForTesting(): number {
  return shadowObserversByHost.size;
}

/** Exposed for testing only: number of records still queued for the next batch. */
export function _getPendingMutationCountForTesting(): number {
  return pendingMutations.length;
}

/**
 * Exposed for testing only: feed synthetic MutationRecords through the same
 * batching path the real observer uses. Needed because happy-dom cannot emit the
 * spec-accurate single-record self-replace shape (host in BOTH addedNodes and
 * removedNodes while still connected) that the real-browser evasion relies on.
 */
export function _feedMutationRecordsForTesting(records: MutationRecord[]): void {
  onMutations(records);
}
