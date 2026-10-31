import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Store = Record<string, unknown>;

describe("retained event assessments", () => {
  const entry = { id: "retained", ts: 1000, kind: "nav_click_block" as const, site: "source.test", reasons: ["no_accessible_name"] };
  const sender = { id: "ours", url: "chrome-extension://ours/evidence/evidence.html" };
  beforeEach(() => { vi.resetModules(); vi.spyOn(Date, "now").mockReturnValue(10000); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  async function setup() {
    const mock = createChromeMock();
    vi.stubGlobal("chrome", { ...mock.chrome, runtime: { id: "ours", getURL: (path: string) => `chrome-extension://ours/${path}` } });
    const storage = await import("../extension/src/shared/storage");
    mock.store[storage.EVENT_LOG_KEY] = [entry];
    return { ...mock, storage };
  }

  it("saves and removes only the opinion, and append replacement does not inherit it", async () => {
    const { storage } = await setup();
    await storage.setEventAssessment(JSON.stringify(entry), "should-allow");
    const assessed = { ...entry, assessment: { kind: "should-allow", ts: 10000 } };
    expect(await storage.getEventLog()).toEqual([assessed]);
    await storage.setEventAssessment(JSON.stringify(assessed), null);
    const removed = { ...entry, assessment: { kind: null, ts: 10000 } };
    expect(await storage.getEventLog()).toEqual([removed]);
    await storage.setEventAssessment(JSON.stringify(removed), "should-block");
    await storage.appendEvent({ id: "retained", kind: "nav_click_block", site: "replacement.test" });
    expect((await storage.getEventLog())[0]).toMatchObject({ site: "replacement.test" });
    expect((await storage.getEventLog())[0]?.assessment).toBeUndefined();
    await expect(storage.setEventAssessment(JSON.stringify(entry), "uncertain")).rejects.toThrow("Observation changed");
  });

  it("refuses delayed saves after clear/reimport, even when the same record returns", async () => {
    const { storage } = await setup();
    const delayed = { type: "ns-event-log-assess" as const, snapshot: JSON.stringify(entry), kind: "should-block" as const, ts: 9999 };
    await storage.clearEventLog();
    expect(await storage.getEventLog()).toEqual([]);
    await storage.handleEventLogControlMessage({ type: "ns-event-log-import-core", writes: { [storage.EVENT_LOG_KEY]: [entry] } }, sender);
    expect((await storage.handleEventLogControlMessage(delayed, sender)).ok).toBe(false);
    expect(await storage.getEventLog()).toEqual([entry]);
  });

  it("acknowledges its own retry but cannot overwrite a later assessment", async () => {
    const { storage } = await setup();
    const first = { type: "ns-event-log-assess" as const, snapshot: JSON.stringify(entry), kind: "should-block" as const, ts: 10000 };
    expect((await storage.handleEventLogControlMessage(first, sender)).ok).toBe(true);
    expect((await storage.handleEventLogControlMessage(first, sender)).ok).toBe(true);
    const next = { ...first, snapshot: JSON.stringify((await storage.getEventLog())[0]), kind: "uncertain" as const, ts: 10001 };
    expect((await storage.handleEventLogControlMessage(next, sender)).ok).toBe(true);
    expect((await storage.handleEventLogControlMessage(first, sender)).ok).toBe(false);
    expect((await storage.getEventLog())[0]?.assessment).toEqual({ kind: "uncertain", ts: 10001 });
  });

  it("keeps content scripts from assigning opinions and rejects malformed requests", async () => {
    const { storage } = await setup();
    const message = { type: "ns-event-log-assess" as const, snapshot: JSON.stringify(entry), kind: "should-block" as const, ts: 10000 };
    expect(await storage.handleEventLogControlMessage(message, { id: "ours", tab: { id: 1 } as chrome.tabs.Tab, url: "https://page.test/" })).toMatchObject({ ok: false, code: "unauthorized" });
    for (const patch of [{ kind: "hostile text" }, { kind: undefined }, { ts: Infinity }, { ts: -1 }, { snapshot: "x".repeat(65537) }]) {
      expect(storage.isEventLogControlMessage({ ...message, ...patch })).toBe(false);
    }
    expect(storage.isEventLogControlMessage({ ...message, kind: null })).toBe(true);
    await storage.appendEvent({ ...entry, assessment: { kind: "should-allow", ts: 10000 } } as Parameters<typeof storage.appendEvent>[0]);
    expect((await storage.getEventLog())[0]?.assessment).toBeUndefined();
  });

  it("does not resurrect a removed assessment on retried delivery", async () => {
    const { storage } = await setup();
    const message = { type: "ns-event-log-assess" as const, snapshot: JSON.stringify(entry), kind: "should-block" as const, ts: 10000 };
    await storage.handleEventLogControlMessage(message, sender);
    await storage.setEventAssessment(JSON.stringify((await storage.getEventLog())[0]), null);
    expect((await storage.handleEventLogControlMessage(message, sender)).ok).toBe(false);
  });

  it("round trips valid opinions through the existing backup and sheds hostile annotation fields", async () => {
    const { store, storage } = await setup();
    store[storage.EVENT_LOG_KEY] = [{ ...entry, assessment: { kind: "uncertain", ts: 2000, private: "secret" } }];
    const backup = await storage.exportAll();
    expect(backup.eventLog[0]?.assessment).toEqual({ kind: "uncertain", ts: 2000 });
    await storage.clearEventLog();
    await storage.importAll(backup);
    expect((await storage.getEventLog())[0]?.assessment).toEqual({ kind: "uncertain", ts: 2000 });
    await storage.importAll({ ...backup, eventLog: [{ ...entry, assessment: { kind: "__proto__", ts: 2000 } }] });
    expect((await storage.getEventLog())[0]?.assessment).toBeUndefined();
    expect((await storage.getEventLog())[0]?.kind).toBe("nav_click_block");
  });
});

function createChromeMock(initial: Store = {}) {
  const store: Store = { ...initial };
  const sessionStore: Store = {};
  return {
    store,
    chrome: {
      // No `runtime.sendMessage`: appends take the direct lane so the test
      // exercises buildEventLogEntry -> persistEventLogEntry in-process.
      storage: {
        local: {
          async get(keys?: string | string[] | Record<string, unknown>) {
            if (keys === undefined) return { ...store };
            if (typeof keys === "string") {
              return keys in store ? { [keys]: store[keys] } : {};
            }
            if (Array.isArray(keys)) {
              return Object.fromEntries(
                keys.filter((key) => key in store).map((key) => [key, store[key]]),
              );
            }
            return Object.fromEntries(
              Object.entries(keys).map(([key, fallback]) => [
                key,
                key in store ? store[key] : fallback,
              ]),
            );
          },
          async set(next: Record<string, unknown>) {
            for (const [key, value] of Object.entries(next)) {
              store[key] = value;
            }
          },
          async remove(keys: string | string[]) {
            const allKeys = Array.isArray(keys) ? keys : [keys];
            for (const key of allKeys) delete store[key];
          },
        },
        session: {
          async get(keys?: string | string[] | Record<string, unknown>) {
            if (keys === undefined) return { ...sessionStore };
            if (typeof keys === "string") {
              return keys in sessionStore ? { [keys]: sessionStore[keys] } : {};
            }
            if (Array.isArray(keys)) {
              return Object.fromEntries(
                keys
                  .filter((key) => key in sessionStore)
                  .map((key) => [key, sessionStore[key]]),
              );
            }
            return Object.fromEntries(
              Object.entries(keys).map(([key, fallback]) => [
                key,
                key in sessionStore ? sessionStore[key] : fallback,
              ]),
            );
          },
          async set(next: Record<string, unknown>) {
            for (const [key, value] of Object.entries(next)) {
              sessionStore[key] = value;
            }
          },
        },
        onChanged: {
          addListener() {},
        },
      },
    },
  };
}

describe("event-log malformed append (non-string fields surface at build time)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("persists a numeric runtime id with a fresh string ID instead of dropping the entry", async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { appendEvent, getEventLog } = await import("../extension/src/shared/storage");

    await appendEvent({ kind: "nav_click_block", id: 123 as unknown as string });

    // Preserve the event without assigning a malformed producer's identity.
    const log = await getEventLog();
    expect(log).toHaveLength(1);
    expect(typeof log[0]!.id).toBe("string");
    expect(log[0]!.id.length).toBeGreaterThan(0);
    expect(log[0]!.id).not.toBe("123");
  });

  it("omits object-valued string fields instead of storing \"[object Object]\" (#1147)", async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
    const { appendEvent, getEventLog } = await import("../extension/src/shared/storage");

    await appendEvent({
      kind: "nav_click_block",
      site: { host: "x" } as unknown as string,
      url: ["https://a.example/"] as unknown as string,
      destHost: 42 as unknown as string,
    });

    const [entry] = await getEventLog();
    expect(entry).toBeDefined();
    expect(entry!.site).toBeUndefined();
    expect(entry!.url).toBeUndefined();
    expect(entry!.destHost).toBe("42"); // primitives still coerce
  });

  it("preserves an existing string ID and repeated malformed-ID events", async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
    const { appendEvent, getEventLog } = await import("../extension/src/shared/storage");

    await appendEvent({ kind: "nav_click_block", id: "123", ts: 1 });
    await appendEvent({ kind: "nav_click_block", id: 123 as unknown as string, ts: 2 });
    await appendEvent({ kind: "nav_click_block", id: 123 as unknown as string, ts: 3 });

    const log = await getEventLog();
    expect(log.map((entry) => entry.ts).sort()).toEqual([1, 2, 3]);
    expect(log.find((entry) => entry.id === "123")?.ts).toBe(1);
    expect(new Set(log.map((entry) => entry.id)).size).toBe(3);
  });
});
