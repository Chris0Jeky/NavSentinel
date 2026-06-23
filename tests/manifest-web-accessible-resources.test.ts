import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Guards the web_accessible_resources list. Both runtime data files are fetched
 * from content scripts via chrome.runtime.getURL(); Chrome denies the load
 * ("Resources must be listed in the web_accessible_resources manifest key")
 * unless they are declared here.
 *
 * - brand_templates.json: visual_sim_loader.ts (content-script fetch)
 * - reputation_data.bin:  capture_isolated.ts loadReputationFilter() (top-frame
 *   content-script fetch). Omitting it silently disabled top-frame reputation
 *   checks and printed a "Failed to fetch" error on every page load.
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

  it.each(["brand_templates.json", "reputation_data.bin"])(
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
});
