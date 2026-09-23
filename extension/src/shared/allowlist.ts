export type Allowlist = Record<string, string[]>;

const LEGACY_ALLOWLIST_KEY = "navsentinel:allowlist";
export const ALLOWLIST_KEY = "sentinelsuite:nav_allowlist_v1";

export function normalizeAllowlist(value: unknown): Allowlist {
  // Every list this module produces is null-prototype (see below), including
  // the empty one: a plain `{}` here would let a later `list["__proto__"] = …`
  // invoke the prototype setter instead of creating an own property. (#807)
  if (!value || typeof value !== "object" || Array.isArray(value)) return Object.create(null);
  const input = value as Record<string, unknown>;
  // Null prototype: siteKeys are raw hostnames, so "__proto__"/"constructor"/...
  // are legal keys. On a plain object, `out["__proto__"] = hosts` would invoke
  // the prototype setter (replacing the result's prototype), and reads like
  // `list["constructor"]` would resolve to inherited members. A null-prototype
  // map makes every hostname an ordinary own property; all consumers use only
  // index/keys/spread/clone shapes, so this is behavior-identical otherwise. (#807)
  const out: Allowlist = Object.create(null);
  for (const [rawSiteKey, rawHosts] of Object.entries(input)) {
    const siteKey = rawSiteKey.trim().toLowerCase();
    if (!siteKey || !Array.isArray(rawHosts)) continue;
    const hosts = Array.from(
      new Set(
        rawHosts
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim().toLowerCase())
          .filter(Boolean)
      )
    ).sort();
    if (hosts.length > 0) {
      out[siteKey] = hosts;
    }
  }
  return out;
}

export async function getAllowlist(): Promise<Allowlist> {
  const res = await chrome.storage.local.get([ALLOWLIST_KEY, LEGACY_ALLOWLIST_KEY]);
  const stored = res[ALLOWLIST_KEY];
  // Treat the new key as authoritative only when it holds a real object (an
  // empty {} is valid -- the user cleared their allowlist). A falsy/invalid
  // value (null/false/0/""/array, e.g. from a partial or crashed write) must
  // NOT short-circuit the legacy migration: the previous hasOwnProperty check
  // returned {} for such a value and silently dropped the user's legacy
  // allowlist. (#306)
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    return normalizeAllowlist(stored);
  }

  const legacy = normalizeAllowlist(res[LEGACY_ALLOWLIST_KEY]);
  if (Object.keys(legacy).length > 0) {
    await chrome.storage.local.set({ [ALLOWLIST_KEY]: legacy });
    await chrome.storage.local.remove(LEGACY_ALLOWLIST_KEY);
    return legacy;
  }

  // Null-prototype, like every list this module produces (see normalizeAllowlist). (#807)
  return Object.create(null);
}

export async function setAllowlist(list: Allowlist): Promise<void> {
  await chrome.storage.local.set({ [ALLOWLIST_KEY]: normalizeAllowlist(list) });
  await chrome.storage.local.remove(LEGACY_ALLOWLIST_KEY);
}

export async function addAllowlistEntry(siteKey: string, destHost: string): Promise<Allowlist> {
  const list = await getAllowlist();
  const key = siteKey.toLowerCase();
  const host = destHost.toLowerCase();
  // Array guard: on a plain-object list (only possible for direct callers --
  // every list in circulation comes from normalizeAllowlist), a
  // prototype-named key would resolve to an inherited member and throw below.
  // Null-prototype lists make this a plain miss that starts a new entry. (#807)
  const existing = list[key];
  const hosts = Array.isArray(existing) ? existing : [];
  if (!hosts.includes(host)) {
    hosts.push(host);
  }
  list[key] = hosts;
  await setAllowlist(list);
  return list;
}

export async function removeAllowlistEntry(siteKey: string, destHost: string): Promise<Allowlist> {
  const list = await getAllowlist();
  const key = siteKey.toLowerCase();
  const host = destHost.toLowerCase();
  const existing = list[key];
  if (!Array.isArray(existing)) return list;
  const next = existing.filter((entry) => entry !== host);
  if (next.length === 0) {
    delete list[key];
  } else {
    list[key] = next;
  }
  await setAllowlist(list);
  return list;
}

export async function clearAllowlist(): Promise<void> {
  await chrome.storage.local.set({ [ALLOWLIST_KEY]: {} });
  await chrome.storage.local.remove(LEGACY_ALLOWLIST_KEY);
}

export function isAllowlisted(list: Allowlist, siteKey: string, destHost: string): boolean {
  const key = siteKey.toLowerCase();
  const host = destHost.toLowerCase();
  const entries = list[key];
  return Array.isArray(entries) && entries.includes(host);
}

export function onAllowlistChange(cb: (list: Allowlist) => void): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    const change = changes[ALLOWLIST_KEY];
    if (!change) return;
    const next = normalizeAllowlist(change.newValue);
    cb(next);
  });
}
