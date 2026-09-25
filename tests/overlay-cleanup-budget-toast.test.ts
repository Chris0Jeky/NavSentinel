import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The budget-exhausted cleanup card carries the group Undo (#748). It must be
 * persistent like the regular cleanup card: a later non-persistent warning
 * would otherwise remove it (renderFullCard drops non-persistent cards) while
 * up to MAX_ACTIVE_OVERLAY_SUPPRESSIONS overlays stay hidden, and controlToast()
 * would not tear it down when cleanup is switched off.
 *
 * Source-level structural check: capture_isolated has import-time side effects
 * and is not imported by unit tests.
 */
describe("overlay cleanup budget-exhausted toast (#748)", () => {
  const source = readFileSync(
    resolve("extension/src/content/capture_isolated.ts"),
    "utf8",
  );

  it("offers Undo and is persistent", () => {
    const start = source.indexOf('if (cleanup.action === "budget_exhausted")');
    expect(start).toBeGreaterThanOrEqual(0);
    const region = source.slice(start, source.indexOf("return true;", start));
    expect(region).toContain("Overlay cleanup reached its safety limit.");
    expect(region).toContain('label: "Undo"');
    expect(region).toContain("persistent: true");
  });
});
