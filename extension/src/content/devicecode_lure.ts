import { showToast } from "./ui_toast";

/**
 * Device-code phishing, lure side (#1223): a page shows a short code with "go to
 * microsoft.com/devicelogin" (or Google's or GitHub's device page) and copies the code
 * for the user, who then types the address. The device page itself never learns where the
 * user came from, so the warning belongs on the lure. Loaded only after a short,
 * non-command clipboard write; nothing copied is read (the receipt carries its length only).
 */
// Matched on text with whitespace and invisible characters removed after NFKC, so an
// address split across elements, broken by <wbr>/zero-width characters, spaced out or
// written in full-width characters still matches what the victim reads and types.
const DEVICE_PAGE_TEXT = /microsoft\.com\/devicelogin|aka\.ms\/devicelogin|login\.microsoft(?:online)?\.com\/[\w.-]+\/oauth2\/(?:v2\.0\/)?deviceauth|login\.live\.com\/oauth20_remoteconnect|google\.com\/device(?!s)|github\.com\/login\/device/i;
const INVISIBLE = /[\s\u00AD\u200B-\u200F\u2060\uFEFF]+/g;
// Docs, Q&A and in-browser terminals where users legitimately run `az login` or
// `gh auth login`. *.github.dev only one label deep: app.github.dev ports serve anyone's pages.
const LEGIT_HOST = /^(?:(?:learn|docs|support)\.microsoft\.com|portal\.azure\.com|shell\.azure\.com|(?:docs\.|cli\.)?github\.com|(?:[\w-]+\.)?github\.dev|vscode\.dev|(?:developers|support)\.google\.com|colab\.research\.google\.com|stackoverflow\.com)$/i;

let warned = false;

// `readText` is capture's own scannableText, passed in so the ClickFix detector is not
// pulled out of the capture chunk into a shared one (which would only hide its bytes).
// One look now and one 1.5 s later, for a lure that shows the address after the copy.
export function checkDeviceCodeLure(readText: (root: Element | null, max: number) => string, host = location.hostname, again = true): void {
  if (warned || LEGIT_HOST.test(host)) return;
  // Runs only after a short copy and warns once, so it can read further than ClickFix.
  if (!DEVICE_PAGE_TEXT.test(readText(document.body, 200000).normalize("NFKC").replace(INVISIBLE, ""))) {
    if (again) setTimeout(() => checkDeviceCodeLure(readText, host, false), 1500);
    return;
  }
  warned = true;
  showToast({
    message: "This page copied a code for a Microsoft, Google or GitHub device sign-in page. Only enter such a code if you started the sign-in yourself, on your own TV, console or command line. Entering a code a website or message gave you signs that sender in to your account.",
    timeoutMs: 0,
  });
}

/** Test-only. */
export function _resetDeviceCodeLure(): void {
  warned = false;
}
