/**
 * DOM Mutation Monitor (P2-07)
 *
 * MutationObserver-based module that watches for suspicious post-load DOM
 * changes indicative of delayed-injection attacks:
 *
 *   1. Post-load overlay injection (fixed/absolute/sticky covering >=25% viewport)
 *   2. Form action attribute changes on existing <form> elements
 *   3. Password field injection into existing forms after initial load
 *   4. Suspicious iframe injection (hidden, tiny, or cross-origin)
 *
 * Runs in the ISOLATED world alongside capture_isolated.ts.
 * Performance budget: <5ms per mutation batch.
 * Does not score -- only detects and reports signals.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MutationSignal {
  type: string;
  severity: "low" | "medium" | "high";
  element: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BATCH_INTERVAL_MS = 500;
const POST_LOAD_GRACE_MS = 2000;
const VIEWPORT_COVERAGE_THRESHOLD = 0.25;
const MAX_SIGNALS = 64;
const TINY_IFRAME_DIMENSION = 4;
/** Avoid `Node.ELEMENT_NODE` so unit tests run without a full DOM polyfill. */
const ELEMENT_NODE_TYPE = 1;

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let observer: MutationObserver | null = null;
let batchTimer = 0;
let pageLoadedAt = 0;
const pendingMutations: MutationRecord[] = [];
const signals: MutationSignal[] = [];

// ---------------------------------------------------------------------------
// Helpers (pure, exported for testing)
// ---------------------------------------------------------------------------

/**
 * Describe an element briefly for the signal log.
 * Avoids expensive DOM reads -- just tag + id/class summary.
 */
export function describeElement(el: Element): string {
  const tag = el.tagName?.toLowerCase() ?? "unknown";
  const id = el.id ? `#${el.id}` : "";
  const cls = el.className && typeof el.className === "string"
    ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}`
    : "";
  return `${tag}${id}${cls}`.slice(0, 120);
}

/**
 * Return true when the element is positioned fixed/absolute/sticky and
 * covers at least `VIEWPORT_COVERAGE_THRESHOLD` of the viewport.
 */
export function isLargeOverlay(el: Element): boolean {
  const style = getComputedStyle(el);
  const pos = style.position;
  if (pos !== "fixed" && pos !== "absolute" && pos !== "sticky") return false;

  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  const vpArea = innerWidth * innerHeight;
  if (vpArea <= 0) return false;

  const coverage = (rect.width * rect.height) / vpArea;
  return coverage >= VIEWPORT_COVERAGE_THRESHOLD;
}

/**
 * Heuristic to identify common legitimate overlays (cookie banners, consent
 * dialogs) so they receive reduced severity rather than "high".
 */
export function looksLikeLegitOverlay(el: Element): boolean {
  const text = (el.textContent ?? "").toLowerCase();
  const id = (el.id ?? "").toLowerCase();
  const cls = typeof el.className === "string" ? el.className.toLowerCase() : "";

  // Cookie / consent patterns
  const consentTokens = [
    "cookie", "consent", "gdpr", "privacy", "accept all",
    "accept cookies", "cookie-banner", "cookie-notice",
    "cookie-consent", "consent-banner",
  ];
  for (let i = 0; i < consentTokens.length; i++) {
    const token = consentTokens[i]!;
    if (id.includes(token) || cls.includes(token)) return true;
    if (text.length < 2000 && text.includes(token)) return true;
  }

  // Common overlay frameworks / ARIA roles
  const role = (el.getAttribute("role") ?? "").toLowerCase();
  if (role === "dialog" || role === "alertdialog") return true;

  return false;
}

/**
 * Classify an iframe as suspicious based on visibility and src.
 * Returns null when the iframe looks benign.
 */
export function classifyIframe(
  iframe: HTMLIFrameElement
): { severity: "low" | "medium" | "high"; reason: string } | null {
  const style = getComputedStyle(iframe);

  // Hidden via display:none
  if (style.display === "none") {
    return { severity: "high", reason: "display:none" };
  }

  // Tiny dimensions
  const rect = iframe.getBoundingClientRect();
  if (
    rect.width <= TINY_IFRAME_DIMENSION &&
    rect.height <= TINY_IFRAME_DIMENSION
  ) {
    return { severity: "high", reason: "tiny dimensions" };
  }

  // Cross-origin src
  const src = iframe.src || iframe.getAttribute("src") || "";
  if (src && !src.startsWith("about:") && !src.startsWith("javascript:")) {
    try {
      const srcUrl = new URL(src, location.href);
      if (srcUrl.origin !== location.origin) {
        return { severity: "medium", reason: "cross-origin src" };
      }
    } catch {
      // Malformed URL is suspicious
      return { severity: "medium", reason: "malformed src" };
    }
  }

  return null;
}

/**
 * Classify a single added node. Returns zero or more signals.
 * Pure-ish function: reads computed style from the live DOM, but
 * classification logic is deterministic given those values.
 */
export function classifyAddedNode(
  node: Node,
  now: number,
  loadedAt: number
): MutationSignal[] {
  if (node.nodeType !== ELEMENT_NODE_TYPE) return [];
  const el = node as Element;
  const results: MutationSignal[] = [];
  const timeSinceLoad = now - loadedAt;

  // --- 1. Large overlay injection after grace period ---
  if (timeSinceLoad > POST_LOAD_GRACE_MS && isLargeOverlay(el)) {
    const legit = looksLikeLegitOverlay(el);
    results.push({
      type: "post_load_overlay",
      severity: legit ? "low" : "high",
      element: describeElement(el),
      timestamp: now,
    });
  }

  // --- 2. Password field added to an existing form ---
  if (el.tagName === "INPUT") {
    const input = el as HTMLInputElement;
    if (
      input.type === "password" &&
      timeSinceLoad > POST_LOAD_GRACE_MS &&
      input.closest("form")
    ) {
      results.push({
        type: "password_field_injection",
        severity: "high",
        element: describeElement(el),
        timestamp: now,
      });
    }
  }

  // Check children for password fields (e.g. a wrapper div inserted)
  if (timeSinceLoad > POST_LOAD_GRACE_MS) {
    const pwFields = el.querySelectorAll
      ? el.querySelectorAll('input[type="password"]')
      : null;
    if (pwFields) {
      for (let i = 0; i < pwFields.length; i++) {
        const pw = pwFields[i]!;
        if (pw.closest("form")) {
          results.push({
            type: "password_field_injection",
            severity: "high",
            element: describeElement(pw),
            timestamp: now,
          });
        }
      }
    }
  }

  // --- 3. Suspicious iframe injection ---
  if (el.tagName === "IFRAME" && timeSinceLoad > POST_LOAD_GRACE_MS) {
    const classification = classifyIframe(el as HTMLIFrameElement);
    if (classification) {
      results.push({
        type: "suspicious_iframe",
        severity: classification.severity,
        element: `${describeElement(el)} (${classification.reason})`,
        timestamp: now,
      });
    }
  }

  // Check children for iframes
  if (timeSinceLoad > POST_LOAD_GRACE_MS && el.querySelectorAll) {
    const iframes = el.querySelectorAll("iframe");
    for (let i = 0; i < iframes.length; i++) {
      const iframe = iframes[i]!;
      const classification = classifyIframe(iframe);
      if (classification) {
        results.push({
          type: "suspicious_iframe",
          severity: classification.severity,
          element: `${describeElement(iframe)} (${classification.reason})`,
          timestamp: now,
        });
      }
    }
  }

  return results;
}

/**
 * Classify a form action attribute change.
 */
export function classifyFormActionChange(
  form: Element,
  oldValue: string | null,
  newValue: string | null,
  now: number
): MutationSignal | null {
  if (form.tagName !== "FORM") return null;
  if (!newValue) return null;

  // Same value is not a mutation of interest
  if (oldValue === newValue) return null;

  // Check whether the new action is cross-origin
  let severity: "low" | "medium" | "high" = "medium";
  try {
    const newUrl = new URL(newValue, location.href);
    if (newUrl.origin !== location.origin) {
      severity = "high";
    }
  } catch {
    // Malformed URL
    severity = "high";
  }

  return {
    type: "form_action_change",
    severity,
    element: describeElement(form),
    timestamp: now,
  };
}

// ---------------------------------------------------------------------------
// Batch processor
// ---------------------------------------------------------------------------

function processBatch(): void {
  batchTimer = 0;
  if (pendingMutations.length === 0) return;

  const now = Date.now();
  const batch = pendingMutations.splice(0, pendingMutations.length);

  for (let m = 0; m < batch.length; m++) {
    const mutation = batch[m]!;

    // --- Added nodes ---
    if (mutation.type === "childList") {
      const added = mutation.addedNodes;
      for (let i = 0; i < added.length; i++) {
        const node = added[i]!;
        const nodeSignals = classifyAddedNode(node, now, pageLoadedAt);
        for (let s = 0; s < nodeSignals.length; s++) {
          pushSignal(nodeSignals[s]!);
        }
      }
    }

    // --- Attribute changes on forms ---
    if (
      mutation.type === "attributes" &&
      mutation.attributeName === "action" &&
      mutation.target.nodeType === ELEMENT_NODE_TYPE
    ) {
      const form = mutation.target as Element;
      const newValue = form.getAttribute("action");
      const signal = classifyFormActionChange(
        form,
        mutation.oldValue,
        newValue,
        now
      );
      if (signal) {
        pushSignal(signal);
      }
    }
  }
}

function pushSignal(signal: MutationSignal): void {
  signals.push(signal);
  if (signals.length > MAX_SIGNALS) {
    signals.splice(0, signals.length - MAX_SIGNALS);
  }
}

function scheduleBatch(): void {
  if (batchTimer) return;
  batchTimer = setTimeout(processBatch, BATCH_INTERVAL_MS) as unknown as number;
}

// ---------------------------------------------------------------------------
// Observer callback
// ---------------------------------------------------------------------------

function onMutations(records: MutationRecord[]): void {
  for (let i = 0; i < records.length; i++) {
    pendingMutations.push(records[i]!);
  }
  scheduleBatch();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function startMutationMonitor(): void {
  if (observer) return; // already running

  pageLoadedAt = Date.now();

  observer = new MutationObserver(onMutations);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["action"],
    attributeOldValue: true,
  });
}

export function stopMutationMonitor(): void {
  if (!observer) return;
  observer.disconnect();
  observer = null;
  if (batchTimer) {
    clearTimeout(batchTimer);
    batchTimer = 0;
  }
  pendingMutations.length = 0;
}

export function getMutationSignals(): MutationSignal[] {
  // Flush any pending batch so callers see the latest signals
  if (pendingMutations.length > 0) {
    processBatch();
  }
  return signals.slice();
}

export function clearMutationSignals(): void {
  signals.length = 0;
}

// ---------------------------------------------------------------------------
// Test helpers (exported for unit tests only)
// ---------------------------------------------------------------------------

/** Reset all module state. For testing only. */
export function _resetMutationMonitor(): void {
  stopMutationMonitor();
  signals.length = 0;
  pageLoadedAt = 0;
}

/** Override pageLoadedAt for deterministic tests. */
export function _setPageLoadedAt(ts: number): void {
  pageLoadedAt = ts;
}

/** Expose pending mutations array length for rate-limiting tests. */
export function _getPendingCount(): number {
  return pendingMutations.length;
}

/** Directly inject a signal for testing. */
export function _pushSignal(signal: MutationSignal): void {
  pushSignal(signal);
}
