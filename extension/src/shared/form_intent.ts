/** Metadata only: never serialize form controls, values, or request bodies. */
export type FormIntent = readonly [
  actionUrl: string,
  method: "get" | "post" | "dialog",
  enctype: "application/x-www-form-urlencoded" | "multipart/form-data" | "text/plain",
  target: string,
  targetScope: "self" | "top" | "other",
];

export const FORM_INTENT_TTL_MS = 1500;
export const FORM_INTENT_MAX_URL = 8192;

export function sameFormIntent(a: FormIntent, b: FormIntent): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4];
}

/** Strict, bounded bridge/session schema. No coercion or unknown-field authority. */
export function isFormIntent(value: unknown): value is FormIntent {
  if (!Array.isArray(value) || value.length !== 5 || Object.keys(value).length !== 5) return false;
  const v = value as readonly unknown[];
  if (typeof v[0] !== "string" || !v[0] || v[0].length > FORM_INTENT_MAX_URL ||
      !["get", "post", "dialog"].includes(v[1] as string) ||
      !["application/x-www-form-urlencoded", "multipart/form-data", "text/plain"].includes(v[2] as string) ||
      typeof v[3] !== "string" || v[3].length > 1024 ||
      !["self", "top", "other"].includes(v[4] as string)) return false;
  try { return new URL(v[0]).href === v[0]; } catch { return false; }
}

export function isHttpFormIntent(intent: FormIntent): boolean {
  return intent[1] !== "dialog" && /^https?:\/\//.test(intent[0]);
}

/**
 * Browser-visible navigation metadata is not an HTTP request/body oracle.
 * GET replaces the action query with encoded controls; POST retains it.
 * Fragments are not network destinations. Only a form-typed commit may spend
 * this match, never a URL-equivalent link/location navigation.
 */
export function formDestinationMatches(intent: FormIntent, destination: string): boolean {
  if (!isHttpFormIntent(intent)) return false;
  try {
    const expected = new URL(intent[0]);
    const actual = new URL(destination);
    expected.hash = actual.hash = "";
    if (intent[1] === "get") expected.search = actual.search = "";
    return expected.href === actual.href;
  } catch { return false; }
}

export interface FormNavigationEntry {
  attemptId: string;
  sourceFrameId: number;
  sourceDocumentId: string;
  get: boolean;
  top: boolean;
  issuedAt: number;
  expiresAt: number;
  phase: "a" | "s" | "p";
  /** Trusted submit event observed in the originating child document. */
  sourceSubmitted?: boolean;
  /** First onBeforeNavigate consumes the armed state, including on mismatch. */
  startedUrl?: string;
  startedAt?: number;
}
