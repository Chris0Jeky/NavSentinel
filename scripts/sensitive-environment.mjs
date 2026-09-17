export const SENSITIVE_ENVIRONMENT_PREFIXES = Object.freeze([
  "GIT_",
  "NAVSENTINEL_STATE_AUTHORITY_",
]);

export const SENSITIVE_ENVIRONMENT_EXACT_KEYS = Object.freeze([
  "NODE_OPTIONS",
  "NODE_PATH",
  "EXTENSION_PATH",
]);

export function normalizeEnvironmentKey(key) {
  return String(key ?? "").toUpperCase();
}

export function isSensitiveEnvironmentKey(key) {
  const normalized = normalizeEnvironmentKey(key);
  return SENSITIVE_ENVIRONMENT_EXACT_KEYS.includes(normalized)
    || SENSITIVE_ENVIRONMENT_PREFIXES.some(prefix => normalized.startsWith(prefix));
}

export function stripSensitiveEnvironment(source = process.env, options = {}) {
  const preserved = new Set(
    (options.preserveNormalizedKeys ?? []).map(normalizeEnvironmentKey),
  );
  const environment = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const normalized = normalizeEnvironmentKey(key);
    if (isSensitiveEnvironmentKey(normalized) && !preserved.has(normalized)) continue;
    environment[key] = value;
  }
  return environment;
}
