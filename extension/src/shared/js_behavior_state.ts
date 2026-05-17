/**
 * Shared JS Behavior state and scoring utilities.
 *
 * Importable by both main-world (js_behavior_monitor.ts) and
 * isolated-world (capture_isolated.ts) without pulling in
 * side-effect-bearing patch code.
 */

export interface JsBehaviorState {
  score: number;
  lastSignalTs: number;
  signalCounts: {
    formSubmitSuspicious: number;
    dynamicFormAction: number;
    exfilNetwork: number;
    exfilBeacon: number;
    credentialRead: number;
  };
  signalLastTs: {
    formSubmitSuspicious: number;
    dynamicFormAction: number;
    exfilNetwork: number;
    exfilBeacon: number;
    credentialRead: number;
  };
}

export const JS_BEHAVIOR_STATE_TTL_MS = 30_000;
export const NRS_WEIGHT_JS_BEHAVIOR_CAP = 35;
export const JS_BEHAVIOR_MULTI_SIGNAL_WINDOW_MS = 5_000;

export const SCORE_CROSS_ORIGIN_CREDENTIAL_FORM = 15;
export const SCORE_DYNAMIC_FORM_ACTION = 10;
export const SCORE_NETWORK_EXFIL_DURING_SUBMIT = 20;
export const SCORE_BEACON_EXFIL_CREDENTIAL_PAGE = 15;
export const SCORE_CREDENTIAL_READ_OUTSIDE_SUBMIT = 10;
export const SCORE_MULTIPLE_SIGNALS_BONUS = 10;


export function createEmptyState(): JsBehaviorState {
  return {
    score: 0,
    lastSignalTs: 0,
    signalCounts: {
      formSubmitSuspicious: 0,
      dynamicFormAction: 0,
      exfilNetwork: 0,
      exfilBeacon: 0,
      credentialRead: 0,
    },
    signalLastTs: {
      formSubmitSuspicious: 0,
      dynamicFormAction: 0,
      exfilNetwork: 0,
      exfilBeacon: 0,
      credentialRead: 0,
    },
  };
}

export function isStateExpired(state: JsBehaviorState, now?: number): boolean {
  if (state.lastSignalTs === 0) return true;
  const currentTime = now ?? Date.now();
  return currentTime - state.lastSignalTs > JS_BEHAVIOR_STATE_TTL_MS;
}

export function computeJsBehaviorScore(state: JsBehaviorState): number {
  let score = 0;

  score += Math.min(
    state.signalCounts.formSubmitSuspicious * SCORE_CROSS_ORIGIN_CREDENTIAL_FORM,
    SCORE_CROSS_ORIGIN_CREDENTIAL_FORM
  );
  score += Math.min(
    state.signalCounts.dynamicFormAction * SCORE_DYNAMIC_FORM_ACTION,
    SCORE_DYNAMIC_FORM_ACTION
  );
  score += Math.min(
    state.signalCounts.exfilNetwork * SCORE_NETWORK_EXFIL_DURING_SUBMIT,
    SCORE_NETWORK_EXFIL_DURING_SUBMIT
  );
  score += Math.min(
    state.signalCounts.exfilBeacon * SCORE_BEACON_EXFIL_CREDENTIAL_PAGE,
    SCORE_BEACON_EXFIL_CREDENTIAL_PAGE
  );
  score += Math.min(
    state.signalCounts.credentialRead * SCORE_CREDENTIAL_READ_OUTSIDE_SUBMIT,
    SCORE_CREDENTIAL_READ_OUTSIDE_SUBMIT
  );

  const recentSignals = Object.entries(state.signalLastTs)
    .filter(([, ts]) => ts > 0 && state.lastSignalTs - ts <= JS_BEHAVIOR_MULTI_SIGNAL_WINDOW_MS);
  if (recentSignals.length >= 2) {
    score += SCORE_MULTIPLE_SIGNALS_BONUS;
  }

  return Math.min(score, NRS_WEIGHT_JS_BEHAVIOR_CAP);
}

