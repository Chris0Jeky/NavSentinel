import { recordClipboardWrite } from "./clickfix_detector";

export interface ClipboardBridgeMetadata {
  /** Untrusted producer timestamp retained only as bridge metadata. */
  ts?: unknown;
  contentLength?: unknown;
  looksLikeCommand?: unknown;
}

/**
 * Admit MAIN-world clipboard metadata using isolated-world receipt time.
 * The producer timestamp is deliberately ignored for freshness authority.
 */
export function recordClipboardBridgeWrite(
  data: ClipboardBridgeMetadata,
  receivedAtMs = Date.now(),
): void {
  const receiptTs = Number.isFinite(receivedAtMs) ? receivedAtMs : Date.now();
  recordClipboardWrite({
    ts: receiptTs,
    contentLength: typeof data.contentLength === "number" ? data.contentLength : -1,
    looksLikeCommand: data.looksLikeCommand === true,
  });
}
