import { describe, expect, it } from "vitest";
import { redactError } from "./receipt";
import { waitForMaintainerReadiness, type MaintainerReadinessMarkers } from "./readiness";

const expectedGuard = "exact-build-guard";
const ready: MaintainerReadinessMarkers = { capture: "1", bridge: "1", ui_guard: expectedGuard };

function page(options: {
  wait?: () => Promise<unknown>;
  markers?: MaintainerReadinessMarkers;
  evaluate?: () => Promise<MaintainerReadinessMarkers>;
}): Parameters<typeof waitForMaintainerReadiness>[0] {
  return {
    waitForFunction: async () => options.wait?.(),
    evaluate: async <T>() => (options.evaluate ? await options.evaluate() : options.markers ?? ready) as T,
  };
}

describe("maintainer headed readiness", () => {
  it("waits before recording final exact markers", async () => {
    const events: string[] = [];
    const result = await waitForMaintainerReadiness({
      waitForFunction: async (_pageFunction, guard, options) => {
        events.push("wait");
        expect(guard).toBe(expectedGuard);
        expect(options).toEqual({ timeout: 123 });
      },
      evaluate: async <T>() => {
        events.push("evaluate");
        return ready as T;
      },
    }, expectedGuard, 123);
    expect(result).toEqual(ready);
    expect(events).toEqual(["wait", "evaluate"]);
  });

  it("rejects a final marker mismatch after the readiness wait", async () => {
    await expect(waitForMaintainerReadiness(
      page({ markers: { ...ready, bridge: null } }),
      expectedGuard,
    )).rejects.toMatchObject({ classification: "extension_readiness", code: "readiness-marker-mismatch" });
  });

  it("classifies timeout without retaining raw page text", async () => {
    const secret = "private-page-error-must-not-persist";
    const timeout = Object.assign(new Error(secret), { name: "TimeoutError" });
    let failure: unknown;
    try {
      await waitForMaintainerReadiness(page({ wait: async () => Promise.reject(timeout) }), expectedGuard);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ classification: "extension_readiness", code: "readiness-wait-timeout" });
    expect(JSON.stringify(redactError(failure))).not.toContain(secret);
  });

  it("classifies marker evaluation failure without raw page text", async () => {
    const secret = "private-evaluation-error-must-not-persist";
    let failure: unknown;
    try {
      await waitForMaintainerReadiness(page({ evaluate: async () => Promise.reject(new Error(secret)) }), expectedGuard);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ classification: "extension_readiness", code: "readiness-marker-evaluation-failed" });
    expect(JSON.stringify(redactError(failure))).not.toContain(secret);
  });

  it("classifies a non-timeout wait failure as evaluation failure", async () => {
    await expect(waitForMaintainerReadiness(
      page({ wait: async () => Promise.reject(new Error("page execution failed")) }),
      expectedGuard,
    )).rejects.toMatchObject({ classification: "extension_readiness", code: "readiness-wait-evaluation-failed" });
  });
});
