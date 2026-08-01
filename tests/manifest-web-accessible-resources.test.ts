import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Guards the default interaction-only web_accessible_resources list. Chrome denies the load
 * ("Resources must be listed in the web_accessible_resources manifest key")
 * unless they are declared here.
 *
 * - brand_templates.json: visual_sim_loader.ts (content-script fetch)
 * - reputation_data.bin is deliberately absent. The explicit non-release
 *   research profile adds it during the build and verifies that artifact.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.resolve(__dirname, "..", "extension", "manifest.json");

type ManifestWar = { resources?: string[]; matches?: string[] };
type Manifest = { web_accessible_resources?: ManifestWar[] };

function loadManifest(): Manifest {
  return JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
}

describe("manifest web_accessible_resources", () => {
  it("declares web_accessible_resources", () => {
    const manifest = loadManifest();
    expect(Array.isArray(manifest.web_accessible_resources)).toBe(true);
    expect(manifest.web_accessible_resources!.length).toBeGreaterThan(0);
  });

  it.each(["brand_templates.json"])(
    "exposes %s to content scripts under <all_urls>",
    (resource) => {
      const manifest = loadManifest();
      const entry = manifest.web_accessible_resources!.find((war) =>
        (war.resources ?? []).includes(resource)
      );
      expect(entry, `${resource} must be web-accessible`).toBeDefined();
      expect(entry!.matches).toContain("<all_urls>");
    }
  );

  it("does not expose the reputation fixture in the default manifest", () => {
    const manifest = loadManifest();
    const resources = manifest.web_accessible_resources!.flatMap((war) => war.resources ?? []);
    expect(resources).not.toContain("reputation_data.bin");
  });
});
