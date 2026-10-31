export const EVENT_ASSESSMENTS = ["should-block", "should-allow", "uncertain"] as const;
export type EventAssessmentKind = typeof EVENT_ASSESSMENTS[number];
export interface EventAssessment { kind: EventAssessmentKind | null; ts: number }

/** Opinions never change an observation or supply detector evidence. */
export function readEventAssessment(value: unknown): EventAssessment | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const item = value as EventAssessment;
  if ((item.kind === null || EVENT_ASSESSMENTS.includes(item.kind)) && Number.isSafeInteger(item.ts) && item.ts >= 0 && Number.isFinite(new Date(item.ts).getTime())) {
    return { kind: item.kind, ts: item.ts };
  }
}

/** Editing an opinion must not change the identity of the observed facts. */
export function eventObservationKey(entry: object): string {
  return JSON.stringify({ ...entry, assessment: undefined });
}
