import type { EventLogEntry } from "../shared/storage";
import { isOverlayReviewReasonCode } from "./evidence_reasons";

export const OVERLAY_DIAGNOSTIC_FORMAT = "navsentinel-overlay-diagnostics";
export const OVERLAY_DIAGNOSTIC_SCHEMA = 1;
export const MAX_OVERLAY_DIAGNOSTIC_BYTES = 256 * 1024;
export const OVERLAY_DIAGNOSTIC_LIMIT_MESSAGE =
  "This diagnostic bundle exceeds 256 KiB. Clear behavioural data or wait for older entries to expire, then prepare again.";
export const MAX_OVERLAY_DIAGNOSTIC_RECORDS = 5000;
const MAX_DIAGNOSTIC_REASONS = 8;
const MAX_PRODUCT_VERSION_LEN = 32;

export const OVERLAY_DIAGNOSTIC_FRAMES = ["top", "child", "unknown"] as const;
export type OverlayDiagnosticFrame = (typeof OVERLAY_DIAGNOSTIC_FRAMES)[number];
export const OVERLAY_DIAGNOSTIC_OUTCOMES = [
  "suppressed",
  "reasserted",
  "already_hidden",
  "budget_limited",
  "restored",
  "user_reported_miss",
  "observed",
] as const;
export type OverlayDiagnosticOutcome = (typeof OVERLAY_DIAGNOSTIC_OUTCOMES)[number];
export const OVERLAY_DIAGNOSTIC_POSITIONS = ["fixed", "absolute", "sticky", "unknown"] as const;
export const OVERLAY_DIAGNOSTIC_GEOMETRY = ["quarter_to_half", "half_to_full", "full_or_more", "unknown"] as const;
export const OVERLAY_DIAGNOSTIC_STACKING = ["elevated", "high", "topmost", "unknown"] as const;
export const OVERLAY_DIAGNOSTIC_READINESS = ["ready", "degraded", "unknown"] as const;
export type OverlayDiagnosticReadiness = (typeof OVERLAY_DIAGNOSTIC_READINESS)[number];
export const OVERLAY_DIAGNOSTIC_ERRORS = ["none", "layout_unavailable", "classifier_failed", "unknown"] as const;
export type OverlayDiagnosticError = (typeof OVERLAY_DIAGNOSTIC_ERRORS)[number];

/** Finite overlay reason vocabulary for diagnostics; arbitrary strings never leave the browser. */
const DIAGNOSTIC_REASON_ALLOWLIST = new Set([
  "overlay_detected",
  "overlay_injected",
  "overlay_cleanup_undo",
  "overlay_cleanup_setting_off",
  "overlay_user_reported_miss",
]);

export interface OverlayDiagnosticRecord {
  frame: OverlayDiagnosticFrame;
  outcome: OverlayDiagnosticOutcome;
  reasonCodes: string[];
  positionBucket: string;
  geometryBucket: string;
  stackingBucket: string;
  timestamp: string;
  retryCount: number;
  readiness: OverlayDiagnosticReadiness;
  error: OverlayDiagnosticError;
}

export interface OverlayDiagnosticBundle {
  format: typeof OVERLAY_DIAGNOSTIC_FORMAT;
  schema: typeof OVERLAY_DIAGNOSTIC_SCHEMA;
  exportedAt: string;
  productVersion: string;
  browserMajor: number;
  records: OverlayDiagnosticRecord[];
}

export interface OverlayDiagnosticSnapshot {
  readonly text: string;
  readonly filename: string;
  readonly count: number;
  readonly bytes: number;
  readonly exportedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeField(value: unknown, key: string): unknown {
  try {
    if (!isRecord(value)) return undefined;
    return value[key];
  } catch {
    return undefined;
  }
}

export function sanitizeProductVersion(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_PRODUCT_VERSION_LEN) return "unknown";
  if (!/^[0-9A-Za-z._-]+$/.test(trimmed)) return "unknown";
  return trimmed;
}

export function sanitizeBrowserMajor(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const n = Math.trunc(value);
  if (n < 0 || n > 999) return 0;
  return n;
}

/** Parse only the major Chrome/Chromium version; full UA strings never leave the browser. */
export function browserMajorFromUserAgent(userAgent: unknown): number {
  if (typeof userAgent !== "string") return 0;
  const capped = userAgent.slice(0, 512);
  const match = /(?:Chrome|Chromium)\/(\d{1,3})/.exec(capped);
  if (!match) return 0;
  return sanitizeBrowserMajor(Number.parseInt(match[1]!, 10));
}

function sanitizeFrame(value: unknown): OverlayDiagnosticFrame {
  return value === "top" || value === "child" ? value : "unknown";
}

function sanitizeOutcome(value: unknown, reasons: readonly string[]): OverlayDiagnosticOutcome {
  if (value === "suppressed") return "suppressed";
  if (value === "reasserted") return "reasserted";
  if (value === "already_hidden") return "already_hidden";
  if (value === "budget_exhausted" || value === "budget_limited") return "budget_limited";
  if (value === "restored") return "restored";
  if (value === "user_reported_miss") return "user_reported_miss";
  if (reasons.includes("overlay_user_reported_miss")) return "user_reported_miss";
  if (reasons.includes("overlay_cleanup_undo") || reasons.includes("overlay_cleanup_setting_off")) return "restored";
  if (reasons.some((r) => r === "overlay_detected" || r === "overlay_injected")) return "observed";
  return "observed";
}

function sanitizeBucket(value: unknown, allow: readonly string[]): string {
  return typeof value === "string" && (allow as readonly string[]).includes(value) ? value : "unknown";
}

function sanitizeReasonCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const code of value) {
    if (out.length >= MAX_DIAGNOSTIC_REASONS) break;
    if (typeof code !== "string") continue;
    if (code.length === 0 || code.length > 80) continue;
    if (!DIAGNOSTIC_REASON_ALLOWLIST.has(code)) continue;
    if (!isOverlayReviewReasonCode(code)) continue;
    if (seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}

function sanitizeRetryCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const n = Math.trunc(value);
  if (!Number.isSafeInteger(n)) return 0;
  return Math.max(0, Math.min(128, n));
}

function sanitizeReadiness(value: unknown): OverlayDiagnosticReadiness {
  return value === "ready" || value === "degraded" ? value : "unknown";
}

function sanitizeError(value: unknown): OverlayDiagnosticError {
  if (value === "none" || value === "layout_unavailable" || value === "classifier_failed") return value;
  return "unknown";
}

function sanitizeTimestamp(ts: unknown): string | null {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return null;
  const date = new Date(ts);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

function diagRecord(value: unknown): Record<string, unknown> | undefined {
  const candidate = safeField(value, "overlayDiag");
  return isRecord(candidate) ? candidate : undefined;
}

/**
 * Strict allowlist projection for the diagnostic bundle. Never spreads or
 * serializes an EventLogEntry: only finite categories, bounded counts, and
 * ISO timestamps. Hostnames, URLs, internal IDs, arbitrary detail strings,
 * scores, labels, and extra fields are omitted by construction.
 */
export function projectOverlayDiagnostics(
  log: readonly EventLogEntry[],
  _context: { productVersion: unknown; browserMajor: unknown },
): OverlayDiagnosticRecord[] {
  const records: OverlayDiagnosticRecord[] = [];
  for (const entry of log.slice(-MAX_OVERLAY_DIAGNOSTIC_RECORDS)) {
    if (!entry || safeField(entry, "kind") !== "mutation_alert") continue;
    const timestamp = sanitizeTimestamp(safeField(entry, "ts"));
    if (!timestamp) continue;
    const rawReasons = safeField(entry, "reasons");
    const reasonCodes = sanitizeReasonCodes(Array.isArray(rawReasons) ? rawReasons : []);
    const extra = safeField(entry, "extra");
    const rawOutcome = safeField(extra, "overlayCleanupOutcome");
    const diag = diagRecord(extra);
    // A bare overlay detection without stored outcome still projects as observed.
    // A finite imported outcome alone is not enough to classify a row as overlay evidence.
    const outcome = sanitizeOutcome(rawOutcome, reasonCodes);
    if (reasonCodes.length === 0) continue;
    const record: OverlayDiagnosticRecord = {
      frame: sanitizeFrame(safeField(diag, "frame")),
      outcome,
      reasonCodes,
      positionBucket: sanitizeBucket(safeField(diag, "positionBucket"), OVERLAY_DIAGNOSTIC_POSITIONS),
      geometryBucket: sanitizeBucket(
        safeField(diag, "geometryBucket") ?? safeField(diag, "coverageBucket"),
        OVERLAY_DIAGNOSTIC_GEOMETRY,
      ),
      stackingBucket: sanitizeBucket(safeField(diag, "stackingBucket"), OVERLAY_DIAGNOSTIC_STACKING),
      timestamp,
      retryCount: sanitizeRetryCount(safeField(diag, "retryCount")),
      readiness: sanitizeReadiness(safeField(diag, "readiness")),
      error: sanitizeError(safeField(diag, "error")),
    };
    records.push(record);
  }
  return records.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

export function createOverlayDiagnosticBundle(
  log: readonly EventLogEntry[],
  context: { productVersion: unknown; browserMajor: unknown },
  now = new Date(),
): OverlayDiagnosticBundle {
  const records = projectOverlayDiagnostics(log, context);
  const exportedAt = Number.isFinite(now.getTime()) ? now.toISOString() : new Date().toISOString();
  return {
    format: OVERLAY_DIAGNOSTIC_FORMAT,
    schema: OVERLAY_DIAGNOSTIC_SCHEMA,
    exportedAt,
    productVersion: sanitizeProductVersion(context.productVersion),
    browserMajor: sanitizeBrowserMajor(context.browserMajor),
    records,
  };
}

/** Measure the same UTF-8 bytes a download Blob will contain. */
export function measureOverlayDiagnosticExport(text: string): number {
  const bytes = new Blob([text]).size;
  if (bytes > MAX_OVERLAY_DIAGNOSTIC_BYTES) throw new RangeError(OVERLAY_DIAGNOSTIC_LIMIT_MESSAGE);
  return bytes;
}

/** Minimize, order, and serialize once. Preview and download share these bytes. */
export function prepareOverlayDiagnosticExport(
  log: readonly EventLogEntry[],
  context: { productVersion: unknown; browserMajor: unknown },
  now = new Date(),
): OverlayDiagnosticSnapshot {
  const payload = createOverlayDiagnosticBundle(log, context, now);
  const text = JSON.stringify(payload, null, 2);
  const bytes = measureOverlayDiagnosticExport(text);
  return Object.freeze({
    text,
    filename: `navsentinel-overlay-diagnostics-${payload.exportedAt.slice(0, 10)}.json`,
    count: payload.records.length,
    bytes,
    exportedAt: payload.exportedAt,
  });
}
