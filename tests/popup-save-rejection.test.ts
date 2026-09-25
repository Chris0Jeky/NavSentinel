import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The popup mode segments and auto-dismiss checkbox persist through
 * `updateSuiteSettings()`, which rejects when runtime messaging fails (worker
 * unreachable, context invalidated) or on a cross-window settings conflict.
 * The seg handlers set their control optimistically before persisting, so an
 * uncaught rejection strands the wrong value until the popup is reopened —
 * plus an unhandled rejection. Each handler must route failures through
 * `resyncAfterFailedSave`, which warns and resyncs from persisted truth via
 * `refreshUi()`. (#849)
 *
 * Source-level structural suite in the #389/#847 style: `popup.ts` has
 * import-time DOM side effects that rule out direct import. Fails against
 * the pre-fix source, where the seg handlers awaited bare and the
 * auto-dismiss save was a voided promise without `.catch`.
 */
describe("popup settings saves handle messaging rejections (#849)", () => {
  const source = readFileSync(
    resolve("extension/src/popup/popup.ts"),
    "utf8",
  );

  const HELPER = "function resyncAfterFailedSave(";
  const NAV_START = 'navSeg.addEventListener("click"';
  const CRED_START = 'credSeg.addEventListener("click"';
  const AUTO_START = 'autoDismiss.addEventListener("change"';
  // Statement that immediately follows the three handlers; anchors the end
  // of the auto-dismiss region without brace matching.
  const END_ANCHOR = "initSegKeyboard(navSeg);";

  const helperAt = source.indexOf(HELPER);
  const navAt = source.indexOf(NAV_START);
  const credAt = source.indexOf(CRED_START);
  const autoAt = source.indexOf(AUTO_START);
  const endAt = source.indexOf(END_ANCHOR);

  it("locates the helper and the three save handlers in order", () => {
    for (const at of [helperAt, navAt, credAt, autoAt, endAt]) {
      expect(at).toBeGreaterThanOrEqual(0);
    }
    expect(helperAt).toBeLessThan(navAt);
    expect(navAt).toBeLessThan(credAt);
    expect(credAt).toBeLessThan(autoAt);
    expect(autoAt).toBeLessThan(endAt);
  });

  it("warns and resyncs from persisted truth in the shared helper", () => {
    const region = source.slice(helperAt, navAt);
    expect(region).toContain("console.warn(");
    expect(region).toContain("refreshUi()");
  });

  it("routes nav-mode save failures through the helper", () => {
    const region = source.slice(navAt, credAt);
    expect(region).toContain("setNavMode(");
    expect(region).toContain("try {");
    expect(region).toContain("catch");
    expect(region).toContain("resyncAfterFailedSave(");
  });

  it("routes cred-mode save failures through the helper", () => {
    const region = source.slice(credAt, autoAt);
    expect(region).toContain("setCredMode(");
    expect(region).toContain("try {");
    expect(region).toContain("catch");
    expect(region).toContain("resyncAfterFailedSave(");
  });

  it("routes the auto-dismiss save rejection through the helper", () => {
    const region = source.slice(autoAt, endAt);
    expect(region).toContain("updateSuiteSettings(");
    expect(region).toContain(".catch(");
    expect(region).toContain("resyncAfterFailedSave(");
  });
});
