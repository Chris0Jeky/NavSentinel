/**
 * corpus_scoring.ts — protected-vs-fired classification for the phishing-corpus lane (#417).
 *
 * The pre-corpus-v2 harness collapsed every NavSentinel signal into a single
 * `detected` boolean, which conflated a *pre-interaction block/prompt* (the user
 * was actually protected) with a *post-render rollback* (the phishing page had
 * already rendered and could have harvested credentials before the rollback
 * fired). Per #417 the corpus TP number should mean "the user was protected",
 * so this module scores those two cases separately.
 *
 * Pure + dependency-free: unit-tested under Vitest (`tests/corpus/corpus_scoring.test.ts`)
 * and imported by the Playwright lane (`tests/e2e/corpus-validation.spec.ts`).
 */

export type ProtectionLevel = "protected" | "fired" | "miss";

/**
 * Signals that intervene BEFORE the phishing page can harm the user — a block or
 * prompt at click-time or credential-submit/paste-time. If one of these fires,
 * the user got a real, pre-harm intervention.
 */
export const PROTECTED_EVENT_KINDS: ReadonlySet<string> = new Set([
  "nav_blank_prompt", // prompted on a blank-anchor navigation before proceeding
  "nav_click_block", // blocked the navigation at click time
  "cred_submit_prompt", // blocked/prompted a credential submission
  "cred_paste_warn", // warned before a password paste into an untrusted form
]);

/**
 * Signals that fire only AFTER the navigation/render already happened — weaker
 * protection, because the phishing page may have rendered (and could have
 * harvested credentials) before the rollback fired.
 */
export const FIRED_LATE_EVENT_KINDS: ReadonlySet<string> = new Set([
  "nav_rollback", // navigation committed, then rolled back post-render
]);

export interface CorpusSignals {
  /** NavSentinel event-log `kind` values observed on the page. */
  detectionKinds?: readonly string[];
  /** The credential modal was shown (a pre-submit block → protected). */
  hadCredentialModal?: boolean;
  /** A risk toast/prompt requiring user action was shown (→ protected). */
  hadToastPrompt?: boolean;
}

export interface CorpusOutcome {
  level: ProtectionLevel;
  /** The distinct protected-class signals that fired (may be empty). */
  protectedBy: string[];
  /** The distinct fired-late signals that fired (may be empty). */
  firedBy: string[];
}

const unique = (xs: string[]): string[] => [...new Set(xs)];

/**
 * Classify a corpus page's outcome:
 *  - `protected` — a pre-harm block/prompt fired (or the credential modal / a
 *    risk toast was shown);
 *  - `fired` — only a post-render signal (e.g. `nav_rollback`) fired: the event
 *    fired but the protection is weak/late;
 *  - `miss` — nothing fired.
 *
 * Precedence is protected > fired > miss, so a page that both prompts a
 * credential submit *and* rolls a redirect back counts as `protected`. Unknown
 * event kinds are ignored (contribute to neither class).
 */
export function classifyCorpusOutcome(signals: CorpusSignals): CorpusOutcome {
  const kinds = signals.detectionKinds ?? [];

  const protectedBy = kinds.filter((k) => PROTECTED_EVENT_KINDS.has(k));
  if (signals.hadCredentialModal) protectedBy.push("credential_modal");
  if (signals.hadToastPrompt) protectedBy.push("toast_prompt");

  const firedBy = kinds.filter((k) => FIRED_LATE_EVENT_KINDS.has(k));

  let level: ProtectionLevel;
  if (protectedBy.length > 0) level = "protected";
  else if (firedBy.length > 0) level = "fired";
  else level = "miss";

  return { level, protectedBy: unique(protectedBy), firedBy: unique(firedBy) };
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
