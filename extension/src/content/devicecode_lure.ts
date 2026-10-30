import { showToast } from "./ui_toast";

/**
 * Device-code phishing, lure side (#1223): a page shows a short code with "go to
 * microsoft.com/devicelogin" (or Google's or GitHub's device page) and copies the code
 * for the user, who then types the address. The device page itself never learns where the
 * user came from, so the warning belongs on the lure. Loaded only after a short,
 * non-command clipboard write; nothing copied is read (the receipt carries its length only).
 */
const DEVICE_PAGE_TEXT = /\b(?:(?:www\.)?microsoft\.com\/devicelogin|aka\.ms\/devicelogin|login\.microsoftonline\.com\/[\w.-]+\/oauth2\/(?:v2\.0\/)?deviceauth|(?:www\.)?google\.com\/device|github\.com\/login\/device)\b/i;
// Docs and in-browser terminals where users legitimately run `az login` or `gh auth login`.
const LEGIT_HOST = /(?:^|\.)(?:learn\.microsoft\.com|docs\.microsoft\.com|support\.microsoft\.com|portal\.azure\.com|shell\.azure\.com|docs\.github\.com|github\.dev|vscode\.dev|developers\.google\.com|support\.google\.com|colab\.research\.google\.com)$/i;

let warned = false;

// `readText` is capture's own scannableText, passed in so the ClickFix detector is not
// pulled out of the capture chunk into a shared one (which would only hide its bytes).
export function checkDeviceCodeLure(readText: (root: Element | null, max: number) => string, host = location.hostname): void {
  if (warned || LEGIT_HOST.test(host) || !DEVICE_PAGE_TEXT.test(readText(document.body, 20000))) return;
  warned = true;
  showToast({
    message: "This page copied a code for a Microsoft, Google or GitHub device sign-in page. Only enter such a code if you started the sign-in yourself, on your own TV, console or command line. Entering a code a website or message gave you signs that sender in to your account.",
    timeoutMs: 0,
    persistent: true,
  });
}

/** Test-only. */
export function _resetDeviceCodeLure(): void {
  warned = false;
}
