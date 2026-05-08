import type { PromptOutcomeEntry } from "./storage";

export interface DomainAdjustment {
  domain: string;
  adjustment: number;
  allowCount: number;
  blockCount: number;
  lastUpdated: number;
}

export const ADAPTIVE_SCORES_KEY = "sentinelsuite:adaptive_scores_v1";
const MAX_ADJUSTMENT = 15;
const MIN_ADJUSTMENT = -15;
const MIN_OUTCOMES = 3;
const RECENT_WINDOW = 10;
const RATIO_THRESHOLD = 0.7;
const MAX_ENTRIES = 200;

export function computeAdjustment(
  outcomes: PromptOutcomeEntry[],
  domain: string,
  baseThreshold = 70
): number {
  const domainOutcomes = outcomes.filter(o => o.domain === domain);
  if (domainOutcomes.length < MIN_OUTCOMES) return 0;

  const recent = domainOutcomes.slice(-RECENT_WINDOW);

  let allowWeight = 0;
  let blockWeight = 0;

  for (const o of recent) {
    if (
      o.outcome === "allow" ||
      o.outcome === "allow_once" ||
      o.outcome === "always_allow" ||
      o.outcome === "trust"
    ) {
      // Discount high-score allows: if the user allowed at a score near/above
      // the threshold, this may have been social engineering, not genuine trust
      if (o.score >= baseThreshold) {
        allowWeight += 0.3;
      } else {
        allowWeight++;
      }
    } else if (o.outcome === "block" || o.outcome === "dismiss") {
      blockWeight++;
    }
  }

  const total = allowWeight + blockWeight;
  if (total === 0) return 0;

  const allowRatio = allowWeight / total;
  const blockRatio = blockWeight / total;

  let adjustment = 0;
  if (allowRatio >= RATIO_THRESHOLD) {
    adjustment = -Math.round(MAX_ADJUSTMENT * ((allowRatio - RATIO_THRESHOLD) / (1 - RATIO_THRESHOLD)));
  } else if (blockRatio >= RATIO_THRESHOLD) {
    adjustment = Math.round(MAX_ADJUSTMENT * ((blockRatio - RATIO_THRESHOLD) / (1 - RATIO_THRESHOLD)));
  }

  return Math.max(MIN_ADJUSTMENT, Math.min(MAX_ADJUSTMENT, adjustment));
}

export async function getAdaptiveScores(): Promise<Record<string, DomainAdjustment>> {
  const res = await chrome.storage.local.get(ADAPTIVE_SCORES_KEY);
  const stored = res[ADAPTIVE_SCORES_KEY];
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  return stored as Record<string, DomainAdjustment>;
}

export async function updateAdaptiveScores(
  outcomes: PromptOutcomeEntry[]
): Promise<Record<string, DomainAdjustment>> {
  const domains = new Set(outcomes.map(o => o.domain));
  const scores: Record<string, DomainAdjustment> = {};

  for (const domain of domains) {
    const domainOutcomes = outcomes.filter(o => o.domain === domain);
    const adjustment = computeAdjustment(outcomes, domain);
    if (adjustment !== 0) {
      const allowCount = domainOutcomes.filter(o =>
        o.outcome === "allow" ||
        o.outcome === "allow_once" ||
        o.outcome === "always_allow" ||
        o.outcome === "trust"
      ).length;
      const blockCount = domainOutcomes.filter(o =>
        o.outcome === "block" || o.outcome === "dismiss"
      ).length;
      scores[domain] = { domain, adjustment, allowCount, blockCount, lastUpdated: Date.now() };
    }
  }

  const entries = Object.entries(scores);
  if (entries.length > MAX_ENTRIES) {
    entries.sort((a, b) => b[1].lastUpdated - a[1].lastUpdated);
    const pruned = Object.fromEntries(entries.slice(0, MAX_ENTRIES));
    await chrome.storage.local.set({ [ADAPTIVE_SCORES_KEY]: pruned });
    return pruned;
  }

  await chrome.storage.local.set({ [ADAPTIVE_SCORES_KEY]: scores });
  return scores;
}

export async function getEffectiveThresholdAdjustment(domain: string): Promise<number> {
  const scores = await getAdaptiveScores();
  return scores[domain]?.adjustment ?? 0;
}

export async function clearAdaptiveScores(): Promise<void> {
  await chrome.storage.local.set({ [ADAPTIVE_SCORES_KEY]: {} });
}
