import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  normalizeAllowlist,
  getAllowlist,
  setAllowlist,
  addAllowlistEntry,
  removeAllowlistEntry,
  clearAllowlist,
  isAllowlisted,
  onAllowlistChange,
  ALLOWLIST_KEY,
  type Allowlist,
} from "../extension/src/shared/allowlist";

const LEGACY_KEY = "navsentinel:allowlist";

const store: Record<string, unknown> = {};

function mockGet(keys: string | string[]) {
  const ks = Array.isArray(keys) ? keys : [keys];
  const result: Record<string, unknown> = {};
  for (const k of ks) {
    if (k in store) result[k] = structuredClone(store[k]);
  }
  return Promise.resolve(result);
}

function mockSet(items: Record<string, unknown>) {
  for (const [k, v] of Object.entries(items)) {
    store[k] = structuredClone(v);
  }
  return Promise.resolve();
}

function mockRemove(keys: string | string[]) {
  const ks = Array.isArray(keys) ? keys : [keys];
  for (const k of ks) delete store[k];
  return Promise.resolve();
}

(globalThis as { chrome?: unknown }).chrome = {
  storage: {
    local: {
      get: vi.fn(mockGet),
      set: vi.fn(mockSet),
      remove: vi.fn(mockRemove),
    },
    onChanged: {
      addListener: vi.fn(),
    },
  },
};

beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  vi.clearAllMocks();
});

describe("normalizeAllowlist", () => {
  it("returns empty object for null/undefined/non-object", () => {
    expect(normalizeAllowlist(null)).toEqual({});
    expect(normalizeAllowlist(undefined)).toEqual({});
    expect(normalizeAllowlist("string")).toEqual({});
    expect(normalizeAllowlist(42)).toEqual({});
    expect(normalizeAllowlist([])).toEqual({});
  });

  it("normalizes keys to lowercase trimmed", () => {
    const result = normalizeAllowlist({ " Example.COM ": ["foo.com"] });
    expect(result).toEqual({ "example.com": ["foo.com"] });
  });

  it("normalizes hosts to lowercase, deduped, and sorted", () => {
    const result = normalizeAllowlist({
      "site.com": ["Zeta.com", "alpha.com", "Zeta.com", " Beta.COM "],
    });
    expect(result).toEqual({ "site.com": ["alpha.com", "beta.com", "zeta.com"] });
  });

  it("drops entries with empty site key", () => {
    const result = normalizeAllowlist({ "": ["foo.com"], "real.com": ["bar.com"] });
    expect(result).toEqual({ "real.com": ["bar.com"] });
  });

  it("drops entries where hosts is not an array", () => {
    const result = normalizeAllowlist({ "a.com": "not-array", "b.com": ["c.com"] });
    expect(result).toEqual({ "b.com": ["c.com"] });
  });

  it("drops entries where all hosts are empty after filtering", () => {
    const result = normalizeAllowlist({ "a.com": [42, null, ""], "b.com": ["c.com"] });
    expect(result).toEqual({ "b.com": ["c.com"] });
  });

  it("filters non-string host entries", () => {
    const result = normalizeAllowlist({ "a.com": ["good.com", 42, null, "ok.com"] });
    expect(result).toEqual({ "a.com": ["good.com", "ok.com"] });
  });
});

describe("isAllowlisted", () => {
  it("returns true for exact match", () => {
    const list: Allowlist = { "site.com": ["dest.com"] };
    expect(isAllowlisted(list, "site.com", "dest.com")).toBe(true);
  });

  it("is case-insensitive", () => {
    const list: Allowlist = { "site.com": ["dest.com"] };
    expect(isAllowlisted(list, "SITE.COM", "DEST.COM")).toBe(true);
  });

  it("returns false for non-matching host", () => {
    const list: Allowlist = { "site.com": ["dest.com"] };
    expect(isAllowlisted(list, "site.com", "other.com")).toBe(false);
  });

  it("returns false for non-matching site key", () => {
    const list: Allowlist = { "site.com": ["dest.com"] };
    expect(isAllowlisted(list, "other.com", "dest.com")).toBe(false);
  });

  it("returns false for empty allowlist", () => {
    expect(isAllowlisted({}, "site.com", "dest.com")).toBe(false);
  });
});

describe("getAllowlist", () => {
  it("returns empty object when storage is empty", async () => {
    const result = await getAllowlist();
    expect(result).toEqual({});
  });

  it("returns current allowlist from new key", async () => {
    store[ALLOWLIST_KEY] = { "site.com": ["dest.com"] };
    const result = await getAllowlist();
    expect(result).toEqual({ "site.com": ["dest.com"] });
  });

  it("migrates legacy key to new key", async () => {
    store[LEGACY_KEY] = { "old.com": ["target.com"] };
    const result = await getAllowlist();
    expect(result).toEqual({ "old.com": ["target.com"] });
    expect(store[ALLOWLIST_KEY]).toEqual({ "old.com": ["target.com"] });
    expect(store[LEGACY_KEY]).toBeUndefined();
  });

  it("prefers new key over legacy key", async () => {
    store[ALLOWLIST_KEY] = { "new.com": ["a.com"] };
    store[LEGACY_KEY] = { "old.com": ["b.com"] };
    const result = await getAllowlist();
    expect(result).toEqual({ "new.com": ["a.com"] });
  });

  it("migrates legacy when the new key holds a falsy value (#306)", async () => {
    // A partial/crashed write can leave the new key present but falsy.
    store[ALLOWLIST_KEY] = null;
    store[LEGACY_KEY] = { "old.com": ["target.com"] };
    const result = await getAllowlist();
    // Pre-fix: hasOwnProperty(ALLOWLIST_KEY) was true -> returned {} and the
    // user's legacy allowlist was silently dropped.
    expect(result).toEqual({ "old.com": ["target.com"] });
    expect(store[ALLOWLIST_KEY]).toEqual({ "old.com": ["target.com"] });
    expect(store[LEGACY_KEY]).toBeUndefined();
  });

  it("migrates legacy when the new key holds an array (#306)", async () => {
    store[ALLOWLIST_KEY] = ["not", "an", "allowlist"];
    store[LEGACY_KEY] = { "old.com": ["target.com"] };
    const result = await getAllowlist();
    expect(result).toEqual({ "old.com": ["target.com"] });
  });

  it("treats an empty new-key object as authoritative, not a migration trigger (#306)", async () => {
    // The user explicitly cleared their allowlist; an empty {} must NOT cause a
    // legacy re-migration (preserves the cleared state).
    store[ALLOWLIST_KEY] = {};
    store[LEGACY_KEY] = { "old.com": ["target.com"] };
    const result = await getAllowlist();
    expect(result).toEqual({});
    expect(store[LEGACY_KEY]).toEqual({ "old.com": ["target.com"] });
  });
});

describe("setAllowlist", () => {
  it("writes normalized allowlist and removes legacy key", async () => {
    store[LEGACY_KEY] = { "leftover.com": ["x.com"] };
    await setAllowlist({ " MixedCase.COM ": ["Host.Com"] });
    expect(store[ALLOWLIST_KEY]).toEqual({ "mixedcase.com": ["host.com"] });
    expect(store[LEGACY_KEY]).toBeUndefined();
  });
});

describe("addAllowlistEntry", () => {
  it("adds a new site+host pair", async () => {
    const result = await addAllowlistEntry("site.com", "dest.com");
    expect(isAllowlisted(result, "site.com", "dest.com")).toBe(true);
  });

  it("appends to existing site key", async () => {
    store[ALLOWLIST_KEY] = { "site.com": ["a.com"] };
    const result = await addAllowlistEntry("site.com", "b.com");
    expect(isAllowlisted(result, "site.com", "a.com")).toBe(true);
    expect(isAllowlisted(result, "site.com", "b.com")).toBe(true);
  });

  it("does not duplicate existing host", async () => {
    store[ALLOWLIST_KEY] = { "site.com": ["dest.com"] };
    const result = await addAllowlistEntry("site.com", "dest.com");
    expect(result["site.com"]!.filter((h) => h === "dest.com")).toHaveLength(1);
  });

  it("is case-insensitive", async () => {
    const result = await addAllowlistEntry("SITE.COM", "DEST.COM");
    expect(isAllowlisted(result, "site.com", "dest.com")).toBe(true);
  });
});

describe("removeAllowlistEntry", () => {
  it("removes a specific host from a site key", async () => {
    store[ALLOWLIST_KEY] = { "site.com": ["a.com", "b.com"] };
    const result = await removeAllowlistEntry("site.com", "a.com");
    expect(isAllowlisted(result, "site.com", "a.com")).toBe(false);
    expect(isAllowlisted(result, "site.com", "b.com")).toBe(true);
  });

  it("removes site key entirely when last host is removed", async () => {
    store[ALLOWLIST_KEY] = { "site.com": ["only.com"] };
    const result = await removeAllowlistEntry("site.com", "only.com");
    expect(result["site.com"]).toBeUndefined();
  });

  it("no-ops for non-existent site key", async () => {
    store[ALLOWLIST_KEY] = { "other.com": ["a.com"] };
    const result = await removeAllowlistEntry("missing.com", "a.com");
    expect(result).toEqual({ "other.com": ["a.com"] });
  });

  it("no-ops for non-existent host under existing key", async () => {
    store[ALLOWLIST_KEY] = { "site.com": ["a.com"] };
    const result = await removeAllowlistEntry("site.com", "missing.com");
    expect(isAllowlisted(result, "site.com", "a.com")).toBe(true);
  });

  it("is case-insensitive", async () => {
    store[ALLOWLIST_KEY] = { "site.com": ["dest.com"] };
    const result = await removeAllowlistEntry("SITE.COM", "DEST.COM");
    expect(result["site.com"]).toBeUndefined();
  });
});

describe("clearAllowlist", () => {
  it("sets allowlist to empty object and removes legacy key", async () => {
    store[ALLOWLIST_KEY] = { "site.com": ["a.com"] };
    store[LEGACY_KEY] = { "old.com": ["b.com"] };
    await clearAllowlist();
    expect(store[ALLOWLIST_KEY]).toEqual({});
    expect(store[LEGACY_KEY]).toBeUndefined();
  });
});

describe("onAllowlistChange", () => {
  it("registers a storage change listener", () => {
    const cb = vi.fn();
    onAllowlistChange(cb);
    expect(chrome.storage.onChanged.addListener).toHaveBeenCalled();
  });

  it("calls callback with normalized allowlist on change", () => {
    let handler: Parameters<typeof chrome.storage.onChanged.addListener>[0] | undefined;
    vi.mocked(chrome.storage.onChanged.addListener).mockImplementation((fn) => {
      handler = fn;
    });
    const cb = vi.fn();
    onAllowlistChange(cb);
    handler!({ [ALLOWLIST_KEY]: { newValue: { "A.COM": ["B.COM"] } } }, "local");
    expect(cb).toHaveBeenCalledWith({ "a.com": ["b.com"] });
  });

  it("ignores changes to other storage areas", () => {
    let handler: Parameters<typeof chrome.storage.onChanged.addListener>[0] | undefined;
    vi.mocked(chrome.storage.onChanged.addListener).mockImplementation((fn) => {
      handler = fn;
    });
    const cb = vi.fn();
    onAllowlistChange(cb);
    handler!({ [ALLOWLIST_KEY]: { newValue: { "a.com": ["b.com"] } } }, "sync");
    expect(cb).not.toHaveBeenCalled();
  });

  it("ignores changes to other keys", () => {
    let handler: Parameters<typeof chrome.storage.onChanged.addListener>[0] | undefined;
    vi.mocked(chrome.storage.onChanged.addListener).mockImplementation((fn) => {
      handler = fn;
    });
    const cb = vi.fn();
    onAllowlistChange(cb);
    handler!({ "other_key": { newValue: "something" } }, "local");
    expect(cb).not.toHaveBeenCalled();
  });
});
