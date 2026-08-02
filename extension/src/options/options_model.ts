import type { PromptOutcome } from "../shared/storage";

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

export function parseIntSafe(value: string, fallback: number): number {
  // An empty / whitespace-only string must use the fallback. `Number("")` and
  // `Number("   ")` are both `0` (finite), so without this guard clearing a
  // numeric field and saving would silently store `0` (then clamp to the field
  // minimum) instead of the documented default. (#367)
  if (value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

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

/** Shared UI hooks for the stats/import orchestrations (injected for testing). */
export interface StatsUiDeps {
  flash: (message: string, tone?: "error") => void;
  refresh: () => Promise<void>;
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
    await deps.refresh();
    deps.flash("Couldn't clear stats — try again.", "error");
    return;
  }
  await deps.refresh();
  deps.flash("Stats cleared.");
}

/**
 * Orchestrate a suite import. `importAll` is non-atomic, so on ANY failure refresh
 * the UI (best-effort, guarded) so it reflects whatever actually persisted, then
 * report a partial result for a prompt-outcome delivery failure or a total failure
 * otherwise (#188 R1/R2).
 */
export async function runImportFlow(
  deps: StatsUiDeps & {
    importPayload: () => Promise<void>;
    isDeliveryFailure: (error: unknown) => boolean;
  },
): Promise<void> {
  try {
    await deps.importPayload();
    await deps.refresh();
    deps.flash("Imported.");
  } catch (e) {
    console.warn("[NavSentinel] import failed:", e);
    // Guard the refresh so a failed re-render can neither mask the status nor
    // escape the (un-awaited) event handler as an unhandled rejection.
    try {
      await deps.refresh();
    } catch (refreshErr) {
      console.warn("[NavSentinel] post-import refresh failed:", refreshErr);
    }
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
