/**
 * Side-effect-free constants shared by main_guard.ts and its unit tests. main_guard.ts
 * patches MAIN-world prototypes at import time, so it is not unit-importable; keeping the
 * tunable constants here lets the #377/F1 invariant test assert against the SAME values the
 * runtime uses (a hardcoded test mirror would silently diverge). Importing this module has
 * no runtime side effects. (#377)
 */

// --- PushState gating constants ---
/** How long after a gesture a pushState/replaceState call is considered gesture-correlated. */
export const PUSHSTATE_GESTURE_WINDOW_MS = 2000;
/** Minimum number of rapid state changes to flag without domain-like path analysis. */
export const PUSHSTATE_RAPID_THRESHOLD = 4;
/** Window for counting rapid pushState calls. */
export const PUSHSTATE_RAPID_WINDOW_MS = 1000;

// --- Pre-bridge outbound buffer constants ---
/** Capacity of the pre-verification priority OutboundQueue. */
export const MAX_PENDING_OUTBOUND = 32;
/**
 * Slots the floodable per-navigation alerts (ns-nav-blocked/ns-nav-allowed) may never
 * occupy, so a synchronous nav flood cannot starve the scarce once-per-event signals
 * (ns-dblclick-x, ns-js-x, ns-pushstate-suspicious) out of the pre-bridge buffer. Sized to
 * exceed the gesture-branch pushstate emission bound (see gestureBranchEmissionBound) so
 * that branch alone cannot monopolize the reservation, leaving room for the dblclick/js
 * correlation signals. The #377/F1 invariant test enforces both bounds against these
 * exact values. (#377/F2)
 */
export const RESERVED_SCARCE_OUTBOUND_SLOTS = 8;
