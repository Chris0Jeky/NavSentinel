/**
 * Unified behavioural-data reset (RI-06 / #474).
 *
 * This lives in its own module rather than inside `storage.ts` on purpose. The
 * clear-all needs `clearDomainProfiles` from `domain_profile.ts`; importing that
 * from `storage.ts` gave the domain-profile module the same entry reachability as
 * the storage chunk, so the bundler folded it in and stopped emitting
 * `assets/domain_profile-*.js` at all (the `check:perf-budget` MISS). Keeping the
 * reset in its own module preserves that chunk boundary with plain static imports;
 * MV3 module service workers cannot use runtime `import()`, so making the edge
 * dynamic was not an option.
 *
 * The split is a build-graph change only. One service-worker-owned entry point,
 * the declared lane boundary and its ordering, partial-failure reporting, and
 * crash-resume all behave exactly as before.
 */
import { clearDomainProfiles } from "./domain_profile";
import {
  clearEventLogDirect,
  clearPromptOutcomesDirect,
  delayMs,
  isTrustedExtensionPageSender,
  queueBulkDataOperation,
  resyncPromptOutcomeAdaptiveScoresDirect,
  shouldDelegatePromptOutcomeWrite,
  STORAGE_DELEGATE_RETRY_DELAYS_MS,
} from "./storage";

/**
 * The declared behavioural-data boundary. This array is the SINGLE place the
 * boundary is defined and the order in which lanes are cleared.
 *
 * ASSUMPTION (the owner still owes the boundary decision — #474): the
 * behavioural-data boundary covers the event log, prompt outcomes, and caches
 * derived from them (adaptive per-domain scores and domain behaviour profiles
 * built from observed behaviour). It EXCLUDES user configuration: suite
 * settings, the user's navigation allowlist, and trusted credential domains.
 * Reason: erasing configuration the user deliberately set would be data loss,
 * whereas leaving behavioural residue is the privacy defect this slice exists
 * to fix. Reversible by widening this lane list once the owner rules.
 *
 * Order: a source lane is cleared before the cache derived from it, matching
 * the existing "Clear stats" flow (outcomes, then adaptive scores). A lane that
 * fails stays recorded in the persisted reset marker below, so a derivative can
 * never outlive its source across a restart.
 */
export const BEHAVIOURAL_DATA_LANES = [
  "promptOutcomes",
  "adaptiveScores",
  "eventLog",
  "domainProfiles",
] as const;

export type BehaviouralDataLane = (typeof BEHAVIOURAL_DATA_LANES)[number];

export interface BehaviouralResetLaneFailure {
  lane: BehaviouralDataLane;
  error: string;
}

export interface BehaviouralResetResult {
  /**
   * True ONLY when every requested lane was confirmed cleared AND the crash
   * marker was finalized. An un-finalized marker is replayed at the next worker
   * start, so reporting success while one survives would mean a later, silent
   * re-clear of data the user created after their reset visibly completed.
   */
  ok: boolean;
  cleared: BehaviouralDataLane[];
  failed: BehaviouralResetLaneFailure[];
  /**
   * Set when the marker could not be finalized. Distinct from `failed`: the
   * lanes listed in `cleared` really were cleared, but the reset is not
   * finished, because it can still replay.
   */
  markerError?: string;
}

/**
 * Crash-window marker. Written to `chrome.storage.local` (not `session`) BEFORE
 * the first destructive write and narrowed after each lane succeeds, so an interrupted
 * reset is never left half-applied without a record — the per-lane session
 * cutoffs only need to outlive a worker restart, but unfinished destructive
 * work must outlive a browser restart too.
 */
export const BEHAVIOURAL_RESET_STATE_KEY = "sentinelsuite:behavioural_reset_v1";

interface BehaviouralResetState {
  startedAt: number;
  pending: BehaviouralDataLane[];
}

const BEHAVIOURAL_LANE_CLEARERS: Record<BehaviouralDataLane, (progressMarker?: Record<string, unknown>) => Promise<void>> = {
  // Each entry reuses the lane's EXISTING serialized clear path (barrier first,
  // then the destructive write) rather than introducing a second concurrency
  // scheme — the get-modify-write races fixed in #180/#182 live in those chains.
  promptOutcomes: (progressMarker) => clearPromptOutcomesDirect(progressMarker),
  // Recomputes rather than blind-clears, so an outcome appended between these
  // two lanes cannot be left holding a source row with no derived score. With
  // no outcomes stored — the normal case — this writes exactly `{}`.
  adaptiveScores: (progressMarker) => resyncPromptOutcomeAdaptiveScoresDirect(progressMarker),
  eventLog: (progressMarker) => clearEventLogDirect(progressMarker),
  // Domain profiles are written directly by content scripts (accepted residual
  // #181), so this clear is serialized only within the calling context. A
  // content-script write already in flight can still land after it; that residual
  // is unchanged by this slice and is called out in PRIVACY.md.
  domainProfiles: (progressMarker) => clearDomainProfiles(progressMarker),
};

function isBehaviouralDataLane(value: unknown): value is BehaviouralDataLane {
  return typeof value === "string" && (BEHAVIOURAL_DATA_LANES as readonly string[]).includes(value);
}

function normalizeBehaviouralResetState(value: unknown): BehaviouralResetState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const pending = Array.isArray(raw.pending) ? raw.pending.filter(isBehaviouralDataLane) : [];
  if (pending.length === 0) return null;
  return {
    startedAt: typeof raw.startedAt === "number" && Number.isFinite(raw.startedAt) ? raw.startedAt : 0,
    // Re-order to the declared order so a resumed reset keeps source-before-derivative.
    pending: BEHAVIOURAL_DATA_LANES.filter((lane) => pending.includes(lane)),
  };
}

/**
 * Serialize whole resets against each other (a user-initiated reset and the
 * startup resume must not interleave their marker writes) AND against a suite
 * import, which is the other multi-lane bulk operation. Individual lanes remain
 * serialized by their own established chains; this is the shared bulk queue in
 * `storage.ts`, so an import can no longer restore a lane the reset has already
 * reported cleared. See `queueBulkDataOperation` for the per-context scope.
 */
const queueBehaviouralReset = queueBulkDataOperation;

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function writeBehaviouralResetState(state: BehaviouralResetState): Promise<void> {
  await chrome.storage.local.set({ [BEHAVIOURAL_RESET_STATE_KEY]: state });
}

/**
 * Narrow the marker to the lanes that still need work, or retire it entirely.
 *
 * Returns null on success, or the reason the marker is still ACTIVE. A stale
 * marker is not free: it is replayed at the next worker start and re-clears
 * lanes the user has since refilled, so a failure here is never swallowed — it
 * is reported and makes the whole reset `ok: false`.
 */
async function finalizeBehaviouralResetState(
  startedAt: number,
  pending: BehaviouralDataLane[]
): Promise<string | null> {
  if (pending.length > 0) {
    // Genuinely unfinished lanes MUST stay replayable; only narrow the list.
    try {
      await writeBehaviouralResetState({ startedAt, pending });
      return null;
    } catch (err) {
      return `marker still lists every lane and may re-clear on restart: ${errorText(err)}`;
    }
  }
  // `remove` is guarded because several stubbed storage areas (and the unit
  // test doubles) implement only get/set.
  const area = chrome.storage.local as { remove?: (keys: string | string[]) => Promise<void> };
  let removeError: unknown;
  if (typeof area.remove === "function") {
    try {
      await area.remove(BEHAVIOURAL_RESET_STATE_KEY);
      return null;
    } catch (err) {
      removeError = err;
      console.warn("[NavSentinel] behavioural reset marker cleanup failed:", err);
    }
  }
  // Fall back to a non-replayable tombstone: an empty `pending` normalizes to
  // "no interrupted reset", so a later worker start reads it and does nothing.
  try {
    await writeBehaviouralResetState({ startedAt, pending: [] });
    return null;
  } catch (err) {
    // The final lane already committed an empty-pending tombstone, so this
    // subsequent cleanup-write failure cannot reactivate replay.
    console.warn("[NavSentinel] behavioural reset marker update failed:", removeError ?? err);
    return null;
  }
}

async function runBehaviouralResetLanes(
  lanes: readonly BehaviouralDataLane[]
): Promise<BehaviouralResetResult> {
  if (lanes.length === 0) return { ok: true, cleared: [], failed: [] };

  const startedAt = Date.now();
  try {
    await writeBehaviouralResetState({ startedAt, pending: [...lanes] });
  } catch (err) {
    // Nothing has been erased yet. Refuse to start an unrecorded half-reset —
    // the same "persist the barrier before the destructive write" ordering the
    // per-lane cutoffs use. Reported as a total failure, and retryable.
    const error = `reset not started (marker not persisted): ${errorText(err)}`;
    return { ok: false, cleared: [], failed: lanes.map((lane) => ({ lane, error })) };
  }

  const cleared: BehaviouralDataLane[] = [];
  const failed: BehaviouralResetLaneFailure[] = [];
  for (const lane of lanes) {
    const pending = lanes.filter((candidate) => candidate !== lane && !cleared.includes(candidate));
    try {
      // A lane's destructive write and this narrowed marker are one
      // chrome.storage.local.set operation. A crash can therefore leave
      // either the old lane+old marker or the cleared lane+narrowed marker,
      // never the destructive replay gap between them.
      await BEHAVIOURAL_LANE_CLEARERS[lane]({
        [BEHAVIOURAL_RESET_STATE_KEY]: { startedAt, pending },
      });
      cleared.push(lane);
    } catch (err) {
      failed.push({ lane, error: errorText(err) });
    }
  }
  const markerError = await finalizeBehaviouralResetState(
    startedAt,
    failed.map((entry) => entry.lane)
  );
  return {
    ok: failed.length === 0 && markerError === null,
    cleared,
    failed,
    ...(markerError ? { markerError } : {}),
  };
}

/**
 * Service-worker-owned reset. Callers outside the worker go through
 * `clearBehaviouralData`, which delegates here over the runtime message lane.
 */
export function clearBehaviouralDataDirect(): Promise<BehaviouralResetResult> {
  return queueBehaviouralReset(() => runBehaviouralResetLanes(BEHAVIOURAL_DATA_LANES));
}

/**
 * Finish a reset that a worker termination or browser restart interrupted.
 * Called once at service-worker startup; a no-op when no marker is present.
 */
export function resumeInterruptedBehaviouralReset(): Promise<BehaviouralResetResult> {
  return queueBehaviouralReset(async () => {
    const res = await chrome.storage.local.get(BEHAVIOURAL_RESET_STATE_KEY);
    const state = normalizeBehaviouralResetState(res[BEHAVIOURAL_RESET_STATE_KEY]);
    if (!state) return { ok: true, cleared: [], failed: [] };
    return runBehaviouralResetLanes(state.pending);
  });
}

export type BehaviouralResetMessage = { type: "ns-behavioural-reset" };

type BehaviouralResetResponse =
  | { ok: true; result: BehaviouralResetResult }
  | { ok: false; error: string; code?: "unauthorized" };

export function isBehaviouralResetMessage(message: unknown): message is BehaviouralResetMessage {
  return Boolean(
    message &&
      typeof message === "object" &&
      (message as Record<string, unknown>).type === "ns-behavioural-reset"
  );
}

/**
 * A clear-all wipes every behavioural store, so — like the per-lane clear and
 * replace controls — it is accepted only from this extension's own pages.
 */
export async function handleBehaviouralResetMessage(
  sender?: chrome.runtime.MessageSender
): Promise<BehaviouralResetResponse> {
  if (!isTrustedExtensionPageSender(sender)) {
    return {
      ok: false,
      error: "Unauthorized behavioural reset from untrusted sender",
      code: "unauthorized",
    };
  }
  try {
    return { ok: true, result: await clearBehaviouralDataDirect() };
  } catch (err) {
    return { ok: false, error: errorText(err) };
  }
}

class BehaviouralResetRetryableError extends Error {}
class BehaviouralResetUnauthorizedError extends Error {}

function sendBehaviouralResetMessage(): Promise<BehaviouralResetResult> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(
        { type: "ns-behavioural-reset" } satisfies BehaviouralResetMessage,
        (response?: BehaviouralResetResponse) => {
          const lastError = chrome.runtime.lastError;
          if (lastError) {
            reject(new BehaviouralResetRetryableError(lastError.message ?? "runtime.sendMessage failed"));
            return;
          }
          if (response?.ok) {
            resolve(response.result);
            return;
          }
          if (response?.code === "unauthorized") {
            reject(new BehaviouralResetUnauthorizedError(response.error));
            return;
          }
          reject(new BehaviouralResetRetryableError(response?.error ?? "Behavioural reset failed"));
        }
      );
    } catch (err) {
      reject(new BehaviouralResetRetryableError(errorText(err)));
    }
  });
}

/**
 * The single clear-all entry point for content/UI callers. Never throws: the
 * result names exactly which lanes were cleared and which were not, so a
 * partial completion can never be reported as success.
 *
 * A delivery failure is reported as "not cleared" for every lane rather than
 * guessed at — the worker may in fact have completed the reset after the
 * response was lost, but the caller has not learned that it did. The persisted
 * marker guarantees any genuinely unfinished lane is retried on the next
 * service-worker start.
 */
export function clearBehaviouralData(): Promise<BehaviouralResetResult> {
  // `clearBehaviouralDataDirect` takes the bulk queue itself, so the two
  // branches acquire it exactly once each — never nested, which would deadlock.
  if (!shouldDelegatePromptOutcomeWrite()) return clearBehaviouralDataDirect();
  // The delegated round trip is held INSIDE the bulk queue so a suite import
  // running in this same page context cannot interleave with the worker-side
  // reset it triggers.
  return queueBulkDataOperation(async () => {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= STORAGE_DELEGATE_RETRY_DELAYS_MS.length; attempt++) {
      try {
        return await sendBehaviouralResetMessage();
      } catch (err) {
        if (err instanceof BehaviouralResetUnauthorizedError) {
          return {
            ok: false,
            cleared: [],
            failed: BEHAVIOURAL_DATA_LANES.map((lane) => ({ lane, error: err.message })),
          };
        }
        lastErr = err;
        const delay = STORAGE_DELEGATE_RETRY_DELAYS_MS[attempt];
        if (delay !== undefined) await delayMs(delay);
      }
    }
    const error = `not confirmed — service worker unreachable after retries: ${errorText(lastErr)}`;
    return {
      ok: false,
      cleared: [],
      failed: BEHAVIOURAL_DATA_LANES.map((lane) => ({ lane, error })),
    };
  });
}
