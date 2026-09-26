import type { Mode } from "../shared/types";

/**
 * Tab-wide navigation authority (#593).
 *
 * A trusted click mints two TAB-WIDE service-worker windows — `ns-nav-gesture`
 * and `ns-allow-nav` — that suppress the delayed page-initiated redirect
 * rollback for the next ~1.5 s. The content script runs in every frame, so
 * before #593 ANY trusted click in ANY frame minted them, including a click on
 * a bare element inside a hidden child frame that then called
 * `top.location.assign(...)`. Chrome commits that top navigation as
 * `transitionType: "link"`, the worker saw the inherited allowance, and the
 * rollback never ran (measured: the same navigation 1600 ms later, after the
 * window expires, does roll back).
 *
 * The boundary is per-frame *intent*, not per-frame input: the hidden layer
 * really does receive the trusted click, so trust alone cannot separate it from
 * a legitimate embed. What separates them is that a legitimate child frame that
 * navigates the tab declares where it is going — an anchor with an href, or a
 * form submit control — while the deceptive layer is a bare element whose
 * destination exists only in script the extension cannot see. A child-frame
 * click with no such in-frame navigation intent therefore grants no tab-wide
 * authority, and any top-frame navigation that follows is evaluated by the
 * EXISTING rollback path rather than being silently allowed.
 *
 * This never blocks a navigation and adds no new UI: the worst case for a
 * misjudged benign click is the existing "rolled back a suspicious redirect"
 * prompt with its Proceed action. Top-frame behaviour is unchanged.
 */
export interface TabNavigationAuthorityInputs {
  /** Whether the clicking frame is the outermost frame. */
  isTopFrame: boolean;
  /** `event.isTrusted` for the click that is asking for authority. */
  isTrustedInput: boolean;
  /** Active guard mode. */
  mode: Mode;
  /**
   * The click resolved to a navigation this frame declared: an anchor with an
   * href, or a form submit control.
   */
  hasInFrameNavigationIntent: boolean;
}

/**
 * Nearest ancestor-or-self control whose DEFAULT action submits its form: a
 * `<button>` whose type is not button/reset (missing/invalid types default to
 * submit), or a submit/image input. Returns null for anything else, including
 * a bare element inside a form. (#820)
 *
 * Keyword matching is ASCII case-insensitive per spec (`type="BUTTON"` is a
 * non-submitting button), done programmatically: the CSS `[type=x i]` flag
 * throws in the happy-dom test harness and the button `type` IDL is
 * spec-unfaithful there, while `getAttribute` + lowercase reproduces the
 * spec exactly in every engine (an exact `[type=button]` selector would
 * mistake `type="BUTTON"` for a submit control and mint authority for a
 * click that never submits).
 *
 * First-match-wins with no outward continuation past a non-submit
 * button/input: activation behavior targets the innermost control, so a
 * click on one never submits via an outer one.
 */
export function findSubmitControl(target: Element | null): Element | null {
  const control = target?.closest("button, input") ?? null;
  if (!control) return null;
  const type = (control.getAttribute("type") ?? "").toLowerCase();
  if (control.tagName.toLowerCase() === "button") {
    return type === "button" || type === "reset" ? null : control;
  }
  if (control.tagName.toLowerCase() === "input") {
    return type === "submit" || type === "image" ? control : null;
  }
  return null;
}

/**
 * The action URL a click declares through a form submit control, or null when
 * the click did not land on one. Paired with a cross-document anchor href, this
 * is the "in-frame navigation intent" that lets a child frame mint tab-wide
 * navigation authority (#593); a bare element does not qualify. The isolated
 * world binds a child frame's redirect allowance to it (#637), and the MAIN
 * world arms the same allowance for the click's own task (#864); both call
 * this one resolver so the worlds cannot disagree about the declared action.
 *
 * Deliberately conservative in BOTH directions. Missing an intent (a submit
 * control inside a shadow root, say) only costs a child frame the tab-wide
 * allowance, which downgrades the navigation to the existing rollback prompt.
 * Seeing one that the page never honours (a submit button whose handler calls
 * preventDefault and then scripts a navigation) is a known forgeable path: the
 * signal is page-declared markup, so it raises the cost of the #593 pattern
 * rather than making it impossible. See the PR and the evidence-map limitation.
 */
export function formSubmitIntentUrl(target: EventTarget | null, baseHref: string): string | null {
  const control = findSubmitControl(target instanceof Element ? target : null);
  const form = (control as HTMLButtonElement | HTMLInputElement | null)?.form;
  if (!form) return null;
  const submitterAction = control?.getAttribute("formaction");
  const formAction = form.getAttribute("action");
  try {
    // An explicitly empty submitter action overrides the form action and
    // declares this document. Only a missing attribute inherits the form.
    return new URL((submitterAction ?? formAction) || baseHref, baseHref).toString();
  } catch {
    return null;
  }
}

export function grantsTabNavigationAuthority(
  opts: TabNavigationAuthorityInputs
): boolean {
  // "off" is the explicit user-selected bypass; preserve its no-intervention
  // contract exactly as before, including for programmatic clicks.
  if (opts.mode === "off") return true;
  // Synthetic input never minted these windows and still must not.
  if (!opts.isTrustedInput) return false;
  // Top-frame behaviour is deliberately unchanged.
  if (opts.isTopFrame) return true;
  return opts.hasInFrameNavigationIntent;
}
