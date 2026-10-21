import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { buildPr599RegressedBundle, REGRESSED_BUNDLE_MARKER } from "./acceptance/pr599-regressed-bundle";
import {
  buildClipboardPressureObservedBundle, hashClipboardPressureBundle, type ObserverMarker,
} from "./acceptance/clipboard-pressure-observed-bundle";

const entrypoint = path.resolve("scripts/clipboard-pressure-pair.mjs");
const cli = await import(pathToFileURL(entrypoint).href) as {
  verifyRegressedSource(fixed: string, regressed: string): { fixedSourceSha256: string; regressedSourceSha256: string };
  reconstructObservedArtifact(source: string, sourceHash: string, marker: ObserverMarker): { marker: ObserverMarker; distSha256: string };
  attachedReceipt(report: unknown, original: string, root: string): string;
};

// Actual parent MAIN declarations give the observer real AST anchors. The
// coalescer below has the exact built shape accepted by the existing #599 helper.
const compiled = ts.transpileModule(fs.readFileSync("extension/src/content/main_guard.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText + '\nfunction pairedCoalescer(e){if(e.type===`ns-clipboard-write`)return e.payload?.looksLikeCommand===!0?`ns-clipboard-write:command-like`:`ns-clipboard-write:other`}\n';

function fixture(body: (root: string, fixed: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ns-pressure-pair-artifacts-"));
  try {
    const fixed = path.join(root, "fixed");
    fs.mkdirSync(path.join(fixed, "assets"), { recursive: true });
    fs.writeFileSync(path.join(fixed, "manifest.json"), '{"version":"0.5.0"}\n');
    fs.writeFileSync(path.join(fixed, "assets", "main_guard.ts-example.js"), compiled);
    fs.writeFileSync(path.join(fixed, "isolated-loader.js"), "// unchanged isolated loader\n");
    body(root, fixed);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

describe("independent diagnostic artifact reconstruction", () => {
  it("reconstructs both fixed and regressed observed bytes, including the marker in the receipt hash", () => fixture((root, fixed) => {
    const regressed = buildPr599RegressedBundle(fixed, path.join(root, "regressed")).extensionPath;
    const identity = cli.verifyRegressedSource(fixed, regressed);
    expect(identity.fixedSourceSha256).not.toBe(identity.regressedSourceSha256);
    for (const [index, source] of [fixed, regressed].entries()) {
      const built = buildClipboardPressureObservedBundle(source, path.join(root, `observed-${index}`));
      expect(cli.reconstructObservedArtifact(source, hashClipboardPressureBundle(source, true), built.marker)).toEqual({
        marker: built.marker, distSha256: hashClipboardPressureBundle(built.extensionPath, true),
      });
    }
  }));

  it.each(["unrelated byte", "extra file", "missing patch", "wrong marker"])("rejects regression with %s", (mutation) => fixture((root, fixed) => {
    const built = buildPr599RegressedBundle(fixed, path.join(root, "regressed"));
    if (mutation === "unrelated byte") fs.appendFileSync(path.join(built.extensionPath, "isolated-loader.js"), "// changed\n");
    if (mutation === "extra file") fs.writeFileSync(path.join(built.extensionPath, "extra.js"), "// unexpected\n");
    if (mutation === "missing patch") fs.copyFileSync(path.join(fixed, "assets", built.patchedAsset), path.join(built.extensionPath, "assets", built.patchedAsset));
    if (mutation === "wrong marker") {
      const filename = path.join(built.extensionPath, REGRESSED_BUNDLE_MARKER);
      const marker = JSON.parse(fs.readFileSync(filename, "utf8"));
      marker.sourceDist = "/different/source";
      fs.writeFileSync(filename, JSON.stringify(marker));
    }
    expect(() => cli.verifyRegressedSource(fixed, built.extensionPath)).toThrow(/QUALIFICATION_INVALID/u);
  }));

  it.each(["source changed", "observed hash", "artifact ID", "source path"])("rejects self-reported %s", (mutation) => fixture((root, fixed) => {
    const built = buildClipboardPressureObservedBundle(fixed, path.join(root, "observed"));
    const sourceHash = hashClipboardPressureBundle(fixed, true);
    const marker = structuredClone(built.marker);
    if (mutation === "source changed") fs.appendFileSync(path.join(fixed, "isolated-loader.js"), "// changed\n");
    if (mutation === "observed hash") marker.observedSha256 = "a".repeat(64);
    if (mutation === "artifact ID") marker.artifactId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    if (mutation === "source path") marker.sourceDist = "/different/source";
    expect(() => cli.reconstructObservedArtifact(fixed, sourceHash, marker)).toThrow(/QUALIFICATION_INVALID/u);
  }));
});

describe("receipt file/report binding", () => {
  it("binds Playwright's copied attachment and rejects altered/outside/duplicate evidence", () => fixture((root) => {
    const fresh = path.join(root, "fresh-run");
    fs.mkdirSync(path.join(fresh, "playwright", "attachments"), { recursive: true });
    const original = path.join(fresh, "receipt.json");
    const attached = path.join(fresh, "playwright", "attachments", "receipt-pathhash.json");
    fs.writeFileSync(original, '{"result":"FAIL"}\n');
    fs.copyFileSync(original, attached);
    const report = (filenames: string[]) => ({ suites: [{ specs: [{ tests: [{ results: [{
      attachments: filenames.map((filename) => ({ name: "receipt", path: filename })),
    }] }] }] }] });
    expect(cli.attachedReceipt(report([attached]), original, fresh)).toBe(attached);
    expect(() => cli.attachedReceipt(report([attached, attached]), original, fresh)).toThrow(/QUALIFICATION_INVALID/u);
    fs.appendFileSync(attached, " ");
    expect(() => cli.attachedReceipt(report([attached]), original, fresh)).toThrow(/receipts differ/u);
    const stale = path.join(root, "stale.json");
    fs.copyFileSync(original, stale);
    expect(() => cli.attachedReceipt(report([stale]), original, fresh)).toThrow(/escaped/u);
  }));

  it("loads the actual CLI and TypeScript helpers under Node without launching a browser", () => {
    const output = execFileSync(process.execPath, ["--input-type=module", "-e",
      `const tools = await import(${JSON.stringify(pathToFileURL(entrypoint).href)}); process.stdout.write(String(typeof tools.reconstructObservedArtifact));`],
    { encoding: "utf8" });
    expect(output).toBe("function");
  });
});
