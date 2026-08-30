import { describe, expect, it } from "vitest";
import {
  PROVING_GROUND_SENTINEL,
  startProvingGroundFakeSink,
} from "./e2e/proving_ground_fake_sink";

describe("Proving Ground fake sink", () => {
  it("accepts only the armed synthetic consequence and never retains the raw sentinel", async () => {
    const sink = await startProvingGroundFakeSink({
      runId: "unit-run",
      scenarioId: "NS-ADV-UI-004",
      allowedRoles: ["attack"],
      allowedConsequences: ["wrong-target-navigation"],
    });

    try {
      expect(new URL(sink.origin).hostname).toBe("127.0.0.1");

      const accepted = await fetch(sink.urlFor("attack", "wrong-target-navigation"));
      expect(accepted.status).toBe(200);

      const invalidUrl = new URL(sink.urlFor("attack", "wrong-target-navigation"));
      invalidUrl.searchParams.set("sentinel", "not-an-armed-sentinel");
      const rejected = await fetch(invalidUrl);
      expect(rejected.status).toBe(400);

      const snapshot = sink.snapshot();
      expect(snapshot.receipts).toHaveLength(1);
      expect(snapshot.invalidAttempts).toHaveLength(1);
      expect(snapshot.receipts[0]).toMatchObject({
        runId: "unit-run",
        scenarioId: "NS-ADV-UI-004",
        role: "attack",
        consequence: "wrong-target-navigation",
        method: "GET",
      });
      expect(snapshot.receipts[0]?.sentinelSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(JSON.stringify(snapshot)).not.toContain(PROVING_GROUND_SENTINEL);
    } finally {
      await sink.close();
    }
  });
});
