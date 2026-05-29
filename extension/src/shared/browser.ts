// Browser-API compatibility layer for cross-engine (Chrome / Firefox) support.
//
// Firefox exposes the WebExtension API under the `browser` global and returns
// promises from most async APIs. Chrome exposes the same surface under `chrome`
// and uses a `lastError` callback pattern. This module normalizes those
// differences so the rest of the extension can target a single API.
//
// This file is purely additive: it does not modify any existing source or build
// behavior. Chrome builds that never import it are unaffected.

// `browser` is the Firefox WebExtension global. It is type-compatible with the
// `chrome` namespace for the subset of APIs this extension uses, so we resolve
// it through a narrow cast rather than `any`.
interface BrowserGlobal {
  browser?: typeof chrome;
}

function resolveExt(): typeof chrome {
  const maybeBrowser = (globalThis as BrowserGlobal).browser;
  return maybeBrowser ?? chrome;
}

/**
 * The active WebExtension API namespace. Resolves to Firefox's `browser` global
 * when present, otherwise Chrome's `chrome` global. Evaluated once at module
 * load.
 */
export const ext: typeof chrome = resolveExt();

/**
 * True when running under a Gecko-based engine that exposes the `browser`
 * global (Firefox). False under Chrome / Chromium.
 */
export function isFirefox(): boolean {
  return typeof (globalThis as { browser?: unknown }).browser !== "undefined";
}

/**
 * Promise-based wrapper around `runtime.sendMessage` that works on both engines.
 *
 * Chrome's callback form reports errors via `runtime.lastError` (which must be
 * read inside the callback to avoid an "unchecked lastError" warning). Firefox
 * rejects the returned promise directly. This normalizes both into a single
 * promise that rejects with an `Error` on failure.
 */
export function sendMessageP<T>(msg: object): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    try {
      ext.runtime.sendMessage(msg, (response: T) => {
        const lastError = ext.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message ?? "runtime.sendMessage failed"));
          return;
        }
        resolve(response);
      });
    } catch (err) {
      // Firefox (and Chrome during teardown) can throw synchronously instead of
      // invoking the callback; normalize to a rejected promise.
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

// Prefix used to namespace session-scoped keys when falling back to
// `storage.local` on engines without `storage.session`.
const SESSION_PREFIX = "ns_session:";

// Promise-based view of the `get` / `set` / `remove` surface of
// `chrome.storage.SessionStorageArea`. Modeling it explicitly (rather than
// `Pick<chrome.storage.SessionStorageArea, ...>`) keeps the contract
// promise-only: the native area also exposes legacy callback overloads which a
// custom fallback cannot satisfy, but the native area IS assignable to this
// narrower promise-only shape.
export interface SessionStorageShim {
  get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

type SessionShim = SessionStorageShim;

// `storage.session` may be absent on Firefox MV3. We detect it defensively
// rather than relying solely on `isFirefox()` so the shim stays correct if a
// future Firefox release adds the API.
function hasSessionArea(): boolean {
  const storage = (ext as { storage?: { session?: unknown } }).storage;
  return typeof storage?.session !== "undefined";
}

function prefixKey(key: string): string {
  return `${SESSION_PREFIX}${key}`;
}

function normalizeGetKeys(
  keys: string | string[] | Record<string, unknown>,
): { lookups: string[]; defaults: Record<string, unknown> } {
  if (typeof keys === "string") {
    return { lookups: [keys], defaults: {} };
  }
  if (Array.isArray(keys)) {
    return { lookups: keys, defaults: {} };
  }
  // Object form: keys map to default values returned when a key is missing.
  return { lookups: Object.keys(keys), defaults: { ...keys } };
}

// storage.local-backed implementation used when storage.session is unavailable.
// Keys are namespaced with SESSION_PREFIX to avoid collision with the
// extension's persistent local data. This is a convention, not an enforced
// invariant: callers must never write a real persistent local key beginning
// with SESSION_PREFIX. FF-03 (which wires the real consumers) must uphold this
// and is also where session-ephemerality (clear-on-restart) is handled.
const localBackedSession: SessionShim = {
  async get(
    keys?: string | string[] | Record<string, unknown> | null,
  ): Promise<Record<string, unknown>> {
    if (keys === null || keys === undefined) {
      // Whole-area read: pull everything, then keep only namespaced entries and
      // strip the prefix from the returned keys.
      const all = await ext.storage.local.get(null);
      const result: Record<string, unknown> = {};
      for (const [storedKey, value] of Object.entries(all)) {
        if (storedKey.startsWith(SESSION_PREFIX)) {
          result[storedKey.slice(SESSION_PREFIX.length)] = value;
        }
      }
      return result;
    }
    const { lookups, defaults } = normalizeGetKeys(keys);
    const prefixed = lookups.map(prefixKey);
    const raw = await ext.storage.local.get(prefixed);
    const result: Record<string, unknown> = { ...defaults };
    for (const key of lookups) {
      const stored = raw[prefixKey(key)];
      if (stored !== undefined) {
        result[key] = stored;
      }
    }
    return result;
  },

  async set(items: Record<string, unknown>): Promise<void> {
    const prefixed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(items)) {
      prefixed[prefixKey(key)] = value;
    }
    await ext.storage.local.set(prefixed);
  },

  async remove(keys: string | string[]): Promise<void> {
    const list = Array.isArray(keys) ? keys : [keys];
    await ext.storage.local.remove(list.map(prefixKey));
  },
};

/**
 * Session-scoped storage with a uniform `get` / `set` / `remove` surface.
 *
 * Uses `chrome.storage.session` when present (Chrome MV3). On engines without
 * it (Firefox MV3), falls back to a `storage.local` area whose keys are
 * namespaced with the `ns_session:` prefix. The fallback is NOT auto-cleared on
 * browser restart the way real session storage is; FF-03 (session_state
 * compat) tracks closing that semantic gap.
 */
export const storageSessionShim: SessionShim = hasSessionArea()
  ? ext.storage.session
  : localBackedSession;
