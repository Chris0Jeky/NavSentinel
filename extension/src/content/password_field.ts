import { domAttribute, domProperty } from "./dom_access";

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
 * comments) are correct in the real runtime (Chrome) and are pinned by
 * `tests/e2e/password-field-css-engine.spec.ts` (#201).
 *
 * Scope note: hiding via the `hidden` attribute, a class/stylesheet, computed
 * style, `visibility:collapse`, `opacity:0`, or off-screen positioning is
 * intentionally NOT consulted here (inline `display`/`visibility` only). Tests
 * that assert such fields "visible" are residual-scope markers, not correctness
 * claims; broadening the model (with FP/TP measurement) is tracked in #199.
 */

// Inputs ever seen as a password field (#1220). A page can flip `type` to text
// just before submit (e.g. on pointerdown of a "show password" lookalike), so
// the submit-time check must remember what the user typed a password into.
const seenAsPassword = new WeakSet<Element>();

// Types that never render typed text; everything else (including unknown types,
// which the browser treats as text) can be masked with `-webkit-text-security`.
const UNMASKABLE = new Set([
  "hidden", "checkbox", "radio", "file", "submit", "reset", "button", "image",
  "range", "color", "date", "datetime-local", "month", "week", "time",
]);

function isCssMasked(el: Element, type: string): boolean {
  if (UNMASKABLE.has(type)) return false;
  try {
    const v = getComputedStyle(el).getPropertyValue("-webkit-text-security").trim();
    return v !== "" && v !== "none";
  } catch {
    return false;
  }
}

/**
 * True for an input the user types a secret into. (#820, #1220)
 *
 * The `type` attribute is an enumerated keyword: per spec the browser matches
 * it ASCII case-insensitively (`type="PASSWORD"` renders a native masked
 * field), so an exact `input[type="password"]` selector misses it. The match
 * is done programmatically on purpose: the CSS `[type=password i]` flag
 * throws in the happy-dom test harness, while `getAttribute` returns the raw
 * attribute verbatim in every engine and lowercasing in JS reproduces the
 * spec semantics exactly (no whitespace trimming on either side: like the
 * browser, `type="password "` does NOT match).
 *
 * Also true for a text input that renders as dots via `-webkit-text-security`
 * (a phishing kit's lookalike), and for an input that was ever seen as a
 * password field (a later flip to text/hidden does not change what it holds).
 * The only side effect is remembering such an input in a WeakSet.
 */
export function isPasswordTypeInput(el: Element): boolean {
  if (domProperty(Element.prototype, el, "tagName").toLowerCase() !== "input") return false;
  const type = (domAttribute(el, "type") ?? "").toLowerCase();
  if (type === "password" || seenAsPassword.has(el) || isCssMasked(el, type)) {
    seenAsPassword.add(el);
    return true;
  }
  return false;
}

/** Event listener: remember the focused or edited input if it is a password field. */
export function rememberPasswordInput(e: Event): void {
  const t = e.composedPath()[0];
  if (t instanceof Element) isPasswordTypeInput(t);
}

/**
 * All password-typed inputs under a root, with the case-insensitive semantics
 * of {@link isPasswordTypeInput}. Shared by every consumer that used to carry
 * its own `input[type="password"]` selector. (#820)
 */
export function queryPasswordInputs(root: ParentNode): Element[] {
  const prototype = root instanceof Element ? Element.prototype
    : root instanceof Document ? Document.prototype : DocumentFragment.prototype;
  const all = prototype.querySelectorAll.call(root, "input");
  const out: Element[] = [];
  for (let i = 0; i < all.length; i++) {
    const el = all[i]!;
    if (isPasswordTypeInput(el)) out.push(el);
  }
  return out;
}

/**
 * True when a password input is a "real" credential field: not disabled and not
 * inline-hidden via `display:none` / `visibility:hidden`. Exported for granular
 * unit testing; runtime consumers use {@link hasVisiblePasswordField}.
 */
export function isVisiblePasswordField(input: HTMLInputElement): boolean {
  if (!(input instanceof HTMLInputElement) || domProperty(HTMLInputElement.prototype, input, "disabled")) return false;
  // `.style` (ElementCSSInlineStyle) is mixed into HTML/SVG/MathML elements but
  // NOT a plain Element. A password input matched inside a non-HTML document
  // (e.g. an application/xml page under the <all_urls> match) is such a plain
  // element: it is not a rendered HTML credential field and has no inline style.
  // Treat it as not-visible rather than dereferencing undefined — the old
  // getAttribute("style") path was total over any Element and never threw.
  const style = domProperty(HTMLElement.prototype, input, "style");
  if (!style) return false;
  return style.display !== "none" && style.visibility !== "hidden";
}

/**
 * True when the document has at least one visible (non-disabled, non
 * inline-hidden) password input. The credential-page gate shared by the SRI
 * checker and content fingerprinting.
 */
export function hasVisiblePasswordField(doc: Document): boolean {
  const inputs = queryPasswordInputs(doc);
  for (let i = 0; i < inputs.length; i++) {
    if (isVisiblePasswordField(inputs[i] as HTMLInputElement)) return true;
  }
  return false;
}
