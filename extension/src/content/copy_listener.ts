/**
 * Pastejacking receipt (#1168): a page `copy` listener can call
 * `clipboardData.setData(...)` + `preventDefault()` so the clipboard gets a
 * command while the visible selection stays benign. The MAIN-world
 * execCommand wrapper only sees the selection, and a user's own Ctrl+C leaves
 * no receipt at all, so the isolated world reads the copy event itself.
 *
 * Only a page-REWRITTEN copy is recorded: an ordinary selection copy is the
 * user's own choice, and classifying it would let prose that happens to hit a
 * command keyword raise a ClickFix alert on any page with an overlay.
 *
 * Privacy: the text is classified in place and dropped; only length + the
 * looksLikeCommand boolean are recorded. Nothing is stored or bridged.
 */
import { recordClipboardWrite } from "./clickfix_detector";
import { looksLikeCommand } from "./command_keywords";

/**
 * Record metadata for a copy event whose page listeners have already run.
 * Records only when the page cancelled the copy and set non-empty text; returns
 * 0 when nothing was recorded, -1 for a command, else the trimmed text length.
 */
export function recordCopyEvent(event: ClipboardEvent, now = Date.now()): number {
  if (!event.defaultPrevented) return 0;
  let text = "";
  try {
    text = event.clipboardData?.getData("text/plain") ?? "";
  } catch {
    // A detached/disabled DataTransfer must not break the page's copy.
  }
  if (!text) return 0;
  const command = looksLikeCommand(text);
  recordClipboardWrite({ ts: now, contentLength: text.length, looksLikeCommand: command });
  // -1 for a command, else the trimmed length of the recorded non-command copy.
  return command ? -1 : text.trim().length;
}

/**
 * From the window capture phase, add a one-shot window bubble listener so the
 * read runs after page window listeners present at dispatch. The bubble
 * handler only acts on the event that armed it, so a listener left armed by an
 * event that never bubbled cannot double-count the next copy.
 *
 * Residuals (#1168), both of which only a MAIN-world
 * DataTransfer.prototype.setData hook could close (out of scope here):
 * - a page that calls stopPropagation() on `copy` before it reaches window
 *   (e.g. on document or the target) skips the bubble read; after dispatch
 *   the DataTransfer is no longer readable, so there is no later point;
 * - a page window bubble listener added DURING dispatch runs after ours, so
 *   it can setData after our read.
 */
export function installCopyListener(enabled: () => boolean, onCopy: (length: number) => void): void {
  window.addEventListener(
    "copy",
    (armed) => {
      if (!armed.isTrusted || !enabled()) return;
      window.addEventListener(
        "copy",
        (event) => {
          const length = event === armed ? recordCopyEvent(event as ClipboardEvent) : 0;
          if (length) onCopy(length);
        },
        { once: true },
      );
    },
    true,
  );
}
