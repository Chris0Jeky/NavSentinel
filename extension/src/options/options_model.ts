import type { BehaviouralDataLane, BehaviouralResetResult } from "../shared/behavioural_reset";
import type {
  ImportAllResult,
  PromptOutcome,
} from "../shared/storage";
export {
  deriveOptionsSettingsPatch,
  rebaseOptionsSettingsDraft,
} from "../shared/storage";

export function pct(n: number, total: number): string {
  if (total === 0) return "--";
  return `${((n / total) * 100).toFixed(1)}%`;
}

export function avg(scores: number[]): string {
  if (scores.length === 0) return "--";
  const sum = scores.reduce((a, b) => a + b, 0);
  return (sum / scores.length).toFixed(1);
}

export function fmtTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

export { parseOptionsInt as parseIntSafe } from "../shared/storage";

/** Display strings for the options Prompt Statistics panel. */
export interface PromptOutcomeStats {
  total: number;
  allowRate: string;
  blockRate: string;
  trustRate: string;
  dismissRate: string;
  avgScoreAllow: string;
  avgScoreBlock: string;
}

/**
 * Aggregate prompt-outcome entries into the display strings the options Prompt
 * Statistics panel renders. Pure (no DOM) so the aggregation is unit-testable.
 *
 * The buckets partition EVERY PromptOutcome variant:
 *   allows  = allow | allow_once | always_allow   blocks = block | cancel
 *   trusts  = trust                               dismisses = dismiss
 * so the four displayed rates sum to 100%. The bare `allow` variant was
 * previously dropped from the allows bucket — it was counted in `total` but in
 * none of the four arrays, understating the allow-rate and excluding those
 * scores from the allow average. (#367)
 */
export function computePromptOutcomeStats(
  outcomes: ReadonlyArray<{ outcome: PromptOutcome; score: number }>,
): PromptOutcomeStats {
  // Single pass over the (bounded, ~500-entry) outcome list — one bucket per entry,
  // no intermediate filter/map allocations.
  let allowCount = 0;
  let blockCount = 0;
  let trustCount = 0;
  let dismissCount = 0;
  const allowScores: number[] = [];
  const blockScores: number[] = [];
  for (const { outcome, score } of outcomes) {
    if (outcome === "allow" || outcome === "allow_once" || outcome === "always_allow") {
      allowCount++;
      allowScores.push(score);
    } else if (outcome === "block" || outcome === "cancel") {
      blockCount++;
      blockScores.push(score);
    } else if (outcome === "trust") {
      trustCount++;
    } else if (outcome === "dismiss") {
      dismissCount++;
    }
  }
  const total = outcomes.length;
  return {
    total,
    allowRate: pct(allowCount, total),
    blockRate: pct(blockCount, total),
    trustRate: pct(trustCount, total),
    dismissRate: pct(dismissCount, total),
    avgScoreAllow: avg(allowScores),
    avgScoreBlock: avg(blockScores),
  };
}

export interface ImportErrorOutcome {
  /** User-facing status message. */
  message: string;
  /** Status tone for flashStatus. */
  tone: "error";
}

/**
 * Pick the status message for a failed import. `importAll` is non-atomic and
 * writes the prompt-outcome history LAST; a *delivery* failure of that step (the
 * SW was unreachable) means the earlier settings/allowlist/eventLog sections
 * already applied, so word it as a partial result. Any other error may be a clean
 * failure (e.g. invalid JSON, before any write) OR a mid-import storage failure
 * that already applied some sections — `runImportFlow` ALWAYS refreshes the UI
 * afterward so the displayed config matches actual state regardless (#188 R1/R2).
 */
export function classifyImportError(isDeliveryFailure: boolean): ImportErrorOutcome {
  return isDeliveryFailure
    ? { message: "Imported, but prompt-related data wasn't fully updated — try again.", tone: "error" }
    : { message: "Import failed.", tone: "error" };
}

export function formatImportSuccess(eventLogDropped = 0): string {
  if (eventLogDropped <= 0) return "Imported.";
  const noun = eventLogDropped === 1 ? "event" : "events";
  const verb = eventLogDropped === 1 ? "was" : "were";
  return `Imported. Event log truncated: ${eventLogDropped} older ${noun} ${verb} not imported.`;
}

/** Shared UI hooks for the stats/import orchestrations (injected for testing). */
export interface StatsUiDeps {
  flash: (message: string, tone?: "error") => void;
  refresh: () => Promise<void>;
}

/**
 * Re-render after storage has already been mutated. `refresh` is `init()`, a
 * sequence of independent storage reads, so a transient failure must not decide
 * whether the user is told what happened: these handlers run un-awaited off a
 * DOM listener, where a rejection escapes as an unhandled rejection and the
 * status line is simply never written. Always refresh, never let it throw, and
 * report the outcome regardless.
 */
async function safeRefresh(refresh: () => Promise<void>): Promise<void> {
  try {
    await refresh();
  } catch (err) {
    console.warn("[NavSentinel] post-operation refresh failed:", err);
  }
}

/**
 * Orchestrate "Clear stats". Scope a delivery failure to either mutation so the
 * UI refreshes and reports a truthful partial result. `clearAdaptive` still runs
 * only after a successful prompt-outcome clear.
 */
export async function runClearStats(
  deps: StatsUiDeps & {
    clearOutcomes: () => Promise<void>;
    clearAdaptive: () => Promise<void>;
  },
): Promise<void> {
  try {
    await deps.clearOutcomes();
    await deps.clearAdaptive();
  } catch (e) {
    console.warn("[NavSentinel] clear stats failed:", e);
    await safeRefresh(deps.refresh);
    deps.flash("Couldn't clear stats — try again.", "error");
    return;
  }
  await safeRefresh(deps.refresh);
  deps.flash("Stats cleared.");
}

/** User-facing names for the declared behavioural-data lanes (RI-06 / #474). */
export const BEHAVIOURAL_LANE_LABELS: Record<BehaviouralDataLane, string> = {
  promptOutcomes: "prompt outcomes",
  adaptiveScores: "adaptive scores",
  eventLog: "event log",
  domainProfiles: "domain profiles",
};

/** What the clear-all control keeps. Kept next to the lane labels so the copy
 *  and the declared boundary are edited together. */
export const BEHAVIOURAL_RESET_KEPT_COPY =
  "Settings, allowlist, and trusted domains were kept.";

/**
 * Turn a clear-all result into the status line shown in the options page.
 * Success is reported ONLY when every lane cleared; a partial result names the
 * lanes that did not, so a half-applied reset is never displayed as done.
 */
export function describeBehaviouralReset(result: BehaviouralResetResult): {
  message: string;
  tone?: "error";
} {
  if (result.markerError) {
    // The lanes cleared, but an active marker means the reset can replay and
    // erase what the user records next. Say so instead of claiming success.
    return {
      message: "Cleared, but the reset wasn't finalized — it may run again at the next browser start.",
      tone: "error",
    };
  }
  if (result.ok) {
    return { message: `Behavioural data cleared. ${BEHAVIOURAL_RESET_KEPT_COPY}` };
  }
  const names = result.failed
    .map((failure) => BEHAVIOURAL_LANE_LABELS[failure.lane] ?? failure.lane)
    .join(", ");
  if (result.cleared.length === 0) {
    return { message: `Couldn't clear behavioural data (${names}) — try again.`, tone: "error" };
  }
  return { message: `Partly cleared — still stored: ${names}. Try again.`, tone: "error" };
}

/**
 * Orchestrate the unified clear-all. `reset` is the single service-worker-owned
 * entry point; this never clears individual lanes itself. The UI always
 * refreshes first so the displayed state matches whatever actually persisted,
 * and a thrown error is treated as a total failure.
 */
export async function runClearBehaviouralData(
  deps: StatsUiDeps & {
    confirm: () => boolean;
    reset: () => Promise<BehaviouralResetResult>;
  },
): Promise<void> {
  if (!deps.confirm()) return;
  let result: BehaviouralResetResult;
  try {
    result = await deps.reset();
  } catch (e) {
    console.warn("[NavSentinel] clear behavioural data failed:", e);
    await safeRefresh(deps.refresh);
    deps.flash("Couldn't clear behavioural data — try again.", "error");
    return;
  }
  await safeRefresh(deps.refresh);
  const outcome = describeBehaviouralReset(result);
  deps.flash(outcome.message, outcome.tone);
}

/**
 * Orchestrate a suite import. `importAll` is non-atomic, so on ANY failure refresh
 * the UI (best-effort, guarded) so it reflects whatever actually persisted, then
 * report a partial result for a prompt-outcome delivery failure or a total failure
 * otherwise (#188 R1/R2).
 */
export async function runImportFlow(
  deps: StatsUiDeps & {
    importPayload: () => Promise<ImportAllResult | void>;
    isDeliveryFailure: (error: unknown) => boolean;
  },
): Promise<void> {
  try {
    const result = await deps.importPayload();
    await deps.refresh();
    deps.flash(formatImportSuccess(result?.eventLogDropped));
  } catch (e) {
    console.warn("[NavSentinel] import failed:", e);
    await safeRefresh(deps.refresh);
    const outcome = classifyImportError(deps.isDeliveryFailure(e));
    deps.flash(outcome.message, outcome.tone);
  }
}

/**
 * Wrap an async click handler so re-entrant invocations are ignored while one is
 * in flight (prevents a double/triple-click from firing overlapping
 * read-modify-write saves). `isBusy`/`setBusy` are injected so the busy state can
 * live on the DOM element (e.g. `button.disabled`) while the logic stays pure and
 * unit-testable. The busy flag is always cleared in a `finally`, even if `fn`
 * rejects — so the control never gets stuck "busy". A rejection from `fn`
 * propagates (it is not swallowed); callers should handle user-facing errors
 * inside `fn` (the save handler does, in its own try/catch). `isBusy`/`setBusy`
 * are assumed not to throw — the only caller backs them with `button.disabled`,
 * which never throws; a throwing accessor is out of contract.
 */
export function withReentrancyGuard(
  isBusy: () => boolean,
  setBusy: (busy: boolean) => void,
  fn: () => Promise<void>,
): () => Promise<void> {
  return async () => {
    if (isBusy()) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
}

/** Read-only options display for the RI-07 JS-behavior instrumentation capability. */
export interface JsBehaviorCapabilityDisplay {
  state: string;
  detail: string;
}

/**
 * Describe the JS-behavior instrumentation capability for the options page.
 *
 * The capability is a build-time release-profile decision, not a stored setting,
 * so the options page can only report it. Passing the runtime flag in keeps the
 * UI from ever claiming the capability is on while the runtime has it off.
 */
export function describeJsBehaviorCapability(enabled: boolean): JsBehaviorCapabilityDisplay {
  if (!enabled) {
    return {
      state: "Off",
      detail:
        "This build does not install fetch, XHR, sendBeacon or password-field " +
        "instrumentation. Navigation, credential and double-click protection are " +
        "unaffected. Enabling it requires compatibility and performance evidence " +
        "that is not available yet.",
    };
  }
  return {
    state: "On",
    detail:
      "This build installs broad JavaScript behavior instrumentation. It is not " +
      "part of the standard beta build.",
  };
}
