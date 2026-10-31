import { describe, expect, it } from "vitest";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { expect as pwExpect } from "@playwright/test";
import {
  PRESSURE_CHECKS, PRESSURE_OUTCOMES_TITLE, REGRESSED_MISMATCHES, PressurePhase, validateClipboardPressurePair,
  type PairCaseEvidence, type PairExpectation, type PressureOutcomes,
} from "./acceptance/clipboard-pressure-qualification";
import type { ObserverMarker } from "./acceptance/clipboard-pressure-observed-bundle";

const hex = (digit: string, length = 64) => digit.repeat(length);
const uuid = (digit: string) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const expected: PairExpectation = {
  head: hex("a", 40), productSourceTree: hex("b", 40), lastProductCommit: hex("c", 40), pairId: uuid("a"),
  chrome: { executable: "/opt/google/chrome/chrome", version: "142.0.7444.0", sha256: hex("a") },
};
const regression = {
  patchedAsset: "assets/bridge_outbound-example.js", fixedAssetSha256: hex("7"), regressedAssetSha256: hex("8"),
  fixedSourceSha256: hex("a"), regressedSourceSha256: hex("f"),
};
const marker = (regressed: boolean): ObserverMarker => ({
  schema: "navsentinel-clipboard-queue-test/v2", classification: "TEST_ONLY_INSTRUMENTED_COPY_NOT_RELEASE_EVIDENCE",
  artifactId: uuid(regressed ? "b" : "c"), sourceDist: regressed ? "/sources/regressed" : "/sources/fixed",
  patchedAsset: "main_guard.ts-example.js", sourceSha256: hex(regressed ? "b" : "c"), observedSha256: hex(regressed ? "d" : "e"),
  sourceBundleSha256: hex(regressed ? "f" : "a"), observedBundleSha256: hex(regressed ? "1" : "2"),
});

function caseFixture(regressed: boolean, observer = marker(regressed)): PairCaseEvidence {
  const variant = regressed ? "regressed" : "fixed";
  const receiptPath = `/run/${variant}/receipt.json`;
  const token = (attack: boolean) => uuid(attack ? regressed ? "d" : "e" : regressed ? "f" : "1");
  const attempt = (attack: boolean) => ({
    attempt: 1, documentToken: token(attack), baseline: { clickfix: 0, overflow: 0 },
    check: { state: "valid", attempted: attack ? 41 : 40, resolved: attack ? 41 : 40, refused: 0, beforeReady: attack ? 41 : 40,
      queueEvidence: {
        schema: observer.schema, artifactId: observer.artifactId, verificationCount: 1, queuedAfterVerification: 0, drainCount: 1, drainsBeforeVerification: 0,
        firstVerification: { clipboardEnqueueCalls: attack ? 41 : 40, commandLike: attack ? 1 : 0, other: 40,
          queueSize: regressed ? 32 : attack ? 3 : 2, dropped: regressed ? attack ? 10 : 9 : 0, coalesced: regressed ? 0 : 39 },
        firstDrain: { verificationCount: 1, total: regressed ? 32 : attack ? 3 : 2, commandLike: !regressed && attack ? 1 : 0,
          other: regressed ? 32 : 1, dropped: regressed ? attack ? 10 : 9 : 0, coalesced: regressed ? 0 : 39 },
      } },
  });
  const observations = {
    benign: { warningCount: 0, baselineClickfix: 0, clickfix: 0, overflow: regressed ? 9 : 0 },
    "attack-warning": { warningPresent: !regressed },
    "attack-log": { baselineClickfix: 0, lastPolledClickfix: regressed ? 0 : 1, clickfix: regressed ? 0 : 1,
      overflow: regressed ? 10 : 0, storedRawMatches: 0, lastPolledOptionsRows: 1, optionsRows: 1,
      optionsClickfix: regressed ? 0 : 1, renderedRawMatches: 0 },
    console: { errors: 0 },
  };
  const outcomes: PressureOutcomes = {
    schema: "navsentinel-clipboard-pressure-outcomes/v1", pairId: expected.pairId, variant, testId: "row8-test",
    config: { workers: 1, retries: 0, retry: 0, timeout: 240000, pressureAttempts: 3, timingSamples: 10 }, observer,
    timingSampleCount: 10, toastReadErrors: 0, arms: { benign: [attempt(false)], attack: [attempt(true)] },
    phases: (Object.keys(PRESSURE_CHECKS) as Array<keyof typeof PRESSURE_CHECKS>).map((id) => ({
      id, documentToken: id === "console" ? null : token(id !== "benign"), complete: true, readCount: id === "console" ? 0 : 1, readErrors: 0,
      observations: observations[id], checks: PRESSURE_CHECKS[id].map((check) => ({ id: check,
        status: regressed && REGRESSED_MISMATCHES.includes(check) ? "mismatch" : "passed" })),
    })),
  };
  const failed = [8, 10, 11];
  const receipt = {
    schema: "navsentinel-acceptance-receipt/v1", classification: "AUTOMATED_AGENT_EVIDENCE_NOT_OWNER_GATE3",
    guide: "AI-47.8-former-AI-37-PR599-diagnostic-queue", test: "AI-47.8 / former AI-37: diagnostic test",
    startedAt: "2026-10-21T00:00:01.000Z", finishedAt: "2026-10-21T00:00:03.000Z",
    git: { head: expected.head, productSourceTree: expected.productSourceTree, lastProductCommit: expected.lastProductCommit,
      productSourceClean: true, statusLines: [] },
    build: { distSha256: hex(regressed ? "3" : "4"), uiGuardRevision: "guard-example", manifestVersion: "0.5.0",
      diagnosticBundle: { classification: observer.classification, extensionPath: `/observed/${variant}` } },
    browser: { product: "branded-chrome", requested: "branded-chrome", brands: ["Google Chrome"],
      version: expected.chrome.version, realistic: true, executable: expected.chrome.executable },
    steps: [
      ...Array.from({ length: 12 }, (_, index) => ({ id: `step-${String(index + 1).padStart(2, "0")}`, title: `${index + 1}. original procedure`,
        status: regressed && failed.includes(index + 1) ? "failed" : "passed", durationMs: 1 })),
      { id: "obs-artifact", title: "direct queue observer artifact", status: "observed", detail: JSON.stringify(observer), durationMs: 0 },
      ...Array.from({ length: 10 }, (_, index) => ({ id: `obs-sample-${index}`, title: `clipboard-pressure timing sample ${index + 1}`,
        status: "observed", detail: JSON.stringify({ queueEvidence: attempt(false).check.queueEvidence }), durationMs: 0 })),
      { id: "obs-outcomes", title: PRESSURE_OUTCOMES_TITLE, status: "observed", detail: JSON.stringify(outcomes), durationMs: 0 },
    ],
    result: regressed ? "FAIL" : "PASS",
    console: [],
    storage: [{ label: "event log after the attack arm", area: "local", value: regressed ? [] : [
      { id: "selected", kind: "clickfix_detected", url: "http://localhost:46200/acceptance/pressure-load/load-13/clickfix-06-clipboard-pressure.html" },
    ] }],
  };
  const report = {
    config: { workers: 1, fullyParallel: false, projects: [{ repeatEach: 1, retries: 0, timeout: 240000 }] },
    errors: [], stats: { expected: regressed ? 0 : 1, unexpected: regressed ? 1 : 0, skipped: 0, flaky: 0 },
    suites: [{ specs: [{ id: "row8-test", file: "ai47-8-clipboard-pressure.spec.ts", title: receipt.test, ok: !regressed,
      tests: [{ timeout: 240000, expectedStatus: "passed", status: regressed ? "unexpected" : "expected", annotations: [],
        results: [{ status: regressed ? "failed" : "passed", retry: 0, workerIndex: 0, parallelIndex: 0,
          errors: regressed ? [{ message: "procedure steps that failed (see receipt.json)" }] : [],
          attachments: [{ name: "receipt", path: receiptPath, contentType: "application/json" }] }] }] }] }],
  };
  return { receipt, report, launches: [{ version: expected.chrome.version, executablePath: expected.chrome.executable, realistic: true,
    extensions: [receipt.build.diagnosticBundle.extensionPath], at: "2026-10-21T00:00:00.500Z" }],
    process: { status: regressed ? 1 : 0, signal: null, error: null,
    startedAt: "2026-10-21T00:00:00.000Z", finishedAt: "2026-10-21T00:00:04.000Z" }, receiptPath,
    artifact: { marker: observer, distSha256: receipt.build.distSha256 } };
}

function set(value: unknown, route: string, replacement: unknown): void {
  const parts = route.split(".");
  let current = value as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) current = current[part] as Record<string, unknown>;
  current[parts.at(-1)!] = replacement;
}
function mutateOutcomes(evidence: PairCaseEvidence, route: string, replacement: unknown): void {
  const steps = (evidence.receipt as { steps: Array<{ title: string; detail?: string }> }).steps;
  const row = steps.find((step) => step.title === PRESSURE_OUTCOMES_TITLE)!;
  const data = JSON.parse(row.detail!);
  set(data, route, replacement);
  row.detail = JSON.stringify(data);
}

describe("strict fixed/regressed clipboard qualification", () => {
  it("accepts the complete fixed pass and directly witnessed command-loss regression", () => {
    expect(() => validateClipboardPressurePair({ fixed: caseFixture(false), regressed: caseFixture(true) }, expected, regression)).not.toThrow();
  });
  it("accepts Options rendering a discarded load's event while the selected regressed load has none", () => {
    const regressed = caseFixture(true);
    set(regressed, "receipt.storage.0.value", [{ id: "discarded", kind: "clickfix_detected",
      url: "http://localhost:46200/acceptance/pressure-load/load-12/clickfix-06-clipboard-pressure.html" }]);
    mutateOutcomes(regressed, "phases.2.observations.optionsClickfix", 1);
    mutateOutcomes(regressed, "phases.2.checks.4.status", "passed");
    expect(() => validateClipboardPressurePair({ fixed: caseFixture(false), regressed }, expected, regression)).not.toThrow();
  });
  it("requires both the selected and discarded events to appear in fixed Options history", () => {
    const fixed = caseFixture(false);
    set(fixed, "receipt.storage.0.value", [{ id: "discarded", kind: "clickfix_detected" }, { id: "selected", kind: "clickfix_detected" }]);
    mutateOutcomes(fixed, "phases.2.observations.optionsRows", 2);
    mutateOutcomes(fixed, "phases.2.observations.optionsClickfix", 2);
    expect(() => validateClipboardPressurePair({ fixed, regressed: caseFixture(true) }, expected, regression)).not.toThrow();
    mutateOutcomes(fixed, "phases.2.observations.optionsClickfix", 1);
    expect(() => validateClipboardPressurePair({ fixed, regressed: caseFixture(true) }, expected, regression)).toThrow(/Options ClickFix observation differs/);
  });
  it.each([
    ["missing", []],
    ["wrong area", [{ label: "event log after the attack arm", area: "session", value: [] }]],
    ["duplicated", Array.from({ length: 2 }, () => ({ label: "event log after the attack arm", area: "local", value: [] }))],
  ])("rejects a %s native log snapshot", (_label, storage) => {
    const regressed = caseFixture(true);
    set(regressed, "receipt.storage", storage);
    expect(() => validateClipboardPressurePair({ fixed: caseFixture(false), regressed }, expected, regression)).toThrow(/QUALIFICATION_INVALID/);
  });
  it("accepts a verified shared-chunk regression with unchanged MAIN bytes", () => {
    const fixedMarker = marker(false);
    const regressedMarker = { ...marker(true), sourceSha256: fixedMarker.sourceSha256 };
    expect(() => validateClipboardPressurePair({ fixed: caseFixture(false, fixedMarker),
      regressed: caseFixture(true, regressedMarker) }, expected, regression)).not.toThrow();
  });
  it.each([
    ["missing reconstruction", undefined],
    ["unconfined asset", { ...regression, patchedAsset: "../bridge_outbound.js" }],
    ["identical asset", { ...regression, regressedAssetSha256: regression.fixedAssetSha256 }],
    ["identical bundle", { ...regression, regressedSourceSha256: regression.fixedSourceSha256 }],
    ["unbound fixed source", { ...regression, fixedSourceSha256: hex("9") }],
    ["unbound regressed source", { ...regression, regressedSourceSha256: hex("9") }],
    ["malformed asset hash", { ...regression, fixedAssetSha256: "not-a-sha256" }],
  ])("rejects %s even when the native outcomes match", (_label, identity) => {
    expect(() => validateClipboardPressurePair({ fixed: caseFixture(false), regressed: caseFixture(true) },
      expected, identity as typeof regression)).toThrow(/QUALIFICATION_INVALID/u);
  });
  it("rejects the consistent command-first counterexample despite identical admission counts and a missing warning", () => {
    const regressed = caseFixture(true);
    mutateOutcomes(regressed, "arms.attack.0.check.queueEvidence.firstDrain.commandLike", 1);
    mutateOutcomes(regressed, "arms.attack.0.check.queueEvidence.firstDrain.other", 31);
    expect(() => validateClipboardPressurePair({ fixed: caseFixture(false), regressed }, expected, regression)).toThrow(/actual retained command class/u);
  });
  const invalidOutcomes: Array<[string, string, unknown]> = [
    ["v1 witness", "arms.attack.0.check.queueEvidence.schema", "navsentinel-clipboard-queue-test/v1"],
    ["missing drain", "arms.attack.0.check.queueEvidence.firstDrain", null],
    ["command survived", "arms.attack.0.check.queueEvidence.firstDrain.commandLike", 1],
    ["mismatched dropped", "arms.attack.0.check.queueEvidence.firstDrain.dropped", 9],
    ["fractional count", "arms.attack.0.check.queueEvidence.firstDrain.other", 31.5],
    ["later handshake", "arms.attack.0.check.queueEvidence.verificationCount", 2],
    ["later drain", "arms.attack.0.check.queueEvidence.drainCount", 2],
    ["early drain", "arms.attack.0.check.queueEvidence.drainsBeforeVerification", 1],
    ["late clipboard admission", "arms.attack.0.check.queueEvidence.queuedAfterVerification", 1],
    ["missed real window", "arms.attack.0.check.state", "retry"],
    ["toast read error", "toastReadErrors", 1],
    ["log read error", "phases.2.readErrors", 1],
    ["unfinished privacy/UI phase", "phases.2.complete", false],
    ["missing privacy predicate", "phases.2.checks", [{ id: "attack.clickfix", status: "mismatch" }]],
    ["privacy failure", "phases.2.checks.2.status", "mismatch"],
    ["hidden privacy leak", "phases.2.observations.storedRawMatches", 1],
    ["selected regressed event survived", "phases.2.observations.clickfix", 1],
    ["extra rendered ClickFix row", "phases.2.observations.optionsClickfix", 1],
    ["old boolean Options evidence", "phases.2.observations.optionsClickfix", false],
    ["Options assertion mismatch", "phases.2.checks.4.status", "mismatch"],
    ["unrelated assertion error", "phases.2.checks.0.status", "error"],
    ["wrong document", "phases.2.documentToken", uuid("9")],
    ["stale pair nonce", "pairId", uuid("9")],
    ["retries widened", "config.retries", 1],
    ["attempt budget widened", "config.pressureAttempts", 4],
    ["samples missing", "timingSampleCount", 9],
    ["missing attack arm", "arms.attack", []],
  ];
  it.each(invalidOutcomes)("rejects %s even with the expected nonzero exit", (_label, route, replacement) => {
    const regressed = caseFixture(true);
    mutateOutcomes(regressed, route, replacement);
    expect(() => validateClipboardPressurePair({ fixed: caseFixture(false), regressed }, expected, regression)).toThrow(/QUALIFICATION_INVALID/u);
  });
  it.each([
    ["report.suites.0.specs.0.tests.0.results.0.status", "timedOut"],
    ["report.suites.0.specs.0.tests.0.results.0.errors", [{ message: "procedure steps that failed (see receipt.json)" }, { message: "unhandled exception" }]],
    ["receipt.git.head", hex("9", 40)], ["receipt.git.productSourceClean", false],
    ["receipt.browser.product", "bundled-chromium"], ["receipt.browser.realistic", false],
    ["receipt.build.distSha256", hex("9")], ["receipt.hardFailure", "TEST_INVALID: setup failed"],
    ["receipt.steps.11.status", "failed"], ["process.status", 0], ["process.signal", "SIGTERM"],
    ["receipt.console", [{ level: "exception", text: "late worker crash" }]],
    ["process.error", "spawn failed"], ["receipt.startedAt", "2026-10-20T00:00:00.000Z"],
    ["report.errors", [{ message: "worker crashed" }]],
    ["launches", []], ["launches.0.executablePath", "/bundled/chromium"], ["launches.0.realistic", false],
    ["launches.0.extensions", []], ["launches.0.extensions", ["/other/extension"]],
    ["launches.0.at", "2026-10-20T00:00:00.000Z"],
  ])("rejects unrelated or malformed %s", (route, replacement) => {
    const regressed = caseFixture(true);
    set(regressed, route as string, replacement);
    expect(() => validateClipboardPressurePair({ fixed: caseFixture(false), regressed }, expected, regression)).toThrow(/QUALIFICATION_INVALID/u);
  });
  it("rejects malformed, duplicate and missing structured receipts", () => {
    for (const mode of ["malformed", "duplicate", "missing"]) {
      const regressed = caseFixture(true);
      const steps = (regressed.receipt as { steps: Array<{ title: string; detail?: string }> }).steps;
      const index = steps.findIndex((row) => row.title === PRESSURE_OUTCOMES_TITLE);
      if (mode === "malformed") steps[index]!.detail = "{broken";
      if (mode === "duplicate") steps.push(steps[index]!);
      if (mode === "missing") steps.splice(index, 1);
      expect(() => validateClipboardPressurePair({ fixed: caseFixture(false), regressed }, expected, regression)).toThrow(/QUALIFICATION_INVALID/u);
    }
  });
});

describe("phase recording keeps original assertions authoritative", () => {
  const empty = () => ({ phases: [] } as unknown as PressureOutcomes);
  it("continues independent predicates then rethrows the original assertion failure", async () => {
    const phase = new PressurePhase(empty(), "benign", uuid("a"));
    await phase.check("benign.no-warning", () => pwExpect([]).toEqual([]), () => true);
    await phase.check("benign.no-clickfix", () => pwExpect(0).toBe(0), () => true);
    await phase.check("benign.no-overflow", () => pwExpect(10).toBe(0), () => false);
    expect(phase.record.checks.map((check) => check.status)).toEqual(["passed", "passed", "mismatch"]);
    expect(() => phase.finish()).toThrow();
    expect(phase.record.complete).toBe(true);
  });
  it("recognizes an actual local Playwright poll mismatch, without accepting a global timeout", async () => {
    const phase = new PressurePhase(empty(), "attack-warning", uuid("a"));
    await phase.check("attack.warning", () => pwExpect.poll(() => 0, { timeout: 1 }).toBe(1), () => false, 1);
    expect(phase.record.checks[0]?.status).toBe("mismatch");
    const global = new PressurePhase(empty(), "attack-warning", uuid("a"));
    await global.check("attack.warning", () => { throw new Error("Call Log:\n- Test timeout of 240000ms exceeded"); }, () => false, 5000);
    expect(global.record.checks[0]?.status).toBe("error");
  });
  it("keeps callback and measurement errors distinct from a missing warning", async () => {
    const phase = new PressurePhase(empty(), "attack-warning", uuid("a"));
    await phase.check("attack.warning", () => phase.read(async () => { throw new Error("page closed"); }), () => false);
    expect(phase.record.readErrors).toBe(1);
    expect(phase.record.checks[0]?.status).toBe("error");
    const measured = new PressurePhase(empty(), "attack-warning", uuid("a"));
    const error = Object.assign(new Error("measurement failed"), { matcherResult: {} });
    await measured.check("attack.warning", () => pwExpect(null).not.toBeNull(), () => { throw error; });
    expect(measured.record.checks[0]?.status).toBe("error");
  });

  it.each(["toastsDuring", "waitForWarning"])("counts failures swallowed by the actual %s reader without changing its result", async (name) => {
    const source = fs.readFileSync("tests/acceptance/ai47-8-clipboard-pressure.spec.ts", "utf8");
    const file = ts.createSourceFile("row8.ts", source, ts.ScriptTarget.Latest, true);
    const declaration = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name)!;
    const code = ts.transpileModule(`${declaration.getText(file)}\nglobalThis.read = ${name};`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText;
    let now = 0;
    let calls = 0;
    const context = vm.createContext({ Date: { now: () => now }, Set,
      CLICKFIX_WARNING: /ClickFix|clipboard|fake.*verification|Do NOT paste/i,
      toastState: async () => { if (calls++ === 0) throw new Error("temporary read failure"); return { text: "ClickFix warning" }; },
    });
    vm.runInContext(code, context);
    const read = context.read as (page: unknown, duration: number, onRead: (failed: boolean) => void) => Promise<unknown>;
    const observations: boolean[] = [];
    const result = await read({ waitForTimeout: async (duration: number) => { now += duration; } }, 300, (failed) => observations.push(failed));
    expect(observations[0]).toBe(true);
    expect(observations.slice(1).every((failed) => !failed)).toBe(true);
    expect(result).toEqual(name === "toastsDuring" ? ["ClickFix warning"] : "ClickFix warning");
  });
});
