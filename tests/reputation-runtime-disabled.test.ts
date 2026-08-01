import { describe, expect, it } from "vitest";
import {
  checkReputationViaMessage,
  getReputationStatus,
  isKnownBadDestination,
  loadReputationFilter,
  reputationEnabled,
} from "../extension/src/shared/reputation_runtime.disabled";

describe("interaction-only reputation runtime", () => {
  it("is an inert, network-free adapter", async () => {
    expect(reputationEnabled).toBe(false);
    await expect(loadReputationFilter({ debug: true, warnOnFailure: true })).resolves.toBeUndefined();
    expect(isKnownBadDestination("malware.example", "deep.malware.example")).toBe(false);
    await expect(checkReputationViaMessage("malware.example")).resolves.toEqual({
      knownBad: false,
      filterReady: false,
    });
    expect(getReputationStatus("malware.example")).toEqual({
      knownBad: false,
      filterReady: false,
    });
  });
});
