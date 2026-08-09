import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Guards that the default interaction-only manifest exposes no public assets. */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.resolve(__dirname, "..", "extension", "manifest.json");

type ManifestWar = { resources?: string[]; matches?: string[] };
type Manifest = { web_accessible_resources?: ManifestWar[] };

function loadManifest(): Manifest {
  return JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
}

describe("manifest web_accessible_resources", () => {
  it("does not declare web_accessible_resources in the default profile", () => {
    const manifest = loadManifest();
    expect(manifest.web_accessible_resources).toBeUndefined();
  });
});
