/**
 * Shared password-field visibility helper (#196).
 *
 * The SRI credential gate (`sri_checker.ts`) and content fingerprinting
 * (`content_analyzer.ts`) must agree on what counts as a "real",
 * user-facing password input: a field hidden inline via `display:none` /
 * `visibility:hidden` is a decoy/honeypot and must NOT trip credential-page
 * signals (#192, #195). Before this module each consumer carried its own
 * copy of the check, kept in sync only by a cross-reference comment.
 *
 * Detection scope (deliberately unchanged from the pre-#196 behavior):
 * - We inspect ONLY the element's inline `style` attribute — the surface an
 *   attacker controls on a static phishing page and the surface #195 gated on.
 *   Hiding via stylesheet/class or the `hidden` attribute is intentionally
 *   out of scope here; expanding to `getComputedStyle` would shift the
 *   false-positive/negative profile and is a separate, threat-validation-gated
 *   decision.
 *
 * What #196 fixes: the previous check did a raw substring match
 * (`style.includes("display:none")`), so a fully visible, interactable field
 * with a decoy like `style="content:'display:none'"` was wrongly treated as
 * hidden, suppressing the gate. This module instead parses the style attribute
 * into CSS *declarations* (`property: value`) and only fires when the
 * `display`/`visibility` property itself resolves to the hiding value. It also
 * honors the CSS cascade (last declaration of a property wins) and is
 * case-insensitive, so it is strictly harder to evade than the substring form.
 */

/**
 * Extract the first whitespace-delimited token of a CSS declaration value,
 * lowercased and with a trailing `!important` stripped.
 *
 * Examples: `" none "` -> `"none"`, `"none !important"` -> `"none"`,
 * `"hidden"` -> `"hidden"`, `"url(a b)"` -> `"url(a"` (never matches a
 * hiding keyword, which is the point).
 */
function firstCssToken(rawValue: string): string {
  const value = rawValue.trim().toLowerCase().replace(/\s*!important\s*$/, "").trim();
  const wsIndex = value.search(/\s/);
  return wsIndex === -1 ? value : value.slice(0, wsIndex);
}

/**
 * True when the given inline `style` attribute string hides the element via
 * a `display:none` or `visibility:hidden` declaration.
 *
 * Parses `prop:value` pairs split on `;`. The first `:` separates property
 * from value, so an inner colon inside a value (e.g. `content:'display:none'`)
 * stays attributed to its real property and cannot spoof a hiding declaration.
 * Per the CSS cascade, the last declaration of a property wins.
 */
export function isInlineHidden(styleAttr: string): boolean {
  if (!styleAttr) return false;
  let displayValue: string | null = null;
  let visibilityValue: string | null = null;
  const declarations = styleAttr.split(";");
  for (let i = 0; i < declarations.length; i++) {
    const decl = declarations[i]!;
    const colon = decl.indexOf(":");
    if (colon === -1) continue;
    const prop = decl.slice(0, colon).trim().toLowerCase();
    if (prop !== "display" && prop !== "visibility") continue;
    const token = firstCssToken(decl.slice(colon + 1));
    if (prop === "display") displayValue = token;
    else visibilityValue = token;
  }
  return displayValue === "none" || visibilityValue === "hidden";
}

/**
 * True when a password input is a "real" credential field: not disabled and
 * not inline-hidden via `display:none` / `visibility:hidden`.
 */
export function isVisiblePasswordField(input: HTMLInputElement): boolean {
  if (input.disabled) return false;
  return !isInlineHidden(input.getAttribute("style") || "");
}

/**
 * True when the document has at least one visible (non-disabled, non
 * inline-hidden) password input. Used as the credential-page gate by both
 * the SRI checker and content fingerprinting.
 */
export function hasVisiblePasswordField(doc: Document): boolean {
  const inputs = doc.querySelectorAll('input[type="password"]');
  for (let i = 0; i < inputs.length; i++) {
    if (isVisiblePasswordField(inputs[i] as HTMLInputElement)) return true;
  }
  return false;
}
