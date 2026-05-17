import { describe, expect, it } from "vitest";
import {
  createEmptyState,
  isStateExpired,
  computeJsBehaviorScore,
  JS_BEHAVIOR_STATE_TTL_MS,
  JS_BEHAVIOR_MULTI_SIGNAL_WINDOW_MS,
  NRS_WEIGHT_JS_BEHAVIOR_CAP,
  SCORE_DYNAMIC_FORM_ACTION,
  type JsBehaviorState,
} from "../extension/src/shared/js_behavior_state";

function markSignal(
  state: JsBehaviorState,
  key: keyof JsBehaviorState["signalCounts"],
  ts = Date.now()
): void {
  state.lastSignalTs = ts;
  state.signalCounts[key] = 1;
  state.signalLastTs[key] = ts;
}

describe("js_behavior_state", () => {
  describe("createEmptyState", () => {
    it("returns zeroed state", () => {
      const state = createEmptyState();
      expect(state.score).toBe(0);
      expect(state.lastSignalTs).toBe(0);
      expect(state.signalCounts.formSubmitSuspicious).toBe(0);
      expect(state.signalCounts.dynamicFormAction).toBe(0);
      expect(state.signalCounts.exfilNetwork).toBe(0);
      expect(state.signalCounts.exfilBeacon).toBe(0);
      expect(state.signalCounts.credentialRead).toBe(0);
      expect(state.signalLastTs.dynamicFormAction).toBe(0);
    });

    it("returns a new object each time", () => {
      const a = createEmptyState();
      const b = createEmptyState();
      expect(a).not.toBe(b);
    });
  });

  describe("isStateExpired", () => {
    it("returns true for empty state (lastSignalTs = 0)", () => {
      expect(isStateExpired(createEmptyState())).toBe(true);
    });

    it("returns false for recent state", () => {
      const state = createEmptyState();
      state.lastSignalTs = Date.now() - 1000;
      expect(isStateExpired(state)).toBe(false);
    });

    it("returns true for state older than TTL", () => {
      const state = createEmptyState();
      state.lastSignalTs = Date.now() - JS_BEHAVIOR_STATE_TTL_MS - 1;
      expect(isStateExpired(state)).toBe(true);
    });

    it("uses provided now parameter", () => {
      const state = createEmptyState();
      state.lastSignalTs = 1000;
      expect(isStateExpired(state, 1000 + JS_BEHAVIOR_STATE_TTL_MS)).toBe(false);
      expect(isStateExpired(state, 1000 + JS_BEHAVIOR_STATE_TTL_MS + 1)).toBe(true);
    });
  });

  describe("computeJsBehaviorScore", () => {
    it("returns 0 for empty state", () => {
      expect(computeJsBehaviorScore(createEmptyState())).toBe(0);
    });

    it("scores single form submit signal at 15", () => {
      const state = createEmptyState();
      state.signalCounts.formSubmitSuspicious = 1;
      expect(computeJsBehaviorScore(state)).toBe(15);
    });

    it("scores single dynamic form action signal at 10", () => {
      const state = createEmptyState();
      state.signalCounts.dynamicFormAction = 1;
      expect(computeJsBehaviorScore(state)).toBe(SCORE_DYNAMIC_FORM_ACTION);
    });

    it("scores single network exfil signal at 20", () => {
      const state = createEmptyState();
      state.signalCounts.exfilNetwork = 1;
      expect(computeJsBehaviorScore(state)).toBe(20);
    });

    it("scores single beacon exfil signal at 15", () => {
      const state = createEmptyState();
      state.signalCounts.exfilBeacon = 1;
      expect(computeJsBehaviorScore(state)).toBe(15);
    });

    it("scores single credential read signal at 10", () => {
      const state = createEmptyState();
      state.signalCounts.credentialRead = 1;
      expect(computeJsBehaviorScore(state)).toBe(10);
    });

    it("adds multiple signals bonus when 2+ types fire", () => {
      const state = createEmptyState();
      const now = Date.now();
      markSignal(state, "formSubmitSuspicious", now);
      markSignal(state, "exfilNetwork", now + 1000);
      // 15 + 20 + 10 (bonus) = 45, capped at 35
      expect(computeJsBehaviorScore(state)).toBe(NRS_WEIGHT_JS_BEHAVIOR_CAP);
    });

    it("does not add multiple signals bonus outside the correlation window", () => {
      const state = createEmptyState();
      const now = Date.now();
      markSignal(state, "formSubmitSuspicious", now);
      markSignal(state, "credentialRead", now + JS_BEHAVIOR_MULTI_SIGNAL_WINDOW_MS + 1);

      expect(computeJsBehaviorScore(state)).toBe(25);
    });

    it("caps at NRS_WEIGHT_JS_BEHAVIOR_CAP (35)", () => {
      const state: JsBehaviorState = {
        score: 0,
        lastSignalTs: Date.now(),
        signalCounts: {
          formSubmitSuspicious: 5,
          dynamicFormAction: 5,
          exfilNetwork: 5,
          exfilBeacon: 5,
          credentialRead: 5,
        },
        signalLastTs: {
          formSubmitSuspicious: Date.now(),
          dynamicFormAction: Date.now(),
          exfilNetwork: Date.now(),
          exfilBeacon: Date.now(),
          credentialRead: Date.now(),
        },
      };
      expect(computeJsBehaviorScore(state)).toBe(NRS_WEIGHT_JS_BEHAVIOR_CAP);
    });

    it("individual signal types are capped (no repeated inflation)", () => {
      const state = createEmptyState();
      state.signalCounts.formSubmitSuspicious = 10;
      // Even with 10 form submits, score is capped at single signal value (15)
      expect(computeJsBehaviorScore(state)).toBe(15);
    });

    it("does not add bonus for single signal type", () => {
      const state = createEmptyState();
      state.signalCounts.credentialRead = 3;
      expect(computeJsBehaviorScore(state)).toBe(10);
    });
  });
});
