/** Frozen before qualification, not a perpetual unseen corpus after these are read. */
import { expect, test } from "@playwright/test";
import { CHALLENGES } from "../../experiments/evidence-observatory/campaign-plan.mjs";
import type { CapturedRun } from "../../experiments/evidence-observatory/recorder.mjs";
import { verifyCampaignInputs, runOverlayArm, attachOverlayTrace, consequenceVector } from "./observatory_overlay_harness";

test.setTimeout(150_000);
for (const challenge of CHALLENGES) test(`Frozen challenge ${challenge.id} @observatory-challenge`, async ({}, testInfo) => {
  const start = verifyCampaignInputs(), variants: CapturedRun[][] = [];
  for (const instrumentation of ["full", "minimal"] as const) {
    const runs: CapturedRun[] = []; let browserVersion = "unknown";
    try {
      for (const arm of ["baseline", "protected", "benign", "mixed"] as const) {
        const result = await runOverlayArm(arm, challenge.churn, instrumentation, challenge);
        runs.push(result.run); browserVersion = result.browserVersion;
      }
    } finally {
      await attachOverlayTrace(testInfo, start, runs, browserVersion, `${challenge.id}-${instrumentation}`, `${instrumentation}-trace.json`, challenge);
    }
    variants.push(runs);
  }
  expect(variants.flat().every(run => run.completed && run.capture.faults.length === 0)).toBe(true);
  expect(consequenceVector(variants[0]!)).toEqual(consequenceVector(variants[1]!));
});
