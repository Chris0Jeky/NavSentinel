/**
 * Shared worker/parallelism topology for the headed persistent-context
 * Playwright lanes.
 *
 * Why this exists (#460): the extension E2E lanes launch *headed persistent*
 * Chromium contexts. On Windows, several such contexts running at once compete
 * for OS focus and user-activation state, and blank-anchor interception cases
 * fail nondeterministically even though every readiness marker has been
 * awaited. Measured 2026-07-17 on untouched `origin/main@cfa6f3c`: the five
 * blank-anchor cases produced 4 failed / 21 passed under
 * `--repeat-each=5 --workers=4`, and 15/15 passed under `--workers=1`.
 *
 * The underlying focus/user-activation race is NOT fixed by this module. It
 * only makes the trustworthy topology the default instead of tribal knowledge,
 * so a local run means the same thing CI means.
 *
 * CI is decided first and is not configurable here: when `CI` is set the result
 * is always serial, exactly as the configs hardcoded before this module existed.
 */

export interface E2eTopology {
  /** Playwright `fullyParallel`. */
  fullyParallel: boolean;
  /** Playwright `workers`. */
  workers: number;
}

/** Opt back into parallel local runs deliberately, e.g. `NAVSENTINEL_E2E_WORKERS=4`. */
export const E2E_WORKERS_ENV = "NAVSENTINEL_E2E_WORKERS";

const SERIAL: E2eTopology = { fullyParallel: false, workers: 1 };

/**
 * Resolve the worker topology for a headed persistent-context lane.
 *
 * - `CI` set (any truthy string): serial, always. The opt-in override is
 *   ignored so CI topology cannot drift.
 * - `NAVSENTINEL_E2E_WORKERS=<n>` locally: `n` workers, parallel when `n > 1`.
 * - otherwise: serial.
 *
 * Throws on a malformed override rather than silently picking a topology the
 * caller did not ask for.
 */
export function resolveE2eTopology(
  env: Record<string, string | undefined> = process.env,
): E2eTopology {
  if (env.CI) {
    return { ...SERIAL };
  }

  const requested = env[E2E_WORKERS_ENV];
  if (requested === undefined || requested.trim() === "") {
    return { ...SERIAL };
  }

  const workers = Number(requested.trim());
  if (!Number.isInteger(workers) || workers < 1) {
    throw new Error(
      `${E2E_WORKERS_ENV} must be a positive integer (got ${JSON.stringify(requested)}).`,
    );
  }

  return { fullyParallel: workers > 1, workers };
}
