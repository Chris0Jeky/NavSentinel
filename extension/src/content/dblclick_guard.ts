/**
 * DoubleClickjacking detection state machine.
 *
 * Detects the attack pattern where a malicious page opens a child window,
 * then uses timing tricks around double-clicks to navigate the opener
 * (victim tab) to a sensitive URL while the user believes they are
 * interacting with the child window.
 *
 * Detection relies on the COMBINATION of signals:
 *   1. A window.open was recently observed (bridge message from main_guard)
 *   2. An opener.location write was detected, OR
 *      the SW signaled a child window closed after an opener nav
 *   3. A second click was observed (bridge message from main_guard)
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
/** True when the SW reports a child-window close correlated with opener nav. */
let dblclickChildClosed = false;
let dblclickChildClosedTs = 0;

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
    // Reset stale signals from a previous detection cycle to prevent
    // a stale dblclickChildClosed flag from causing false positives.
    dblclickOpenerNavTs = 0;
    dblclickOpenerNavUrl = "";
    dblclickSecondClickTs = 0;
    dblclickChildClosed = false;
    dblclickChildClosedTs = 0;
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
 *
 * Returns true if the message was handled, false otherwise.
 */
export function handleDblclickRuntimeMessage(message: Record<string, unknown> | null | undefined): boolean {
  if (!message) return false;

  if (message.type === "ns-dblclick-child-closed") {
    dblclickChildClosed = true;
    dblclickChildClosedTs = Date.now();
    return true;
  }

  if (message.type === "ns-dblclick-opener-nav-from-child") {
    dblclickOpenerNavTs = typeof message.ts === "number" ? message.ts : Date.now();
    dblclickOpenerNavUrl = typeof message.url === "string" ? message.url : "";
    return true;
  }

  return false;
}

/**
 * Returns true when the DoubleClickjacking attack pattern is active:
 * - A window.open was recently observed, AND
 * - Either an opener.location write was detected, OR
 *   the SW signaled that a child window closed after an opener nav.
 * The signal expires after DBLCLICK_HIJACK_STALE_MS to avoid stale FPs.
 */
export function isDoubleClickHijackActive(): boolean {
  const now = Date.now();
  if (now - dblclickWindowOpenTs > DBLCLICK_HIJACK_STALE_MS) return false;
  if (dblclickOpenerNavTs > 0 && now - dblclickOpenerNavTs <= DBLCLICK_HIJACK_STALE_MS) return true;
  if (dblclickChildClosed && now - dblclickChildClosedTs <= DBLCLICK_HIJACK_STALE_MS
      && dblclickOpenerNavTs > 0) return true;
  if (dblclickSecondClickTs > 0 && now - dblclickSecondClickTs <= DBLCLICK_HIJACK_STALE_MS
      && dblclickOpenerNavTs > 0) return true;
  return false;
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
  dblclickChildClosed = false;
  dblclickChildClosedTs = 0;
}
