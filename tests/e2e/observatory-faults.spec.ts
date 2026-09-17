/** A green TEST here means a broken observer was diagnosed, NOT a prevented attack. */
import { expect, test } from "@playwright/test";
import { FAULT_IDS, assessFaultTrace } from "../../experiments/evidence-observatory/fault-contract.mjs";
import { verifyCampaignInputs, runOverlayArm, attachOverlayTrace } from "./observatory_overlay_harness";

test.setTimeout(90_000);
for (const faultId of FAULT_IDS) test(`Observer fault ${faultId} remains inconclusive @observatory-fault`, async ({}, testInfo) => {
  const start = verifyCampaignInputs();
  const arm = ["page-report-flood", "receiver-observer-error"].includes(faultId) ? "baseline" : "protected";
  const result = await runOverlayArm(arm, false, "full", { fault: faultId });
  const trace = await attachOverlayTrace(testInfo, start, [result.run], result.browserVersion, `fault-${faultId}`, "fault-trace.json");
  expect(result.error, "Unexpected runner failures cannot be hidden by a detected fault").toBeNull();
  const assessment = assessFaultTrace(trace);
  expect(assessment.status, JSON.stringify(assessment)).toBe("FAULT_DETECTED");
  expect(assessment.preventionSupported).toBe(false);
});
