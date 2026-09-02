import * as http from "node:http";
import { describe, expect, it } from "vitest";
import {
  PROVING_GROUND_SENTINEL,
  startProvingGroundEgressFence,
  startProvingGroundFakeSink,
  startProvingGroundFakeSinkForHost,
} from "./e2e/proving_ground_fake_sink";

describe("Proving Ground fake sink", () => {
  it("accepts one armed synthetic consequence and never retains the raw sentinel", async () => {
    const sink = await startProvingGroundFakeSink({
      runId: "unit-run",
      scenarioId: "NS-ADV-UI-004",
      allowedRoles: ["attack"],
      allowedConsequences: ["wrong-target-navigation"],
      targetAuthorities: [{
        id: "unit-attack-harm",
        role: "attack",
        consequence: "wrong-target-navigation",
        maxUses: 1,
      }],
    });

    try {
      expect(new URL(sink.origin).hostname).toBe("127.0.0.1");
      expect(() => sink.urlFor("attack", "wrong-target-navigation"))
        .toThrow("Target authority is not armed: missing");

      const targetUrl = sink.urlFor("attack", "wrong-target-navigation", "unit-attack-harm");
      const accepted = await fetch(targetUrl);
      expect(accepted.status).toBe(200);

      const invalidUrl = new URL(targetUrl);
      invalidUrl.searchParams.set("sentinel", "not-an-armed-sentinel");
      const rejected = await fetch(invalidUrl);
      expect(rejected.status).toBe(400);

      const replayed = await fetch(targetUrl);
      expect(replayed.status).toBe(409);

      const snapshot = sink.snapshot();
      expect(snapshot.receipts).toHaveLength(1);
      expect(snapshot.invalidAttempts).toHaveLength(2);
      expect(snapshot.invalidAttempts.map((attempt) => attempt.reason)).toEqual([
        "Only the exact synthetic sentinel is accepted",
        "Target authority use count is exhausted",
      ]);
      expect(snapshot.receipts[0]).toMatchObject({
        runId: "unit-run",
        scenarioId: "NS-ADV-UI-004",
        role: "attack",
        consequence: "wrong-target-navigation",
        targetId: "unit-attack-harm",
        method: "GET",
      });
      expect(snapshot.receipts[0]?.sentinelSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(JSON.stringify(snapshot)).not.toContain(PROVING_GROUND_SENTINEL);
    } finally {
      await sink.close();
    }
  });

  it("blocks and records non-loopback proxy traffic before a browser can send it", async () => {
    const attempts: Array<{ method: string; target: string; count: number }> = [];
    const fence = await startProvingGroundEgressFence(attempts);

    try {
      const proxy = new URL(fence.proxyServer);
      const statusCode = await new Promise<number | undefined>((resolve, reject) => {
        const request = http.request({
          hostname: proxy.hostname,
          port: proxy.port,
          method: "GET",
          path: "http://public.invalid/synthetic",
          headers: { host: "public.invalid" },
        }, (response) => {
          response.resume();
          response.once("end", () => resolve(response.statusCode));
        });
        request.once("error", reject);
        request.end();
      });

      expect(statusCode).toBe(403);
      expect(attempts).toEqual([{
        method: "GET",
        target: "http://public.invalid/synthetic",
        count: 1,
      }]);
    } finally {
      await fence.close();
    }
  });

  it("reaches a real IPv6 loopback sink or reports unsupported host family", async () => {
    let sink: Awaited<ReturnType<typeof startProvingGroundFakeSinkForHost>>;
    try {
      sink = await startProvingGroundFakeSinkForHost("::1", {
        runId: "unit-ipv6-run",
        scenarioId: "NS-ADV-WIN-001",
        allowedRoles: ["attack"],
        allowedConsequences: ["unauthorized-browsing-context"],
        targetAuthorities: [{
          id: "unit-ipv6-harm",
          role: "attack",
          consequence: "unauthorized-browsing-context",
          maxUses: 1,
        }],
      });
    } catch (error) {
      expect(error).toEqual(new Error("unsupported-loopback-host-family"));
      return;
    }

    try {
      expect(new URL(sink.origin).hostname).toBe("[::1]");
      const targetUrl = sink.urlFor("attack", "unauthorized-browsing-context", "unit-ipv6-harm");
      const accepted = await fetch(targetUrl);
      expect(accepted.status).toBe(200);
      expect(sink.snapshot().receipts).toEqual([expect.objectContaining({
        scenarioId: "NS-ADV-WIN-001",
        role: "attack",
        consequence: "unauthorized-browsing-context",
        targetId: "unit-ipv6-harm",
      })]);
    } finally {
      await sink.close();
    }
  });
});
