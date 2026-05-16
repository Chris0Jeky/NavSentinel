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
 *
 * Runs in the ISOLATED content script world.
 *
 * Known limitation: Shadow DOM subtrees are NOT observed. An attacker could
 * create a custom element with `attachShadow({mode: "open"})` and inject
 * overlays, forms, or password fields inside the shadow tree without
 * triggering any alerts. The codebase already handles shadow DOM for click
 * detection (see `capture_isolated.ts` `tryOpenShadowRoot`), but recursively
 * observing shadow roots as they appear is non-trivial and deferred to a
 * follow-up task.
 * TODO(shadow-dom, #97): Observe shadow roots by listening for shadow host
 * attachment via a secondary MutationObserver or periodic polling.
 */

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
 * Legitimate iframe source patterns to ignore (reCAPTCHA, analytics, ad frames).
 * Matched case-insensitively against the iframe src attribute.
 */
const LEGIT_IFRAME_PATTERNS: RegExp[] = [
  /google\.com\/recaptcha/i,
  /recaptcha/i,
  /hcaptcha\.com/i,
  /challenges\.cloudflare\.com/i,
  /funcaptcha\.com/i,
  /arkoselabs\.com/i,
  /googletagmanager\.com/i,
  /google-analytics\.com/i,
  /googlesyndication\.com/i,
  /doubleclick\.net/i,
  /youtube\.com\/embed/i,
  /facebook\.com\/plugins/i,
  /twitter\.com\/widgets/i,
  /platform\.twitter\.com/i,
  /connect\.facebook\.net/i,
  /apis\.google\.com/i,
  /accounts\.google\.com/i,
  /gstatic\.com/i,
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
  for (const pattern of LEGIT_IFRAME_PATTERNS) {
    if (pattern.test(src)) return true;
  }
  return false;
}

function pushAlert(alert: MutationAlert): void {
  if (alerts.length >= MAX_ALERTS) return;
  alerts.push(alert);
  alertCallback?.(alert);
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

function snapshotFormActions(doc: Document): void {
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

  // Skip known-legitimate iframes
  if (src && isLegitIframeSrc(src)) return;

  const reasons: string[] = [];

  // Check for hidden iframes
  const cs = getComputedStyle(iframe);
  if (cs.display === "none") reasons.push("display:none");
  if (cs.visibility === "hidden") reasons.push("visibility:hidden");

  // Check for tiny iframes
  const rect = iframe.getBoundingClientRect();
  if (rect && rect.width < TINY_IFRAME_PX && rect.height < TINY_IFRAME_PX && rect.width >= 0 && rect.height >= 0) {
    reasons.push(`tiny (${Math.round(rect.width)}x${Math.round(rect.height)})`);
  }

  // Check for cross-domain src
  if (src && isCrossDomain(src)) {
    reasons.push(`cross-domain src: ${src}`);
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

  // Check descendants (e.g., a wrapper div containing a password field)
  const passwords = node.querySelectorAll('input[type="password"]');
  for (let i = 0; i < passwords.length; i++) {
    checkPasswordInjection(passwords[i]!);
  }

  const iframes = node.querySelectorAll("iframe");
  for (let i = 0; i < iframes.length; i++) {
    checkSuspiciousIframe(iframes[i]!);
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

  if (record.attributeName === "src" && target.tagName === "IFRAME") {
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
  if (alerts.length >= MAX_ALERTS) return;

  const batch = pendingMutations;
  pendingMutations = [];

  for (const record of batch) {
    if (alerts.length >= MAX_ALERTS) break;

    if (record.type === "childList") {
      for (let i = 0; i < record.addedNodes.length; i++) {
        if (alerts.length >= MAX_ALERTS) break;
        processAddedNode(record.addedNodes[i]!);
      }
    } else if (record.type === "attributes") {
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
  observer.observe(doc.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["action", "type", "src", "style", "class"],
  });

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
