import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("bridge race condition fixes", () => {
  describe("issue #90: retry generation counter prevents closing active port", () => {
    it("stale retry callback is invalidated by generation counter", () => {
      let gen = 0;
      let _bridgeReady = false;

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

      _bridgeReady = true;
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
      let _bridgeReady = false;
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
      _bridgeReady = true;

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

  // D-BRIDGE: the MAIN-world guard had no timeout on the challenge handshake.
  // A port whose peer never echoes the challenge (a dead isolated context, or a
  // hostile page that posts a bridge init first then stalls) pinned bridgeSession
  // forever, so the `bridgeSession && data.session !== bridgeSession` guard then
  // rejected the real isolated world's init — permanently disabling the bridge.
  // These tests model main_guard.ts's handshake state machine + failBridgeHandshake.
  describe("D-BRIDGE: handshake timeout releases a half-open bridge", () => {
    interface FakePort {
      closed: boolean;
    }
    interface BridgeState {
      port: FakePort | null;
      session: string | null;
      verified: boolean;
      challenge: string | null;
      timer: number;
    }
    let s: BridgeState;

    const clearTimer = (): void => {
      if (s.timer) {
        clearTimeout(s.timer);
        s.timer = 0;
      }
    };

    const failHandshake = (): void => {
      s.timer = 0;
      if (s.verified) return;
      if (s.port) s.port.closed = true;
      s.port = null;
      s.session = null;
      s.challenge = null;
      s.verified = false;
    };

    // Models the BRIDGE_INIT branch of main_guard's message handler.
    const onInit = (session: string, port: FakePort = { closed: false }): boolean => {
      if (s.session && session !== s.session) return false; // session-pinning guard
      clearTimer();
      if (s.port) s.port.closed = true;
      s.port = port;
      s.session = session;
      s.verified = false;
      s.challenge = `challenge-${session}`;
      s.timer = setTimeout(failHandshake, 3000) as unknown as number;
      return true;
    };

    const onChallengeResponse = (challenge: string): void => {
      if (s.verified) return;
      if (challenge === s.challenge) {
        clearTimer();
        s.verified = true;
        s.challenge = null;
      }
    };

    beforeEach(() => {
      vi.useFakeTimers();
      s = { port: null, session: null, verified: false, challenge: null, timer: 0 };
    });
    afterEach(() => {
      vi.clearAllTimers();
      vi.useRealTimers();
    });

    it("a stalled init pins the session and would lock out the real bridge", () => {
      expect(onInit("attacker")).toBe(true);
      expect(onInit("real")).toBe(false); // rejected while pinned
      expect(s.session).toBe("attacker");
      expect(s.verified).toBe(false);
    });

    it("the timeout releases the half-open bridge so a fresh init re-establishes", () => {
      expect(onInit("attacker")).toBe(true);
      const attackerPort = s.port!;
      vi.advanceTimersByTime(3000);
      expect(s.session).toBeNull();
      expect(s.port).toBeNull();
      expect(attackerPort.closed).toBe(true);
      expect(onInit("real")).toBe(true); // now accepted
      expect(s.session).toBe("real");
    });

    it("does not tear down an already-verified bridge", () => {
      expect(onInit("real")).toBe(true);
      onChallengeResponse("challenge-real");
      expect(s.verified).toBe(true);
      failHandshake(); // a stale teardown must be a no-op once verified
      expect(s.verified).toBe(true);
      expect(s.session).toBe("real");
      expect(s.port).not.toBeNull();
    });

    it("successful verification clears the timer (no later teardown)", () => {
      expect(onInit("real")).toBe(true);
      onChallengeResponse("challenge-real");
      vi.advanceTimersByTime(10000);
      expect(s.verified).toBe(true);
      expect(s.session).toBe("real");
    });

    it("a superseding init (isolated retry, same session) resets the timer", () => {
      expect(onInit("real")).toBe(true);
      const firstPort = s.port!;
      vi.advanceTimersByTime(2000); // first timer would fire at 3000
      expect(onInit("real")).toBe(true); // retry resets the timer
      expect(firstPort.closed).toBe(true);
      vi.advanceTimersByTime(2000); // 4000 total, but new timer set at 2000 → fires at 5000
      expect(s.session).toBe("real"); // not yet torn down
      vi.advanceTimersByTime(1000); // reach 5000
      expect(s.session).toBeNull(); // now torn down
    });
  });
});
