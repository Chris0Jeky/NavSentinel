/**
 * Every reason code the product can store on an event-log entry has readable
 * Protection Center text (#867).
 *
 * The stored vocabulary is read from the producers' source, so adding a code to
 * any producer without journal text fails here. The producer inventory pins every
 * `reasons:` expression in the modules that write the event log, so a NEW
 * producer (or a new expression in an existing one) fails until its vocabulary is
 * registered below and explained.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  explainJournalReason,
  isJournalReasonCode,
  JOURNAL_ONLY_REASON_CODES,
} from "../extension/src/evidence/evidence_reasons";
import {
  createEvidenceExport,
  projectEvidence,
} from "../extension/src/evidence/evidence_model";
import { computeCredentialRisk } from "../extension/src/shared/domain";
import { isKnownReasonCode } from "../extension/src/shared/explanations";
import type {
  CredentialSettings,
  EventLogEntry,
} from "../extension/src/shared/storage";

const CREDENTIAL_CONFIG: CredentialSettings = {
  mode: "smart",
  promptOnUntrustedDomain: true,
  promptOnMediumRisk: true,
  mediumRiskThreshold: 40,
  blockHttpPasswordSubmit: true,
  warnOnPaste: true,
  similarity: { enabled: true, maxDistance: 2 },
};

const SRC = resolve(__dirname, "..", "extension", "src");
const read = (file: string): string => readFileSync(join(SRC, file), "utf8");
const captures = (text: string, pattern: RegExp): string[] =>
  [...text.matchAll(pattern)].map((match) => match[1]!);
function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  expect(from, `source marker ${start}`).toBeGreaterThan(-1);
  const to = text.indexOf(end, from);
  expect(to, `source end marker after ${start}`).toBeGreaterThan(from);
  return text.slice(from, to);
}

const CDS = captures(read("shared/scoring.ts"), /reasons\.push\("([^"]+)"\)/g);
const NRS = captures(read("shared/nrs.ts"), /nrsFactors\.push\("([^"]+)"\)/g);

/** Every code each producer can write into EventLogEntry.reasons. */
const VOCABULARY = {
  // nav_click_block, nav_silent_allow and nav_blank_prompt store computeNRS reasonCodes.
  navigation: [...CDS, ...NRS],
  clickfix: captures(
    read("content/clickfix_detector.ts"),
    /reasons\.push\("([^"]+)"\)/g,
  ),
  mutation: captures(
    between(
      read("content/mutation_monitor.ts"),
      "export type MutationAlertType =",
      ";",
    ),
    /"([^"]+)"/g,
  ),
  // The bridge fallback "unknown" is deliberately unexplained: it is not a finding.
  pushstate: captures(
    between(
      read("content/main_guard.ts"),
      "function checkPushStateSuspicious(",
      "\n}\n",
    ),
    /"([a-z]+(?:_[a-z]+)+)"/g,
  ),
  credential: [
    ...captures(read("shared/domain.ts"), /\bcode: "([A-Z0-9_]+)"/g),
    ...captures(
      read("content/credential_guard.ts"),
      /"([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)"/g,
    ),
  ],
} as const;

/** Modules that import appendEvent, with every `reasons:` expression they contain. */
const EVENT_WRITERS = (function collect(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collect(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
})(SRC).filter((path) =>
  /import\s*\{[^}]*\bappendEvent\b[^}]*\}\s*from\s*"[^"]*shared\/storage"/.test(
    readFileSync(path, "utf8"),
  ),
);

function reasonExpressions(): Array<{ file: string; expression: string }> {
  return EVENT_WRITERS.flatMap((path) => {
    const file = relative(SRC, path).replaceAll("\\", "/");
    return captures(readFileSync(path, "utf8"), /\breasons: ([^\n]+)/g)
      .map((raw) =>
        raw
          .replace(/ \} : \{\}\),?$/, "")
          .replace(/,$/, "")
          .trim(),
      )
      .filter((expression) => !expression.startsWith("string[]"))
      .map((expression) => ({ file, expression }));
  });
}

/**
 * Where each stored `reasons:` expression draws its codes from. `null` marks an
 * expression that does not write the event log (and so is not journaled).
 * Literal arrays (`["code"]`) are checked directly.
 */
const EXPRESSION_SOURCES: Record<string, keyof typeof VOCABULARY | null> = {
  reasonCodes: "navigation",
  "params.reasonCodes": "navigation",
  "outcomeFeatures.reasons": "navigation",
  "result.reasons": "clickfix",
  "[alert.type]": "mutation",
  '[typeof data.reason === "string" ? data.reason : "unknown"]': "pushstate",
  "risk.reasons.map((r) => r.code)": "credential",
  // Credential modal display lines, never persisted.
  "getCredentialReasonLines(risk.reasons)": null,
  // Prompt-outcome records (a separate store), not the event log.
  credReasons: null,
};

const literalCodes = (): string[] =>
  reasonExpressions().flatMap(({ expression }) => {
    const literal = /^\["([^"]+)"\]$/.exec(expression);
    return literal ? [literal[1]!] : [];
  });

const storedCodes = (): string[] => [
  ...new Set([...Object.values(VOCABULARY).flat(), ...literalCodes()]),
];

describe("stored reason vocabulary (#867)", () => {
  it("reads every producer from source (guards against pattern rot)", () => {
    expect(VOCABULARY.navigation).toEqual(
      expect.arrayContaining([
        "no_accessible_name",
        "near_invisible_opacity",
        "nrs_new_tab_window",
        "nrs_js_behavior_suspicious",
      ]),
    );
    expect(VOCABULARY.clickfix).toEqual(
      expect.arrayContaining([
        "clipboard_command_with_overlay",
        "legit_captcha_present",
      ]),
    );
    expect(VOCABULARY.mutation).toEqual([
      "overlay_detected",
      "overlay_injected",
      "form_action_changed",
      "form_method_changed",
      "password_injected",
      "suspicious_iframe",
    ]);
    expect(VOCABULARY.pushstate).toEqual([
      "rapid_pushstate",
      "domain_like_path_after_gesture",
    ]);
    expect(VOCABULARY.credential).toEqual(
      expect.arrayContaining([
        "NON_HTTPS_PAGE",
        "IP_HOST",
        "UNTRUSTED_DOMAIN",
        "CONTENT_FP",
        "SRI_MISSING_ON_CREDENTIAL_PAGE",
      ]),
    );
    expect(literalCodes()).toEqual(
      expect.arrayContaining([
        "overlay_cleanup_setting_off",
        "overlay_cleanup_undo",
        "late_async_child_frame",
        "nrs_double_click_hijack",
      ]),
    );
    expect(
      EVENT_WRITERS.map((path) =>
        relative(SRC, path).replaceAll("\\", "/"),
      ).sort(),
    ).toEqual(
      expect.arrayContaining([
        "content/capture_isolated.ts",
        "content/credential_guard.ts",
        "content/pending_navigation_decision.ts",
      ]),
    );
  });

  it("registers every reasons expression in modules that write the event log", () => {
    const unregistered = reasonExpressions().filter(
      ({ expression }) =>
        !/^\["[^"]+"\]$/.test(expression) &&
        !Object.hasOwn(EXPRESSION_SOURCES, expression),
    );
    expect(
      unregistered,
      "register the new producer's vocabulary in this test and give its codes journal text",
    ).toEqual([]);
  });

  it("gives every stored code a short, plain-language explanation", () => {
    const missing = storedCodes().filter((code) => !isJournalReasonCode(code));
    expect(
      missing,
      "add journal text in evidence_reasons.ts (or a toast text in explanations.ts)",
    ).toEqual([]);
    for (const code of storedCodes()) {
      const text = explainJournalReason(code);
      expect(text, code).not.toBe(code);
      expect(text, code).toMatch(/^[A-Z][^<>]* [^<>]*[^.]$/);
      expect(text.length, code).toBeLessThanOrEqual(80);
    }
  });

  it("keeps journal-only text disjoint from the portable registry and free of dead entries", () => {
    const stored = new Set(storedCodes());
    for (const code of JOURNAL_ONLY_REASON_CODES) {
      expect(isKnownReasonCode(code), `${code} already has portable text`).toBe(
        false,
      );
      expect(
        stored.has(code),
        `${code} is not produced by any event writer`,
      ).toBe(true);
    }
  });

  it("explains the codes a real credential risk evaluation stores", () => {
    const cases = [
      {
        pageUrl: "http://user@192.168.0.10/login",
        actionUrl: "http://collector.example/submit",
      },
      {
        pageUrl: "https://paypa1.com/signin",
        actionUrl: "https://paypa1.com/signin",
      },
      {
        pageUrl: "https://paypal.account.verify.example.com/login",
        actionUrl: "https://paypal.com/login",
      },
      {
        pageUrl: "https://xn--pypal-4ve.com/login",
        actionUrl: "https://xn--pypal-4ve.com/login",
      },
    ];
    const codes = new Set<string>();
    for (const input of cases) {
      const risk = computeCredentialRisk({
        ...input,
        trustedDomains: ["paypal.com"],
        config: CREDENTIAL_CONFIG,
      });
      for (const reason of risk.reasons) codes.add(reason.code);
    }
    expect(codes.size).toBeGreaterThanOrEqual(8);
    expect([...codes].filter((code) => !isJournalReasonCode(code))).toEqual([]);
  });
});

describe("journal display versus portable export (#867)", () => {
  const entry = (reasons: string[]): EventLogEntry => ({
    id: "private-id",
    ts: 1_700_000_000_000,
    kind: "cred_submit_prompt",
    site: "source.test",
    destHost: "target.test",
    score: 90,
    reasons,
  });

  it("shows credential codes in the journal but exports only the portable registry", () => {
    const [row] = projectEvidence([
      entry([
        "NON_HTTPS_PAGE",
        "IP_HOST",
        "CONTENT_FP",
        "CONTENT_FP",
        "no_accessible_name",
      ]),
    ]);
    expect(row?.reasons).toEqual([
      "NON_HTTPS_PAGE",
      "IP_HOST",
      "CONTENT_FP",
      "no_accessible_name",
    ]);
    expect(
      createEvidenceExport([row!], new Date(0)).events[0]?.reasons,
    ).toEqual(["no_accessible_name"]);
  });

  it("never echoes unknown, legacy or markup-shaped codes", () => {
    const hostile = [
      "<img src=x onerror=alert(1)>",
      "__proto__",
      "constructor",
      "toString",
      "raw_legacy_code",
      "",
    ];
    expect(projectEvidence([entry(hostile)])[0]?.reasons).toEqual([]);
    for (const code of hostile) {
      expect(isJournalReasonCode(code)).toBe(false);
      expect(explainJournalReason(code)).toBe(
        "A signal without a readable description was recorded",
      );
    }
  });
});
