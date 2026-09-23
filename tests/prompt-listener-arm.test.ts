import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `showAllowPrompt()` runs once per blocked navigation (popup / form-submit /
 * click paths), but the persistent `pageshow` / `visibilitychange` listeners
 * it needs must be armed exactly once per page lifetime. Registering them
 * inline leaks another listener pair per prompt, and every bfcache restore
 * then fans out N duplicate chain-info requests (each
 * `handleChainInfoPageShow` call bumps `requestGeneration`, so duplicates are
 * not deduped).
 *
 * Source-level structural suite in the style of the #389 `capture_isolated`
 * priming-order tests: `showAllowPrompt` is not exported and the module has
 * import-time side effects, so the suite asserts on the source shape. It
 * fails against the pre-fix source, where the two `addEventListener` calls
 * sat unguarded in the `showAllowPrompt` body. (Brace matching is avoided:
 * the 190-line prompt body contains braces inside string literals.)
 */
describe("showAllowPrompt arms persistent listeners once (#847)", () => {
  const source = readFileSync(
    resolve("extension/src/content/capture_isolated.ts"),
    "utf8",
  );

  const HELPER = "function armForwardPollListenersOnce(";
  const PROMPT_START = "function showAllowPrompt(params: AllowPromptParams)";
  // Module-level statement that immediately follows showAllowPrompt's closing
  // brace; anchors the end of the prompt region without brace matching.
  const PROMPT_END_ANCHOR = 'window.addEventListener(\n  "pointerdown"';

  it("declares a module-level armed flag", () => {
    expect(source).toContain("let forwardPollListenersArmed = false;");
  });

  it("guards the once-helper with an early return", () => {
    const helperAt = source.indexOf(HELPER);
    const promptAt = source.indexOf(PROMPT_START);
    expect(helperAt).toBeGreaterThanOrEqual(0);
    expect(promptAt).toBeGreaterThan(helperAt);
    const helperRegion = source.slice(helperAt, promptAt);
    expect(helperRegion).toContain("if (forwardPollListenersArmed) return;");
    expect(helperRegion).toContain("forwardPollListenersArmed = true;");
  });

  it("registers both persistent listeners inside the once-helper, in order", () => {
    const helperAt = source.indexOf(HELPER);
    const promptAt = source.indexOf(PROMPT_START);
    const armedAt = source.indexOf("forwardPollListenersArmed = true;");
    const pageShowAt = source.indexOf('addEventListener("pageshow"');
    const visAt = source.indexOf('addEventListener("visibilitychange"');
    for (const at of [armedAt, pageShowAt, visAt]) {
      expect(at).toBeGreaterThan(helperAt);
      expect(at).toBeLessThan(promptAt);
    }
    expect(armedAt).toBeLessThan(pageShowAt);
    expect(pageShowAt).toBeLessThan(visAt);
    // No second pageshow/visibilitychange registration anywhere in the module.
    expect(source.split('addEventListener("pageshow"').length - 1).toBe(1);
    expect(source.split('addEventListener("visibilitychange"').length - 1).toBe(
      1,
    );
  });

  it("calls the once-helper from showAllowPrompt without inline listeners", () => {
    const promptAt = source.indexOf(PROMPT_START);
    const endAt = source.indexOf(PROMPT_END_ANCHOR);
    expect(promptAt).toBeGreaterThanOrEqual(0);
    expect(endAt).toBeGreaterThan(promptAt);
    const promptRegion = source.slice(promptAt, endAt);
    expect(promptRegion).toContain("armForwardPollListenersOnce(");
    expect(promptRegion).not.toContain('addEventListener("pageshow"');
    expect(promptRegion).not.toContain('addEventListener("visibilitychange"');
  });

  it("keeps the per-prompt immediate checks", () => {
    // Every prompt must still kick fresh rollback/forward checks; only the
    // persistent listener registration is once-per-page.
    expect(source).toContain("run();");
    expect(source).toContain("} else {\n    runForward();\n  }");
  });
});
