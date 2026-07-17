import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const script = resolve("scripts/check-mv3-worker-imports.mjs");
const temporaryDirectories: string[] = [];

function makeDist(files: Record<string, string>, backgroundType = "module") {
  const dist = mkdtempSync(join(tmpdir(), "navsentinel-mv3-worker-"));
  temporaryDirectories.push(dist);
  writeFileSync(
    join(dist, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      background: { service_worker: "service-worker-loader.js", type: backgroundType },
    }),
  );
  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = join(dist, relativePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, source);
  }
  return dist;
}

function runCheck(dist: string) {
  return spawnSync(process.execPath, [script, dist], { encoding: "utf8" });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("MV3 emitted service-worker import check", () => {
  it("accepts a local static graph that reaches the pending-decision runtime", () => {
    const dist = makeDist({
      "service-worker-loader.js": 'import"./assets/sw.js";',
      "assets/sw.js": 'import{createBroker as c}from"./pending-decision-runtime~sw.js";c();',
      "assets/pending-decision-runtime~sw.js": "export function createBroker() {}",
    });

    const result = runCheck(dist);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS: 3 statically linked worker modules");
  });

  it.each([
    ["dynamic import", 'import("./pending-decision-runtime~sw.js")', "unsupported dynamic import()"],
    ["preload helper", "__vitePreload(loadWorker);", "browser preload helper"],
    ["module preload", 'const relation = "modulepreload";', "browser preload helper"],
    ["remote import", 'import "https://example.test/worker.js";', "non-local import"],
    ["out-of-dist import", 'import "../../outside-worker.js";', "escapes extension/dist"],
    ["missing import", 'import "./pending-decision-runtime~sw.js";', "import is missing"],
  ])("rejects %s in the reachable worker graph", (_label, workerSource, expectedError) => {
    const dist = makeDist({ "service-worker-loader.js": workerSource });

    const result = runCheck(dist);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(expectedError);
  });

  it("rejects a non-module background worker", () => {
    const dist = makeDist(
      {
        "service-worker-loader.js": 'import "./pending-decision-runtime~sw.js";',
        "pending-decision-runtime~sw.js": "export {};",
      },
      "classic",
    );

    const result = runCheck(dist);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('background.type must be "module"');
  });

  it("rejects a static graph that omits the pending-decision runtime", () => {
    const dist = makeDist({ "service-worker-loader.js": "export {};" });

    const result = runCheck(dist);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Pending-decision runtime is not reachable");
  });
});
