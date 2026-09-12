/** Metadata only: never serialize form controls, values, or request bodies. */
export interface FormIntent {
  actionUrl: string;
  method: "get" | "post" | "dialog";
  enctype: "application/x-www-form-urlencoded" | "multipart/form-data" | "text/plain";
  target: string;
  targetScope: "self" | "top" | "other";
}

export const FORM_INTENT_TTL_MS = 1500;
export const FORM_COMMIT_TTL_MS = 10000;
export const FORM_INTENT_MAX_URL = 8192;

export function sameFormIntent(a: FormIntent, b: FormIntent): boolean {
  return a.actionUrl === b.actionUrl && a.method === b.method &&
    a.enctype === b.enctype && a.target === b.target && a.targetScope === b.targetScope;
}

/** Strict, bounded bridge/session schema. No coercion or unknown-field authority. */
export function isFormIntent(value: unknown): value is FormIntent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== 5 || !["actionUrl", "method", "enctype", "target", "targetScope"].every(key => Object.hasOwn(v, key)) || typeof v.actionUrl !== "string" ||
      !v.actionUrl || v.actionUrl.length > FORM_INTENT_MAX_URL ||
      typeof v.target !== "string" || v.target.length > 1024 ||
      !["get", "post", "dialog"].includes(v.method as string) ||
      !["application/x-www-form-urlencoded", "multipart/form-data", "text/plain"].includes(v.enctype as string) ||
      !["self", "top", "other"].includes(v.targetScope as string)) return false;
  try { return new URL(v.actionUrl).href === v.actionUrl; } catch { return false; }
}

export function isHttpFormIntent(intent: FormIntent): boolean {
  return intent.method !== "dialog" && /^https?:\/\//.test(intent.actionUrl);
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
    const expected = new URL(intent.actionUrl);
    const actual = new URL(destination);
    expected.hash = actual.hash = "";
    if (intent.method === "get") expected.search = actual.search = "";
    return expected.href === actual.href;
  } catch { return false; }
}

export interface FormNavigationCapability {
  attemptId: string;
  sourceFrameId: number;
  sourceDocumentId: string;
  intent: FormIntent;
  /** First onBeforeNavigate consumed the armed state, including on mismatch. */
  startedUrl?: string;
}

export function isFormNavigationCapability(value: unknown): value is FormNavigationCapability {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return typeof v.attemptId === "string" && /^[a-f0-9]{32}$/.test(v.attemptId) &&
    Number.isSafeInteger(v.sourceFrameId) && (v.sourceFrameId as number) > 0 &&
    typeof v.sourceDocumentId === "string" && v.sourceDocumentId.length > 0 && v.sourceDocumentId.length <= 128 &&
    isFormIntent(v.intent) && isHttpFormIntent(v.intent) &&
    (v.startedUrl === undefined || (typeof v.startedUrl === "string" && v.startedUrl.length <= FORM_INTENT_MAX_URL));
}

export function formCapabilityAllowsCommit(
  form: FormNavigationCapability,
  url: string,
  transitionType: string,
  qualifiers: readonly string[],
): boolean {
  if (form.intent.targetScope !== "top" || transitionType !== "form_submit" ||
      !form.startedUrl || !formDestinationMatches(form.intent, form.startedUrl)) return false;
  if (qualifiers.includes("forward_back") || qualifiers.includes("client_redirect")) return false;
  return formDestinationMatches(form.intent, url) || qualifiers.includes("server_redirect");
}

export interface FormNavigationEntry extends FormNavigationCapability {
  issuedAt: number;
  expiresAt: number;
  phase: "armed" | "started" | "spent";
  startedAt?: number;
}

export function isFormNavigationEntry(value: unknown): value is FormNavigationEntry {
  if (!isFormNavigationCapability(value)) return false;
  const v = value as FormNavigationEntry;
  return Number.isFinite(v.issuedAt) && Number.isFinite(v.expiresAt) &&
    v.expiresAt === v.issuedAt + FORM_INTENT_TTL_MS && ["armed", "started", "spent"].includes(v.phase) &&
    (v.phase !== "started" || (typeof v.startedAt === "number" && Number.isFinite(v.startedAt) && v.startedAt >= v.issuedAt && v.startedAt < v.expiresAt));
}

/** A timely start gets a bounded response window, not a renewed click grant. */
export function formNavigationDeadline(entry: FormNavigationEntry): number {
  return entry.phase === "started" && entry.startedAt !== undefined ? entry.startedAt + FORM_COMMIT_TTL_MS : entry.expiresAt;
}

/** First navigation start spends the arm, whether or not its destination matches. */
export function startFormNavigation(entry: FormNavigationEntry, url: string, now: number): void {
  if (entry.phase !== "armed" || now < entry.issuedAt || now >= entry.expiresAt || !formDestinationMatches(entry.intent, url)) {
    entry.phase = "spent";
    delete entry.startedUrl;
    delete entry.startedAt;
    return;
  }
  entry.phase = "started";
  entry.startedUrl = url;
  entry.startedAt = now;
}

export function consumeFormNavigation(entry: FormNavigationEntry, url: string, transition: string, qualifiers: readonly string[], now: number): boolean {
  const allowed = entry.phase === "started" && now < formNavigationDeadline(entry) &&
    formCapabilityAllowsCommit(entry, url, transition, qualifiers);
  entry.phase = "spent";
  delete entry.startedUrl;
  delete entry.startedAt;
  return allowed;
}
