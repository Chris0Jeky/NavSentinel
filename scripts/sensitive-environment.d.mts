export const SENSITIVE_ENVIRONMENT_PREFIXES: readonly [
  "GIT_",
  "NAVSENTINEL_STATE_AUTHORITY_",
];

export const SENSITIVE_ENVIRONMENT_EXACT_KEYS: readonly [
  "NODE_OPTIONS",
  "NODE_PATH",
  "EXTENSION_PATH",
];

export interface StripSensitiveEnvironmentOptions {
  readonly preserveNormalizedKeys?: readonly string[];
}

export function normalizeEnvironmentKey(key: string): string;
export function isSensitiveEnvironmentKey(key: string): boolean;
export function stripSensitiveEnvironment(
  source?: NodeJS.ProcessEnv,
  options?: StripSensitiveEnvironmentOptions,
): NodeJS.ProcessEnv;
