/**
 * Shared password-field visibility helper (#196).
 *
 * The SRI credential gate (`sri_checker.ts`) and content fingerprinting
 * (`content_analyzer.ts`) must agree on what counts as a "real", user-facing
 * password input: a field hidden inline via `display:none` /
 * `visibility:hidden` is a decoy/honeypot and must NOT trip credential-page
 * signals (#192, #195). Before this module each consumer carried its own copy
 * of the check, kept in sync only by a cross-reference comment.
 *
 * Implementation: we read the element's inline CSSStyleDeclaration
 * (`input.style`) — the browser's own parse of the `style` attribute. This is:
 *   - INLINE-SCOPE-ONLY by construction. `element.style` reflects only the
 *     inline `style` attribute, never stylesheets, classes, the `hidden`
 *     attribute, or computed/cascaded values. That is the exact surface the
 *     prior code (and #195) covered and the surface an attacker controls on a
 *     static phishing page. Expanding to `getComputedStyle` / the `hidden`
 *     attribute would shift the false-positive/negative profile and is a
 *     separate, threat-validation-gated decision.
 *   - ROBUST. It uses the browser's real CSS tokenizer, so it cannot be fooled
 *     by the decoys that defeated the prior raw-substring check
 *     (`style.includes("display:none")`): a hiding keyword inside an unrelated
 *     property (`content:'display:none'`), inside a quoted value with an
 *     embedded `;` (`content:'a;display:none;b'`), a CSS-invalid multi-token
 *     value (`display:none none`), CSS comments, casing, and `!important` are
 *     all resolved correctly by the engine. (#196 first hand-parsed the
 *     attribute string; an adversarial review showed that re-implementing the
 *     CSS tokenizer re-opened several of those evasions, so we delegate to the
 *     engine instead.)
 *
 * Tests run under happy-dom, whose inline-CSS parser is a close but imperfect
 * match for Chrome (naive about `;` inside quoted values, does not strip CSS
 * comments, does not lowercase property names). The cases happy-dom matches
 * Chrome on are asserted in password-field.test.ts; the engine-distinguishing
 * cases it diverges on (embedded `;`-in-quotes, uppercase property, CSS
 * comments) are correct in the real runtime (Chrome) and are pinned by a
 * Chrome-backed E2E tracked in #201.
 *
 * Scope note: hiding via the `hidden` attribute, a class/stylesheet, computed
 * style, `visibility:collapse`, `opacity:0`, or off-screen positioning is
 * intentionally NOT consulted here (inline `display`/`visibility` only). Tests
 * that assert such fields "visible" are residual-scope markers, not correctness
 * claims; broadening the model (with FP/TP measurement) is tracked in #199.
 */

/**
 * True when a password input is a "real" credential field: not disabled and not
 * inline-hidden via `display:none` / `visibility:hidden`. Exported for granular
 * unit testing; runtime consumers use {@link hasVisiblePasswordField}.
 */
export function isVisiblePasswordField(input: HTMLInputElement): boolean {
  if (input.disabled) return false;
  // `.style` (ElementCSSInlineStyle) is mixed into HTML/SVG/MathML elements but
  // NOT a plain Element. A password input matched inside a non-HTML document
  // (e.g. an application/xml page under the <all_urls> match) is such a plain
  // element: it is not a rendered HTML credential field and has no inline style.
  // Treat it as not-visible rather than dereferencing undefined — the old
  // getAttribute("style") path was total over any Element and never threw.
  const style = input.style;
  if (!style) return false;
  return style.display !== "none" && style.visibility !== "hidden";
}

/**
 * True when the document has at least one visible (non-disabled, non
 * inline-hidden) password input. The credential-page gate shared by the SRI
 * checker and content fingerprinting.
 */
export function hasVisiblePasswordField(doc: Document): boolean {
  const inputs = doc.querySelectorAll('input[type="password"]');
  for (let i = 0; i < inputs.length; i++) {
    if (isVisiblePasswordField(inputs[i] as HTMLInputElement)) return true;
  }
  return false;
}
