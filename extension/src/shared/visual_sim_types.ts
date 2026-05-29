/**
 * Visual Similarity Detection - Shared Types (P4-01)
 *
 * Type definitions shared across the capture pipeline, hash algorithms,
 * and template database.
 */

export interface BrandTemplate {
  id: string;
  displayName: string;
  aHash: Uint8Array;
  bHash: Uint8Array;
  version: number;
}

export interface VisualSimMatch {
  brandId: string;
  brandName: string;
  confidence: "low" | "high";
  aHashDistance: number;
  bHashDistance: number;
}

export interface VisualSimResult {
  matched: boolean;
  match?: VisualSimMatch;
  score: number;
  captureMs: number;
  hashMs: number;
  compareMs: number;
}

export interface VisualSimConfig {
  enabled: boolean;
  aHashThreshold: number;
  bHashThreshold: number;
  stabilityWaitMs: number;
  maxTemplates: number;
}

export const DEFAULT_VISUAL_SIM_CONFIG: VisualSimConfig = {
  enabled: true,
  aHashThreshold: 10,
  bHashThreshold: 25,
  stabilityWaitMs: 500,
  maxTemplates: 50,
};

export const NRS_WEIGHT_VISUAL_SIM_CAP = 30;
// Cross-origin (impersonation) scoring tiers. On-domain (canonical) brand
// matches score 0 and never contribute -- only cross-origin impersonation does.
// aHash-only is a deliberately weak signal (+10); bHash-confirmed is +30.
export const VISUAL_SIM_SCORE_AHASH_ONLY = 10;
// Reference value for a confirmed match; only applied when cross-origin.
// Retained for documentation/tests of the tiering model.
export const VISUAL_SIM_SCORE_BHASH_CONFIRMED = 25;
export const VISUAL_SIM_SCORE_BHASH_CROSS_ORIGIN = 30;
