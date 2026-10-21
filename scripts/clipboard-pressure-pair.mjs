/**
 * Dedicated hosted diagnostic pair; never replaces ordinary acceptance.
 * Native CLI execution requires Node.js 24 or newer (the dedicated workflow pins 24).
 * node scripts/clipboard-pressure-pair.mjs run <new output directory> <exact head>
 * node scripts/clipboard-pressure-pair.mjs validate <output directory> <exact head>
 *
 * The native tests remain PASS/FAIL according to their original assertions.
 * Only the independent strict validator can qualify the expected negative.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import console from "node:console";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
// Ordinary unit tests may transform these helpers on Node 20. The native CLI
// must fail clearly before Node 20 tries to load a TypeScript file itself.
if (invokedDirectly && Number(process.versions.node.split(".")[0]) < 24) {
  throw new Error(`clipboard-pressure-pair.mjs requires Node.js 24 or newer; received ${process.versions.node}`);
}
const {
  buildClipboardPressureObservedBundle, hashClipboardPressureBundle,
} = await import("../tests/acceptance/clipboard-pressure-observed-bundle.ts");
const { buildPr599RegressedBundle, REGRESSED_BUNDLE_MARKER } = await import("../tests/acceptance/pr599-regressed-bundle.ts");
const { validateClipboardPressurePair } = await import("../tests/acceptance/clipboard-pressure-qualification.ts");

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = "/opt/google/chrome/chrome";
const SPEC = "tests/acceptance/ai47-8-clipboard-pressure.spec.ts";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const invalid = (detail) => { throw new Error(`QUALIFICATION_INVALID: ${detail}`); };
const requireEvidence = (condition, detail) => { if (!condition) invalid(detail); };
const readJson = (filename) => JSON.parse(fs.readFileSync(filename, "utf8"));
const writeJson = (filename, value) => fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`);
const git = (args) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
const canonical = (value) => JSON.stringify(value && typeof value === "object"
  ? Array.isArray(value) ? value.map((item) => JSON.parse(canonical(item)))
    : Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, JSON.parse(canonical(item))]))
  : value);

function fileHashes(root) {
  const entries = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) entries.push([path.relative(root, target).replaceAll("\\", "/"), sha256(fs.readFileSync(target))]);
      else invalid("source artifacts must contain only ordinary files/directories");
    }
  }
  visit(root);
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

/** Rebuild the existing exact regression and compare every file, not just its marker. */
export function verifyRegressedSource(fixedSource, regressedSource) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ns-pressure-regression-check-"));
  try {
    const rebuilt = buildPr599RegressedBundle(fixedSource, temp);
    const actualFiles = fileHashes(regressedSource);
    const expectedFiles = fileHashes(rebuilt.extensionPath);
    delete actualFiles[REGRESSED_BUNDLE_MARKER];
    delete expectedFiles[REGRESSED_BUNDLE_MARKER];
    requireEvidence(canonical(actualFiles) === canonical(expectedFiles), "regressed source differs outside the exact #599 patch");
    const fixedFiles = fileHashes(fixedSource);
    const patchedAsset = `assets/${rebuilt.patchedAsset}`;
    const changedFiles = [...new Set([...Object.keys(fixedFiles), ...Object.keys(actualFiles)])]
      .filter((filename) => fixedFiles[filename] !== actualFiles[filename]);
    requireEvidence(changedFiles.length === 1 && changedFiles[0] === patchedAsset, "regression must change exactly its resolved policy asset");
    const actualMarker = readJson(path.join(regressedSource, REGRESSED_BUNDLE_MARKER));
    const expectedMarker = readJson(path.join(rebuilt.extensionPath, REGRESSED_BUNDLE_MARKER));
    requireEvidence(Object.keys(actualMarker).sort().join("|") === Object.keys(expectedMarker).sort().join("|"), "regression marker fields differ");
    requireEvidence(typeof actualMarker.createdAt === "string" && Number.isFinite(Date.parse(actualMarker.createdAt)), "invalid regression marker time");
    delete actualMarker.createdAt; delete expectedMarker.createdAt;
    requireEvidence(canonical(actualMarker) === canonical(expectedMarker), "regression source identity differs");
    return { patchedAsset, fixedAssetSha256: fixedFiles[patchedAsset], regressedAssetSha256: actualFiles[patchedAsset],
      fixedSourceSha256: hashClipboardPressureBundle(fixedSource, true),
      regressedSourceSha256: hashClipboardPressureBundle(regressedSource, true) };
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

/** Reconstruct observed bytes from the independently bound source and artifact ID. */
export function reconstructObservedArtifact(sourceDist, sourceSha256, recordedMarker) {
  requireEvidence(hashClipboardPressureBundle(sourceDist, true) === sourceSha256, "source bundle changed during the pair");
  requireEvidence(recordedMarker && typeof recordedMarker === "object" && recordedMarker.sourceDist === path.resolve(sourceDist), "observer belongs to a different source");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ns-pressure-observer-check-"));
  try {
    const rebuilt = buildClipboardPressureObservedBundle(sourceDist, temp, recordedMarker.artifactId);
    requireEvidence(canonical(rebuilt.marker) === canonical(recordedMarker), "observed marker/hashes do not match independently reconstructed bytes");
    return { marker: rebuilt.marker, distSha256: hashClipboardPressureBundle(rebuilt.extensionPath, true) };
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

function repositoryIdentity(expectedHead) {
  requireEvidence(/^[a-f0-9]{40}$/u.test(expectedHead), "expected head must be a full immutable SHA");
  requireEvidence(git(["rev-parse", "HEAD"]) === expectedHead, "checkout does not match the trusted expected head");
  requireEvidence(git(["rev-parse", "--is-shallow-repository"]) === "false", "checkout is shallow");
  requireEvidence(git(["status", "--porcelain", "--untracked-files=normal"]) === "", "checkout is not clean");
  return { head: expectedHead, productSourceTree: git(["rev-parse", "HEAD:extension/src"]),
    lastProductCommit: git(["log", "-1", "--format=%H", "--", "extension/src", "extension/public", "vite.config.ts", "package-lock.json", "scripts/build-extension.mjs"]) };
}

function chromeIdentity() {
  const output = execFileSync(CHROME, ["--version"], { encoding: "utf8" }).trim();
  const version = /^Google Chrome (\d+\.\d+\.\d+\.\d+)(?:\s.*)?$/u.exec(output)?.[1];
  requireEvidence(version, "installed browser is not branded Google Chrome");
  return { executable: CHROME, version, sha256: sha256(fs.readFileSync(CHROME)) };
}

function findReceipts(root) {
  if (!fs.existsSync(root)) return [];
  const found = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) found.push(...findReceipts(target));
    else if (entry.isFile() && entry.name === "receipt.json") found.push(target);
  }
  return found;
}

export function attachedReceipt(report, originalPath, receiptRoot) {
  const attachments = [];
  function visit(suites) {
    requireEvidence(Array.isArray(suites), "report suites missing");
    for (const suite of suites) {
      for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) for (const result of test.results ?? []) {
        for (const attachment of result.attachments ?? []) if (attachment.name === "receipt") attachments.push(attachment);
      }
      if (suite.suites) visit(suite.suites);
    }
  }
  visit(report.suites);
  requireEvidence(attachments.length === 1 && typeof attachments[0].path === "string", "report needs one actual receipt attachment");
  const filename = attachments[0].path;
  requireEvidence(path.isAbsolute(filename) && fs.lstatSync(filename).isFile(), "receipt attachment must be an ordinary absolute file");
  const relative = path.relative(fs.realpathSync(receiptRoot), fs.realpathSync(filename));
  requireEvidence(relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), "receipt attachment escaped this fresh native run");
  requireEvidence(fs.readFileSync(filename).equals(fs.readFileSync(originalPath)), "attached and original receipts differ");
  return filename;
}

export function loadAndValidatePair(directory, expectedHead) {
  const manifest = readJson(path.join(directory, "pair-manifest.json"));
  requireEvidence(manifest.schema === "navsentinel-clipboard-pressure-pair-run/v1", "missing pair manifest schema");
  const identity = repositoryIdentity(expectedHead);
  for (const key of Object.keys(identity)) requireEvidence(identity[key] === manifest.expected[key], `post-run ${key} changed`);
  requireEvidence(canonical(chromeIdentity()) === canonical(manifest.expected.chrome), "Chrome binary/version changed during the pair");
  requireEvidence(manifest.sources.fixed === path.join(repoRoot, "extension", "dist") && manifest.sources.regressed === path.join(directory, "regressed-source", "extension"), "unexpected source paths");
  const regression = verifyRegressedSource(manifest.sources.fixed, manifest.sources.regressed);
  requireEvidence(canonical(regression) === canonical(manifest.regression), "source/regression identity changed during the pair");
  const cases = {};
  for (const variant of ["fixed", "regressed"]) {
    const caseDirectory = path.join(directory, variant);
    const receiptRoot = path.join(repoRoot, "artifacts", "acceptance", `pressure-pair-${manifest.expected.pairId}-${variant}`);
    const receipts = findReceipts(receiptRoot);
    requireEvidence(receipts.length === 1, `${variant} needs exactly one fresh receipt, found ${receipts.length}`);
    const originalReceiptPath = receipts[0];
    const receipt = readJson(originalReceiptPath);
    const report = readJson(path.join(caseDirectory, "playwright.json"));
    const receiptPath = attachedReceipt(report, originalReceiptPath, receiptRoot);
    requireEvidence(Array.isArray(receipt.steps), "receipt steps missing");
    const markers = receipt.steps.filter((step) => step.title === "direct queue observer artifact" && step.status === "observed");
    requireEvidence(markers.length === 1 && typeof markers[0].detail === "string", "missing/duplicate observer artifact record");
    const artifact = reconstructObservedArtifact(manifest.sources[variant], variant === "fixed" ? regression.fixedSourceSha256 : regression.regressedSourceSha256, JSON.parse(markers[0].detail));
    cases[variant] = { receipt, receiptPath, report,
      launches: fs.readFileSync(path.join(caseDirectory, "branded-launches.jsonl"), "utf8").split(/\r?\n/u).filter((line) => line.trim()).map((line) => JSON.parse(line)),
      process: readJson(path.join(caseDirectory, "process.json")), artifact };
    fs.copyFileSync(receiptPath, path.join(caseDirectory, "receipt.json"));
  }
  validateClipboardPressurePair(cases, manifest.expected, regression);
  return { schema: "navsentinel-clipboard-pressure-pair-qualification/v1", qualified: true,
    classification: "TEST_ONLY_INSTRUMENTED_COPY_NOT_RELEASE_EVIDENCE", expected: manifest.expected, regression,
    fixed: cases.fixed.artifact, regressed: cases.regressed.artifact,
    held: ["Discarded-page event attribution (#963 P2)", "Unchanged release artifact and owner Gate-3 proof"] };
}

export function runPair(directory, expectedHead) {
  requireEvidence(!fs.existsSync(directory), "pair output already exists; stale evidence cannot be reused");
  requireEvidence(process.env.NAVSENTINEL_EXPECTED_GUARD === undefined, "guard revision overrides are not allowed in this pair");
  const identity = repositoryIdentity(expectedHead);
  const chrome = chromeIdentity();
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  fs.mkdirSync(directory);
  const fixed = path.join(repoRoot, "extension", "dist");
  const regressed = buildPr599RegressedBundle(fixed, path.join(directory, "regressed-source")).extensionPath;
  const expected = { ...identity, chrome, pairId: randomUUID() };
  writeJson(path.join(directory, "pair-manifest.json"), { schema: "navsentinel-clipboard-pressure-pair-run/v1", expected,
    sources: { fixed, regressed }, regression: verifyRegressedSource(fixed, regressed) });
  for (const variant of ["fixed", "regressed"]) {
    const caseDirectory = path.join(directory, variant);
    fs.mkdirSync(caseDirectory);
    const runName = `pressure-pair-${expected.pairId}-${variant}`;
    requireEvidence(!fs.existsSync(path.join(repoRoot, "artifacts", "acceptance", runName)), "acceptance directory already exists");
    const log = fs.openSync(path.join(caseDirectory, "playwright.log"), "wx");
    const startedAt = new Date().toISOString();
    console.log(`Running ${variant} diagnostic once at ${expectedHead}; logs: ${caseDirectory}`);
    let result;
    try {
      result = spawnSync(process.execPath, [path.join(repoRoot, "node_modules", "@playwright", "test", "cli.js"),
        "test", "-c", "playwright.acceptance.config.ts", SPEC, "--workers=1", "--retries=0", "--reporter=list,json"], {
        cwd: repoRoot, stdio: ["ignore", log, log], env: { ...process.env,
          EXTENSION_PATH: variant === "fixed" ? fixed : regressed, NAVSENTINEL_BRANDED_CHROME: CHROME,
          NAVSENTINEL_REALISTIC_CHROME: "1", NAVSENTINEL_LIVE: "0", NAVSENTINEL_ACCEPTANCE_RUN: runName,
          NAVSENTINEL_PRESSURE_PAIR_ID: expected.pairId, NAVSENTINEL_PRESSURE_PAIR_VARIANT: variant,
          NAVSENTINEL_BRANDED_RECORD: path.join(caseDirectory, "branded-launches.jsonl"),
          PLAYWRIGHT_JSON_OUTPUT_NAME: path.join(caseDirectory, "playwright.json"),
        },
      });
    } finally { fs.closeSync(log); }
    writeJson(path.join(caseDirectory, "process.json"), { status: result.status, signal: result.signal,
      error: result.error?.message ?? null, startedAt, finishedAt: new Date().toISOString() });
    // Both runs are preserved. Exit codes alone do not authorize qualification.
    console.log(`${variant} native exit: ${result.status}; signal: ${result.signal ?? "none"}`);
  }
  return loadAndValidatePair(directory, expectedHead);
}

if (invokedDirectly) {
  const [mode, output, expectedHead] = process.argv.slice(2);
  if (!["run", "validate"].includes(mode) || !output || !expectedHead) invalid("usage: run|validate <output directory> <exact head>");
  const directory = path.resolve(output);
  try {
    const result = mode === "run" ? runPair(directory, expectedHead) : loadAndValidatePair(directory, expectedHead);
    writeJson(path.join(directory, "qualification.json"), result);
    console.log("Qualified the fixed/regressed diagnostic pair; attribution and owner/release proof remain held.");
  } catch (error) {
    if (fs.existsSync(directory)) writeJson(path.join(directory, "qualification.json"), { qualified: false,
      error: error instanceof Error ? error.message : String(error) });
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
