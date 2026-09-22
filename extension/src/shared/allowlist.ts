export type Allowlist = Record<string, string[]>;

const LEGACY_ALLOWLIST_KEY = "navsentinel:allowlist";
export const ALLOWLIST_KEY = "sentinelsuite:nav_allowlist_v1";

export type AllowlistMutationMessage =
  | { type: "ns-allowlist-mutate"; op: "add" | "remove"; siteKey: string; destHost: string }
  | { type: "ns-allowlist-mutate"; op: "migrate" }
  | { type: "ns-allowlist-mutate"; op: "clear" }
  | { type: "ns-allowlist-mutate"; op: "replace"; list: Allowlist };

type AllowlistMutationResponse =
  | { ok: true; list: Allowlist }
  | { ok: false; error: string };

// Options and content scripts have separate module instances. Their writes
// must meet in the service worker rather than in either module's local queue.
async function delegateMutation(message: AllowlistMutationMessage): Promise<Allowlist> {
  const response = await chrome.runtime.sendMessage(message) as AllowlistMutationResponse | undefined;
  if (!response?.ok) throw new Error(response?.error ?? "Allowlist update was not confirmed");
  return normalizeAllowlist(response.list);
}

function hasDocumentContext(): boolean { return typeof document !== "undefined"; }

// In-process FIFO write queue (#753). Each mutating helper enqueues its
// get-mutate-set so it runs only after the previous mutation has settled,
// even if the previous call rejected. The later-enqueued call wins.
let writeQueue: Promise<void> = Promise.resolve();

function enqueueAllowlistWrite<T>(op: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(op, op);
  writeQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

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

async function readAllowlist(delegateMigration: boolean): Promise<Allowlist> {
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
    if (delegateMigration) return delegateMutation({ type: "ns-allowlist-mutate", op: "migrate" });
    await chrome.storage.local.set({ [ALLOWLIST_KEY]: legacy });
    await chrome.storage.local.remove(LEGACY_ALLOWLIST_KEY);
    return legacy;
  }

  return {};
}

export function getAllowlist(): Promise<Allowlist> { return readAllowlist(hasDocumentContext()); }

async function setAllowlistDirect(list: Allowlist): Promise<void> {
  await chrome.storage.local.set({ [ALLOWLIST_KEY]: normalizeAllowlist(list) });
  await chrome.storage.local.remove(LEGACY_ALLOWLIST_KEY);
}

/** Worker-side mutation, also used by non-browser unit tests. */
export function applyAllowlistMutationDirect(message: AllowlistMutationMessage): Promise<Allowlist> {
  return enqueueAllowlistWrite(async () => {
    if (message.op === "migrate") return readAllowlist(false);
    if (message.op === "clear") {
      await chrome.storage.local.set({ [ALLOWLIST_KEY]: {} });
      await chrome.storage.local.remove(LEGACY_ALLOWLIST_KEY);
      return {};
    }
    if (message.op === "replace") {
      const list = normalizeAllowlist(message.list);
      await setAllowlistDirect(list);
      return list;
    }
    const list = await readAllowlist(false);
    const key = message.siteKey.toLowerCase();
    const host = message.destHost.toLowerCase();
    const existing = list[key] ?? [];
    if (message.op === "add") {
      if (!existing.includes(host)) existing.push(host);
      list[key] = existing;
    } else if (existing.length > 0) {
      const next = existing.filter((entry) => entry !== host);
      if (next.length === 0) delete list[key];
      else list[key] = next;
    }
    if (message.op === "add" || existing.length > 0) await setAllowlistDirect(list);
    return list;
  });
}

export async function setAllowlist(list: Allowlist): Promise<void> {
  if (hasDocumentContext()) { await delegateMutation({ type: "ns-allowlist-mutate", op: "replace", list }); return; }
  await applyAllowlistMutationDirect({ type: "ns-allowlist-mutate", op: "replace", list });
}

export async function addAllowlistEntry(siteKey: string, destHost: string): Promise<Allowlist> {
  const message = { type: "ns-allowlist-mutate", op: "add", siteKey, destHost } as const;
  return hasDocumentContext() ? delegateMutation(message) : applyAllowlistMutationDirect(message);
}

export async function removeAllowlistEntry(siteKey: string, destHost: string): Promise<Allowlist> {
  const message = { type: "ns-allowlist-mutate", op: "remove", siteKey, destHost } as const;
  return hasDocumentContext() ? delegateMutation(message) : applyAllowlistMutationDirect(message);
}

export async function clearAllowlist(): Promise<void> {
  const message = { type: "ns-allowlist-mutate", op: "clear" } as const;
  if (hasDocumentContext()) { await delegateMutation(message); return; }
  await applyAllowlistMutationDirect(message);
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
