/**
 * Per-domain behavioral profiling (P4-07).
 *
 * Tracks navigation risk scores over time so that sites which
 * consistently trigger near-threshold activity accumulate an
 * additional NRS penalty (`domain_repeat_offender`, +10).
 *
 * Storage: `domainProfiles` key in chrome.storage.local.
 * Bounded to MAX_PROFILES entries with LRU eviction.
 * Profiles not seen in DECAY_AGE_MS have visits/triggerCount halved.
 *
 * Concurrency — accepted residual (#181, closed as accept+document):
 * The public API serializes read-modify-write through the module-level `pending`
 * promise chain, which eliminates lost updates WITHIN a single content-script
 * context. It does NOT serialize across contexts: content scripts run with
 * `all_frames: true`, so each frame (and each tab) has its own `pending`, and two
 * contexts that record the same domain concurrently can each load the shared
 * `chrome.storage.local`, mutate independently, and have the last `set` win — the
 * other context's increment is then lost.
 *
 * This residual is deliberately accepted rather than fixed (a cross-context fix
 * would route every write through the service worker, adding a message round-trip
 * to the navigation hot path for what is low-stakes telemetry). The data here is a
 * coarse per-domain visit/trigger counter feeding a single +10 `domain_repeat_offender`
 * NRS signal that accrues over many visits. A lost update only ever DROPS an
 * increment, so the failure mode is a marginal, self-correcting UNDER-count (a
 * repeat offender flagged one visit later) — never an over-count that could
 * manufacture a false positive, and never a correctness hazard for any other signal.
 * If domain profiles ever gain a higher-stakes consumer, revisit the SW-delegation
 * option recorded in #181.
 */

export const DOMAIN_PROFILES_KEY = "sentinelsuite:domain_profiles_v1";

/** Hard cap on stored profiles. LRU eviction when exceeded. */
export const MAX_PROFILES = 500;

/** Profiles older than 30 days get a 50 % decay on visits/triggerCount. */
export const DECAY_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Repeat-offender thresholds. */
export const REPEAT_OFFENDER_TRIGGER_MIN = 3;
export const REPEAT_OFFENDER_AVG_NRS_MIN = 30;

export interface DomainProfile {
  domain: string;
  visits: number;
  totalNRS: number;
  maxNRS: number;
  triggerCount: number;
  lastSeen: number;
  factors: Record<string, number>;
  /** Running list of NRS values for stddev calculation, capped at 50. */
  nrsHistory: number[];
}

export interface DomainRiskAssessment {
  avgNRS: number;
  consistency: number;
  isRepeatOffender: boolean;
  topFactors: string[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

const MAX_NRS_HISTORY = 50;

/** Apply time-based decay in-place. Returns true if the profile was decayed. */
function applyDecay(profile: DomainProfile, now: number): boolean {
  if (!Number.isFinite(profile.lastSeen) || !Number.isFinite(now)) return false;
  if (now - profile.lastSeen < DECAY_AGE_MS) return false;
  const MAX_DECAY_ITERATIONS = 24;
  let iterations = 0;
  while (now - profile.lastSeen >= DECAY_AGE_MS && iterations < MAX_DECAY_ITERATIONS) {
    profile.visits = Math.max(1, Math.floor(profile.visits * 0.5));
    profile.triggerCount = Math.floor(profile.triggerCount * 0.5);
    profile.totalNRS = Math.floor(profile.totalNRS * 0.5);
    for (const key of Object.keys(profile.factors)) {
      profile.factors[key] = Math.floor(profile.factors[key]! * 0.5);
      if (profile.factors[key] === 0) delete profile.factors[key];
    }
    profile.lastSeen += DECAY_AGE_MS;
    iterations++;
  }
  if (iterations === MAX_DECAY_ITERATIONS) {
    profile.lastSeen = now;
  }
  return true;
}

/** Evict LRU entries to keep the map within MAX_PROFILES. */
function evictLRU(profiles: Map<string, DomainProfile>): void {
  if (profiles.size <= MAX_PROFILES) return;
  const sorted = [...profiles.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen);
  const excess = profiles.size - MAX_PROFILES;
  for (let i = 0; i < excess; i++) {
    profiles.delete(sorted[i]![0]);
  }
}

// ---------------------------------------------------------------------------
// Storage access
// ---------------------------------------------------------------------------

async function loadProfiles(): Promise<Map<string, DomainProfile>> {
  const res = await chrome.storage.local.get(DOMAIN_PROFILES_KEY);
  const raw = res[DOMAIN_PROFILES_KEY];
  if (!raw || typeof raw !== "object") return new Map();
  const map = new Map<string, DomainProfile>();
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (val && typeof val === "object") {
      const p = val as DomainProfile;
      // Ensure nrsHistory exists (forward-compat with older stored data)
      if (!Array.isArray(p.nrsHistory)) {
        p.nrsHistory = [];
      }
      if (!p.factors || typeof p.factors !== "object" || Array.isArray(p.factors)) {
        p.factors = {};
      }
      map.set(key, p);
    }
  }
  return map;
}

async function saveProfiles(profiles: Map<string, DomainProfile>): Promise<void> {
  const obj: Record<string, DomainProfile> = {};
  for (const [key, val] of profiles) {
    obj[key] = val;
  }
  await chrome.storage.local.set({ [DOMAIN_PROFILES_KEY]: obj });
}

// ---------------------------------------------------------------------------
// Assessment helper
// ---------------------------------------------------------------------------

function computeAssessment(profile: DomainProfile): DomainRiskAssessment {
  const avgNRS = profile.visits > 0 ? profile.totalNRS / profile.visits : 0;
  const consistency = stddev(profile.nrsHistory);
  const isRepeatOffender =
    profile.triggerCount > REPEAT_OFFENDER_TRIGGER_MIN &&
    avgNRS > REPEAT_OFFENDER_AVG_NRS_MIN;
  const topFactors = Object.entries(profile.factors)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k);
  return { avgNRS, consistency, isRepeatOffender, topFactors };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

let pending: Promise<unknown> = Promise.resolve();

/**
 * Record a navigation event for the given domain.
 * Returns the updated risk assessment, eliminating the need for a
 * separate getDomainRisk call. Serialized via promise chain to
 * prevent concurrent read-modify-write races.
 */
export function recordNavigation(
  domain: string,
  nrs: number,
  reasons: string[],
  blockThreshold = 70,
): Promise<DomainRiskAssessment> {
  const next = pending.then(async (): Promise<DomainRiskAssessment> => {
    const now = Date.now();
    const profiles = await loadProfiles();

    let profile = profiles.get(domain);
    if (!profile) {
      profile = {
        domain,
        visits: 0,
        totalNRS: 0,
        maxNRS: 0,
        triggerCount: 0,
        lastSeen: now,
        factors: {},
        nrsHistory: [],
      };
      profiles.set(domain, profile);
    }

    applyDecay(profile, now);

    profile.visits += 1;
    profile.totalNRS += nrs;
    profile.maxNRS = Math.max(profile.maxNRS, nrs);
    profile.lastSeen = now;

    if (nrs >= blockThreshold) {
      profile.triggerCount += 1;
    }

    profile.nrsHistory.push(nrs);
    if (profile.nrsHistory.length > MAX_NRS_HISTORY) {
      profile.nrsHistory = profile.nrsHistory.slice(-MAX_NRS_HISTORY);
    }

    for (const reason of reasons) {
      const prev = Object.hasOwn(profile.factors, reason) ? profile.factors[reason]! : 0;
      profile.factors[reason] = prev + 1;
    }

    evictLRU(profiles);
    await saveProfiles(profiles);

    return computeAssessment(profile);
  });
  pending = next.catch((err) => { console.warn("[NavSentinel] profile serialization error:", err); });
  return next;
}

/**
 * Compute a risk assessment for the given domain.
 *
 * Serialized through the same `pending` chain as recordNavigation: this reader
 * can apply decay and persist the result, so it must not interleave with a
 * concurrent navigation's read-modify-write (whose update would otherwise be
 * lost when this function saves its pre-write snapshot).
 */
export function getDomainRisk(domain: string): Promise<DomainRiskAssessment> {
  const next = pending.then(async (): Promise<DomainRiskAssessment> => {
    const profiles = await loadProfiles();
    const profile = profiles.get(domain);

    if (!profile || profile.visits === 0) {
      return { avgNRS: 0, consistency: 0, isRepeatOffender: false, topFactors: [] };
    }

    const now = Date.now();
    const decayed = applyDecay(profile, now);

    if (decayed) {
      await saveProfiles(profiles);
    }

    return computeAssessment(profile);
  });
  pending = next.catch((err) => { console.warn("[NavSentinel] profile serialization error:", err); });
  return next;
}

/**
 * Return the top N most suspicious domain profiles, ordered by avgNRS desc.
 *
 * Serialized through the `pending` chain: it applies decay across all profiles
 * and may persist that snapshot, so it must not interleave with a concurrent
 * recordNavigation (whose update would be overwritten by this stale snapshot).
 */
export function getTopSuspiciousDomains(limit: number): Promise<DomainProfile[]> {
  const next = pending.then(async (): Promise<DomainProfile[]> => {
    const profiles = await loadProfiles();
    const now = Date.now();

    let anyDecayed = false;
    for (const profile of profiles.values()) {
      if (applyDecay(profile, now)) {
        anyDecayed = true;
      }
    }

    if (anyDecayed) {
      await saveProfiles(profiles);
    }

    return [...profiles.values()]
      .filter((p) => p.visits > 0)
      .sort((a, b) => {
        const avgA = a.totalNRS / a.visits;
        const avgB = b.totalNRS / b.visits;
        return avgB - avgA;
      })
      .slice(0, limit);
  });
  pending = next.catch((err) => { console.warn("[NavSentinel] profile serialization error:", err); });
  return next;
}

/**
 * Clear all stored domain profiles.
 *
 * Serialized through the `pending` chain so it cannot interleave with a
 * recordNavigation read-modify-write (otherwise a clear issued between a
 * navigation's load and save would be silently resurrected, or a navigation's
 * update would survive a clear the user just requested).
 */
export function clearDomainProfiles(): Promise<void> {
  const next = pending.then(async (): Promise<void> => {
    await chrome.storage.local.set({ [DOMAIN_PROFILES_KEY]: {} });
  });
  pending = next.catch((err) => { console.warn("[NavSentinel] profile serialization error:", err); });
  return next;
}

/**
 * Test-only: reset the module-level serialization chain so that fire-and-forget
 * operations queued by one test cannot leak into the next. Not part of the
 * runtime API.
 *
 * CAVEAT: this reassigns `pending` to a fresh resolved promise; it does NOT
 * cancel `.then()` callbacks already queued on the previous chain. A test that
 * issues a fire-and-forget op (e.g. `void recordNavigation(...)`) MUST await it
 * to completion before relying on this reset — otherwise the prior op can still
 * run and mutate shared state after the next test begins.
 *
 * NOTE: `pending` is per-content-script-context. With `all_frames: true`, each
 * frame (and tab) has its own chain, so two contexts racing recordNavigation for
 * the same domain can still lose an update at the shared chrome.storage.local
 * layer. This cross-context residual is an ACCEPTED limitation — see the module
 * header for the rationale (low-stakes counter; lost updates only under-count) and
 * #181 (closed as accept+document).
 */
export function _resetSerializationForTests(): void {
  pending = Promise.resolve();
}
