import { createEvidenceExport, type EvidenceEvent } from "./evidence_model";

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
  const text = JSON.stringify(payload, null, 2);
  const bytes = measureEvidenceExport(text);
  return Object.freeze({
    text,
    filename: `navsentinel-evidence-${payload.exportedAt.slice(0, 10)}.json`,
    count: payload.events.length,
    bytes,
    exportedAt: payload.exportedAt,
  });
}
