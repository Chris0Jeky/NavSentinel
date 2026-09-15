import type { Mode } from "../shared/types";

/**
 * Tab-wide navigation windows are retained for top-frame input and declared
 * child anchors. Child forms use the separate one-use form capability (#688):
 * cancelling a form click must not authorize top.location or a different form.
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
   * href. A form alone is not tab-wide authority.
   */
  hasInFrameNavigationIntent: boolean;
  isFormSubmission?: boolean;
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
  return opts.isFormSubmission !== true && opts.hasInFrameNavigationIntent;
}
