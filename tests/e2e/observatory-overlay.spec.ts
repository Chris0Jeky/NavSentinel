/** Developmental comparisons; deliberate observer faults use a separate lane. */
import { expect, test } from "@playwright/test";
import type { CapturedRun } from "../../experiments/evidence-observatory/recorder.mjs";
import { verifyCampaignInputs, runOverlayArm, attachOverlayTrace, consequenceVector } from "./observatory_overlay_harness";

test.setTimeout(150_000);
for (const churn of [false, true]) test(`Observatory ${churn ? "reinsertion" : "stable"} four-arm and observer-parity campaign @observatory`, async ({}, testInfo) => {
  const start = verifyCampaignInputs(); const variants = [];
  for (const instrumentation of ["full", "minimal"] as const) {
    const runs: CapturedRun[] = []; let browserVersion = "unknown";
    try {
      for (const arm of ["baseline", "protected", "benign", "mixed"] as const) {
        const result = await runOverlayArm(arm, churn, instrumentation); runs.push(result.run); browserVersion = result.browserVersion;
      }
    } finally {
      await attachOverlayTrace(testInfo, start, runs, browserVersion, `${churn ? "reinsertion" : "stable"}-${instrumentation}`, `${instrumentation}-trace.json`);
    }
    variants.push(runs);
  }
  expect(variants.flat().every(run => run.completed && run.capture.faults.length === 0)).toBe(true);
  expect(consequenceVector(variants[0]!)).toEqual(consequenceVector(variants[1]!));
});
