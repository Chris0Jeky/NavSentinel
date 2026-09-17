import { describe, expect, it } from "vitest";
import { startProvingGroundFakeSink } from "./e2e/proving_ground_fake_sink";

// Each case owns a short-lived server which may reuse the same safe port.
// Drain and close the response instead of reusing an undici pool across servers.
async function requestOnce(url: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, { ...init, headers: { connection: "close", ...init.headers } });
  await response.arrayBuffer();
  return response;
}
const options = {
  runId: "observatory-health-run", scenarioId: "NS-ADV-UI-004",
  allowedRoles: ["attack" as const], allowedConsequences: ["wrong-target-navigation"],
  targetAuthorities: [{ id: "harm", role: "attack" as const, consequence: "wrong-target-navigation", maxUses: 1 }],
};
describe("Observatory independent receiver health", () => {
  it("checks a separate live channel without consuming a one-use target", async () => {
    const sink = await startProvingGroundFakeSink(options);
    try {
      expect(typeof sink.probe).toBe("function");
      const before = await sink.probe();
      expect(before).toMatchObject({ healthy: true, receiptCount: 0, invalidAttempts: 0, observerErrors: 0 });
      expect(before.targetUses).toEqual({ harm: 0 });
      const second = await sink.probe();
      expect(second.healthSequence).toBe(before.healthSequence + 1);
      expect(sink.snapshot()).toEqual({ receipts: [], invalidAttempts: [] });
      const response = await requestOnce(sink.urlFor("attack", "wrong-target-navigation", "harm"));
      expect(response.status).toBe(200);
      const after = await sink.probe();
      expect(after.targetUses).toEqual({ harm: 1 });
      expect(after.receiptCount).toBe(1);
      expect((await requestOnce(sink.urlFor("attack", "wrong-target-navigation", "harm"))).status).toBe(409);
      expect((await sink.probe()).invalidAttempts).toBe(1);
    } finally { await sink.close(); }
    expect((await sink.probe()).healthy).toBe(false);
  });
  it("reports independently accepted copies to subscribers and detaches them", async () => {
    const sink = await startProvingGroundFakeSink(options);
    try {
      const receipts: unknown[] = [];
      expect(typeof sink.observe).toBe("function");
      const off = sink.observe(receipt => { receipts.push(receipt); receipt.runId = "mutated-observer"; });
      await requestOnce(sink.urlFor("attack", "wrong-target-navigation", "harm"));
      off(); off();
      expect(receipts).toHaveLength(1);
      expect(sink.snapshot().receipts[0]?.runId).toBe(options.runId);
      expect((await sink.probe()).observerErrors).toBe(0);
    } finally { await sink.close(); }
  });
  it("observer failure cannot erase acceptance or stop the receiver", async () => {
    const sink = await startProvingGroundFakeSink(options);
    try {
      expect(typeof sink.observe).toBe("function");
      sink.observe(() => { throw new Error("TEST_OBSERVER_FAILURE"); });
      expect((await requestOnce(sink.urlFor("attack", "wrong-target-navigation", "harm"))).status).toBe(200);
      expect(sink.snapshot().receipts).toHaveLength(1);
      expect(await sink.probe()).toMatchObject({ healthy: true, receiptCount: 1, observerErrors: 1 });
    } finally { await sink.close(); }
  });
  it("uncredentialed probe-shaped browser traffic is not a health acknowledgement", async () => {
    const sink = await startProvingGroundFakeSink(options);
    try {
      expect(typeof sink.probe).toBe("function");
      const res = await requestOnce(`${sink.origin}/__navsentinel_sink_health`, { method: "HEAD" });
      expect(res.status).not.toBe(204);
      expect((await sink.probe()).targetUses).toEqual({ harm: 0 });
    } finally { await sink.close(); }
  });
});
