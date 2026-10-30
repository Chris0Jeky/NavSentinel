/**
 * ClickFix clipboard neutralization (#1169).
 *
 * On a high-confidence ClickFix detection the page has just put a shell command
 * on the clipboard. This overwrites it, from the isolated world, with a fixed
 * warning so a paste into Run, Terminal or File Explorer runs nothing. The
 * isolated world's own `navigator.clipboard` binding is out of reach of the
 * page's MAIN-world code. The clipboard is never read.
 *
 * Loaded lazily by capture_isolated only after a positive ClickFix scan, so the
 * always-on capture chunk pays only for the import call (perf budget).
 */
import type { Mode } from "../shared/types";

/**
 * Product default: neutralize in Smart and Strict, never in Off. Reversible;
 * an owner decision on #1169 may flip it, and this is the only switch.
 */
export const CLIPBOARD_NEUTRALIZE_ENABLED = true;

export const CLIPBOARD_WARNING_TEXT =
  "Heedline blocked a command this website copied. Do not paste website commands into Run, Terminal or File Explorer.";

/** Toast prefix when the overwrite succeeded; lives here to keep it out of the capture chunk. */
export const CLIPBOARD_REPLACED_TOAST =
  "Heedline detected a fake verification dialog and replaced the command it copied to your clipboard. Do NOT paste into Run or Terminal";

/** Ceiling on overwrites per page load: one per page write receipt, bounded. */
export const MAX_NEUTRALIZATIONS_PER_PAGE = 10;

/** A write that never settles must not hold the warning toast back. */
const WRITE_TIMEOUT_MS = 1000;

/**
 * Detector reasons that prove a command-like page write (hasRecentCommandClipboardWrite).
 * The lure-text code arrives with the overlay-free ClickFix branch (#1167).
 */
const COMMAND_WRITE_REASONS = ["clipboard_command_with_overlay", "clipboard_command_with_lure_text"];

export interface NeutralizeInput {
  mode: Mode;
  detected: boolean;
  reasons: readonly string[];
}

/**
 * Neutralize only a detected scan whose evidence includes a command-like page
 * write; never on captcha text alone, a non-command write, or in Off mode.
 */
export function shouldNeutralizeClipboard(input: NeutralizeInput, enabled = CLIPBOARD_NEUTRALIZE_ENABLED): boolean {
  return (
    enabled &&
    input.mode !== "off" &&
    input.detected &&
    input.reasons.some((r) => COMMAND_WRITE_REASONS.includes(r))
  );
}

let neutralizations = 0;

/**
 * Called once per page clipboard-write receipt that produced a detection.
 * Resolves true only when the warning text was written; every failure
 * (no clipboard, no focus or activation, timeout, cap reached) is silent and
 * leaves the existing warning toast as the only protection.
 */
export async function maybeNeutralizeClipboard(
  input: NeutralizeInput,
  clipboard: Pick<Clipboard, "writeText"> | undefined = globalThis.navigator?.clipboard,
): Promise<boolean> {
  if (!shouldNeutralizeClipboard(input) || !clipboard) return false;
  if (neutralizations >= MAX_NEUTRALIZATIONS_PER_PAGE) return false;
  neutralizations++;  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      clipboard.writeText(CLIPBOARD_WARNING_TEXT).then(() => true),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), WRITE_TIMEOUT_MS); }),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Exposed for testing only. */
export function _resetNeutralizer(): void {
  neutralizations = 0;
}
