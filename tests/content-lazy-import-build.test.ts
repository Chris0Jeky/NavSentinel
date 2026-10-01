import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build, type UserConfig } from "vite";
import { describe, it } from "vitest";
import extensionConfig from "../vite.config";

async function buildLazyGraph(forcePreload = false): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ns-lazy-build-"));
  try {
    fs.writeFileSync(path.join(root, "entry.js"), 'import { shared } from "./shared.js"; globalThis.probe = [shared, () => import("./lazy.js")];');
    fs.writeFileSync(path.join(root, "shared.js"), 'export const shared = "shared-value";');
    fs.writeFileSync(path.join(root, "lazy.js"), 'import { shared } from "./shared.js"; export const value = shared + "-lazy";');
    const modulePreload = forcePreload ? { polyfill: false } : (extensionConfig as UserConfig).build?.modulePreload;
    const result = await build({
      configFile: false,
      root,
      logLevel: "silent",
      build: {
        write: false,
        minify: false,
        ...(modulePreload === undefined ? {} : { modulePreload }),
        rolldownOptions: { input: path.join(root, "entry.js") },
      },
    });
    const outputs = Array.isArray(result) ? result : [result];
    const chunks = outputs.flatMap((output) => {
      assert.ok("output" in output, "fixture must produce a completed build, not a watcher");
      return output.output.filter((file) => file.type === "chunk");
    });
    assert.ok(chunks.some((chunk) => chunk.dynamicImports.length > 0), "the fixture must retain a real lazy import");
    return chunks.map((chunk) => chunk.code).join("\n");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe("content-script lazy imports do not use page DOM for module loading (#972)", () => {
  it("builds the production lazy graph without document-dependent preload code", async () => {
    const source = await buildLazyGraph();
    assert.doesNotMatch(source, /\b(?:modulepreload|__vitePreload)\b/);
    assert.doesNotMatch(source, /document\.head/);
  }, 30_000);

  it("detects the bundler's page-DOM preload control", async () => {
    assert.match(await buildLazyGraph(true), /\b(?:modulepreload|__vitePreload)\b/);
  }, 30_000);
});
