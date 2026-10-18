import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build, type UserConfig } from "vite";
import { describe, it } from "vitest";
import extensionConfig from "../vite.config";

async function runLazyGraph(removeHead: boolean, forcePreload = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ns-lazy-build-"));
  try {
    fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
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
        rolldownOptions: {
          input: path.join(root, "entry.js"),
          output: { codeSplitting: { groups: [{
            name: "shared", test: /shared\.js$/, entriesAware: false, priority: 10,
          }] } },
        },
      },
    });
    const outputs = Array.isArray(result) ? result : [result];
    const chunks = outputs.flatMap((output) => {
      assert.ok("output" in output, "fixture must produce a completed build, not a watcher");
      return output.output.filter((file) => file.type === "chunk");
    });
    assert.ok(chunks.some((chunk) => chunk.dynamicImports.length > 0), "the fixture must retain a real lazy import");
    const entry = chunks.find((chunk) => chunk.isEntry);
    assert.ok(entry);
    for (const chunk of chunks) {
      const filename = path.join(root, chunk.fileName);
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.writeFileSync(filename, chunk.code);
    }
    // Execute the built ESM graph in a fresh process. Only the DOM interface
    // needed by Vite's preload helper is modeled; browser behavior is covered
    // separately by the built-extension E2E cases.
    const code = `
const links = [];
globalThis.document = {
  head: ${removeHead ? "null" : "{ appendChild(link) { links.push(link.href); } }"},
  createElement() { return { relList: { supports() { return true; } } }; },
  getElementsByTagName() { return []; },
  querySelector() { return null; },
};
globalThis.window = { dispatchEvent() { return true; } };
try {
  await import(${JSON.stringify(pathToFileURL(path.join(root, entry.fileName)).href)});
  const loaded = await globalThis.probe[1]();
  console.log(JSON.stringify({ value: loaded.value, links, error: null }));
} catch (error) {
  console.log(JSON.stringify({ value: null, links, error: String(error) }));
}
`;
    const run = spawnSync(process.execPath, ["--input-type=module", "--eval", code], {
      cwd: root, encoding: "utf8", timeout: 10_000,
    });
    assert.equal(run.error, undefined);
    assert.equal(run.status, 0, run.stderr);
    return JSON.parse(run.stdout.trim()) as { value: string | null; links: string[]; error: string | null };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe("content-script lazy imports do not use page DOM for module loading (#972)", () => {
  for (const removeHead of [false, true]) {
    it(`loads the production graph without page links, head removed=${removeHead}`, async () => {
      assert.deepEqual(await runLazyGraph(removeHead), {
        value: "shared-value-lazy", links: [], error: null,
      });
    }, 30_000);
  }

  it("enabled-preload control publishes links into the page", async () => {
    const result = await runLazyGraph(false, true);
    assert.equal(result.value, "shared-value-lazy");
    assert.equal(result.error, null);
    assert.ok(result.links.length > 0, "the control must exercise actual dependency preloading");
  }, 30_000);

  it("enabled-preload control fails when head is absent", async () => {
    const result = await runLazyGraph(true, true);
    assert.equal(result.value, null);
    assert.match(result.error ?? "", /appendChild/);
  }, 30_000);
});
