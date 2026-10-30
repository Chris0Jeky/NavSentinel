/**
 * ConsentFix (Push Security, 2025-12-11): a page opens a real Microsoft sign-in that
 * redirects to a localhost URL (an Azure CLI-style public client), then tells the user
 * to copy that URL from the address bar and paste it back. The URL carries an OAuth
 * authorization code the attacker redeems for the user's tokens.
 *
 * A loopback URL with an OAuth code or token, pasted into a page that is not itself on
 * loopback, has no ordinary reason to exist.
 *
 * Volexity (2025-04-22, UTA0352/UTA0355) saw the same theft through Microsoft first-party
 * redirect pages: victims were asked to send back the address of insiders.vscode.dev/redirect,
 * vscode-redirect.azurewebsites.net or login.microsoftonline.com/WebApp/CloudDomainJoin/8 with
 * its ?code= (pasted into mail, WhatsApp or Signal web). Those count too, anywhere but their
 * own host.
 */
const LOOPBACK_AUTH_URL = /^\s*https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d{1,5})?\/\S*?[?&#](?:code|access_token|id_token)=/i;
// The same code with the address trimmed off ("paste only the part after localhost"): a long
// code followed by Microsoft's session_state. Plain code=...&state= is every OAuth provider's
// callback (GitHub, Google, Slack) and is left alone.
const BARE_AUTH_CODE = /^\s*[?&#]?code=[^\s&]{20,}&(?:\S*&)?session_state=/i;
const LOOPBACK_HOST = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;
const FIRST_PARTY_AUTH_URL = /^\s*https:\/\/(insiders\.vscode\.dev\/redirect|vscode-redirect\.azurewebsites\.net\/|login\.microsoftonline\.com\/(?:[^/?#\s]+\/)*(?:nativeclient|WebApp\/CloudDomainJoin\/\d+))\S*?[?&#]code=/i;

export function isAuthCodePaste(text: string, pageHost: string): boolean {
  const head = text.slice(0, 4096);
  const firstParty = FIRST_PARTY_AUTH_URL.exec(head);
  if (firstParty) return firstParty[1]!.split("/")[0]!.toLowerCase() !== pageHost.toLowerCase();
  return (LOOPBACK_AUTH_URL.test(head) || BARE_AUTH_CODE.test(head)) && !LOOPBACK_HOST.test(pageHost);
}
