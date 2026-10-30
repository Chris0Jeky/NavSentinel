import { showToast } from "./ui_toast";

/**
 * Reverse tabnabbing (#1172): the service worker saw a page opened from this tab write
 * `opener.location` while this tab was hidden, and the registrable domain changed.
 * Warn only; never block or navigate. `from` is the page's original site.
 */
export function showTabnabWarning(from: unknown): void {
  const site = typeof from === "string" && /^[a-z0-9.-]{1,253}$/i.test(from) ? from : "";
  showToast({
    message: `Another tab changed this page${site ? ` from ${site}` : ""} while you were away. Check the address before you sign in.`,
    timeoutMs: 15000,
  });
}
