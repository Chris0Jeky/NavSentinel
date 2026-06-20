/**
 * SessionStateManager: write-through cache for ephemeral SW state.
 *
 * MV3 service workers are ephemeral -- Chrome can terminate them at any time.
 * This module backs in-memory Maps with `chrome.storage.session` so state
 * survives SW restarts within a browser session.
 *
 * Design:
 *  - In-memory Maps are the primary read path (synchronous).
 *  - Every write is mirrored to `chrome.storage.session` (fire-and-forget).
 *  - On SW startup, `hydrate()` populates the in-memory Maps from session
 *    storage before the first navigation event is processed.
 *
 * Session storage is cleared when the browser closes, which is the correct
 * lifetime for ephemeral tab state.
 */

import type { OAuthFlowState } from "../content/oauth_monitor";
import type { RedirectChain } from "./redirect_chain";
import type { EventLogEntry } from "./storage";

// ---------------------------------------------------------------------------
// Storage key prefix to avoid collisions with other session data.
// ---------------------------------------------------------------------------
const PREFIX = "ns_sw:";

// ---------------------------------------------------------------------------
// Type definitions for the stored state shape.
// Each key maps to a JSON-serialisable record of tab-id entries.
// ---------------------------------------------------------------------------

export interface ChildWindowEntry {
  openerTabId: number;
  createdAt: number;
  openerNavObserved: boolean;
}

export interface AllowTargetEntry {
  url: string;
  expiresAt: number;
  matchQueryPrefix?: boolean;
  silentEvent?: EventLogEntry;
}

export interface TypedOriginEntry {
  ts: number;
  deadline: number;
}

export interface PendingRollbackEntry {
  url: string;
  prevUrl?: string;
  qualifiers: string[];
}

export interface PendingForwardEntry {
  url: string;
  ts: number;
  returnUrl?: string;
}

export interface RollbackReturnEntry {
  url: string;
  expiresAt: number;
}

export interface LastCommittedEntry {
  url: string;
  prevUrl?: string;
  transitionType: string;
  qualifiers: string[];
  ts: number;
  allowedAtCommit: boolean;
}

// ---------------------------------------------------------------------------
// Session storage key constants
// ---------------------------------------------------------------------------

const KEYS = {
  allowUntil: `${PREFIX}allowUntil`,
  gestureUntil: `${PREFIX}gestureUntil`,
  allowStarted: `${PREFIX}allowStarted`,
  allowTarget: `${PREFIX}allowTarget`,
  userNavContextUntil: `${PREFIX}userNavContextUntil`,
  suppressUntil: `${PREFIX}suppressUntil`,
  typedOrigin: `${PREFIX}typedOrigin`,
  readyTabs: `${PREFIX}readyTabs`,
  pendingRollback: `${PREFIX}pendingRollback`,
  pendingForward: `${PREFIX}pendingForward`,
  rollbackReturn: `${PREFIX}rollbackReturn`,
  lastUrl: `${PREFIX}lastUrl`,
  lastCommitted: `${PREFIX}lastCommitted`,
  childWindow: `${PREFIX}childWindow`,
  oauthFlow: `${PREFIX}oauthFlow`,
  redirectChains: `${PREFIX}redirectChains`,
  captureTimestamps: `${PREFIX}captureTimestamps`,
} as const;

// ---------------------------------------------------------------------------
// Helper: convert Map to/from plain objects for JSON serialisation.
// Map keys are tab IDs (numbers), but JSON object keys are always strings.
// ---------------------------------------------------------------------------

function mapToObj<V>(map: Map<number, V>): Record<string, V> {
  const obj: Record<string, V> = {};
  for (const [k, v] of map) {
    obj[String(k)] = v;
  }
  return obj;
}

function objToMap<V>(obj: unknown): Map<number, V> {
  const map = new Map<number, V>();
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, V>)) {
      const n = Number(k);
      if (Number.isFinite(n)) {
        map.set(n, v);
      }
    }
  }
  return map;
}

function setToArray(set: Set<number>): number[] {
  return [...set];
}

function arrayToSet(arr: unknown): Set<number> {
  const set = new Set<number>();
  if (Array.isArray(arr)) {
    for (const v of arr) {
      if (typeof v === "number" && Number.isFinite(v)) {
        set.add(v);
      }
    }
  }
  return set;
}

// ---------------------------------------------------------------------------
// SessionStateManager
// ---------------------------------------------------------------------------

export class SessionStateManager {
  // --- In-memory Maps (primary read path) ---
  readonly allowUntilByTab = new Map<number, number>();
  readonly gestureUntilByTab = new Map<number, number>();
  readonly allowStartedByTab = new Map<number, string>();
  readonly allowTargetByTab = new Map<number, AllowTargetEntry>();
  readonly userNavContextUntilByTab = new Map<number, number>();
  readonly suppressUntilByTab = new Map<number, number>();
  readonly typedOriginByTab = new Map<number, TypedOriginEntry>();
  readonly readyTabs = new Set<number>();
  readonly pendingRollbackByTab = new Map<number, PendingRollbackEntry>();
  readonly pendingForwardByTab = new Map<number, PendingForwardEntry>();
  readonly rollbackReturnByTab = new Map<number, RollbackReturnEntry>();
  readonly lastUrlByTab = new Map<number, string>();
  readonly lastCommittedByTab = new Map<number, LastCommittedEntry>();
  readonly childWindowByTab = new Map<number, ChildWindowEntry>();
  readonly oauthFlowByTab = new Map<number, OAuthFlowState>();

  // Redirect chain data (separate because RedirectChainTracker has its own class)
  readonly redirectChainData = new Map<number, RedirectChain>();

  // Per-tab viewport-capture timestamps (visual-sim rate limit). Session-backed
  // so the rate limit survives SW restart and cannot be bypassed by forcing a
  // worker recycle between bursts.
  readonly captureTimestampsByTab = new Map<number, number[]>();

  private _hydrated = false;
  private _canPersist = false;
  private _hydratePromise: Promise<void> | null = null;

  /** Whether hydrate() has completed (success OR degraded read-failure). */
  get hydrated(): boolean {
    return this._hydrated;
  }

  /**
   * Whether persistence is enabled. False before hydration AND after a failed
   * hydrate (degraded mode), so a transient session.get read failure cannot let
   * persistAll()/persistMap() overwrite the still-present session storage we
   * merely failed to read (#228.2). Re-enabled only by a successful hydrate.
   */
  get canPersist(): boolean {
    return this._canPersist;
  }

  // -----------------------------------------------------------------------
  // Hydrate: load from session storage into in-memory Maps.
  // Called once at SW startup before processing events.
  // Cached: subsequent calls return the same promise.
  // -----------------------------------------------------------------------

  hydrate(): Promise<void> {
    if (this._hydratePromise) return this._hydratePromise;
    this._hydratePromise = this._doHydrate();
    return this._hydratePromise;
  }

  private async _doHydrate(): Promise<void> {
    let data: Record<string, unknown> | null = null;
    // One retry: a transient session.get failure should not flip us into the
    // persistence-suppressed degraded mode if an immediate retry succeeds.
    for (let attempt = 0; attempt < 2 && data === null; attempt++) {
      try {
        data = await chrome.storage.session.get(Object.values(KEYS));
      } catch (err) {
        console.warn(`[NavSentinel] session storage hydration failed (attempt ${attempt + 1}):`, err);
      }
    }

    if (data === null) {
      // Read failed after retry: allow in-memory reads (so gated handlers do not
      // block forever) but keep persistence DISABLED so the next persistAll()
      // cannot overwrite the still-present session storage with empty maps
      // (#228.2). Persistence resumes after a successful hydrate on the next SW
      // startup. TRADEOFF (R1 finding 2): for the rest of THIS worker's lifetime
      // the SW-recycle-resistant protections that depend on persistence (the
      // capture-rate limit, pending rollback/forward) are degraded; they recover
      // on the next worker startup's fresh hydrate.
      this._hydrated = true;
      return;
    }

    this._restoreMap(this.allowUntilByTab, data[KEYS.allowUntil]);
    this._restoreMap(this.gestureUntilByTab, data[KEYS.gestureUntil]);
    this._restoreMap(this.allowStartedByTab, data[KEYS.allowStarted]);
    this._restoreMap(this.allowTargetByTab, data[KEYS.allowTarget]);
    this._restoreMap(this.userNavContextUntilByTab, data[KEYS.userNavContextUntil]);
    this._restoreMap(this.suppressUntilByTab, data[KEYS.suppressUntil]);
    this._restoreMap(this.typedOriginByTab, data[KEYS.typedOrigin]);
    this._restoreSet(this.readyTabs, data[KEYS.readyTabs]);
    this._restoreMap(this.pendingRollbackByTab, data[KEYS.pendingRollback]);
    this._restoreMap(this.pendingForwardByTab, data[KEYS.pendingForward]);
    this._restoreMap(this.rollbackReturnByTab, data[KEYS.rollbackReturn]);
    this._restoreMap(this.lastUrlByTab, data[KEYS.lastUrl]);
    this._restoreMap(this.lastCommittedByTab, data[KEYS.lastCommitted]);
    this._restoreMap(this.childWindowByTab, data[KEYS.childWindow]);
    this._restoreMap(this.oauthFlowByTab, data[KEYS.oauthFlow]);
    this._restoreRedirectChains(data[KEYS.redirectChains]);
    this._restoreMap(
      this.captureTimestampsByTab,
      data[KEYS.captureTimestamps],
      (v) => Array.isArray(v) && v.every((n) => typeof n === "number" && Number.isFinite(n)),
    );
    this._hydrated = true;
    this._canPersist = true;
  }

  // -----------------------------------------------------------------------
  // Persist: mirror in-memory state to session storage (fire-and-forget).
  // -----------------------------------------------------------------------

  /** Persist a single Map to session storage. Suppressed until a successful hydrate (#228.2). */
  persistMap<V>(map: Map<number, V>, key: keyof typeof KEYS): void {
    if (!this._canPersist) return;
    const storageKey = KEYS[key];
    void chrome.storage.session.set({ [storageKey]: mapToObj(map) }).catch((err) => {
      console.warn("[NavSentinel] session persist failed:", err);
    });
  }

  /** Persist the readyTabs Set to session storage. Suppressed until a successful hydrate (#228.2). */
  persistReadyTabs(): void {
    if (!this._canPersist) return;
    void chrome.storage.session.set({ [KEYS.readyTabs]: setToArray(this.readyTabs) }).catch((err) => {
      console.warn("[NavSentinel] session persist failed:", err);
    });
  }

  /** Persist all state in a single batch write. Suppressed until a successful hydrate (#228.2). */
  persistAll(): void {
    if (!this._canPersist) return;
    const data: Record<string, unknown> = {
      [KEYS.allowUntil]: mapToObj(this.allowUntilByTab),
      [KEYS.gestureUntil]: mapToObj(this.gestureUntilByTab),
      [KEYS.allowStarted]: mapToObj(this.allowStartedByTab),
      [KEYS.allowTarget]: mapToObj(this.allowTargetByTab),
      [KEYS.userNavContextUntil]: mapToObj(this.userNavContextUntilByTab),
      [KEYS.suppressUntil]: mapToObj(this.suppressUntilByTab),
      [KEYS.typedOrigin]: mapToObj(this.typedOriginByTab),
      [KEYS.readyTabs]: setToArray(this.readyTabs),
      [KEYS.pendingRollback]: mapToObj(this.pendingRollbackByTab),
      [KEYS.pendingForward]: mapToObj(this.pendingForwardByTab),
      [KEYS.rollbackReturn]: mapToObj(this.rollbackReturnByTab),
      [KEYS.lastUrl]: mapToObj(this.lastUrlByTab),
      [KEYS.lastCommitted]: mapToObj(this.lastCommittedByTab),
      [KEYS.childWindow]: mapToObj(this.childWindowByTab),
      [KEYS.oauthFlow]: mapToObj(this.oauthFlowByTab),
      [KEYS.redirectChains]: mapToObj(this.redirectChainData),
      [KEYS.captureTimestamps]: mapToObj(this.captureTimestampsByTab),
    };
    void chrome.storage.session.set(data).catch((err) => {
      console.warn("[NavSentinel] session persistAll failed:", err);
    });
  }

  // -----------------------------------------------------------------------
  // Clean up all state for a removed tab.
  // -----------------------------------------------------------------------

  deleteTab(tabId: number): void {
    this.allowUntilByTab.delete(tabId);
    this.gestureUntilByTab.delete(tabId);
    this.allowStartedByTab.delete(tabId);
    this.allowTargetByTab.delete(tabId);
    this.userNavContextUntilByTab.delete(tabId);
    this.suppressUntilByTab.delete(tabId);
    this.typedOriginByTab.delete(tabId);
    this.readyTabs.delete(tabId);
    this.pendingRollbackByTab.delete(tabId);
    this.pendingForwardByTab.delete(tabId);
    this.rollbackReturnByTab.delete(tabId);
    this.lastUrlByTab.delete(tabId);
    this.lastCommittedByTab.delete(tabId);
    this.childWindowByTab.delete(tabId);
    this.oauthFlowByTab.delete(tabId);
    this.redirectChainData.delete(tabId);
    this.captureTimestampsByTab.delete(tabId);
    // Batch persist after bulk delete
    this.persistAll();
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private _restoreMap<V>(
    map: Map<number, V>,
    raw: unknown,
    isValidValue?: (value: unknown) => boolean,
  ): void {
    const restored = objToMap<V>(raw);
    let skipped = 0;
    for (const [k, v] of restored) {
      // Optional per-value shape gate for maps whose value type would break callers if
      // corrupt (e.g. captureTimestampsByTab expects number[], and sw.ts calls .filter on
      // it — a non-array from a corrupt session restore would throw). Mirrors the inline
      // validation _restoreRedirectChains already does. (#339)
      if (isValidValue && !isValidValue(v)) {
        skipped++;
        continue;
      }
      map.set(k, v);
    }
    if (skipped > 0) {
      console.warn(
        `[NavSentinel] session restore: skipped ${skipped} malformed map entr${skipped === 1 ? "y" : "ies"}`,
      );
    }
  }

  private _restoreRedirectChains(raw: unknown): void {
    const restored = objToMap<RedirectChain>(raw);
    for (const [k, v] of restored) {
      if (v && Array.isArray(v.hops) && typeof v.startedAt === "number") {
        this.redirectChainData.set(k, v);
      }
    }
  }

  private _restoreSet(set: Set<number>, raw: unknown): void {
    const restored = arrayToSet(raw);
    for (const v of restored) {
      set.add(v);
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton instance for the SW module.
// ---------------------------------------------------------------------------

export const swState = new SessionStateManager();
