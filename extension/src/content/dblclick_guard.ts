/**
 * DoubleClickjacking detection state machine.
 *
 * Detects the attack pattern where a malicious page opens a child window,
 * then uses timing tricks around double-clicks to navigate the opener
 * (victim tab) to a sensitive URL while the user believes they are
 * interacting with the child window.
 *
 * Detection relies on the COMBINATION of signals:
 *   1. Same-document legacy evidence: window.open, opener.location and a
 *      second click were all observed by the MAIN-world bridge; OR
 *   2. Cross-document evidence: the isolated child script saw a trusted click,
 *      Chrome committed a navigation in its verified opener tab, and the
 *      resulting opaque SW capability survived the document replacement.
 *
 * The signal expires after DBLCLICK_HIJACK_STALE_MS to avoid stale FPs.
 */

// --- Constants ---

const DBLCLICK_HIJACK_STALE_MS = 5000;

// --- State variables ---

let dblclickWindowOpenTs = 0;
let dblclickOpenerNavTs = 0;
let dblclickOpenerNavUrl = "";
let dblclickSecondClickTs = 0;
/** URL-free opaque capability from the SW's cross-document correlation. */
let dblclickCrossDocument: { expiresAt: number; token: string } | null = null;

// --- Public API ---

/**
 * Handle DoubleClickjacking-related bridge messages from main_guard.
 *
 * Called by capture_isolated.ts when the bridge dispatches one of:
 *   - ns-dblclick-window-open
 *   - ns-dblclick-opener-nav
 *   - ns-dblclick-second-click
 *
 * Returns an object with `handled` (whether the message was consumed) and
 * optionally `forwardToSW` with the payload to relay to the service worker.
 */
export function handleDblclickBridgeMessage(
  type: string,
  data: Record<string, unknown>,
): { handled: boolean; forwardToSW?: { type: string; url: string; ts: number } } {
  if (type === "ns-dblclick-window-open") {
    dblclickWindowOpenTs = typeof data.ts === "number" ? data.ts : Date.now();
    // Reset stale signals from a previous detection cycle.
    dblclickOpenerNavTs = 0;
    dblclickOpenerNavUrl = "";
    dblclickSecondClickTs = 0;
    return { handled: true };
  }

  if (type === "ns-dblclick-opener-nav") {
    dblclickOpenerNavTs = typeof data.ts === "number" ? data.ts : Date.now();
    dblclickOpenerNavUrl = typeof data.url === "string" ? data.url : "";
    // Signal that this needs to be forwarded to the SW so it can notify
    // the opener tab. capture_isolated.ts will handle the actual send.
    return {
      handled: true,
      forwardToSW: {
        type: "ns-dblclick-opener-nav",
        url: dblclickOpenerNavUrl,
        ts: dblclickOpenerNavTs,
      },
    };
  }

  if (type === "ns-dblclick-second-click") {
    dblclickSecondClickTs = typeof data.ts === "number" ? data.ts : Date.now();
    return { handled: true };
  }

  return { handled: false };
}

/**
 * Handle DoubleClickjacking-related chrome.runtime.onMessage messages.
 *
 * Called by capture_isolated.ts when the runtime dispatches one of:
 *   - ns-dblclick-child-closed  (SW notifies us when a child window closes)
 *   - ns-dblclick-opener-nav-from-child  (SW forwards opener.location write from child tab)
 *   - ns-dblclick-correlation-ready      (destination peeked a verified SW record)
 *
 * Returns true if the message was handled, false otherwise.
 */
export function handleDblclickRuntimeMessage(message: Record<string, unknown> | null | undefined): boolean {
  if (!message) return false;

  if (message.type === "ns-dblclick-child-closed") {
    return true;
  }

  if (message.type === "ns-dblclick-opener-nav-from-child") {
    dblclickOpenerNavTs = typeof message.ts === "number" ? message.ts : Date.now();
    dblclickOpenerNavUrl = typeof message.url === "string" ? message.url : "";
    return true;
  }

  if (message.type === "ns-dblclick-correlation-ready") {
    const expiresAt = message.expiresAt;
    const token = message.token;
    const now = Date.now();
    if (
      typeof expiresAt !== "number" ||
      !Number.isFinite(expiresAt) ||
      typeof token !== "string" ||
      token.length === 0 ||
      token.length > 128 ||
      expiresAt <= now ||
      expiresAt - now > DBLCLICK_HIJACK_STALE_MS
    ) {
      return false;
    }
    dblclickCrossDocument = { expiresAt, token };
    return true;
  }

  return false;
}

/**
 * Returns true when the DoubleClickjacking attack pattern is active:
 * - A window.open was recently observed, AND
 * - An opener.location write was detected, AND
 * - A second click was observed after that write.
 * The signal expires after DBLCLICK_HIJACK_STALE_MS to avoid stale FPs.
 */
export function isDoubleClickHijackActive(): boolean {
  const now = Date.now();
  if (now - dblclickWindowOpenTs > DBLCLICK_HIJACK_STALE_MS) return false;
  return (
    dblclickOpenerNavTs > 0 &&
    now - dblclickOpenerNavTs <= DBLCLICK_HIJACK_STALE_MS &&
    dblclickSecondClickTs >= dblclickOpenerNavTs &&
    now - dblclickSecondClickTs <= DBLCLICK_HIJACK_STALE_MS
  );
}

/**
 * Consume the destination document's one-shot SW correlation for a trusted
 * click. Programmatic clicks must never turn page-controlled state into a
 * detection or a user-facing warning.
 */
export function consumeDblclickCorrelationOnTrustedClick(isTrusted: boolean): string | null {
  if (!isTrusted) return null;
  const now = Date.now();
  if (!dblclickCrossDocument || dblclickCrossDocument.expiresAt <= now) {
    dblclickCrossDocument = null;
    return null;
  }
  const { token } = dblclickCrossDocument;
  dblclickCrossDocument = null;
  return token;
}

/**
 * Returns the opener navigation URL recorded by the state machine.
 * Used by capture_isolated.ts for event logging when hijack is detected.
 */
export function getDblclickOpenerNavUrl(): string {
  return dblclickOpenerNavUrl;
}

/**
 * Reset all DoubleClickjacking state. Exposed for testing only.
 */
export function _resetDblclickState(): void {
  dblclickWindowOpenTs = 0;
  dblclickOpenerNavTs = 0;
  dblclickOpenerNavUrl = "";
  dblclickSecondClickTs = 0;
  dblclickCrossDocument = null;
}
