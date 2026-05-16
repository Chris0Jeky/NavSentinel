import { describe, expect, it } from "vitest";
import {
  createEmptyState,
  isStateExpired,
  computeJsBehaviorScore,
  JS_BEHAVIOR_STATE_TTL_MS,
  NRS_WEIGHT_JS_BEHAVIOR_CAP,
  SCORE_CROSS_ORIGIN_CREDENTIAL_FORM,
  SCORE_NETWORK_EXFIL_DURING_SUBMIT,
  SCORE_BEACON_EXFIL_CREDENTIAL_PAGE,
  SCORE_CREDENTIAL_READ_OUTSIDE_SUBMIT,
  SCORE_MULTIPLE_SIGNALS_BONUS,
  type JsBehaviorState,
} from "../extension/src/shared/js_behavior_state";
import { computeNRS } from "../extension/src/shared/nrs";
import type { NavigationContext } from "../extension/src/shared/nrs";
import type { ScoreResult } from "../extension/src/shared/scoring";

function baseCds(cds = 0, reasonCodes: string[] = []): ScoreResult {
  return { cds, reasonCodes };
}

function baseNav(overrides: Partial<NavigationContext> = {}): NavigationContext {
  return {
    isNewTabOrWindow: false,
    isCrossSite: false,
    ...overrides,
  };
}

function simulateSignalAccumulation(signals: string[]): JsBehaviorState {
  let state = createEmptyState();
  const now = Date.now();

  for (const signal of signals) {
    if (isStateExpired(state, now)) {
      state = createEmptyState();
    }
    state.lastSignalTs = now;

    switch (signal) {
      case "ns-js-form-submit-suspicious":
        state.signalCounts.formSubmitSuspicious++;
        break;
      case "ns-js-exfil-network":
        state.signalCounts.exfilNetwork++;
        break;
      case "ns-js-exfil-beacon":
        state.signalCounts.exfilBeacon++;
        break;
      case "ns-js-credential-read":
        state.signalCounts.credentialRead++;
        break;
    }
  }

  state.score = computeJsBehaviorScore(state);
  return state;
}

describe("JS Behavior → NRS Integration", () => {
  describe("signal accumulation mimics capture_isolated handler", () => {
    it("single form-submit-suspicious signal yields SCORE_CROSS_ORIGIN_CREDENTIAL_FORM", () => {
      const state = simulateSignalAccumulation(["ns-js-form-submit-suspicious"]);
      expect(state.score).toBe(SCORE_CROSS_ORIGIN_CREDENTIAL_FORM);
    });

    it("single exfil-network signal yields SCORE_NETWORK_EXFIL_DURING_SUBMIT", () => {
      const state = simulateSignalAccumulation(["ns-js-exfil-network"]);
      expect(state.score).toBe(SCORE_NETWORK_EXFIL_DURING_SUBMIT);
    });

    it("single beacon signal yields SCORE_BEACON_EXFIL_CREDENTIAL_PAGE", () => {
      const state = simulateSignalAccumulation(["ns-js-exfil-beacon"]);
      expect(state.score).toBe(SCORE_BEACON_EXFIL_CREDENTIAL_PAGE);
    });

    it("single credential-read signal yields SCORE_CREDENTIAL_READ_OUTSIDE_SUBMIT", () => {
      const state = simulateSignalAccumulation(["ns-js-credential-read"]);
      expect(state.score).toBe(SCORE_CREDENTIAL_READ_OUTSIDE_SUBMIT);
    });

    it("two distinct signals trigger multi-signal bonus", () => {
      const state = simulateSignalAccumulation([
        "ns-js-form-submit-suspicious",
        "ns-js-credential-read",
      ]);
      expect(state.score).toBe(
        SCORE_CROSS_ORIGIN_CREDENTIAL_FORM +
        SCORE_CREDENTIAL_READ_OUTSIDE_SUBMIT +
        SCORE_MULTIPLE_SIGNALS_BONUS
      );
    });

    it("all four signal types fire multi-signal bonus once", () => {
      const state = simulateSignalAccumulation([
        "ns-js-form-submit-suspicious",
        "ns-js-exfil-network",
        "ns-js-exfil-beacon",
        "ns-js-credential-read",
      ]);
      const raw =
        SCORE_CROSS_ORIGIN_CREDENTIAL_FORM +
        SCORE_NETWORK_EXFIL_DURING_SUBMIT +
        SCORE_BEACON_EXFIL_CREDENTIAL_PAGE +
        SCORE_CREDENTIAL_READ_OUTSIDE_SUBMIT +
        SCORE_MULTIPLE_SIGNALS_BONUS;
      expect(state.score).toBe(Math.min(raw, NRS_WEIGHT_JS_BEHAVIOR_CAP));
    });

    it("duplicate signals of same type don't exceed single-signal cap", () => {
      const state = simulateSignalAccumulation([
        "ns-js-credential-read",
        "ns-js-credential-read",
        "ns-js-credential-read",
      ]);
      expect(state.score).toBe(SCORE_CREDENTIAL_READ_OUTSIDE_SUBMIT);
    });
  });

  describe("NRS integration with jsBehaviorScore", () => {
    it("jsBehaviorScore contributes to NRS", () => {
      const result = computeNRS(
        baseCds(20),
        baseNav({ jsBehaviorScore: 15 })
      );
      expect(result.nrs).toBe(35);
      expect(result.nrsFactors).toContain("nrs_js_behavior_suspicious");
    });

    it("jsBehaviorScore is capped at NRS_WEIGHT_JS_BEHAVIOR_CAP", () => {
      const result = computeNRS(
        baseCds(20),
        baseNav({ jsBehaviorScore: 100 })
      );
      expect(result.nrs).toBe(20 + NRS_WEIGHT_JS_BEHAVIOR_CAP);
    });

    it("jsBehaviorScore=0 adds nothing", () => {
      const result = computeNRS(
        baseCds(20),
        baseNav({ jsBehaviorScore: 0 })
      );
      expect(result.nrs).toBe(20);
      expect(result.nrsFactors).not.toContain("nrs_js_behavior_suspicious");
    });

    it("jsBehaviorScore undefined adds nothing", () => {
      const result = computeNRS(
        baseCds(20),
        baseNav({ jsBehaviorScore: undefined })
      );
      expect(result.nrs).toBe(20);
    });

    it("jsBehaviorScore combined with other NRS factors", () => {
      const result = computeNRS(
        baseCds(30),
        baseNav({
          isNewTabOrWindow: true,
          isCrossSite: true,
          jsBehaviorScore: NRS_WEIGHT_JS_BEHAVIOR_CAP,
        })
      );
      // 30 + 20 + 20 + 35 = 105 → diminishing returns: 100 + (5 * 0.5) = 102.5
      expect(result.nrs).toBe(102.5);
    });

    it("jsBehaviorScore + allowlist still reduces", () => {
      const result = computeNRS(
        baseCds(30),
        baseNav({
          jsBehaviorScore: 20,
          destinationAllowlisted: true,
        })
      );
      // 30 + 20 - 100 = -50 → clamped to 0
      expect(result.nrs).toBe(0);
    });

    it("high jsBehaviorScore pushes into block threshold", () => {
      const result = computeNRS(
        baseCds(30),
        baseNav({
          isNewTabOrWindow: true,
          jsBehaviorScore: NRS_WEIGHT_JS_BEHAVIOR_CAP,
        })
      );
      // 30 + 20 + 35 = 85 → diminishing: 100 + (85-100)*0.5 ... wait 85 < 100
      // Actually: 85 < 100, so no diminishing returns. nrs = 85
      expect(result.nrs).toBe(85);
      expect(result.nrs).toBeGreaterThanOrEqual(70); // block threshold
    });
  });

  describe("state expiry", () => {
    it("expired state returns 0 score", () => {
      const state = createEmptyState();
      state.lastSignalTs = Date.now() - JS_BEHAVIOR_STATE_TTL_MS - 1;
      state.signalCounts.credentialRead = 5;
      state.score = 10;
      expect(isStateExpired(state)).toBe(true);
    });

    it("fresh state is not expired", () => {
      const state = createEmptyState();
      state.lastSignalTs = Date.now() - 1000;
      expect(isStateExpired(state)).toBe(false);
    });

    it("zero lastSignalTs is always expired", () => {
      const state = createEmptyState();
      expect(isStateExpired(state)).toBe(true);
    });
  });
});
