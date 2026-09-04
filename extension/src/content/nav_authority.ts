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
