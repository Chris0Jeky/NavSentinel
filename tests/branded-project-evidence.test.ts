import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
// @ts-expect-error The standalone Node workflow helper has no declarations.
import { retainBrandedProjectEvidence } from "../scripts/retain-branded-project-evidence.mjs";

function workspace(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "ns-branded-retention-"));
  try { run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}
function emit(root: string, project: string): void {
  for (const directory of ["test-results", "playwright-report"]) {
    rmSync(join(root, directory), { recursive: true, force: true });
    mkdirSync(join(root, directory));
  }
  writeFileSync(join(root, "test-results/e2e-junit.xml"), `<testsuite name="${project}"/>`);
  writeFileSync(join(root, "test-results/receipt.json"), JSON.stringify({ project }));
  writeFileSync(join(root, "playwright-report/index.html"), `<p>${project}</p>`);
}

describe("branded project evidence retention", () => {
  it("keeps every project's reports and attachment bytes after later cleanup", () => workspace(root => {
    for (const project of ["smoke", "regression", "phase2"]) {
      emit(root, project);
      writeFileSync(join(root, "test-results/attachment.bin"), Buffer.from([0, 1, 255]));
      retainBrandedProjectEvidence(project, root);
    }
    for (const project of ["smoke", "regression", "phase2"]) {
      const saved = join(root, "artifacts/branded", project);
      assert.deepEqual(JSON.parse(readFileSync(join(saved, "test-results/receipt.json"), "utf8")), { project });
      assert.equal(readFileSync(join(saved, "playwright-report/index.html"), "utf8"), `<p>${project}</p>`);
      assert.deepEqual(readFileSync(join(saved, "test-results/attachment.bin")), Buffer.from([0, 1, 255]));
      assert.equal(JSON.parse(readFileSync(join(saved, "retention.json"), "utf8")).retentionComplete, true);
    }
  }));

  it("refuses to overwrite an earlier attempt", () => workspace(root => {
    emit(root, "smoke"); retainBrandedProjectEvidence("smoke", root);
    emit(root, "replacement");
    assert.throws(() => retainBrandedProjectEvidence("smoke", root), { code: "EEXIST" });
    assert.equal(readFileSync(join(root, "artifacts/branded/smoke/playwright-report/index.html"), "utf8"), "<p>smoke</p>");
  }));

  it("retains available diagnostics but fails when a report is missing", () => workspace(root => {
    emit(root, "regression");
    rmSync(join(root, "playwright-report"), { recursive: true });
    writeFileSync(join(root, "test-results/failure.txt"), "synthetic failure");
    assert.throws(() => retainBrandedProjectEvidence("regression", root), /Missing branded project evidence/);
    const saved = join(root, "artifacts/branded/regression");
    assert.equal(readFileSync(join(saved, "test-results/failure.txt"), "utf8"), "synthetic failure");
    const manifest = JSON.parse(readFileSync(join(saved, "retention.json"), "utf8"));
    assert.equal(manifest.retentionComplete, false);
    assert.ok(manifest.missing.includes("playwright-report/index.html"));
  }));

  it("does not treat an empty JUnit file as retained evidence", () => workspace(root => {
    emit(root, "phase2"); writeFileSync(join(root, "test-results/e2e-junit.xml"), "");
    assert.throws(() => retainBrandedProjectEvidence("phase2", root), /Missing branded project evidence/);
  }));

  for (const project of ["../escape", "smoke/..", "", "other", null]) {
    it(`rejects invalid project ${JSON.stringify(project)} before filesystem mutation`, () => workspace(root => {
      assert.throws(() => retainBrandedProjectEvidence(project, root), /Invalid branded project/);
      assert.equal(existsSync(join(root, "artifacts")), false);
    }));
  }

  it("wires retention before fail-fast exit and uploads the persistent copies", () => {
    const workflow = readFileSync(".github/workflows/branded-chrome-advisory.yml", "utf8");
    const loop = /for project in smoke regression phase2; do([\s\S]*?) {10}done/.exec(workflow)?.[1];
    assert.ok(loop);
    const retain = loop.indexOf('node scripts/retain-branded-project-evidence.mjs "$project"');
    assert.ok(retain > loop.indexOf("xvfb-run -a npx playwright test"));
    assert.ok(retain < loop.indexOf('if [ "$status" -ne 0 ]'));
    assert.match(loop, /exit "\$retention_status"/);
    assert.match(workflow, /path: \|[\s\S]*?artifacts\/branded\//);
  });
});
