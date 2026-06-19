import type { PromptOutcomeEntry } from "./storage";

export interface DomainAdjustment {
  domain: string;
  adjustment: number;
  allowCount: number;
  blockCount: number;
  lastUpdated: number;
}

export interface AdjustmentResult {
  adjustment: number;
  allowCount: number;
  blockCount: number;
}

export const ADAPTIVE_SCORES_KEY = "sentinelsuite:adaptive_scores_v1";
const MAX_ADJUSTMENT = 15;
const MIN_ADJUSTMENT = -15;
const MIN_OUTCOMES = 3;
const RECENT_WINDOW = 10;
const RATIO_THRESHOLD = 0.7;
const MAX_ENTRIES = 200;

export function computeAdjustment(
  domainOutcomes: PromptOutcomeEntry[],
  baseThreshold = 70
): AdjustmentResult {
  // Contract: allowCount/blockCount are only meaningful on a nonzero adjustment.
  // The early returns report 0/0 (this length gate, pre-count) or the windowed
  // counts (decisive-count gate below); the sole caller reads them only when
  // adjustment !== 0. (#204 R2)
  if (domainOutcomes.length < MIN_OUTCOMES) return { adjustment: 0, allowCount: 0, blockCount: 0 };

  const recent = domainOutcomes.slice(-RECENT_WINDOW);

  let allowWeight = 0;
  let blockWeight = 0;
  let allowCount = 0;
  let blockCount = 0;

  for (const o of recent) {
    if (
      o.outcome === "allow" ||
      o.outcome === "allow_once" ||
      o.outcome === "always_allow" ||
      o.outcome === "trust"
    ) {
      allowCount++;
      // Discount high-score allows: if the user allowed at a score near/above
      // the threshold, this may have been social engineering, not genuine trust
      if (o.score >= baseThreshold) {
        allowWeight += 0.3;
      } else {
        allowWeight++;
      }
    } else if (o.outcome === "block" || o.outcome === "dismiss") {
      blockCount++;
      blockWeight++;
    }
  }

  // Require at least MIN_OUTCOMES DECISIVE outcomes (allow/block) in the recent
  // window. The initial length gate counts non-decisive `cancel` outcomes that the
  // ratio below ignores, so without this a single decisive allow padded with
  // cancels (e.g. [cancel, cancel, allow]) would pass the gate and drive the
  // maximum threshold relaxation — making the extension least protective on the
  // strength of one data point (#204).
  if (allowCount + blockCount < MIN_OUTCOMES) {
    return { adjustment: 0, allowCount, blockCount };
  }

  const total = allowWeight + blockWeight;
  // Defensive backstop: now unreachable given the decisive-count gate above (>= 3
  // decisive outcomes => total >= 3 * 0.3 = 0.9), but retained to guard the ratio
  // divisions below against a future change that could let total reach 0 (#204 R1).
  if (total === 0) return { adjustment: 0, allowCount, blockCount };

  const allowRatio = allowWeight / total;
  const blockRatio = blockWeight / total;

  // The ratio sets DIRECTION and how far past RATIO_THRESHOLD we are; it is scale-free.
  let direction = 0;
  let ratioExcess = 0;
  if (allowRatio >= RATIO_THRESHOLD) {
    // User mostly allows -> raise threshold -> fewer auto-blocks -> user decides more
    direction = 1;
    ratioExcess = (allowRatio - RATIO_THRESHOLD) / (1 - RATIO_THRESHOLD);
  } else if (blockRatio >= RATIO_THRESHOLD) {
    // User mostly blocks -> lower threshold -> more auto-blocks -> stricter protection
    direction = -1;
    ratioExcess = (blockRatio - RATIO_THRESHOLD) / (1 - RATIO_THRESHOLD);
  }

  // Effective-sample-size scaling (#213). The ratio above is scale-free: a pure-allow
  // sequence has allowRatio = allowWeight/allowWeight = 1.0 regardless of the high-score
  // discount, so e.g. 3 near-threshold allows (allowWeight 0.9) used to drive the full
  // +15 — the 0.3 discount that resists social-engineering allows never affected the
  // magnitude without blocks to dilute the ratio. Scale the magnitude by the SUMMED
  // (discounted) weight — the effective sample size — relative to MIN_OUTCOMES, capped
  // at 1. So 3 discounted allows (weight 0.9 -> confidence 0.3) yield ~a third of the
  // magnitude, while any sequence with >= MIN_OUTCOMES full-weight decisive outcomes
  // (weight >= 3 -> confidence 1) is unchanged. Rounding the positive magnitude before
  // applying `direction` keeps full-weight results bit-identical to the prior code.
  const confidence = Math.min(1, total / MIN_OUTCOMES);
  const magnitude = Math.round(MAX_ADJUSTMENT * ratioExcess * confidence);
  let adjustment = direction * magnitude;

  adjustment = Math.max(MIN_ADJUSTMENT, Math.min(MAX_ADJUSTMENT, adjustment));
  return { adjustment, allowCount, blockCount };
}

export async function getAdaptiveScores(): Promise<Record<string, DomainAdjustment>> {
  const res = await chrome.storage.local.get(ADAPTIVE_SCORES_KEY);
  const stored = res[ADAPTIVE_SCORES_KEY];
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  return stored as Record<string, DomainAdjustment>;
}

export async function updateAdaptiveScores(
  outcomes: PromptOutcomeEntry[],
  baseThreshold = 70
): Promise<void> {
  const grouped = new Map<string, PromptOutcomeEntry[]>();
  for (const o of outcomes) {
    const list = grouped.get(o.domain);
    if (list) list.push(o);
    else grouped.set(o.domain, [o]);
  }
  const scores: Record<string, DomainAdjustment> = {};

  for (const [domain, domainOutcomes] of grouped) {
    const { adjustment, allowCount, blockCount } = computeAdjustment(domainOutcomes, baseThreshold);
    if (adjustment !== 0) {
      scores[domain] = { domain, adjustment, allowCount, blockCount, lastUpdated: Date.now() };
    }
  }

  const entries = Object.entries(scores);
  if (entries.length > MAX_ENTRIES) {
    entries.sort((a, b) => b[1].lastUpdated - a[1].lastUpdated);
    const pruned = Object.fromEntries(entries.slice(0, MAX_ENTRIES));
    await chrome.storage.local.set({ [ADAPTIVE_SCORES_KEY]: pruned });
    return;
  }

  await chrome.storage.local.set({ [ADAPTIVE_SCORES_KEY]: scores });
}

export async function getEffectiveThresholdAdjustment(domain: string): Promise<number> {
  const scores = await getAdaptiveScores();
  return scores[domain]?.adjustment ?? 0;
}

export async function clearAdaptiveScores(): Promise<void> {
  await chrome.storage.local.set({ [ADAPTIVE_SCORES_KEY]: {} });
}
