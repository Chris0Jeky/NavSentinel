import { describe, expect, it } from "vitest";
import { buildTemplateFile } from "../scripts/build-brand-templates.mjs";

describe("brand-templates build script — deterministic, timestamp-free (#322 / #16)", () => {
  it("produces a byte-identical object on repeated builds (no Date.now / timestamp)", () => {
    // The previous build embedded `generated: new Date()...`, so two builds on
    // different calendar days diverged and dirtied the tree. The output must be a
    // pure function of the (static) brand list.
    const a = JSON.stringify(buildTemplateFile());
    const b = JSON.stringify(buildTemplateFile());
    expect(a).toBe(b);
  });

  it("carries no non-deterministic build-timestamp field", () => {
    expect(buildTemplateFile()).not.toHaveProperty("generated");
  });

  it("emits a well-formed template file (version + >=40 unique brands, sized hashes)", () => {
    const file = buildTemplateFile();
    expect(file.version).toBe(1);
    expect(Array.isArray(file.templates)).toBe(true);
    expect(file.templates.length).toBeGreaterThanOrEqual(40);

    const ids = new Set<string>();
    for (const t of file.templates) {
      expect(t.id).toBeTruthy();
      expect(t.displayName).toBeTruthy();
      expect(t.aHash).toHaveLength(8);
      expect(t.bHash).toHaveLength(32);
      expect(t.aHash.every((x) => x >= 0 && x <= 255)).toBe(true);
      expect(t.bHash.every((x) => x >= 0 && x <= 255)).toBe(true);
      expect(t.version).toBeGreaterThan(0);
      ids.add(t.id);
    }
    expect(ids.size).toBe(file.templates.length); // no duplicate brand IDs
  });

  it("matches the committed extension/public/brand_templates.json exactly (no drift)", async () => {
    // Guards against the committed artifact going stale relative to the generator —
    // the build is deterministic, so the two must be byte-identical.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const committed = readFileSync(
      resolve(__dirname, "../extension/public/brand_templates.json"),
      "utf-8",
    );
    // Custom message uses vitest's expect(actual, message) form (Jest-compatible
    // matchers ignore a message arg passed to toEqual) so a failure tells the
    // contributor the remedy, not just the diff.
    expect(
      JSON.parse(committed),
      "Committed extension/public/brand_templates.json is out of sync with the generator. Run `npm run build:templates` and commit the updated file.",
    ).toEqual(buildTemplateFile());
  });
});
