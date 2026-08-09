import type { ReleaseProfile } from "./release-profile.mjs";

export interface BuiltReleaseProfileResult {
  profile: ReleaseProfile;
  manifest: Record<string, unknown>;
  hasReputationAsset: boolean;
  exposesReputation: boolean;
  hasBrandTemplatesAsset: boolean;
  exposesBrandTemplates: boolean;
}

export function inspectBuiltReleaseProfile(
  distDir?: string,
  options?: { expectedProfile?: string; requireReleaseEligible?: boolean },
): BuiltReleaseProfileResult;
