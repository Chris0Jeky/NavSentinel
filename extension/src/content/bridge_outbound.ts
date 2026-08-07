/**
 * Bounded outbound buffer for cross-world bridge messages produced before the
 * bridge handshake is verified (used in both directions: main_guard → isolated
 * and capture_isolated → main).
 *
 * Overflow policy: ALERTS are never evicted by routine traffic, and among items
 * of equal priority the EARLIEST are preserved (newest overflow dropped).
 *
 * Rationale: the pre-verification window buffers attack-onset evidence — the
 * first `ns-nav-blocked`, `ns-dblclick-second-click`, exfil, or relay signals.
 * A pure drop-oldest policy let a page flood post-onset noise to evict the first
 * alerts; a pure drop-newest policy is the mirror weakness (pre-fill the buffer
 * with noise so a later real alert is dropped). Tagging detection/relay messages
 * as priority and evicting routine messages first defeats both: routine noise
 * can never push out a buffered alert. Dropped messages are counted (not
 * silently discarded) so the count can be surfaced once the bridge is ready.
 */
export interface OutboundMessage {
  type: string;
  payload?: Record<string, unknown>;
}

interface QueuedMessage {
  message: OutboundMessage;
  priority: boolean;
  floodable: boolean;
}

export class OutboundQueue {
  private readonly cap: number;
  private readonly reservedForScarce: number;
  private readonly items: QueuedMessage[] = [];
  private floodableCount = 0;
  private dropped = 0;

  constructor(cap: number, reservedForScarce = 0) {
    // Guard against a non-finite cap (e.g. NaN), which would otherwise make the
    // length comparison always false and leave the queue effectively unbounded.
    this.cap = Number.isFinite(cap) ? Math.max(0, Math.floor(cap)) : 0;
    // Slots that floodable alerts may never occupy, so a per-navigation flood cannot
    // crowd out the scarce once-per-event signals. Clamped to [0, cap].
    this.reservedForScarce = Number.isFinite(reservedForScarce)
      ? Math.max(0, Math.min(Math.floor(reservedForScarce), this.cap))
      : 0;
  }

  /**
   * Buffer a message. `priority` marks security-relevant alerts that must not be
   * evicted by routine traffic. On overflow the oldest routine message is
   * dropped to make room; if every buffered message is priority, the earliest
   * are kept and this incoming one is dropped.
   *
   * `floodable` marks high-frequency per-navigation priority telemetry
   * (`ns-nav-blocked`/`ns-nav-allowed`). A synchronous flood of these before the
   * bridge handshake would otherwise fill all `cap` slots and starve the scarce
   * once-per-event correlation signals (`ns-dblclick-*`, `ns-js-*`,
   * `ns-pushstate-suspicious`), which are then dropped — losing irreplaceable
   * evidence. Floodable priority alerts are therefore capped at `cap -
   * reservedForScarce`; beyond that the surplus is dropped (the navigation is still
   * blocked/allowed and recorded; only the redundant bridge telemetry is shed).
   * (#377/F2)
   */
  enqueue(message: OutboundMessage, priority = false, floodable = false): void {
    if (priority && floodable && this.floodableCount >= this.cap - this.reservedForScarce) {
      this.dropped++;
      return;
    }
    if (this.items.length < this.cap) {
      this.items.push({ message, priority, floodable });
      if (floodable) this.floodableCount++;
      return;
    }
    if (!priority) {
      // Routine overflow: keep the earliest buffered messages, drop this one.
      this.dropped++;
      return;
    }
    // An alert must be admitted: displace the oldest routine message. If the
    // buffer is entirely alerts, keep the earliest and drop this one.
    const routineIdx = this.items.findIndex((q) => !q.priority);
    if (routineIdx === -1) {
      this.dropped++;
      return;
    }
    this.items.splice(routineIdx, 1);
    this.dropped++;
    this.items.push({ message, priority, floodable });
    if (floodable) this.floodableCount++;
  }

  /**
   * Remove and return all buffered messages (in order) plus the number dropped
   * since the last drain, resetting both. Safe to call when empty.
   */
  drain(): { items: OutboundMessage[]; dropped: number } {
    const items = this.items.splice(0, this.items.length).map((q) => q.message);
    const dropped = this.dropped;
    this.dropped = 0;
    this.floodableCount = 0;
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

// Priority detection signals on the MAIN-world → isolated direction (never evicted by
// routine traffic). Note: the members that are also FLOODABLE_ALERT_TYPES
// (ns-nav-blocked, ns-nav-allowed) are additionally capped at cap - reservedForScarce
// slots and dropped beyond that under a flood, so they are not unconditionally
// non-droppable. (#377/F2)
const MAIN_GUARD_ALERT_TYPES = new Set<string>([
  "ns-nav-blocked",
  "ns-nav-allowed",
  "ns-clipboard-write",
  "ns-pushstate-suspicious",
]);

/**
 * Whether a MAIN-world → isolated message must survive pre-verification buffer
 * pressure. Priority = detection signals AND control relays:
 *  - `ns-js-*`        JS-behavior signals.
 *  - `ns-dblclick-*`  the DoubleClickjacking chain — including the
 *                     `ns-dblclick-window-open` precondition, without which the
 *                     priority second-click/opener-nav correlations are useless.
 *  - `ns-allow*`      control relays (e.g. `ns-allow-target-nav`) that
 *                     pre-authorize a user-approved navigation in the SW;
 *                     dropping one makes the SW re-block an allowed action.
 * Routine (config-ack, pong, bridge-ready/overflow, debug) is droppable.
 */
export function isMainGuardAlertType(type: string): boolean {
  return (
    MAIN_GUARD_ALERT_TYPES.has(type) ||
    type.startsWith("ns-js-") ||
    type.startsWith("ns-dblclick-") ||
    type.startsWith("ns-allow")
  );
}

// Priority messages emitted once per navigation decision. A page can drive these in a
// synchronous loop (many blocked/allowed window.open / form.submit calls), so
// under the pre-bridge buffer they are the flood source. They are tagged
// `floodable` so the OutboundQueue caps them and reserves room for the scarce
// once-per-event correlation signals (dblclick / js / pushstate). (#377/F2)
//
// `ns-allow-target-nav` is the per-allowed-nav SW pre-authorization relay that accompanies
// every `ns-nav-allowed`. It is `priority` (never evicted by routine traffic — dropping one
// under NORMAL pressure would re-block a user-approved nav), but it is ALSO `floodable`: an
// allowed-nav flood would otherwise queue one uncapped relay per nav and refill the buffer
// past the reservation, starving the scarce signals. Capping it shifts only the SURPLUS
// relays in a flood; the SW then re-evaluates those navs (fail-safe — more restrictive,
// never a bypass), an acceptable trade vs losing irreplaceable detection signals. (#377/F2)
const FLOODABLE_ALERT_TYPES = new Set<string>([
  "ns-nav-blocked",
  "ns-nav-allowed",
  "ns-allow-target-nav",
]);

/** Whether an alert is high-frequency per-navigation telemetry subject to the
 *  OutboundQueue floodable cap. (#377/F2) */
export function isFloodableAlertType(type: string): boolean {
  return FLOODABLE_ALERT_TYPES.has(type);
}
