/**
 * ClickFix clipboard neutralization (#1169).
 *
 * On a high-confidence ClickFix detection the page has just put a shell command
 * on the clipboard. This overwrites it, from the isolated world, with a fixed
 * warning so a paste into Run, Terminal or File Explorer runs nothing. The
 * isolated world's own `navigator.clipboard` binding is out of reach of the
 * page's MAIN-world code, and the overwrite produces no bridge receipt, so it
 * cannot feed back into itself. The clipboard is never read.
 *
 * capture_isolated loads this chunk lazily, only for a command-like page write
 * outside Off mode, and calls `onClickFixReceipt`. Its own warning toast and
 * event stay synchronous and unchanged; this module adds the overwrite, a
 * follow-up toast and a `clipboard_neutralized` journal entry after a success.
 */
import { appendEvent } from "../shared/storage";
import type { Mode } from "../shared/types";
import { showToast } from "./ui_toast";

/**
 * Product default: neutralize in Smart and Strict, never in Off. Reversible;
 * an owner decision on #1169 may flip it, and this is the only switch.
 */
export const CLIPBOARD_NEUTRALIZE_ENABLED = true;

export const CLIPBOARD_WARNING_TEXT =
  "Heedline blocked a command this website copied. Do not paste website commands into Run, Terminal or File Explorer.";

export const CLIPBOARD_REPLACED_TOAST =
  "Heedline replaced the command this page copied with a warning. Do NOT paste website commands into Run or Terminal.";

/** Successful overwrites allowed per page load. */
export const MAX_NEUTRALIZATIONS_PER_PAGE = 50;

/** A write that never settles is a failure; the existing warning stands. */
const WRITE_TIMEOUT_MS = 1000;

/** The follow-up toast and journal entry repeat at most this often. */
const ALERT_INTERVAL_MS = 10_000;

/**
 * Detector reasons that prove a command-like page write behind a lure.
 * The lure-text code arrives with the overlay-free ClickFix branch (#1167).
 */
const COMMAND_WRITE_REASONS = ["clipboard_command_with_overlay", "clipboard_command_with_lure_text"];

export interface NeutralizeInput {
  mode: Mode;
  /** The receipt that triggered this scan was command-like (not an older one). */
  command: boolean;
  detected: boolean;
  reasons: string[];
  score: number;
}

/**
 * Neutralize only when THIS receipt is command-like, and either the scan found
 * a command write behind a lure or the page was already neutralized once
 * (sticky, so a page cannot drop its overlay and write again unchallenged).
 * Never on a benign write, captcha text alone, or in Off mode.
 */
export function shouldNeutralizeClipboard(
  input: NeutralizeInput,
  sticky = false,
  enabled = CLIPBOARD_NEUTRALIZE_ENABLED,
): boolean {
  if (!enabled || input.mode === "off" || !input.command) return false;
  return sticky || (input.detected && input.reasons.some((r) => COMMAND_WRITE_REASONS.includes(r)));
}

let successes = 0;
let lastAlertAt = -Infinity;

/** Write the warning text; true only when the write resolved in time. */
async function writeWarning(clipboard: Pick<Clipboard, "writeText"> | undefined): Promise<boolean> {
  if (!clipboard) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), WRITE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([clipboard.writeText(CLIPBOARD_WARNING_TEXT).then(() => true), timeout]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Handle one page clipboard-write receipt. Resolves true only when the warning
 * text was written. Every failure (no clipboard, no focus or activation,
 * timeout, cap reached) is silent: capture_isolated's warning already showed.
 */
export async function onClickFixReceipt(
  input: NeutralizeInput,
  clipboard: Pick<Clipboard, "writeText"> | undefined = globalThis.navigator?.clipboard,
  now: () => number = Date.now,
): Promise<boolean> {
  if (!shouldNeutralizeClipboard(input, successes > 0)) return false;
  if (successes >= MAX_NEUTRALIZATIONS_PER_PAGE) return false;
  if (!(await writeWarning(clipboard))) return false;
  successes++;
  const at = now();
  if (at - lastAlertAt >= ALERT_INTERVAL_MS) {
    lastAlertAt = at;
    void appendEvent({
      kind: "clickfix_detected",
      site: location.hostname.toLowerCase(),
      url: location.href,
      score: input.score,
      reasons: ["clipboard_neutralized"],
    }).catch(() => {});
    showToast({ message: CLIPBOARD_REPLACED_TOAST, timeoutMs: 0 });
  }
  return true;
}

/** Exposed for testing only. */
export function _resetNeutralizer(): void {
  successes = 0;
  lastAlertAt = -Infinity;
}
