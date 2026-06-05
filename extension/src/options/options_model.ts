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
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export interface ImportErrorOutcome {
  /** User-facing status message. */
  message: string;
  /** Status tone for flashStatus. */
  tone: "error";
  /**
   * Whether the page should still refresh after the error. True for a partial
   * import (only the last, prompt-outcome step failed) so the UI reflects the
   * sections that DID apply.
   */
  reinit: boolean;
}

/**
 * Decide how the options page reports a failed import. `importAll` is non-atomic
 * and writes the prompt-outcome history LAST; a *delivery* failure of that step
 * (the SW was unreachable) means the earlier settings/allowlist/eventLog sections
 * already applied, so report a partial result and still refresh the UI. Any other
 * error (e.g. invalid JSON) happens before any write — report a total failure and
 * leave the UI showing the unchanged config (#188 R1).
 */
export function classifyImportError(isDeliveryFailure: boolean): ImportErrorOutcome {
  return isDeliveryFailure
    ? {
        message: "Imported, but prompt history wasn't updated — try again.",
        tone: "error",
        reinit: true,
      }
    : { message: "Import failed.", tone: "error", reinit: false };
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
