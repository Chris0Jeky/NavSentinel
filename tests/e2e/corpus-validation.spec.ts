import { test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyCorpusOutcome,
  DETECTION_EVENT_KINDS,
  PROTECTED_EVENT_KINDS,
  tallyCorpusOutcomes,
  type ProtectionLevel,
} from "../corpus/corpus_scoring";
import { loadValidatedCorpusManifest } from "../../scripts/corpus-manifest.mjs";
import {
  CorpusReplayHarness,
  CorpusReplayInvalid,
  CORPUS_RECEIPT_SETTLE_MS,
  exerciseFirstEligibleControl,
  type NativeExerciseResult,
} from "./corpus_replay_harness";
import { getServiceWorker } from "./extension_test_utils";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(__dirname, "..", "..", "extension", "dist");
const corpusDir = path.resolve(__dirname, "..", "corpus");
const manifestPath = path.join(corpusDir, "manifest.json");
const snapshotsDir = path.join(corpusDir, "snapshots");
const resultsPath = path.join(corpusDir, "validation-results.json");
const EVENT_LOG_KEY = "sentinelsuite:event_log_v1";

type DetectionEvent = {
  kind: string;
  score?: number;
};

type CorpusSignals = {
  detectionKinds: string[];
  hadCredentialModal: boolean;
  hadToast: boolean;
  events: DetectionEvent[];
};

type PageResult = {
  filename: string;
  url: string;
  source: string;
  interaction: NativeExerciseResult["kind"];
  getQueryPathBound: boolean;
  detected: boolean;
  protection: ProtectionLevel;
  protectedBy: string[];
  firedBy: string[];
  harmReached: boolean;
  notExercisable: boolean;
  events: DetectionEvent[];
};

type ResultsWriteInput = {
  valid: boolean;
  failureCode: string | null;
  manifestEntries: number | null;
  expectedReplayEntries: number | null;
  results: PageResult[];
  deniedProxyAttempts: number;
};

function stableFailureCode(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[a-z0-9_]+$/u.test(error.code)
  ) {
    return error.code;
  }
  if (error instanceof Error) {
    const match = /^TEST_INVALID:([a-z0-9_]+)$/u.exec(error.message);
    if (match?.[1]) return match[1];
  }
  return "runner_failure";
}

function writeResults(input: ResultsWriteInput): void {
  const complete =
    input.valid &&
    input.expectedReplayEntries !== null &&
    input.results.length === input.expectedReplayEntries;
  const actionable = input.results.filter((entry) => !entry.notExercisable);
  const notExercisable = input.results.length - actionable.length;
  const totals = complete
    ? tallyCorpusOutcomes(
        input.results.map((entry) => ({
          level: entry.protection,
          protectedBy: entry.protectedBy,
          firedBy: entry.firedBy,
        })),
      )
    : null;
  const protectedActionable = complete
    ? actionable.filter((entry) => entry.protection === "protected").length
    : null;
  const harmReached = complete
    ? actionable.filter((entry) => entry.harmReached).length
    : null;

  const receipt = {
    schema_version: "2.0.0",
    runDate: new Date().toISOString(),
    valid: complete,
    outcome: complete ? "OBSERVED" : "TEST_INVALID",
    failureCode: complete ? null : input.failureCode ?? "incomplete_denominator",
    methodology: {
      sourceReplay: "digest-validated bytes at the exact canonical recorded URL",
      snapshotJavaScript: "blocked; dynamic-form replay is not implemented",
      nativeInput: "Playwright locator fill/click with independent trusted-event probes",
      harmOracle: "one-use source-bound in-memory first-hop navigation receipt",
      postReceiptSettleMs: CORPUS_RECEIPT_SETTLE_MS,
      getFormReceipt: "exact action origin/path; browser-generated query is not asserted",
      egress: "context deny-by-default route plus empty-allowlist proxy",
    },
    denominator: {
      complete,
      manifestEntries: input.manifestEntries,
      expectedReplayEntries: input.expectedReplayEntries,
      observedEntries: input.results.length,
      actionable: complete ? actionable.length : null,
      notExercisable: complete ? notExercisable : null,
    },
    totals,
    rates:
      complete && totals && protectedActionable !== null && harmReached !== null
        ? {
            protectedPerReplayEntry:
              input.results.length > 0
                ? totals.protected / input.results.length
                : null,
            protectedPerActionableEntry:
              actionable.length > 0
                ? protectedActionable / actionable.length
                : null,
            harmReachedPerActionableEntry:
              actionable.length > 0 ? harmReached / actionable.length : null,
          }
        : null,
    deniedProxyAttempts: input.deniedProxyAttempts,
    entries: input.results,
  };

  fs.writeFileSync(resultsPath, JSON.stringify(receipt, null, 2), "utf8");
}

async function clearEventLog(harness: CorpusReplayHarness): Promise<void> {
  try {
    const worker = await getServiceWorker(harness.context);
    await worker.evaluate(async (key) => {
      await chrome.storage.local.set({ [key]: [] });
    }, EVENT_LOG_KEY);
  } catch {
    throw new CorpusReplayInvalid("event_log_reset_failed");
  }
}

async function readSignals(
  harness: CorpusReplayHarness,
  page: Page,
): Promise<CorpusSignals> {
  try {
    const worker = await getServiceWorker(harness.context);
    const storedEvents = (await worker.evaluate(async (key) => {
      const stored = await chrome.storage.local.get(key);
      return Array.isArray(stored[key]) ? stored[key] : [];
    }, EVENT_LOG_KEY)) as Array<{
      kind?: unknown;
      score?: unknown;
      extra?: { error?: unknown };
    }>;
    const events = storedEvents
      .filter(
        (entry): entry is { kind: string; score?: number; extra?: { error?: unknown } } =>
          typeof entry.kind === "string" &&
          DETECTION_EVENT_KINDS.has(entry.kind) &&
          !(entry.kind === "cred_submit_prompt" && entry.extra?.error),
      )
      .map((entry) => ({
        kind: entry.kind,
        ...(typeof entry.score === "number" ? { score: entry.score } : {}),
      }));
    const ui = await page.evaluate(() => {
      const modalHost = document.querySelector(
        "#__sentinelsuite_cred_modal_host__",
      );
      const modalVisible = Boolean(
        modalHost?.shadowRoot?.querySelector(".overlay"),
      );
      const toastHost = document.querySelector("#__navsentinel_toast_host");
      const toastText = toastHost?.shadowRoot
        ?.querySelector(".body")
        ?.textContent?.trim();
      return {
        hadCredentialModal: modalVisible,
        hadToast: Boolean(toastText),
      };
    });

    return {
      detectionKinds: events.map((entry) => entry.kind),
      hadCredentialModal: ui.hadCredentialModal,
      hadToast: ui.hadToast,
      events,
    };
  } catch (error) {
    if (error instanceof CorpusReplayInvalid) throw error;
    throw new CorpusReplayInvalid("signal_read_failed");
  }
}

async function hasPreHarmSignal(
  harness: CorpusReplayHarness,
  page: Page,
): Promise<boolean> {
  const signals = await readSignals(harness, page);
  return (
    signals.hadCredentialModal ||
    signals.detectionKinds.some((kind) => PROTECTED_EVENT_KINDS.has(kind))
  );
}

test("Phishing corpus validation @corpus", async () => {
  test.skip(
    !fs.existsSync(extensionPath),
    "Build the extension before running corpus tests.",
  );

  const results: PageResult[] = [];
  let manifestEntries: number | null = null;
  let expectedReplayEntries: number | null = null;
  let harness: CorpusReplayHarness | null = null;
  let failure: CorpusReplayInvalid | null = null;
  let deniedProxyAttempts = 0;

  try {
    const loaded = loadValidatedCorpusManifest({ manifestPath, snapshotsDir });
    manifestEntries = loaded.manifest.entries.length;
    expectedReplayEntries = loaded.entries.length;
    test.setTimeout(loaded.entries.length * 35_000 + 60_000);

    harness = await CorpusReplayHarness.start(extensionPath);
    await getServiceWorker(harness.context);

    for (const entry of loaded.entries) {
      await clearEventLog(harness);
      const page = await harness.open({ url: entry.url, bytes: entry.bytes });
      let pageCleanupFailed = false;
      try {
        const exercise = await exerciseFirstEligibleControl(harness, page);
        let harmReached = false;
        if (exercise.kind === "none") {
          await page.waitForTimeout(500);
        } else {
          harmReached = await harness.awaitTerminal(
            exercise.receiptBefore,
            () => hasPreHarmSignal(harness!, page),
          );
        }

        const signals = await readSignals(harness, page);
        const outcome = classifyCorpusOutcome({
          detectionKinds: signals.detectionKinds,
          hadCredentialModal: signals.hadCredentialModal,
          hadToast: signals.hadToast,
          harmReached,
        });
        if (
          exercise.kind !== "none" &&
          !harmReached &&
          outcome.level !== "protected"
        ) {
          throw new CorpusReplayInvalid("terminal_state_lost");
        }

        results.push({
          filename: entry.filename,
          url: entry.url,
          source: entry.source,
          interaction: exercise.kind,
          getQueryPathBound: exercise.getQueryPathBound,
          detected: outcome.level !== "miss",
          protection: outcome.level,
          protectedBy: outcome.protectedBy,
          firedBy: outcome.firedBy,
          harmReached,
          notExercisable: exercise.kind === "none",
          events: signals.events,
        });
        harness.throwIfInvalid();
      } finally {
        try {
          await page.close();
        } catch {
          pageCleanupFailed = true;
        }
      }
      if (pageCleanupFailed) {
        throw new CorpusReplayInvalid("page_cleanup_failure");
      }
    }

    if (results.length !== loaded.entries.length) {
      throw new CorpusReplayInvalid("incomplete_denominator");
    }
    const actionable = results.filter((entry) => !entry.notExercisable);
    if (
      actionable.some(
        (entry) => entry.protection !== "protected" && !entry.harmReached,
      )
    ) {
      throw new CorpusReplayInvalid("terminal_state_incomplete");
    }
    harness.throwIfInvalid();
  } catch (error) {
    failure =
      error instanceof CorpusReplayInvalid
        ? error
        : new CorpusReplayInvalid(stableFailureCode(error));
  } finally {
    if (harness) {
      deniedProxyAttempts = harness.egressAttempts.reduce(
        (sum, attempt) => sum + attempt.count,
        0,
      );
      try {
        await harness.close();
      } catch {
        failure ??= new CorpusReplayInvalid("runner_cleanup_failure");
      }
    }
  }

  writeResults({
    valid: failure === null,
    failureCode: failure?.code ?? null,
    manifestEntries,
    expectedReplayEntries,
    results,
    deniedProxyAttempts,
  });
  if (failure) throw failure;
});
