/**
 * Bounded outbound buffer for MAIN-world → isolated-world bridge messages that
 * are produced before the bridge handshake is verified.
 *
 * Overflow policy: PRESERVE THE EARLIEST messages, drop the newest overflow.
 *
 * Rationale: the pre-verification window buffers attack-onset evidence — the
 * first `ns-nav-blocked`, `ns-dblclick-second-click`, or JS-exfil signals a page
 * emits. The previous policy dropped the OLDEST entries on overflow, which let a
 * page flood the guard with post-onset noise to evict the first — and most
 * security-relevant — alerts before the bridge verified. Keeping the earliest
 * messages preserves that evidence; the brief pre-verify window (bounded by the
 * isolated side's bridge-init timeout) makes losing the freshest few acceptable.
 *
 * Dropped messages are counted rather than silently discarded so the count can
 * be surfaced (e.g. via a debug log) once the bridge is ready.
 */
export interface OutboundMessage {
  type: string;
  payload?: Record<string, unknown>;
}

export class OutboundQueue {
  private readonly cap: number;
  private readonly items: OutboundMessage[] = [];
  private dropped = 0;

  constructor(cap: number) {
    this.cap = Math.max(0, Math.floor(cap));
  }

  /** Buffer a message, or count it as dropped when the queue is at capacity. */
  enqueue(message: OutboundMessage): void {
    if (this.items.length >= this.cap) {
      this.dropped++;
      return;
    }
    this.items.push(message);
  }

  /**
   * Remove and return all buffered messages plus the number of messages dropped
   * since the last drain, resetting both. Safe to call when empty.
   */
  drain(): { items: OutboundMessage[]; dropped: number } {
    const items = this.items.splice(0, this.items.length);
    const dropped = this.dropped;
    this.dropped = 0;
    return { items, dropped };
  }

  /** Number of messages currently buffered. */
  get size(): number {
    return this.items.length;
  }

  /** Number of messages dropped since the last drain. */
  get droppedCount(): number {
    return this.dropped;
  }
}
