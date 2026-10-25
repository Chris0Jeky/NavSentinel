import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Guards the declared permission set. RI-05 removed the test-only
 * declarativeNetRequest ruleset (localhost-scoped placeholder rules behind a
 * disabled options toggle), so neither manifest may request the DNR
 * permissions or declare a rule resource. A real hard-block feature is a
 * separate future design (#242/#243) and would re-declare these deliberately.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(__dirname, "..", "extension");

type Manifest = {
  permissions?: string[];
  declarative_net_request?: unknown;
};

const MANIFESTS = ["manifest.json", "manifest.firefox.json"] as const;

function loadManifest(name: string): Manifest {
  return JSON.parse(readFileSync(path.join(extensionDir, name), "utf8")) as Manifest;
}

describe("manifest permissions", () => {
  it.each(MANIFESTS)("%s requests no declarativeNetRequest permission", (name) => {
    const permissions = loadManifest(name).permissions ?? [];
    expect(permissions).not.toContain("declarativeNetRequest");
    expect(permissions).not.toContain("declarativeNetRequestWithHostAccess");
  });

  it.each(MANIFESTS)("%s declares no declarative_net_request rule resources", (name) => {
    expect(loadManifest(name).declarative_net_request).toBeUndefined();
  });

  it.each(MANIFESTS)("%s still requests the permissions the product uses", (name) => {
    const permissions = loadManifest(name).permissions ?? [];
    expect(permissions).toContain("storage");
    expect(permissions).toContain("webNavigation");
    expect(permissions).toContain("tabs");
  });

  // #1114/#1134: inherited-origin frames (about:blank, srcdoc, blob) need the
  // credential guard, the MAIN-world guard and the isolated bridge that arms it.
  it.each(["capture_isolated", "main_guard", "credential_guard"])(
    "manifest.json injects %s into origin-fallback frames",
    (script) => {
      const scripts = (loadManifest("manifest.json") as {
        content_scripts: Array<{ js: string[]; all_frames?: boolean; match_origin_as_fallback?: boolean }>;
      }).content_scripts;
      const entry = scripts.find((s) => s.js.includes(`src/content/${script}.ts`));
      expect(entry).toMatchObject({ all_frames: true, match_origin_as_fallback: true });
    },
  );

  it("ships no static DNR ruleset file", () => {
    expect(existsSync(path.join(extensionDir, "rules", "dnr_static.json"))).toBe(false);
  });
});
