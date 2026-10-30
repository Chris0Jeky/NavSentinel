/** Structured diagnostics; existing Playwright assertions still decide row 8. */
import type { ClipboardQueueEvidence, ObserverMarker } from "./clipboard-pressure-observed-bundle";

export const PRESSURE_OUTCOMES_TITLE = "clipboard-pressure structured outcomes/v1";
export type PhaseId = "benign" | "attack-warning" | "attack-log" | "console";
export const PRESSURE_CHECKS: Record<PhaseId, readonly string[]> = {
  benign: ["benign.no-warning", "benign.no-clickfix", "benign.no-overflow"],
  "attack-warning": ["attack.warning"],
  "attack-log": ["attack.clickfix", "attack.no-overflow", "stored.private", "options.populated", "options.clickfix", "rendered.private"],
  console: ["console.clean"],
};
export const REGRESSED_MISMATCHES = ["benign.no-overflow", "attack.warning", "attack.clickfix", "attack.no-overflow", "options.clickfix"];
export type PhaseRecord = {
  id: PhaseId;
  documentToken: string | null;
  complete: boolean;
  readCount: number;
  readErrors: number;
  observations: Record<string, unknown>;
  checks: Array<{ id: string; status: "passed" | "mismatch" | "error" }>;
};
export type PressureAttempt = {
  attempt: number;
  documentToken: string;
  baseline: { clickfix: number; overflow: number };
  check: { state: string; attempted: number; resolved: number; refused: number; beforeReady: number; queueEvidence: ClipboardQueueEvidence | null };
};
export type PressureOutcomes = {
  schema: "navsentinel-clipboard-pressure-outcomes/v1";
  pairId: string | null;
  variant: string | null;
  testId: string;
  config: { workers: number; retries: number; retry: number; timeout: number; pressureAttempts: number; timingSamples: number };
  observer: ObserverMarker;
  timingSampleCount: number;
  toastReadErrors: number;
  arms: { benign: PressureAttempt[]; attack: PressureAttempt[] };
  phases: PhaseRecord[];
};

/** Continue independent assertions, but rethrow the first failure at the group boundary. */
export class PressurePhase {
  readonly record: PhaseRecord;
  private readonly failures: unknown[] = [];

  constructor(outcomes: PressureOutcomes, id: PhaseId, documentToken: string | null) {
    this.record = { id, documentToken, complete: false, readCount: 0, readErrors: 0, observations: {}, checks: [] };
    outcomes.phases.push(this.record);
  }

  async read<T>(body: () => Promise<T>): Promise<T> {
    this.record.readCount++;
    try { return await body(); } catch (error) { this.record.readErrors++; throw error; }
  }

  async check(id: string, body: () => unknown | Promise<unknown>, matches: () => boolean, pollTimeoutMs?: number): Promise<void> {
    if (!PRESSURE_CHECKS[this.record.id].includes(id) || this.record.checks.some((check) => check.id === id)) {
      throw new Error(`TEST_INVALID: unexpected or duplicate pressure predicate ${id}`);
    }
    let thrown: unknown;
    let failed = false;
    let measurementError = false;
    try { await body(); } catch (error) { failed = true; thrown = error; }
    let matched = false;
    try { matched = matches(); } catch (error) { failed = true; measurementError = true; thrown = error; }
    // expect.poll wraps its final matcher mismatch in a plain Error. Accept only
    // its full local-timeout suffix, a measured mismatch, and zero read errors.
    // Test timeout/cancellation and callback errors cannot take this path.
    const matcherMismatch = thrown instanceof Error && "matcherResult" in thrown;
    const pollMismatch = pollTimeoutMs !== undefined && thrown instanceof Error &&
      thrown.message.endsWith(`Call Log:\n- Timeout ${pollTimeoutMs}ms exceeded while waiting on the predicate`);
    const status = !failed && matched ? "passed" : failed && !measurementError && !matched && this.record.readErrors === 0 &&
      (matcherMismatch || pollMismatch) ? "mismatch" : "error";
    this.record.checks.push({ id, status });
    if (status !== "passed") this.failures.push(thrown ?? new Error(`TEST_INVALID: predicate/measurement disagreement for ${id}`));
  }

  finish(): void {
    const expected = PRESSURE_CHECKS[this.record.id];
    if (this.record.checks.length !== expected.length || this.record.checks.some((check, index) => check.id !== expected[index])) {
      throw new Error(`TEST_INVALID: incomplete pressure phase ${this.record.id}`);
    }
    this.record.complete = true;
    if (this.failures.length) throw this.failures[0];
  }
}

export type PairExpectation = {
  head: string;
  productSourceTree: string;
  lastProductCommit: string;
  pairId: string;
  chrome: { executable: string; version: string; sha256: string };
};
/** Computed from the runner's independently reconstructed, one-asset #599 copy. */
export type PairRegressionIdentity = {
  patchedAsset: string;
  fixedAssetSha256: string;
  regressedAssetSha256: string;
  fixedSourceSha256: string;
  regressedSourceSha256: string;
};
export type PairCaseEvidence = {
  receipt: unknown;
  report: unknown;
  launches: unknown;
  process: { status: number | null; signal: string | null; error: string | null; startedAt: string; finishedAt: string };
  receiptPath: string;
  /** Reconstructed independently from the runner's source copy, before parsing assertions. */
  artifact: { marker: ObserverMarker; distSha256: string };
};

function invalid(detail: string): never { throw new Error(`QUALIFICATION_INVALID: ${detail}`); }
function requireEvidence(condition: unknown, detail: string): asserts condition { if (!condition) invalid(detail); }
function object(value: unknown, label: string): Record<string, unknown> {
  requireEvidence(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}
function array(value: unknown, label: string): unknown[] {
  requireEvidence(Array.isArray(value), `${label} must be an array`);
  return value;
}
function count(value: unknown, label: string): number {
  requireEvidence(typeof value === "number" && Number.isSafeInteger(value) && value >= 0, `${label} must be a nonnegative integer`);
  return value;
}
function same(actual: unknown, expected: unknown, label: string): void { requireEvidence(actual === expected, `${label} differs`); }
function fields(value: Record<string, unknown>, expected: string[], label: string): void {
  same(Object.keys(value).sort().join("|"), [...expected].sort().join("|"), `${label} fields`);
}
function canonical(value: unknown): string {
  const sorted = (input: unknown): unknown => Array.isArray(input) ? input.map(sorted) : input && typeof input === "object"
    ? Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, sorted(item)])) : input;
  return JSON.stringify(sorted(value));
}
function timestamp(value: unknown, label: string): number {
  requireEvidence(typeof value === "string" && Number.isFinite(Date.parse(value)), `${label} must be a timestamp`);
  return Date.parse(value);
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const HEX40 = /^[a-f0-9]{40}$/u;
const HEX64 = /^[a-f0-9]{64}$/u;

function observerWitness(value: unknown, artifactId: string, attack: boolean, regressed: boolean): void {
  const witness = object(value, "selected direct witness");
  fields(witness, ["schema", "artifactId", "verificationCount", "queuedAfterVerification", "drainCount", "drainsBeforeVerification", "firstVerification", "firstDrain"], "direct witness");
  same(witness.schema, "navsentinel-clipboard-queue-test/v2", "witness schema");
  same(witness.artifactId, artifactId, "selected artifact ID");
  same(witness.verificationCount, 1, "verification count");
  same(witness.queuedAfterVerification, 0, "late queue entries");
  same(witness.drainCount, 1, "drain count");
  same(witness.drainsBeforeVerification, 0, "pre-verification drains");
  const admitted = object(witness.firstVerification, "first verification");
  fields(admitted, ["clipboardEnqueueCalls", "commandLike", "other", "queueSize", "dropped", "coalesced"], "first verification");
  const drained = object(witness.firstDrain, "first drain");
  fields(drained, ["verificationCount", "total", "commandLike", "other", "dropped", "coalesced"], "first drain");
  for (const [key, number] of Object.entries(admitted)) count(number, `admitted ${key}`);
  for (const [key, number] of Object.entries(drained)) count(number, `drained ${key}`);
  same(admitted.clipboardEnqueueCalls, attack ? 41 : 40, "clipboard admission count");
  same(admitted.commandLike, attack ? 1 : 0, "command admission count");
  same(admitted.other, 40, "other admission count");
  same(drained.verificationCount, 1, "drain verification ordinal");
  same(drained.total, admitted.queueSize, "drain/verification queue size");
  same(drained.dropped, admitted.dropped, "drain/verification drops");
  same(drained.coalesced, admitted.coalesced, "drain/verification coalesces");
  requireEvidence(count(drained.total, "drain total") <= 32 && count(drained.total, "drain total") >=
    count(drained.commandLike, "drained command") + count(drained.other, "drained other"), "drained class totals are inconsistent");
  same(drained.commandLike, !regressed && attack ? 1 : 0, "actual retained command class");
  same(drained.other, regressed ? 32 : 1, "actual retained other class");
  same(drained.coalesced, regressed ? 0 : 39, "coalescing behavior");
  if (regressed) requireEvidence(count(drained.dropped, "regressed drops") > 0, "regression did not directly witness overflow");
  else same(drained.dropped, 0, "fixed-policy drops");
}

function validateCase(evidence: PairCaseEvidence, expected: PairExpectation, regressed: boolean, seenDocuments: Set<string>): void {
  const variant = regressed ? "regressed" : "fixed";
  const receipt = object(evidence.receipt, `${variant} receipt`);
  const report = object(evidence.report, `${variant} report`);
  same(evidence.process.status, regressed ? 1 : 0, `${variant} process exit`);
  same(evidence.process.signal, null, "process signal");
  same(evidence.process.error, null, "process setup error");
  const start = timestamp(evidence.process.startedAt, "process start");
  const finish = timestamp(evidence.process.finishedAt, "process finish");
  const receiptStart = timestamp(receipt.startedAt, "receipt start");
  const receiptFinish = timestamp(receipt.finishedAt, "receipt finish");
  requireEvidence(start <= receiptStart && receiptStart <= receiptFinish && receiptFinish <= finish, "receipt is stale or unfinished");
  same(receipt.schema, "navsentinel-acceptance-receipt/v1", "receipt schema");
  same(receipt.classification, "AUTOMATED_AGENT_EVIDENCE_NOT_OWNER_GATE3", "receipt classification");
  same(receipt.guide, "AI-47.8-former-AI-37-PR599-diagnostic-queue", "procedure identity");
  same(receipt.result, regressed ? "FAIL" : "PASS", "procedure result");
  requireEvidence(!Object.hasOwn(receipt, "hardFailure"), "hard failure is never an expected regression");
  for (const value of array(receipt.console, "complete receipt console")) {
    const entry = object(value, "console record");
    if (entry.level === "error" || entry.level === "exception") {
      requireEvidence(typeof entry.text === "string" && /favicon\.ico/u.test(entry.text), "late/unreported console error");
    }
  }
  const git = object(receipt.git, "Git identity");
  for (const key of ["head", "productSourceTree", "lastProductCommit"] as const) same(git[key], expected[key], `Git ${key}`);
  same(git.productSourceClean, true, "product source cleanliness");
  same(array(git.statusLines, "product source status").length, 0, "product source status");
  const browser = object(receipt.browser, "browser identity");
  same(browser.product, "branded-chrome", "actual browser product");
  same(browser.requested, "branded-chrome", "requested browser product");
  requireEvidence(array(browser.brands, "browser brands").includes("Google Chrome"), "missing actual Google Chrome brand");
  same(browser.executable, expected.chrome.executable, "Chrome executable");
  same(browser.version, expected.chrome.version, "Chrome version");
  same(browser.realistic, true, "Chrome realism mode");
  const build = object(receipt.build, "build identity");
  const marker = object(evidence.artifact.marker, "reconstructed artifact marker");
  fields(marker, ["schema", "classification", "artifactId", "sourceDist", "patchedAsset", "sourceSha256", "observedSha256", "sourceBundleSha256", "observedBundleSha256"], "artifact marker");
  same(marker.schema, "navsentinel-clipboard-queue-test/v2", "artifact schema");
  same(marker.classification, "TEST_ONLY_INSTRUMENTED_COPY_NOT_RELEASE_EVIDENCE", "artifact classification");
  requireEvidence(typeof marker.artifactId === "string" && UUID.test(marker.artifactId), "invalid artifact identifier");
  for (const key of ["sourceSha256", "observedSha256", "sourceBundleSha256", "observedBundleSha256"]) {
    requireEvidence(typeof marker[key] === "string" && HEX64.test(marker[key]), `invalid ${key}`);
  }
  requireEvidence(marker.sourceSha256 !== marker.observedSha256 && typeof evidence.artifact.distSha256 === "string" && HEX64.test(evidence.artifact.distSha256), "artifact was not separately observed/hash-bound");
  same(build.distSha256, evidence.artifact.distSha256, "reconstructed observed bundle hash");
  const diagnostic = object(build.diagnosticBundle, "diagnostic build identity");
  same(diagnostic.classification, "TEST_ONLY_INSTRUMENTED_COPY_NOT_RELEASE_EVIDENCE", "diagnostic classification");
  requireEvidence(typeof diagnostic.extensionPath === "string" && diagnostic.extensionPath.startsWith("/"), "missing selected diagnostic path");
  const launches = array(evidence.launches, "completed branded launches");
  same(launches.length, 1, "one completed branded launch");
  const launch = object(launches[0], "actual branded launch");
  fields(launch, ["version", "executablePath", "realistic", "extensions", "at"], "actual launch");
  same(launch.version, expected.chrome.version, "launched Chrome version");
  same(launch.executablePath, expected.chrome.executable, "launched Chrome executable");
  same(launch.realistic, true, "launched realism mode");
  same(canonical(launch.extensions), canonical([diagnostic.extensionPath]), "actually loaded diagnostic extension");
  const launchedAt = timestamp(launch.at, "launch time");
  requireEvidence(start <= launchedAt && launchedAt <= receiptStart, "launch record is stale or from another run");

  const steps = array(receipt.steps, "procedure steps").map((step) => object(step, "procedure step"));
  requireEvidence(new Set(steps.map((step) => step.id)).size === steps.length, "duplicate step/observation ID");
  const procedure = steps.filter((step) => step.status !== "observed");
  same(procedure.length, 12, "procedure step count");
  procedure.forEach((step, index) => {
    const number = index + 1;
    same(step.id, `step-${String(number).padStart(2, "0")}`, "procedure step ID");
    requireEvidence(typeof step.title === "string" && step.title.startsWith(`${number}. `), "procedure step identity differs");
    same(step.status, regressed && [8, 10, 11].includes(number) ? "failed" : "passed", `procedure step ${number}`);
  });
  const observation = (title: string): Record<string, unknown> => {
    const rows = steps.filter((step) => step.title === title);
    same(rows.length, 1, `unique ${title}`);
    same(rows[0]!.status, "observed", `${title} status`);
    requireEvidence(typeof rows[0]!.detail === "string", `${title} missing JSON`);
    try { return object(JSON.parse(rows[0]!.detail), title); } catch { return invalid(`${title} malformed JSON`); }
  };
  const recordedMarker = observation("direct queue observer artifact");
  same(canonical(recordedMarker), canonical(evidence.artifact.marker), "independently reconstructed observer marker");
  const outcomes = observation(PRESSURE_OUTCOMES_TITLE);
  fields(outcomes, ["schema", "pairId", "variant", "testId", "config", "observer", "timingSampleCount", "toastReadErrors", "arms", "phases"], "structured outcomes");
  same(outcomes.schema, "navsentinel-clipboard-pressure-outcomes/v1", "outcomes schema");
  same(outcomes.pairId, expected.pairId, "pair nonce");
  same(outcomes.variant, variant, "pair variant");
  same(canonical(outcomes.observer), canonical(evidence.artifact.marker), "outcome observer identity");
  same(canonical(outcomes.config), canonical({ workers: 1, retries: 0, retry: 0, timeout: 240000, pressureAttempts: 3, timingSamples: 10 }), "unchanged attempt and worker configuration");
  same(outcomes.timingSampleCount, 10, "timing sample count");
  same(outcomes.toastReadErrors, 0, "swallowed toast read errors");
  for (let index = 1; index <= 10; index++) {
    const sample = observation(`clipboard-pressure timing sample ${index}`);
    same(object(sample.queueEvidence, "timing sample witness").artifactId, evidence.artifact.marker.artifactId, "sample artifact identity");
  }

  const arms = object(outcomes.arms, "selected arms");
  fields(arms, ["benign", "attack"], "arms");
  const selected: Record<string, { documentToken: string; baselineClickfix: number }> = {};
  for (const arm of ["benign", "attack"]) {
    const attempts = array(arms[arm], `${arm} attempts`);
    requireEvidence(attempts.length >= 1 && attempts.length <= 3, `${arm} attempts missing or widened`);
    attempts.forEach((value, index) => {
      const attempt = object(value, "pressure attempt");
      fields(attempt, ["attempt", "documentToken", "baseline", "check"], "pressure attempt");
      same(attempt.attempt, index + 1, "attempt ordinal");
      requireEvidence(typeof attempt.documentToken === "string" && UUID.test(attempt.documentToken) && !seenDocuments.has(attempt.documentToken), "missing/duplicate document identity");
      seenDocuments.add(attempt.documentToken);
      const baseline = object(attempt.baseline, "arm baseline");
      fields(baseline, ["clickfix", "overflow"], "baseline");
      const baselineClickfix = count(baseline.clickfix, "baseline clickfix");
      count(baseline.overflow, "baseline overflow");
      const check = object(attempt.check, "arm self-check");
      if (index !== attempts.length - 1) { same(check.state, "retry", "discarded attempt state"); return; }
      same(check.state, "valid", "selected attempt validity");
      for (const name of ["attempted", "resolved", "beforeReady"]) same(check[name], arm === "attack" ? 41 : 40, `selected ${name}`);
      same(check.refused, 0, "clipboard refusals");
      observerWitness(check.queueEvidence, evidence.artifact.marker.artifactId, arm === "attack", regressed);
      selected[arm] = { documentToken: attempt.documentToken, baselineClickfix };
    });
  }
  const phases = array(outcomes.phases, "phase records");
  const phaseIds = Object.keys(PRESSURE_CHECKS) as PhaseId[];
  same(phases.length, phaseIds.length, "complete phase count");
  phases.forEach((value, index) => {
    const phase = object(value, "phase");
    const id = phaseIds[index]!;
    fields(phase, ["id", "documentToken", "complete", "readCount", "readErrors", "observations", "checks"], "phase");
    same(phase.id, id, "phase order/identity");
    same(phase.documentToken, id === "console" ? null : selected[id === "benign" ? "benign" : "attack"]!.documentToken, "phase document identity");
    same(phase.complete, true, "phase completion");
    same(phase.readErrors, 0, "phase read errors");
    requireEvidence(count(phase.readCount, "phase reads") >= (id === "console" ? 0 : 1), "phase was not observed");
    const measured = object(phase.observations, "phase measurements");
    if (id === "benign") {
      fields(measured, ["warningCount", "baselineClickfix", "clickfix", "overflow"], "benign measurements");
      same(measured.warningCount, 0, "benign warning count");
      same(measured.baselineClickfix, selected.benign!.baselineClickfix, "benign baseline binding");
      same(measured.clickfix, measured.baselineClickfix, "benign ClickFix count");
    } else if (id === "attack-warning") {
      fields(measured, ["warningPresent"], "attack warning measurement");
      same(measured.warningPresent, !regressed, "attack warning observation");
    } else if (id === "attack-log") {
      fields(measured, ["baselineClickfix", "lastPolledClickfix", "clickfix", "overflow", "storedRawMatches", "lastPolledOptionsRows", "optionsRows", "optionsClickfix", "renderedRawMatches"], "attack log measurements");
      same(measured.baselineClickfix, selected.attack!.baselineClickfix, "attack baseline binding");
      const target = selected.attack!.baselineClickfix + (regressed ? 0 : 1);
      same(measured.lastPolledClickfix, target, "last successful poll observation");
      same(measured.clickfix, target, "unconditional final log observation");
      same(measured.storedRawMatches, 0, "stored privacy check");
      requireEvidence(count(measured.lastPolledOptionsRows, "polled Options rows") > 0 && count(measured.optionsRows, "Options rows") > 0, "Options was not populated");
      same(measured.optionsClickfix, !regressed, "Options ClickFix observation");
      same(measured.renderedRawMatches, 0, "rendered privacy check");
    } else { fields(measured, ["errors"], "console measurements"); same(measured.errors, 0, "console errors"); }
    if (id === "benign" || id === "attack-log") {
      if (regressed) requireEvidence(count(measured.overflow, "overflow rows") > 0, "regressed overflow was not observed");
      else same(measured.overflow, 0, "fixed overflow rows");
    }
    const checks = array(phase.checks, "predicate outcomes");
    same(checks.length, PRESSURE_CHECKS[id].length, "predicate count");
    checks.forEach((value, checkIndex) => {
      const check = object(value, "predicate");
      fields(check, ["id", "status"], "predicate");
      const expectedId = PRESSURE_CHECKS[id][checkIndex]!;
      same(check.id, expectedId, "predicate order/identity");
      same(check.status, regressed && REGRESSED_MISMATCHES.includes(expectedId) ? "mismatch" : "passed", `predicate ${expectedId}`);
    });
  });

  const config = object(report.config, "Playwright configuration");
  same(config.workers, 1, "actual workers"); same(config.fullyParallel, false, "actual parallel mode");
  const projects = array(config.projects, "Playwright projects"); same(projects.length, 1, "project count");
  const project = object(projects[0], "Playwright project");
  same(project.repeatEach, 1, "repeat count"); same(project.retries, 0, "actual retries"); same(project.timeout, 240000, "actual timeout");
  same(array(report.errors, "global report errors").length, 0, "global errors");
  const stats = object(report.stats, "report statistics");
  for (const [key, expectedCount] of Object.entries({ expected: regressed ? 0 : 1, unexpected: regressed ? 1 : 0, skipped: 0, flaky: 0 })) same(stats[key], expectedCount, `report ${key}`);
  const specs: Record<string, unknown>[] = [];
  const visit = (value: unknown): void => {
    for (const entry of array(value, "report suites")) {
      const suite = object(entry, "report suite");
      for (const spec of array(suite.specs ?? [], "report specs")) specs.push(object(spec, "test spec"));
      if (suite.suites !== undefined) visit(suite.suites);
    }
  };
  visit(report.suites);
  same(specs.length, 1, "exactly one row-8 test");
  const spec = specs[0]!;
  same(spec.id, outcomes.testId, "actual test ID"); same(spec.title, receipt.test, "test title binding");
  requireEvidence(typeof spec.file === "string" && /(?:^|\/)ai47-8-clipboard-pressure\.spec\.ts$/u.test(spec.file), "wrong spec selected");
  same(spec.ok, !regressed, "spec result");
  const tests = array(spec.tests, "test cases"); same(tests.length, 1, "test case count");
  const test = object(tests[0], "test result");
  same(test.timeout, 240000, "test timeout"); same(test.expectedStatus, "passed", "unchanged expected test status");
  same(test.status, regressed ? "unexpected" : "expected", "test outcome");
  same(array(test.annotations, "test annotations").length, 0, "skip/expected-fail annotations");
  const results = array(test.results, "test attempts"); same(results.length, 1, "one native execution");
  const result = object(results[0], "native result");
  same(result.status, regressed ? "failed" : "passed", "native result status");
  same(result.retry, 0, "native retry"); same(result.workerIndex, 0, "native worker"); same(result.parallelIndex, 0, "native parallel worker");
  const errors = array(result.errors, "test-level errors"); same(errors.length, regressed ? 1 : 0, "test-level error count");
  if (regressed) {
    const message = object(errors[0], "final soft-assert aggregation").message;
    requireEvidence(typeof message === "string" && message.includes("procedure steps that failed (see receipt.json)") && !message.includes("TEST_INVALID"), "unrelated test-level failure");
  }
  const attachments = array(result.attachments, "test attachments").map((value) => object(value, "attachment")).filter((value) => value.name === "receipt");
  same(attachments.length, 1, "unique receipt attachment");
  same(attachments[0]!.path, evidence.receiptPath, "receipt/report attachment binding");
}

/** All evidence is required. A nonzero exit, aggregate drop count or absent warning is never sufficient. */
export function validateClipboardPressurePair(cases: { fixed: PairCaseEvidence; regressed: PairCaseEvidence }, expected: PairExpectation,
  regression: PairRegressionIdentity): void {
  try {
    for (const value of [expected.head, expected.productSourceTree, expected.lastProductCommit]) requireEvidence(HEX40.test(value), "invalid trusted Git identity");
    requireEvidence(UUID.test(expected.pairId), "invalid trusted pair nonce");
    requireEvidence(/^\d+\.\d+\.\d+\.\d+$/u.test(expected.chrome.version) && HEX64.test(expected.chrome.sha256) && expected.chrome.executable.startsWith("/"), "invalid trusted Chrome identity");
    requireEvidence(cases.fixed.artifact.marker.artifactId !== cases.regressed.artifact.marker.artifactId, "both runs reused one observed artifact identity");
    const source = object(regression, "independently reconstructed regression");
    fields(source, ["patchedAsset", "fixedAssetSha256", "regressedAssetSha256", "fixedSourceSha256", "regressedSourceSha256"], "regression identity");
    requireEvidence(typeof source.patchedAsset === "string" && /^assets\/[A-Za-z0-9_$.-]+\.js$/u.test(source.patchedAsset), "invalid regression asset path");
    for (const key of ["fixedAssetSha256", "regressedAssetSha256", "fixedSourceSha256", "regressedSourceSha256"]) {
      requireEvidence(typeof source[key] === "string" && HEX64.test(source[key]), `invalid regression ${key}`);
    }
    requireEvidence(source.fixedAssetSha256 !== source.regressedAssetSha256, "fixed and regressed policy asset bytes are identical");
    requireEvidence(source.fixedSourceSha256 !== source.regressedSourceSha256, "fixed and regressed source bundles are identical");
    same(cases.fixed.artifact.marker.sourceBundleSha256, source.fixedSourceSha256, "fixed reconstructed source bundle");
    same(cases.regressed.artifact.marker.sourceBundleSha256, source.regressedSourceSha256, "regressed reconstructed source bundle");
    const documents = new Set<string>();
    validateCase(cases.fixed, expected, false, documents);
    validateCase(cases.regressed, expected, true, documents);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("QUALIFICATION_INVALID:")) throw error;
    invalid(`malformed or incomplete evidence (${error instanceof Error ? error.message : String(error)})`);
  }
}
