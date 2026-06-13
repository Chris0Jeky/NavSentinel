import type { ClickContext } from "../shared/scoring";
import type { PromptOutcomeEntry } from "../shared/storage";

/**
 * Replay-grade enrichment (P5-C1 / #238) attached to a nav PromptOutcome.
 * Built from the LOCAL decision scope at decision time — NOT from the global
 * `lastDebug`, which is only assigned after the decision branches run (so at the
 * outcome call sites it still holds the previous click's data).
 */
export type NavOutcomeFeatures = Pick<
  PromptOutcomeEntry,
  "reasons" | "cds" | "nrsFactors" | "navAnomalyScore" | "adaptiveAdj" | "thresholdUsed" | "elementContext"
>;

/**
 * Select which replay fields to attach to a nav outcome record, omitting empty
 * or absent signals so thin records stay lean. Storage (`appendPromptOutcome`)
 * still sanitizes/bounds whatever this passes; this only decides inclusion.
 * Pure + side-effect-free so it is unit-testable in isolation from the
 * content-script entry module.
 */
export function buildNavOutcomeFeatures(input: {
  reasonCodes?: string[];
  nrsFactors?: string[];
  cds?: number;
  navAnomalyScore?: number;
  adaptiveAdj?: number;
  thresholdUsed: number;
  ctx?: ClickContext;
}): NavOutcomeFeatures {
  const out: NavOutcomeFeatures = { thresholdUsed: input.thresholdUsed };
  if (input.reasonCodes && input.reasonCodes.length > 0) out.reasons = input.reasonCodes;
  if (input.nrsFactors && input.nrsFactors.length > 0) out.nrsFactors = input.nrsFactors;
  if (typeof input.cds === "number" && Number.isFinite(input.cds)) out.cds = input.cds;
  if (typeof input.navAnomalyScore === "number" && input.navAnomalyScore > 0) out.navAnomalyScore = input.navAnomalyScore;
  if (typeof input.adaptiveAdj === "number" && Number.isFinite(input.adaptiveAdj)) out.adaptiveAdj = input.adaptiveAdj;
  if (input.ctx) out.elementContext = input.ctx;
  return out;
}
