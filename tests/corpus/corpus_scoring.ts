/**
 * corpus_scoring.ts — protected-vs-fired classification for the phishing-corpus lane (#417).
 *
 * The pre-corpus-v2 harness collapsed every NavSentinel signal into a single
 * `detected` boolean, which conflated a *pre-interaction block/prompt* (the user
 * was actually protected) with a *post-render* signal (the phishing page had
 * already rendered and could have harvested credentials before the signal
 * fired). Per #417 the corpus TP number should mean "the user was protected",
 * so this module scores those two cases separately.
 *
 * IMPORTANT (why a bare toast is NOT "protected"): several NavSentinel toasts
 * fire *after* the page renders — the `nav_rollback` rollback toast, the
 * reputation late-warn, and the mutation/overlay warning. A toast on its own is
 * therefore a post-render (weak) signal, so it counts toward `fired`, never
 * `protected`. The genuine pre-harm interventions are captured by their own
 * event kinds (nav_blank_prompt / nav_click_block / cred_submit_prompt /
 * cred_paste_warn) and by the credential modal (the pre-submit interceptor UI).
 *
 * Pure + dependency-free: unit-tested under Vitest (`tests/corpus/corpus_scoring.test.ts`)
 * and imported by the Playwright lane (`tests/e2e/corpus-validation.spec.ts`).
 */

export type ProtectionLevel = "protected" | "fired" | "miss";

/**
 * Event kinds that intervene BEFORE the phishing page can harm the user — a
 * block or prompt at click-time or credential-submit/paste-time. If one of
 * these fires, the user got a real, pre-harm intervention.
 */
export const PROTECTED_EVENT_KINDS: ReadonlySet<string> = new Set([
  "nav_blank_prompt", // prompted on a blank-anchor navigation before proceeding
  "nav_click_block", // blocked the navigation at click time
  "cred_submit_prompt", // blocked/prompted a credential submission
  "cred_paste_warn", // warned before a password paste into an untrusted form
]);

/**
 * Event kinds that fire only AFTER the navigation/render already happened —
 * weaker protection, because the phishing page may have rendered (and could
 * have harvested credentials) before the signal fired.
 */
export const FIRED_LATE_EVENT_KINDS: ReadonlySet<string> = new Set([
  "nav_rollback", // navigation committed, then rolled back post-render
]);

/**
 * The union of the two sets — the event kinds that count as *any* detection on a
 * phishing page. Exported as the single source of truth so the Playwright lane's
 * event-log filter cannot silently drift from the classifier (a kind in one but
 * not the other would be mis-bucketed).
 */
export const DETECTION_EVENT_KINDS: ReadonlySet<string> = new Set([
  ...PROTECTED_EVENT_KINDS,
  ...FIRED_LATE_EVENT_KINDS,
]);

export interface CorpusSignals {
  /** NavSentinel event-log `kind` values observed on the page. */
  detectionKinds?: readonly string[];
  /** The credential modal was shown (the pre-submit interceptor → protected). */
  hadCredentialModal?: boolean;
  /**
   * A risk toast was shown. Treated as a post-render / late signal (→ `fired`),
   * NOT as protection: in this lane a bare toast without a pre-harm event kind
   * comes from the rollback toast, the reputation late-warn, or a mutation
   * overlay — all after the page rendered.
   */
  hadToast?: boolean;
}

export interface CorpusOutcome {
  level: ProtectionLevel;
  /** The distinct protected-class signals that fired (may be empty). */
  protectedBy: string[];
  /** The distinct fired-late signals that fired (may be empty). */
  firedBy: string[];
}

/**
 * Classify a corpus page's outcome:
 *  - `protected` — a pre-harm block/prompt fired (a PROTECTED_EVENT_KINDS event
 *    or the credential modal);
 *  - `fired` — only post-render signals fired (`nav_rollback` and/or a bare
 *    toast): the signal fired but the protection is weak/late;
 *  - `miss` — nothing fired.
 *
 * Precedence is protected > fired > miss, so a page that both prompts a
 * credential submit *and* rolls a redirect back counts as `protected`, while a
 * page whose only signals are a rollback and its own toast stays `fired`.
 * Unknown event kinds are ignored (contribute to neither class).
 */
export function classifyCorpusOutcome(signals: CorpusSignals): CorpusOutcome {
  // Dedupe the observed kinds up front; `credential_modal` / `toast` are not
  // event kinds, so pushing them once cannot introduce duplicates.
  const kinds = new Set(signals.detectionKinds ?? []);

  const protectedBy = [...kinds].filter((k) => PROTECTED_EVENT_KINDS.has(k));
  if (signals.hadCredentialModal) protectedBy.push("credential_modal");

  const firedBy = [...kinds].filter((k) => FIRED_LATE_EVENT_KINDS.has(k));
  if (signals.hadToast) firedBy.push("toast");

  let level: ProtectionLevel;
  if (protectedBy.length > 0) level = "protected";
  else if (firedBy.length > 0) level = "fired";
  else level = "miss";

  return { level, protectedBy, firedBy };
}

/** Aggregate counts for a corpus run's summary (protected vs merely-fired vs miss). */
export interface CorpusTotals {
  protected: number;
  fired: number;
  miss: number;
  total: number;
}

/** Tally a set of per-page outcomes into run-level totals. */
export function tallyCorpusOutcomes(outcomes: readonly CorpusOutcome[]): CorpusTotals {
  const totals: CorpusTotals = { protected: 0, fired: 0, miss: 0, total: outcomes.length };
  for (const o of outcomes) totals[o.level] += 1;
  return totals;
}
