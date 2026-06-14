import type { Mode } from "../shared/types";

/**
 * Silent-decision helpers (P5-B1 / #236).
 *
 * The capture_isolated click listener fires on EVERY click, and most clicks are
 * not navigations. Emitting a `nav_silent_allow` event unconditionally in the
 * `decision === "allow"` branch would flood the (small, FIFO-capped) event log
 * and evict the loud threat events the journal exists to show. These pure
 * helpers gate emission to actual cross-document navigations and throttle rapid
 * repeats, so the logic is unit-testable without the content-script's
 * DOM/chrome globals.
 */

export interface SilentNavInputs {
  /** Active guard mode. "off" means no decision was made — never record. */
  mode: Mode;
  /** Only the top frame records, to avoid per-iframe duplication. */
  isTopFrame: boolean;
  /** A real anchor element was the click target. */
  hasAnchor: boolean;
  /** Resolves to a real cross-document http(s) navigation (see isDocumentNavigationHref). */
  isDocumentNavigation: boolean;
  /** target="_blank" (new tab/window) navigation. */
  isBlankAnchor: boolean;
  /** Same-tab navigation (no target / _self). */
  isSameTabAnchor: boolean;
}

export interface SilentNavCommitInputs {
  isTopFrame: boolean;
  isDocumentNavigation: boolean;
  isSameTabAnchor: boolean;
  explicitNewTab: boolean;
}

export interface ImmediateSilentNavInputs extends SilentNavInputs {
  /** Browser modifier/middle-click intent that sends a same-tab anchor to a new tab. */
  explicitNewTab: boolean;
}

/**
 * True when a silently-allowed click is an actual navigation worth recording.
 * Excludes off-mode, child frames, and non-navigation clicks (buttons, text,
 * arbitrary elements, fragment jumps, pseudo-scheme links) which would
 * otherwise dominate the event log.
 */
export function isSilentNavCandidate(opts: SilentNavInputs): boolean {
  if (opts.mode === "off") return false;
  if (!opts.isTopFrame) return false;
  if (!opts.hasAnchor || !opts.isDocumentNavigation) return false;
  return opts.isBlankAnchor || opts.isSameTabAnchor;
}

/**
 * Same-tab silent nav events are committed by the service worker only when the
 * current top-frame tab later commits the allowed target. Modifier/middle clicks
 * and child-frame navigations commit somewhere else, so queuing them on this tab
 * would leave a stale allowance behind.
 */
export function shouldQueueSameTabSilentCommit(opts: SilentNavCommitInputs): boolean {
  return opts.isTopFrame &&
    opts.isDocumentNavigation &&
    opts.isSameTabAnchor &&
    !opts.explicitNewTab;
}

/**
 * New-tab anchor navigations commit in another tab, so the opener has no commit
 * event to wait for. Record them immediately, including modifier/middle-clicks
 * on otherwise same-tab anchors.
 */
export function shouldLogImmediateSilentNav(opts: ImmediateSilentNavInputs): boolean {
  return isSilentNavCandidate(opts) &&
    (opts.isBlankAnchor || (opts.isSameTabAnchor && opts.explicitNewTab));
}

/**
 * True when a resolved anchor href is a real cross-document navigation worth
 * recording: it has a network host (so javascript:/mailto:/tel:/data:/blob:
 * URLs, whose host is empty, are excluded) AND it is not a same-document
 * fragment jump (href="#section" changes only the hash, causing no page load).
 * `destHref`/`destHost` come from parseDestination (resolved against the page).
 *
 * Known minor gap (instrumentation-only, no security impact): navigating FROM a
 * hashed URL TO the same path without a hash is a real document load but compares
 * equal here, so it is not recorded. Acceptable for journal/corpus coverage.
 */
export function isDocumentNavigationHref(
  destHref: string | null | undefined,
  destHost: string | null | undefined,
  currentHref: string
): boolean {
  if (!destHref || !destHost) return false;
  let parsed: URL;
  try {
    parsed = new URL(destHref);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  return parsed.href.split("#")[0] !== currentHref.split("#")[0];
}

/** Mutable throttle state, held by the caller so the gate stays pure/testable. */
export interface SilentNavThrottleState {
  key: string;
  at: number;
}

/**
 * Allows at most one emission per destination key within `windowMs`, defeating
 * rapid repeated clicks on the same link. Only the most-recent destination is
 * tracked (consecutive-repeat suppression), which is intentionally cheap; truly
 * interleaved navigations to distinct destinations are legitimate data and pass.
 * Mutates `state` in place and returns whether emission is allowed now.
 */
export function silentNavThrottleAllows(
  state: SilentNavThrottleState,
  key: string,
  now: number,
  windowMs: number
): boolean {
  if (key === state.key && now - state.at < windowMs) return false;
  state.key = key;
  state.at = now;
  return true;
}
