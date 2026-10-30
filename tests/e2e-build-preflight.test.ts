import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertE2eBuild, defaultManifestPath } from "./e2e/build-preflight";

describe("E2E build preflight", () => {
  let directory: string;
  let manifestPath: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "navsentinel-build-preflight-"));
    manifestPath = join(directory, "manifest.json");
    vi.stubEnv("NAVSENTINEL_ALLOW_MISSING_BUILD", undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });

  it.each([undefined, "0", "true"])("rejects a missing manifest with opt-out %s", (value) => {
    vi.stubEnv("NAVSENTINEL_ALLOW_MISSING_BUILD", value);
    expect(() => assertE2eBuild(manifestPath)).toThrow("npm run build");
  });

  it.each([
    { content_scripts: [{ js: ["missing.js", "content.js"] }] },
    { background: { service_worker: "content.js" } },
  ])("accepts an MV3 manifest with an existing referenced script: %j", (scripts) => {
    writeFileSync(manifestPath, JSON.stringify({ manifest_version: 3, ...scripts }));
    writeFileSync(join(directory, "content.js"), "// built script\n");
    expect(() => assertE2eBuild(manifestPath)).not.toThrow();
  });

  it.each([
    ["empty manifest", ""],
    ["invalid JSON", "{"],
    ["manifest without MV3", JSON.stringify({ background: { service_worker: "content.js" } })],
    ["MV2 manifest", JSON.stringify({ manifest_version: 2, background: { service_worker: "content.js" } })],
    ["manifest without scripts", JSON.stringify({ manifest_version: 3 })],
    ["missing content script", JSON.stringify({ manifest_version: 3, content_scripts: [{ js: ["missing.js"] }] })],
    ["missing service worker", JSON.stringify({ manifest_version: 3, background: { service_worker: "missing.js" } })],
    ["directory as script", JSON.stringify({ manifest_version: 3, background: { service_worker: "." } })],
  ])("rejects %s", (_label, manifest) => {
    writeFileSync(manifestPath, manifest);
    writeFileSync(join(directory, "content.js"), "// unrelated or non-MV3 script\n");
    expect(() => assertE2eBuild(manifestPath)).toThrow("npm run build");
  });

  it("checks the EXTENSION_PATH build the specs load, falling back to extension/dist", () => {
    expect(defaultManifestPath({ EXTENSION_PATH: directory })).toBe(manifestPath);
    expect(defaultManifestPath({})).toMatch(/extension[\\/]dist[\\/]manifest\.json$/);
    vi.stubEnv("EXTENSION_PATH", directory);
    expect(() => assertE2eBuild()).toThrow(manifestPath);
    writeFileSync(manifestPath, JSON.stringify({ manifest_version: 3, background: { service_worker: "content.js" } }));
    writeFileSync(join(directory, "content.js"), "// built script\n");
    expect(() => assertE2eBuild()).not.toThrow();
  });

  it("allows an intentionally missing build only with the explicit opt-out", () => {
    vi.stubEnv("NAVSENTINEL_ALLOW_MISSING_BUILD", "1");
    expect(() => assertE2eBuild(manifestPath)).not.toThrow();
  });
});
