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

  private _hydrated = false;
  private _hydratePromise: Promise<void> | null = null;

  /** Whether hydrate() has completed. */
  get hydrated(): boolean {
    return this._hydrated;
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
    try {
      const data = await chrome.storage.session.get(Object.values(KEYS));

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
    } catch (err) {
      console.warn("[NavSentinel] session storage hydration failed:", err);
    }
    this._hydrated = true;
  }

  // -----------------------------------------------------------------------
  // Persist: mirror in-memory state to session storage (fire-and-forget).
  // -----------------------------------------------------------------------

  /** Persist a single Map to session storage. Skips write if not yet hydrated. */
  persistMap<V>(map: Map<number, V>, key: keyof typeof KEYS): void {
    if (!this._hydrated) return;
    const storageKey = KEYS[key];
    void chrome.storage.session.set({ [storageKey]: mapToObj(map) }).catch((err) => {
      console.warn("[NavSentinel] session persist failed:", err);
    });
  }

  /** Persist the readyTabs Set to session storage. Skips write if not yet hydrated. */
  persistReadyTabs(): void {
    if (!this._hydrated) return;
    void chrome.storage.session.set({ [KEYS.readyTabs]: setToArray(this.readyTabs) }).catch((err) => {
      console.warn("[NavSentinel] session persist failed:", err);
    });
  }

  /** Persist all state in a single batch write. Skips write if not yet hydrated. */
  persistAll(): void {
    if (!this._hydrated) return;
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
    // Batch persist after bulk delete
    this.persistAll();
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private _restoreMap<V>(map: Map<number, V>, raw: unknown): void {
    const restored = objToMap<V>(raw);
    for (const [k, v] of restored) {
      map.set(k, v);
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
