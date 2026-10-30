import { showToast } from "./ui_toast";

/**
 * Reverse tabnabbing (#1172): the service worker saw a page opened from this tab write
 * `opener.location` while this tab was hidden, and the registrable domain changed.
 * Device-code phishing (`kind: "devicecode"`): a website sent the user to an OAuth device
 * sign-in page; `from` is that website. Warn only; never block or navigate.
 * `message.from` is the page's original site.
 */
export function warn(message: { from?: unknown; kind?: unknown }): void {
  const from = message.from;
  const site = typeof from === "string" && /^[a-z0-9.-]{1,253}$/i.test(from) ? from : "";
  if (message.kind === "devicecode") {
    showToast({
      message: `${site ? `${site} sent you to this device sign-in page` : "A website sent you to a device sign-in page"}. Only enter a code your own TV, console or command line showed you: a code a website or message gives you signs its sender in to your account.`,
      timeoutMs: 0,
      persistent: true,
    });
    return;
  }
  showToast({
    message: `Another tab changed this page${site ? ` from ${site}` : ""} while you were away. Check the address before you sign in.`,
    timeoutMs: 15000,
  });
}
