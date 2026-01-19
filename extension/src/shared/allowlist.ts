export type Allowlist = Record<string, string[]>;

const ALLOWLIST_KEY = "navsentinel:allowlist";

export async function getAllowlist(): Promise<Allowlist> {
  const res = await chrome.storage.local.get(ALLOWLIST_KEY);
  return (res[ALLOWLIST_KEY] as Allowlist) ?? {};
}

export async function setAllowlist(list: Allowlist): Promise<void> {
  await chrome.storage.local.set({ [ALLOWLIST_KEY]: list });
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
    const next = (change.newValue as Allowlist | undefined) ?? {};
    cb(next);
  });
}
