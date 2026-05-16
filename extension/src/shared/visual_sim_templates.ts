/**
 * Visual Similarity Detection — Template Database (P4-01)
 *
 * Manages the pre-computed brand template database for perceptual
 * hash comparison. Templates are bundled with the extension and
 * loaded on first use.
 */

import { hammingDistance } from "./visual_sim_hash";
import type { BrandTemplate, VisualSimMatch } from "./visual_sim_types";
import {
  DEFAULT_VISUAL_SIM_CONFIG,
  VISUAL_SIM_SCORE_AHASH_ONLY,
  VISUAL_SIM_SCORE_BHASH_CONFIRMED,
  VISUAL_SIM_SCORE_BHASH_CROSS_ORIGIN,
} from "./visual_sim_types";

let _templates: BrandTemplate[] = [];
let _loaded = false;

export function getTemplates(): BrandTemplate[] {
  return _templates;
}

export function isLoaded(): boolean {
  return _loaded;
}

export function loadTemplates(templates: BrandTemplate[]): void {
  _templates = templates;
  _loaded = true;
}

export function findAHashCandidates(
  queryHash: Uint8Array,
  threshold?: number
): Array<{ template: BrandTemplate; distance: number }> {
  const t = threshold ?? DEFAULT_VISUAL_SIM_CONFIG.aHashThreshold;
  const candidates: Array<{ template: BrandTemplate; distance: number }> = [];

  for (let i = 0; i < _templates.length; i++) {
    const dist = hammingDistance(queryHash, _templates[i]!.aHash);
    if (dist <= t) {
      candidates.push({ template: _templates[i]!, distance: dist });
    }
  }

  return candidates.sort((a, b) => a.distance - b.distance);
}

export function confirmBHashMatch(
  queryBHash: Uint8Array,
  candidate: BrandTemplate,
  threshold?: number
): { matched: boolean; distance: number } {
  const t = threshold ?? DEFAULT_VISUAL_SIM_CONFIG.bHashThreshold;
  const dist = hammingDistance(queryBHash, candidate.bHash);
  return { matched: dist <= t, distance: dist };
}

export function computeVisualSimScore(
  match: VisualSimMatch,
  isCrossOriginFromBrand: boolean
): number {
  if (match.confidence === "high" && isCrossOriginFromBrand) {
    return VISUAL_SIM_SCORE_BHASH_CROSS_ORIGIN;
  }
  if (match.confidence === "high") {
    return VISUAL_SIM_SCORE_BHASH_CONFIRMED;
  }
  return VISUAL_SIM_SCORE_AHASH_ONLY;
}
