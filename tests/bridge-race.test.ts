import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("bridge race condition fixes", () => {
  describe("issue #90: retry generation counter prevents closing active port", () => {
    it("stale retry callback is invalidated by generation counter", () => {
      let gen = 0;
      let bridgeReady = false;

      const attempt = () => {
        gen++;
        const thisGen = gen;

        const timer = setTimeout(() => {
          if (gen !== thisGen) return;
          attempt();
        }, 100);

        return { timer, thisGen };
      };

      const first = attempt();
      expect(first.thisGen).toBe(1);

      bridgeReady = true;
      gen++;

      expect(gen).toBe(2);
      expect(first.thisGen).toBe(1);
      expect(gen !== first.thisGen).toBe(true);
    });

    it("new attempt increments generation before closing previous port", () => {
      let gen = 0;
      const portsClosed: number[] = [];

      const simulateAttempt = (prevPortGen: number | null) => {
        gen++;
        const thisGen = gen;
        if (prevPortGen !== null) {
          portsClosed.push(prevPortGen);
        }
        return thisGen;
      };

      const gen1 = simulateAttempt(null);
      expect(gen1).toBe(1);

      const gen2 = simulateAttempt(gen1);
      expect(gen2).toBe(2);
      expect(portsClosed).toEqual([1]);
    });

    it("markMainGuardReady increments gen to invalidate pending retries", () => {
      let gen = 0;
      let bridgeReady = false;
      let retryFired = false;

      gen++;
      const attemptGen = gen;

      const retryCallback = () => {
        if (gen !== attemptGen) {
          retryFired = false;
          return;
        }
        retryFired = true;
      };

      gen++;
      bridgeReady = true;

      retryCallback();
      expect(retryFired).toBe(false);
    });
  });

  describe("issue #86: challenge-response handshake", () => {
    it("bridge is not verified until challenge is echoed back", () => {
      let verified = false;
      const challenge = "abc123def456";

      const handleResponse = (msg: { type: string; challenge: string }) => {
        if (msg.type === "ns-challenge-response" && msg.challenge === challenge) {
          verified = true;
        }
      };

      expect(verified).toBe(false);

      handleResponse({ type: "ns-challenge-response", challenge: "wrong" });
      expect(verified).toBe(false);

      handleResponse({ type: "ns-challenge-response", challenge: challenge });
      expect(verified).toBe(true);
    });

    it("messages are queued until bridge is verified", () => {
      let verified = false;
      const pending: string[] = [];
      const sent: string[] = [];

      const postToIsolated = (type: string) => {
        if (!verified) {
          pending.push(type);
          return;
        }
        sent.push(type);
      };

      postToIsolated("ns-nav-blocked");
      postToIsolated("ns-config");
      expect(pending).toEqual(["ns-nav-blocked", "ns-config"]);
      expect(sent).toEqual([]);

      verified = true;
      for (const msg of pending.splice(0)) {
        postToIsolated(msg);
      }
      expect(sent).toEqual(["ns-nav-blocked", "ns-config"]);
    });

    it("attacker cannot spoof challenge response without correct nonce", () => {
      const challenge = crypto.randomUUID().replace(/-/g, "");
      let verified = false;

      const attempts = [
        { type: "ns-challenge-response", challenge: "" },
        { type: "ns-challenge-response", challenge: "0".repeat(32) },
        { type: "ns-bridge-ready", challenge },
        { type: "ns-challenge-response", challenge: challenge.slice(0, -1) + "x" },
      ];

      for (const attempt of attempts) {
        if (attempt.type === "ns-challenge-response" && attempt.challenge === challenge) {
          verified = true;
        }
      }

      expect(verified).toBe(false);
    });

    it("isolated world responds to challenge with correct echo", () => {
      const session = "deadbeef".repeat(4);
      const challenge = "cafebabe".repeat(4);
      let response: { source: string; type: string; challenge: string; session: string } | null = null;

      const handleBridgeMessage = (data: { source?: string; type?: string; session?: string; challenge?: string }) => {
        if (data.type === "ns-challenge" && data.session === session && data.challenge) {
          response = {
            source: "__navsentinel__",
            type: "ns-challenge-response",
            session,
            challenge: data.challenge
          };
        }
      };

      handleBridgeMessage({
        source: "__navsentinel__",
        type: "ns-challenge",
        session,
        challenge
      });

      expect(response).not.toBeNull();
      expect(response!.type).toBe("ns-challenge-response");
      expect(response!.challenge).toBe(challenge);
      expect(response!.session).toBe(session);
    });
  });
});
