export interface ReleaseProfile {
  id: string;
  schemaVersion: number;
  description: string;
  releaseEligible: boolean;
  capabilities: {
    reputation: boolean;
  };
}

export const RELEASE_PROFILE_ENV: string;
export const RELEASE_PROFILE_RECEIPT: string;
export function loadReleaseProfileConfig(filePath?: string): unknown;
export function resolveReleaseProfile(requested?: string): ReleaseProfile;
export function createReleaseProfileReceipt(profile: ReleaseProfile): Record<string, unknown>;
export function serializeReleaseProfileReceipt(profile: ReleaseProfile): string;
export function configureManifestForProfile<T>(baseManifest: T, profile: ReleaseProfile): T;
export function assertReleaseProfileReceipt(receipt: unknown): ReleaseProfile;
