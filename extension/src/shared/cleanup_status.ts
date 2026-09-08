import type { NavSettings } from "./storage";

/** Configured cleanup state, independent of whether a page has an overlay. */
export function cleanupStatus(nav: NavSettings): { text: string; state: string } {
  if (!nav.autoDismissOverlays) return { text: "Disabled", state: "disabled" };
  if (nav.defaultMode === "off") return { text: "Paused · Navigation Off", state: "paused" };
  return { text: "Active", state: "active" };
}
