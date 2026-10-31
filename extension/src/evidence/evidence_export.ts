import { createEvidenceExport, MAX_EVIDENCE_EVENTS, type EvidenceEvent } from "./evidence_model";
import { readEventAssessment } from "../shared/event_assessment";

export const MAX_EVIDENCE_EXPORT_BYTES = 8 * 1024 * 1024;
export const EVIDENCE_EXPORT_LIMIT_MESSAGE = "This export exceeds 8 MiB. Narrow the journal filters and preview again.";

export interface EvidenceExportSnapshot {
  readonly text: string;
  readonly filename: string;
  readonly count: number;
  readonly bytes: number;
  readonly exportedAt: string;
}

/** Measure the same UTF-8 bytes a download Blob will contain; equality is valid. */
export function measureEvidenceExport(text: string): number {
  const bytes = new Blob([text]).size;
  if (bytes > MAX_EVIDENCE_EXPORT_BYTES) throw new RangeError(EVIDENCE_EXPORT_LIMIT_MESSAGE);
  return bytes;
}

/** Minimize, order and serialize once. Preview and download share these bytes. */
export function prepareEvidenceExport(events: readonly EvidenceEvent[], now = new Date()): EvidenceExportSnapshot {
  const payload = createEvidenceExport(events, now);
  return snapshot(payload, "evidence");
}

/** Only assessed portable observations leave; sites, scores and local IDs do not. */
export function prepareReviewExport(events: readonly (EvidenceEvent & { assessment?: unknown })[], now = new Date()): EvidenceExportSnapshot {
  const observations: EvidenceEvent[] = [];
  const corrections: { eventId: string; kind: string; timestamp: string }[] = [];
  for (const event of events.slice(-MAX_EVIDENCE_EVENTS).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))) {
    const assessment = readEventAssessment(event.assessment);
    if (!assessment?.kind) continue;
    const row = createEvidenceExport([event], now).events[0];
    if (!row) continue;
    row.id = `event-${observations.length + 1}`;
    row.sourceSite = row.destinationSite = null;
    delete row.score;
    observations.push(row);
    corrections.push({ eventId: row.id, kind: assessment.kind, timestamp: new Date(assessment.ts).toISOString() });
  }
  const payload = { format: "navsentinel-evidence-review", schema: 1, source: "navsentinel-extension",
    evidence: "recorded-observation-not-independent-proof", exportedAt: now.toISOString(), events: observations, corrections };
  return snapshot(payload, "review");
}

function snapshot(payload: { events: readonly unknown[]; exportedAt: string }, kind: string): EvidenceExportSnapshot {
  const text = JSON.stringify(payload, null, 2);
  const bytes = measureEvidenceExport(text);
  return Object.freeze({
    text,
    filename: `heedline-${kind}-${payload.exportedAt.slice(0, 10)}.json`,
    count: payload.events.length,
    bytes,
    exportedAt: payload.exportedAt,
  });
}
