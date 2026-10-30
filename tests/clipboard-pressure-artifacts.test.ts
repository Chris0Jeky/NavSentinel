import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
  verifyRegressedSource(fixed: string, regressed: string): { patchedAsset: string; fixedAssetSha256: string; regressedAssetSha256: string; fixedSourceSha256: string; regressedSourceSha256: string };
  reconstructObservedArtifact(source: string, sourceHash: string, marker: ObserverMarker): { marker: ObserverMarker; distSha256: string };
  attachedReceipt(report: unknown, original: string, root: string): string;
};

// Actual parent MAIN declarations give the observer real AST anchors. The
// coalescer below has the exact built shape accepted by the existing #599 helper.
const compiled = ts.transpileModule(fs.readFileSync("extension/src/content/main_guard.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const coalescer = 'function pairedCoalescer(e){if(e.type===`ns-clipboard-write`)return e.payload?.looksLikeCommand===!0?`ns-clipboard-write:command-like`:`ns-clipboard-write:other`}\n';

function fixture(body: (root: string, fixed: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ns-pressure-pair-artifacts-"));
  try {
    const fixed = path.join(root, "fixed");
    fs.mkdirSync(path.join(fixed, "assets"), { recursive: true });
    fs.writeFileSync(path.join(fixed, "manifest.json"), '{"version":"0.5.0"}\n');
    fs.writeFileSync(path.join(fixed, "assets", "main_guard.ts-example.js"), compiled);
    fs.writeFileSync(path.join(fixed, "assets", "bridge_outbound-example.js"), coalescer);
    fs.writeFileSync(path.join(fixed, "isolated-loader.js"), "// unchanged isolated loader\n");
    body(root, fixed);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

describe("independent diagnostic artifact reconstruction", () => {
  it("binds the actual shared regression chunk while MAIN bytes stay identical", () => fixture((root, fixed) => {
    const built = buildPr599RegressedBundle(fixed, path.join(root, "regressed"));
    expect(built.patchedAsset).toBe("bridge_outbound-example.js");
    const hash = (source: string, asset: string) => createHash("sha256").update(fs.readFileSync(path.join(source, "assets", asset))).digest("hex");
    expect(hash(fixed, "main_guard.ts-example.js")).toBe(hash(built.extensionPath, "main_guard.ts-example.js"));
    const identity = cli.verifyRegressedSource(fixed, built.extensionPath);
    expect(identity.patchedAsset).toBe("assets/bridge_outbound-example.js");
    expect(identity.fixedAssetSha256).toBe(hash(fixed, built.patchedAsset));
    expect(identity.regressedAssetSha256).toBe(hash(built.extensionPath, built.patchedAsset));
    expect(identity.fixedAssetSha256).not.toBe(identity.regressedAssetSha256);
    expect(identity.fixedSourceSha256).not.toBe(identity.regressedSourceSha256);
  }));

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
  it.skipIf(Number(process.versions.node.split(".")[0]) < 24).each([true, false])(
    "preserves an existing output directory (qualification present: %s)", (hasQualification) => fixture((root) => {
      const output = path.join(root, "existing-output");
      fs.mkdirSync(output);
      const qualification = path.join(output, "qualification.json");
      const original = '{"qualified":true,"evidence":"original"}\n';
      if (hasQualification) fs.writeFileSync(qualification, original);
      const result = spawnSync(process.execPath, [entrypoint, "run", output, "a".repeat(40)], { encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("pair output already exists");
      expect(fs.readdirSync(output)).toEqual(hasQualification ? ["qualification.json"] : []);
      if (hasQualification) expect(fs.readFileSync(qualification, "utf8")).toBe(original);
    }),
  );

  it.skipIf(Number(process.versions.node.split(".")[0]) < 24)(
    "a failed validate replaces a stale qualified verdict", () => fixture((root) => {
      const output = path.join(root, "stale-output");
      fs.mkdirSync(output);
      const qualification = path.join(output, "qualification.json");
      fs.writeFileSync(qualification, '{"qualified":true}\n');
      const result = spawnSync(process.execPath, [entrypoint, "validate", output, "a".repeat(40)], { encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(JSON.parse(fs.readFileSync(qualification, "utf8")).qualified).toBe(false);
    }),
  );

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

  it("rejects unsupported native CLI runtimes before importing TypeScript helpers", () => {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e",
      `Object.defineProperty(process.versions, "node", { value: "20.20.2" }); process.argv[1] = ${JSON.stringify(entrypoint)}; await import(${JSON.stringify(pathToFileURL(entrypoint).href)});`],
    { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("clipboard-pressure-pair.mjs requires Node.js 24 or newer; received 20.20.2");
    expect(result.stderr).not.toContain("ERR_UNKNOWN_FILE_EXTENSION");
  });

  it("enforces the real native runtime contract without launching a browser", () => {
    if (Number(process.versions.node.split(".")[0]) < 24) {
      const result = spawnSync(process.execPath, [entrypoint], { encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`clipboard-pressure-pair.mjs requires Node.js 24 or newer; received ${process.versions.node}`);
      expect(result.stderr).not.toContain("ERR_UNKNOWN_FILE_EXTENSION");
      return;
    }
    const output = execFileSync(process.execPath, ["--input-type=module", "-e",
      `const tools = await import(${JSON.stringify(pathToFileURL(entrypoint).href)}); process.stdout.write(String(typeof tools.reconstructObservedArtifact));`],
    { encoding: "utf8" });
    expect(output).toBe("function");
  });
});
