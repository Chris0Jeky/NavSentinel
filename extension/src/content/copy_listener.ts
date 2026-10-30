/**
 * Pastejacking receipt (#1168): a page `copy` listener can call
 * `clipboardData.setData(...)` + `preventDefault()` so the clipboard gets a
 * command while the visible selection stays benign. The MAIN-world
 * execCommand wrapper only sees the selection, and a user's own Ctrl+C leaves
 * no receipt at all, so the isolated world reads the copy event itself.
 *
 * Privacy: the text is classified in place and dropped; only length + the
 * looksLikeCommand boolean are recorded. Nothing is stored or bridged.
 */
import { recordClipboardWrite } from "./clickfix_detector";
import { looksLikeCommand } from "./command_keywords";

/** Record metadata for a copy event whose page listeners have already run. */
export function recordCopyEvent(event: ClipboardEvent, now = Date.now()): void {
  let text = "";
  try {
    // A cancelled copy writes whatever the page set; otherwise the browser copies the selection.
    text = (event.defaultPrevented ? event.clipboardData?.getData("text/plain") : getSelection()?.toString()) ?? "";
  } catch {
    // A detached/disabled DataTransfer must not break the page's copy.
  }
  recordClipboardWrite({ ts: now, contentLength: text.length, looksLikeCommand: looksLikeCommand(text) });
}

/**
 * From the window capture phase, add a one-shot window bubble listener so the
 * read runs after page window listeners present at dispatch. The bubble
 * handler only acts on the event that armed it, so a listener left armed by an
 * event that never bubbled cannot double-count the next copy.
 *
 * Residual (#1168): a page that calls stopPropagation() on `copy` before it
 * reaches window (e.g. on document or the target) skips the bubble read, so
 * that page's rewrite goes unrecorded. After dispatch the DataTransfer is no
 * longer readable, so there is no later point to recover it.
 */
export function installCopyListener(enabled: () => boolean, onCopy: () => void): void {
  window.addEventListener(
    "copy",
    (armed) => {
      if (!enabled()) return;
      window.addEventListener(
        "copy",
        (event) => {
          if (event !== armed) return;
          recordCopyEvent(event as ClipboardEvent);
          onCopy();
        },
        { once: true },
      );
    },
    true,
  );
}
