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

  it("accepts a synthetic built manifest", () => {
    writeFileSync(manifestPath, JSON.stringify({ manifest_version: 3 }));
    expect(() => assertE2eBuild(manifestPath)).not.toThrow();
  });

  it("checks the EXTENSION_PATH build the specs load, falling back to extension/dist", () => {
    expect(defaultManifestPath({ EXTENSION_PATH: directory })).toBe(manifestPath);
    expect(defaultManifestPath({})).toMatch(/extension[\\/]dist[\\/]manifest\.json$/);
    vi.stubEnv("EXTENSION_PATH", directory);
    expect(() => assertE2eBuild()).toThrow(manifestPath);
    writeFileSync(manifestPath, JSON.stringify({ manifest_version: 3 }));
    expect(() => assertE2eBuild()).not.toThrow();
  });

  it("allows an intentionally missing build only with the explicit opt-out", () => {
    vi.stubEnv("NAVSENTINEL_ALLOW_MISSING_BUILD", "1");
    expect(() => assertE2eBuild(manifestPath)).not.toThrow();
  });
});
