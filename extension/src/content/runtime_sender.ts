/**
 * Own-extension sender gate for content-script `chrome.runtime.onMessage`
 * listeners. (#815)
 *
 * `chrome.tabs.sendMessage(tabId, ...)` from ANY co-installed extension is
 * delivered to every content-script `onMessage` listener in the tab,
 * regardless of owning extension — the `sender` parameter is the only
 * discriminator. Without this gate, a hostile extension could spoof
 * `ns-rollback` (silent `location.replace` through our own allow machinery),
 * `ns-forward-offer`, and the `ns-dblclick-*` / `ns-oauth-*` NRS signals.
 *
 * Only the extension id is authoritative here: `sender.url`/`sender.origin`
 * metadata may be omitted for background-to-content sends, so it stays
 * unchecked (same shape as `PendingNavigationDecisionClient`'s sender check).
 * A missing sender is unauthenticable and rejected.
 */
export function isOwnExtensionRuntimeSender(
  sender: { id?: string | undefined } | null | undefined,
): boolean {
  try {
    const ownId = chrome.runtime.id;
    return !!sender && !!ownId && sender.id === ownId;
  } catch {
    return false;
  }
}
