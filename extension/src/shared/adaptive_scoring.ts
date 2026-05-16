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

  const total = allowWeight + blockWeight;
  if (total === 0) return { adjustment: 0, allowCount, blockCount };

  const allowRatio = allowWeight / total;
  const blockRatio = blockWeight / total;

  let adjustment = 0;
  if (allowRatio >= RATIO_THRESHOLD) {
    // User mostly allows -> raise threshold -> fewer auto-blocks -> user decides more
    adjustment = Math.round(MAX_ADJUSTMENT * ((allowRatio - RATIO_THRESHOLD) / (1 - RATIO_THRESHOLD)));
  } else if (blockRatio >= RATIO_THRESHOLD) {
    // User mostly blocks -> lower threshold -> more auto-blocks -> stricter protection
    adjustment = -Math.round(MAX_ADJUSTMENT * ((blockRatio - RATIO_THRESHOLD) / (1 - RATIO_THRESHOLD)));
  }

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
