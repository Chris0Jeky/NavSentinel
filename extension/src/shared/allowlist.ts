export type Allowlist = Record<string, string[]>;

const LEGACY_ALLOWLIST_KEY = "navsentinel:allowlist";
export const ALLOWLIST_KEY = "sentinelsuite:nav_allowlist_v1";

export function normalizeAllowlist(value: unknown): Allowlist {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const out: Allowlist = {};
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
  const current = normalizeAllowlist(res[ALLOWLIST_KEY]);
  if (Object.keys(current).length > 0) return current;

  const legacy = normalizeAllowlist(res[LEGACY_ALLOWLIST_KEY]);
  if (Object.keys(legacy).length > 0) {
    await chrome.storage.local.set({ [ALLOWLIST_KEY]: legacy });
    await chrome.storage.local.remove(LEGACY_ALLOWLIST_KEY);
    return legacy;
  }

  return {};
}

export async function setAllowlist(list: Allowlist): Promise<void> {
  await chrome.storage.local.set({ [ALLOWLIST_KEY]: normalizeAllowlist(list) });
}

export async function addAllowlistEntry(siteKey: string, destHost: string): Promise<Allowlist> {
  const list = await getAllowlist();
  const key = siteKey.toLowerCase();
  const host = destHost.toLowerCase();
  const existing = list[key] ?? [];
  if (!existing.includes(host)) {
    existing.push(host);
  }
  list[key] = existing;
  await setAllowlist(list);
  return list;
}

export async function removeAllowlistEntry(siteKey: string, destHost: string): Promise<Allowlist> {
  const list = await getAllowlist();
  const key = siteKey.toLowerCase();
  const host = destHost.toLowerCase();
  const existing = list[key];
  if (!existing) return list;
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
  await setAllowlist({});
}

export function isAllowlisted(list: Allowlist, siteKey: string, destHost: string): boolean {
  const key = siteKey.toLowerCase();
  const host = destHost.toLowerCase();
  return (list[key] ?? []).includes(host);
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
