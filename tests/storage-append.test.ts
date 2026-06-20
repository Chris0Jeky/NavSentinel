import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EVENT_LOG_KEY,
  PROMPT_OUTCOMES_KEY,
} from "../extension/src/shared/storage";

type Store = Record<string, unknown>;

function createChromeMock(initial: Store = {}) {
  const store: Store = { ...initial };

  return {
    store,
    chrome: {
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
              Object.entries(keys).map(([key, fallback]) => [key, key in store ? store[key] : fallback]),
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
        onChanged: {
          addListener() {},
        },
      },
    },
  };
}

const SETTINGS_KEY = "sentinelsuite:settings_v1";

// A trusted extension-page sender (options/popup) has no `tab`. clear/replace
// require this; content-script senders (with a tab) may only append.
const OPTIONS_SENDER = {
  url: "chrome-extension://navsentinel-test/options.html",
} as chrome.runtime.MessageSender;
const CONTENT_SCRIPT_SENDER = {
  tab: { id: 7 },
  url: "https://evil.example/page",
} as chrome.runtime.MessageSender;

describe("appendEvent", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("appends a new event to an empty log", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { appendEvent } = await import("../extension/src/shared/storage");
    await appendEvent({ kind: "nav_click_block", site: "example.com" });

    const log = store[EVENT_LOG_KEY] as Array<{ kind: string; site: string }>;
    expect(log).toHaveLength(1);
    expect(log[0]!.kind).toBe("nav_click_block");
    expect(log[0]!.site).toBe("example.com");
  });

  it("appends to an existing log", async () => {
    const { chrome, store } = createChromeMock({
      [EVENT_LOG_KEY]: [{ id: "old-1", ts: 1000, kind: "suite_config_update" }],
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { appendEvent } = await import("../extension/src/shared/storage");
    await appendEvent({ kind: "nav_rollback", site: "test.com" });

    const log = store[EVENT_LOG_KEY] as Array<{ id: string }>;
    expect(log).toHaveLength(2);
  });

  it("deduplicates by id (replaces existing entry)", async () => {
    const { chrome, store } = createChromeMock({
      [EVENT_LOG_KEY]: [{ id: "dedup-1", ts: 1000, kind: "suite_config_update" }],
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { appendEvent } = await import("../extension/src/shared/storage");
    await appendEvent({ id: "dedup-1", kind: "nav_click_block", site: "updated.com" });

    const log = store[EVENT_LOG_KEY] as Array<{ id: string; kind: string; site: string }>;
    expect(log).toHaveLength(1);
    expect(log[0]!.kind).toBe("nav_click_block");
    expect(log[0]!.site).toBe("updated.com");
  });

  it("enforces configured log limit", async () => {
    const { chrome, store } = createChromeMock({
      [SETTINGS_KEY]: { logLimit: 100 },
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { appendEvent } = await import("../extension/src/shared/storage");

    for (let i = 0; i < 120; i++) {
      await appendEvent({ id: `evt-${i}`, kind: "nav_click_block", ts: i });
    }

    const log = store[EVENT_LOG_KEY] as Array<{ id: string }>;
    expect(log).toHaveLength(100);
    expect(log[0]!.id).toBe("evt-20");
  });

  it("drops a NEW silent event (loud wins) on a loud-saturated log, without warning (#236)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const loud = Array.from({ length: 50 }, (_, i) => ({ id: `loud-${i}`, ts: i, kind: "nav_click_block" }));
    const { chrome, store } = createChromeMock({
      [SETTINGS_KEY]: { logLimit: 50 },
      [EVENT_LOG_KEY]: loud,
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { appendEvent } = await import("../extension/src/shared/storage");
    await appendEvent({ id: "silent-new", kind: "nav_silent_allow", ts: 100, site: "x.com" });

    const log = store[EVENT_LOG_KEY] as Array<{ id: string; kind: string }>;
    // Loud events are protected: all 50 retained, the new silent event evicted.
    expect(log).toHaveLength(50);
    expect(log.some((e) => e.id === "silent-new")).toBe(false);
    expect(log.every((e) => e.kind === "nav_click_block")).toBe(true);
    // The intentional eviction must NOT be treated as a failed write (no retries/warn).
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("keeps a NEW silent event while evicting an OLDER silent event at cap (#236)", async () => {
    const entries = [
      { id: "silent-old", ts: 0, kind: "nav_silent_allow" },
      ...Array.from({ length: 49 }, (_, i) => ({ id: `loud-${i}`, ts: i + 1, kind: "nav_click_block" })),
    ];
    const { chrome, store } = createChromeMock({
      [SETTINGS_KEY]: { logLimit: 50 },
      [EVENT_LOG_KEY]: entries,
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { appendEvent } = await import("../extension/src/shared/storage");
    await appendEvent({ id: "silent-new", kind: "nav_silent_allow", ts: 100, site: "x.com" });

    const log = store[EVENT_LOG_KEY] as Array<{ id: string }>;
    expect(log).toHaveLength(50);
    // Oldest silent dropped; new silent kept; all loud retained.
    expect(log.some((e) => e.id === "silent-old")).toBe(false);
    expect(log.some((e) => e.id === "silent-new")).toBe(true);
  });

  it("delegates event-log appends through the service worker when runtime messaging is available", async () => {
    const { chrome, store } = createChromeMock();
    const sent: unknown[] = [];
    (chrome as unknown as { runtime: unknown }).runtime = {
      sendMessage(message: unknown, callback?: (response: unknown) => void) {
        sent.push(message);
        callback?.({ ok: true });
      },
    };
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { appendEvent } = await import("../extension/src/shared/storage");
    await appendEvent({ id: "delegated-1", kind: "nav_silent_allow", ts: 10, site: "example.com" });

    expect(store[EVENT_LOG_KEY]).toBeUndefined();
    expect(sent).toEqual([
      {
        type: "ns-event-log-append",
        entry: { id: "delegated-1", ts: 10, kind: "nav_silent_allow", site: "example.com" },
      },
    ]);
  });

  it("handles delegated event-log appends in the service-worker path", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", {
      ...chrome,
      clients: {},
      registration: {},
    } as unknown as typeof globalThis.chrome);

    const { handleEventLogAppendMessage } = await import("../extension/src/shared/storage");
    await expect(
      handleEventLogAppendMessage({
        type: "ns-event-log-append",
        entry: { id: "sw-1", ts: 10, kind: "cred_form_evaluated", site: "example.com" },
      })
    ).resolves.toEqual({ ok: true });

    expect(store[EVENT_LOG_KEY]).toEqual([
      { id: "sw-1", ts: 10, kind: "cred_form_evaluated", site: "example.com" },
    ]);
  });

  it("retries delegated event-log appends when the service worker is initially unreachable", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
    const worker = await import("../extension/src/shared/storage");
    let calls = 0;
    const runtime: {
      lastError?: { message?: string };
      sendMessage: (message: unknown, callback?: (response: unknown) => void) => void;
    } = {
      sendMessage(message, callback) {
        calls++;
        if (calls === 1) {
          runtime.lastError = { message: "Could not establish connection." };
          callback?.(undefined);
          delete runtime.lastError;
          return;
        }
        void worker.handleEventLogAppendMessage(
          message as Parameters<typeof worker.handleEventLogAppendMessage>[0]
        ).then((response) => callback?.(response));
      },
    };
    (chrome as unknown as { runtime: unknown }).runtime = runtime;

    vi.resetModules();
    const contentScript = await import("../extension/src/shared/storage");
    await contentScript.appendEvent({ id: "event-retry-1", kind: "nav_silent_allow", ts: 10, site: "example.com" });

    expect(calls).toBeGreaterThanOrEqual(2);
    const ids = (store[EVENT_LOG_KEY] as Array<{ id: string }>).map((entry) => entry.id);
    expect(ids).toContain("event-retry-1");
  });

  it("serializes service-worker event-log appends without losing entries", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", {
      ...chrome,
      clients: {},
      registration: {},
    } as unknown as typeof globalThis.chrome);

    const { handleEventLogAppendMessage } = await import("../extension/src/shared/storage");
    await Promise.all([
      handleEventLogAppendMessage({
        type: "ns-event-log-append",
        entry: { id: "sw-concurrent-1", ts: 1, kind: "nav_silent_allow" },
      }),
      handleEventLogAppendMessage({
        type: "ns-event-log-append",
        entry: { id: "sw-concurrent-2", ts: 2, kind: "cred_form_evaluated" },
      }),
      handleEventLogAppendMessage({
        type: "ns-event-log-append",
        entry: { id: "sw-concurrent-3", ts: 3, kind: "nav_click_block" },
      }),
    ]);

    const ids = (store[EVENT_LOG_KEY] as Array<{ id: string }>).map((entry) => entry.id);
    expect(ids).toEqual(["sw-concurrent-1", "sw-concurrent-2", "sw-concurrent-3"]);
  });

  it("clamps logLimit below minimum to 50", async () => {
    const { chrome, store } = createChromeMock({
      [SETTINGS_KEY]: { logLimit: 3 },
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { appendEvent } = await import("../extension/src/shared/storage");

    for (let i = 0; i < 60; i++) {
      await appendEvent({ id: `evt-${i}`, kind: "nav_click_block", ts: i });
    }

    const log = store[EVENT_LOG_KEY] as Array<{ id: string }>;
    expect(log).toHaveLength(50);
  });

  it("auto-generates id and ts when not provided", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { appendEvent } = await import("../extension/src/shared/storage");
    await appendEvent({ kind: "nav_click_block" });

    const log = store[EVENT_LOG_KEY] as Array<{ id: string; ts: number }>;
    expect(log).toHaveLength(1);
    expect(log[0]!.id).toBeTruthy();
    expect(log[0]!.ts).toBeGreaterThan(0);
  });

  it("preserves optional fields when provided", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { appendEvent } = await import("../extension/src/shared/storage");
    await appendEvent({
      kind: "nav_click_block",
      site: "test.com",
      url: "https://test.com/page",
      destHost: "evil.com",
      score: 85,
      reasons: ["nrs_cross_site", "nrs_new_tab_window"],
      extra: { tabId: 42 },
    });

    const log = store[EVENT_LOG_KEY] as Array<Record<string, unknown>>;
    expect(log).toHaveLength(1);
    expect(log[0]!.site).toBe("test.com");
    expect(log[0]!.url).toBe("https://test.com/page");
    expect(log[0]!.destHost).toBe("evil.com");
    expect(log[0]!.score).toBe(85);
    expect(log[0]!.reasons).toEqual(["nrs_cross_site", "nrs_new_tab_window"]);
    expect(log[0]!.extra).toEqual({ tabId: 42 });
  });

  it("sanitizes non-string reasons so the event persists instead of being silently dropped (#339)", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { appendEvent } = await import("../extension/src/shared/storage");
    // A malformed runtime append carries non-string reasons. Pre-fix the built entry fails
    // isEventLogEntry, so persistEventLogEntry's re-validation drops it (mistaken for an
    // intentional silent-decision eviction) and it never persists. Post-fix reasons are
    // sanitized to a string[], so the entry stays valid and is persisted.
    await appendEvent({
      id: "bad-reasons",
      kind: "nav_click_block",
      reasons: [123, "ok", null, "fine"] as unknown as string[],
    });

    const log = (store[EVENT_LOG_KEY] as Array<{ id: string; reasons?: unknown }>) ?? [];
    const entry = log.find((e) => e.id === "bad-reasons");
    expect(entry).toBeDefined();
    expect(entry!.reasons).toEqual(["ok", "fine"]); // non-strings filtered out
  });

  it("caps event reasons at MAX_REASON_CODES (32) to bound per-entry size (#339)", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { appendEvent } = await import("../extension/src/shared/storage");
    const reasons = Array.from({ length: 40 }, (_, i) => `code_${i}`);
    await appendEvent({ id: "many-reasons", kind: "nav_click_block", reasons });

    const log = (store[EVENT_LOG_KEY] as Array<{ id: string; reasons?: string[] }>) ?? [];
    const entry = log.find((e) => e.id === "many-reasons");
    expect(entry).toBeDefined();
    expect(entry!.reasons).toHaveLength(32);
    expect(entry!.reasons![0]).toBe("code_0");
    expect(entry!.reasons![31]).toBe("code_31");
  });

  it("coerces a non-array reasons value to [] (persists, does not throw or drop) (#339)", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { appendEvent } = await import("../extension/src/shared/storage");
    await appendEvent({
      id: "scalar-reasons",
      kind: "nav_click_block",
      reasons: "nrs_foo" as unknown as string[],
    });

    const log = (store[EVENT_LOG_KEY] as Array<{ id: string; reasons?: unknown }>) ?? [];
    const entry = log.find((e) => e.id === "scalar-reasons");
    expect(entry).toBeDefined();
    expect(entry!.reasons).toEqual([]); // sanitizeCodeList -> undefined -> ?? [] (still valid)
  });

  it("omits optional fields when not provided", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { appendEvent } = await import("../extension/src/shared/storage");
    await appendEvent({ kind: "suite_config_update" });

    const log = store[EVENT_LOG_KEY] as Array<Record<string, unknown>>;
    expect(log).toHaveLength(1);
    expect("site" in log[0]!).toBe(false);
    expect("url" in log[0]!).toBe(false);
    expect("destHost" in log[0]!).toBe(false);
    expect("score" in log[0]!).toBe(false);
    expect("reasons" in log[0]!).toBe(false);
    expect("extra" in log[0]!).toBe(false);
  });

  it("handles non-array storage value gracefully", async () => {
    const { chrome, store } = createChromeMock({
      [EVENT_LOG_KEY]: "corrupted",
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { appendEvent } = await import("../extension/src/shared/storage");
    await appendEvent({ kind: "nav_click_block" });

    const log = store[EVENT_LOG_KEY] as Array<{ kind: string }>;
    expect(log).toHaveLength(1);
    expect(log[0]!.kind).toBe("nav_click_block");
  });

  it("warns on console when all 3 verification attempts fail", async () => {
    let setCount = 0;
    const brokenChrome = {
      storage: {
        local: {
          async get(keys?: string | string[]) {
            const k = Array.isArray(keys) ? keys : typeof keys === "string" ? [keys] : [];
            if (k.includes(EVENT_LOG_KEY)) return {};
            if (k.includes(SETTINGS_KEY)) return { [SETTINGS_KEY]: { logLimit: 300 } };
            return {};
          },
          async set() {
            setCount++;
          },
        },
        onChanged: { addListener() {} },
      },
    };
    vi.stubGlobal("chrome", brokenChrome as unknown as typeof globalThis.chrome);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { appendEvent } = await import("../extension/src/shared/storage");
    const result = appendEvent({ id: "fail-id", kind: "nav_click_block" });
    await expect(result).resolves.toBeUndefined();

    expect(setCount).toBe(3);
    expect(warnSpy).toHaveBeenCalledWith(
      "[NavSentinel] appendEvent: failed to persist after 3 attempts, id:",
      "fail-id",
    );
  });

  it("survives null/undefined items in existing log array", async () => {
    const { chrome, store } = createChromeMock({
      [EVENT_LOG_KEY]: [null, undefined, { id: "valid-1", ts: 1, kind: "nav_click_block" }, { notAnId: true }],
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { appendEvent } = await import("../extension/src/shared/storage");
    await appendEvent({ kind: "nav_rollback", site: "test.com" });

    const log = store[EVENT_LOG_KEY] as Array<{ id?: string }>;
    expect(log).toHaveLength(2);
    expect(log.map((e) => e.id)).toEqual(["valid-1", expect.any(String)]);
  });

  it("propagates exception when set() throws", async () => {
    const throwingChrome = {
      storage: {
        local: {
          async get() {
            return {};
          },
          async set() {
            throw new Error("QUOTA_BYTES exceeded");
          },
        },
        onChanged: { addListener() {} },
      },
    };
    vi.stubGlobal("chrome", throwingChrome as unknown as typeof globalThis.chrome);

    const { appendEvent } = await import("../extension/src/shared/storage");
    await expect(appendEvent({ kind: "nav_click_block" })).rejects.toThrow("QUOTA_BYTES exceeded");
  });

  it("propagates exception when get() throws", async () => {
    const throwingChrome = {
      storage: {
        local: {
          async get() {
            throw new Error("Extension context invalidated");
          },
          async set() {},
        },
        onChanged: { addListener() {} },
      },
    };
    vi.stubGlobal("chrome", throwingChrome as unknown as typeof globalThis.chrome);

    const { appendEvent } = await import("../extension/src/shared/storage");
    await expect(appendEvent({ kind: "nav_click_block" })).rejects.toThrow("Extension context invalidated");
  });

  it("handles concurrent appends without losing entries", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { appendEvent } = await import("../extension/src/shared/storage");
    await Promise.all([
      appendEvent({ id: "concurrent-1", kind: "nav_click_block", ts: 1 }),
      appendEvent({ id: "concurrent-2", kind: "nav_rollback", ts: 2 }),
      appendEvent({ id: "concurrent-3", kind: "suite_config_update", ts: 3 }),
    ]);

    const log = store[EVENT_LOG_KEY] as Array<{ id: string }>;
    const ids = log.map((e) => e.id);
    expect(ids).toEqual(["concurrent-1", "concurrent-2", "concurrent-3"]);
  });
});

describe("appendPromptOutcome", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("appends a new outcome to an empty log", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { appendPromptOutcome } = await import("../extension/src/shared/storage");
    await appendPromptOutcome({
      domain: "example.com",
      type: "nav",
      score: 65,
      outcome: "allow",
    });

    const log = store[PROMPT_OUTCOMES_KEY] as Array<{ domain: string; outcome: string }>;
    expect(log).toHaveLength(1);
    expect(log[0]!.domain).toBe("example.com");
    expect(log[0]!.outcome).toBe("allow");
  });

  it("appends to an existing outcomes log", async () => {
    const { chrome, store } = createChromeMock({
      [PROMPT_OUTCOMES_KEY]: [
        { id: "old-1", ts: 1000, domain: "a.com", type: "nav", score: 50, outcome: "block" },
      ],
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { appendPromptOutcome } = await import("../extension/src/shared/storage");
    await appendPromptOutcome({
      domain: "b.com",
      type: "cred",
      score: 30,
      outcome: "allow_once",
    });

    const log = store[PROMPT_OUTCOMES_KEY] as Array<{ id: string }>;
    expect(log).toHaveLength(2);
  });

  it("deduplicates by id", async () => {
    const { chrome, store } = createChromeMock({
      [PROMPT_OUTCOMES_KEY]: [
        { id: "dup-1", ts: 1000, domain: "a.com", type: "nav", score: 50, outcome: "block" },
      ],
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { appendPromptOutcome } = await import("../extension/src/shared/storage");
    await appendPromptOutcome({
      id: "dup-1",
      domain: "a.com",
      type: "nav",
      score: 50,
      outcome: "allow",
    });

    const log = store[PROMPT_OUTCOMES_KEY] as Array<{ id: string; outcome: string }>;
    expect(log).toHaveLength(1);
    expect(log[0]!.outcome).toBe("allow");
  });

  it("preserves optional destDomain and reasons", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { appendPromptOutcome } = await import("../extension/src/shared/storage");
    await appendPromptOutcome({
      domain: "example.com",
      destDomain: "evil.com",
      type: "nav",
      score: 85,
      outcome: "block",
      reasons: ["nrs_known_bad_domain"],
    });

    const log = store[PROMPT_OUTCOMES_KEY] as Array<Record<string, unknown>>;
    expect(log[0]!.destDomain).toBe("evil.com");
    expect(log[0]!.reasons).toEqual(["nrs_known_bad_domain"]);
  });

  it("omits optional fields when not provided", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { appendPromptOutcome } = await import("../extension/src/shared/storage");
    await appendPromptOutcome({
      domain: "example.com",
      type: "nav",
      score: 50,
      outcome: "allow",
    });

    const log = store[PROMPT_OUTCOMES_KEY] as Array<Record<string, unknown>>;
    expect("destDomain" in log[0]!).toBe(false);
    expect("reasons" in log[0]!).toBe(false);
  });

  it("enforces 500 outcome limit", async () => {
    const existing = Array.from({ length: 500 }, (_, i) => ({
      id: `old-${i}`,
      ts: i,
      domain: "a.com",
      type: "nav",
      score: 50,
      outcome: "block",
    }));
    const { chrome, store } = createChromeMock({
      [PROMPT_OUTCOMES_KEY]: existing,
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { appendPromptOutcome } = await import("../extension/src/shared/storage");
    await appendPromptOutcome({
      domain: "new.com",
      type: "nav",
      score: 99,
      outcome: "allow",
    });

    const log = store[PROMPT_OUTCOMES_KEY] as Array<{ id: string; domain: string }>;
    expect(log).toHaveLength(500);
    expect(log[log.length - 1]!.domain).toBe("new.com");
    expect(log[0]!.id).toBe("old-1");
  });

  it("handles non-array storage value gracefully", async () => {
    const { chrome, store } = createChromeMock({
      [PROMPT_OUTCOMES_KEY]: 42,
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { appendPromptOutcome } = await import("../extension/src/shared/storage");
    await appendPromptOutcome({
      domain: "example.com",
      type: "nav",
      score: 50,
      outcome: "allow",
    });

    const log = store[PROMPT_OUTCOMES_KEY] as Array<{ domain: string }>;
    expect(log).toHaveLength(1);
    expect(log[0]!.domain).toBe("example.com");
  });

  it("drops corrupt stored outcomes before appending", async () => {
    const validOutcome = {
      id: "valid-outcome",
      ts: 1,
      domain: "valid.example",
      type: "nav",
      score: 40,
      outcome: "allow",
    };
    const { chrome, store } = createChromeMock({
      [PROMPT_OUTCOMES_KEY]: [
        null,
        validOutcome,
        { id: "missing-required-fields" },
        undefined,
        "not-an-outcome",
      ],
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { appendPromptOutcome } = await import("../extension/src/shared/storage");
    await appendPromptOutcome({
      id: "new-valid-outcome",
      domain: "new.example",
      type: "cred",
      score: 65,
      outcome: "block",
    });

    const log = store[PROMPT_OUTCOMES_KEY] as Array<{ id: string }>;
    expect(log.map((entry) => entry.id)).toEqual(["valid-outcome", "new-valid-outcome"]);
  });

  it("warns on console when all 3 verification attempts fail", async () => {
    let setCount = 0;
    const brokenChrome = {
      storage: {
        local: {
          async get(keys?: string | string[]) {
            const k = Array.isArray(keys) ? keys : typeof keys === "string" ? [keys] : [];
            if (k.includes(PROMPT_OUTCOMES_KEY)) return {};
            return {};
          },
          async set() {
            setCount++;
          },
        },
        onChanged: { addListener() {} },
      },
    };
    vi.stubGlobal("chrome", brokenChrome as unknown as typeof globalThis.chrome);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { appendPromptOutcome } = await import("../extension/src/shared/storage");
    const result = appendPromptOutcome({
      id: "fail-outcome",
      domain: "example.com",
      type: "nav",
      score: 50,
      outcome: "block",
    });
    await expect(result).resolves.toBeUndefined();

    expect(setCount).toBe(3);
    expect(warnSpy).toHaveBeenCalledWith(
      "[NavSentinel] appendPromptOutcome: failed to persist after 3 attempts, id:",
      "fail-outcome",
    );
  });

  it("serializes concurrent appends without losing outcomes", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { appendPromptOutcome } = await import("../extension/src/shared/storage");
    const ids = Array.from({ length: 8 }, (_, i) => `outcome-${i}`);
    await Promise.all(
      ids.map((id, i) =>
        appendPromptOutcome({
          id,
          domain: `site-${i}.example`,
          type: "nav",
          score: 40 + i,
          outcome: "allow",
          ts: i,
        }),
      ),
    );

    const log = store[PROMPT_OUTCOMES_KEY] as Array<{ id: string }>;
    expect(log).toHaveLength(ids.length);
    expect(new Set(log.map((entry) => entry.id))).toEqual(new Set(ids));
  });

  it("does not accept verification that clobbers existing outcomes", async () => {
    let getCount = 0;
    let setCount = 0;
    const existingOutcome = {
      id: "existing-outcome",
      ts: 1,
      domain: "existing.example",
      type: "nav",
      score: 50,
      outcome: "block",
    };
    const otherOutcome = {
      id: "other-outcome",
      ts: 2,
      domain: "other.example",
      type: "cred",
      score: 30,
      outcome: "trust",
    };
    const brokenChrome = {
      storage: {
        local: {
          async get(keys?: string | string[]) {
            const k = Array.isArray(keys) ? keys : typeof keys === "string" ? [keys] : [];
            if (!k.includes(PROMPT_OUTCOMES_KEY)) return {};
            getCount++;
            return {
              [PROMPT_OUTCOMES_KEY]: getCount % 2 === 1
                ? [existingOutcome, otherOutcome]
                : [{
                  id: "replacement-outcome",
                  ts: 3,
                  domain: "replacement.example",
                  type: "nav",
                  score: 55,
                  outcome: "dismiss",
                }, otherOutcome, {
                  id: "new-outcome",
                  ts: 4,
                  domain: "new.example",
                  type: "nav",
                  score: 60,
                  outcome: "allow",
                }],
            };
          },
          async set() {
            setCount++;
          },
        },
        onChanged: { addListener() {} },
      },
    };
    vi.stubGlobal("chrome", brokenChrome as unknown as typeof globalThis.chrome);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { appendPromptOutcome } = await import("../extension/src/shared/storage");
    await appendPromptOutcome({
      id: "new-outcome",
      domain: "new.example",
      type: "nav",
      score: 60,
      outcome: "allow",
    });

    expect(setCount).toBe(3);
    expect(warnSpy).toHaveBeenCalledWith(
      "[NavSentinel] appendPromptOutcome: failed to persist after 3 attempts, id:",
      "new-outcome",
    );
  });

  it("retries without forgetting outcomes observed before a clobbered verify", async () => {
    let setCount = 0;
    const existingOutcome = {
      id: "existing-outcome",
      ts: 1,
      domain: "existing.example",
      type: "nav",
      score: 50,
      outcome: "block",
    };
    const otherOutcome = {
      id: "other-outcome",
      ts: 2,
      domain: "other.example",
      type: "cred",
      score: 30,
      outcome: "trust",
    };
    const newOutcome = {
      id: "new-outcome",
      ts: 4,
      domain: "new.example",
      type: "nav" as const,
      score: 60,
      outcome: "allow" as const,
    };
    const store: Store = {
      [PROMPT_OUTCOMES_KEY]: [existingOutcome, otherOutcome],
    };
    const clobberingChrome = {
      storage: {
        local: {
          async get(keys?: string | string[]) {
            const k = Array.isArray(keys) ? keys : typeof keys === "string" ? [keys] : [];
            return k.includes(PROMPT_OUTCOMES_KEY) ? { [PROMPT_OUTCOMES_KEY]: store[PROMPT_OUTCOMES_KEY] } : {};
          },
          async set(next: Record<string, unknown>) {
            setCount++;
            store[PROMPT_OUTCOMES_KEY] = next[PROMPT_OUTCOMES_KEY];
            if (setCount === 1) {
              store[PROMPT_OUTCOMES_KEY] = [otherOutcome, newOutcome];
            }
          },
        },
        onChanged: { addListener() {} },
      },
    };
    vi.stubGlobal("chrome", clobberingChrome as unknown as typeof globalThis.chrome);

    const { appendPromptOutcome } = await import("../extension/src/shared/storage");
    await appendPromptOutcome(newOutcome);

    const ids = (store[PROMPT_OUTCOMES_KEY] as Array<{ id: string }>).map((item) => item.id);
    expect(setCount).toBe(2);
    expect(new Set(ids)).toEqual(new Set(["existing-outcome", "other-outcome", "new-outcome"]));
  });

  it("routes independent module callers through one runtime writer", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
    const workerStorage = await import("../extension/src/shared/storage");
    const runtimeChrome = chrome as unknown as {
      runtime: {
        lastError?: { message?: string };
        sendMessage(message: unknown, callback?: (response: unknown) => void): void;
      };
    };
    runtimeChrome.runtime = {
      sendMessage(message, callback) {
        void workerStorage.handlePromptOutcomeStorageMessage(
          message as Parameters<typeof workerStorage.handlePromptOutcomeStorageMessage>[0]
        ).then((response) => callback?.(response));
      },
    };

    vi.resetModules();
    const contentStorageA = await import("../extension/src/shared/storage");
    vi.resetModules();
    const contentStorageB = await import("../extension/src/shared/storage");

    await Promise.all([
      contentStorageA.appendPromptOutcome({
        id: "context-a",
        domain: "a.example",
        type: "nav",
        score: 55,
        outcome: "allow",
      }),
      contentStorageB.appendPromptOutcome({
        id: "context-b",
        domain: "b.example",
        type: "cred",
        score: 75,
        outcome: "block",
      }),
    ]);

    const ids = (store[PROMPT_OUTCOMES_KEY] as Array<{ id: string }>).map((entry) => entry.id);
    expect(new Set(ids)).toEqual(new Set(["context-a", "context-b"]));
  });

  it("drops a delayed runtime append created before a clear reset", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { handlePromptOutcomeStorageMessage } = await import("../extension/src/shared/storage");
    await handlePromptOutcomeStorageMessage({ type: "ns-prompt-outcome-clear" }, OPTIONS_SENDER);
    await handlePromptOutcomeStorageMessage({
      type: "ns-prompt-outcome-append",
      entry: {
        id: "delayed-before-clear",
        ts: 1,
        domain: "late.example",
        type: "nav",
        score: 70,
        outcome: "allow",
      },
    });

    expect(store[PROMPT_OUTCOMES_KEY]).toEqual([]);
  });

  it("drops a delayed runtime append with the same timestamp as a clear reset", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
    vi.spyOn(Date, "now").mockReturnValue(1000);

    const { handlePromptOutcomeStorageMessage } = await import("../extension/src/shared/storage");
    await handlePromptOutcomeStorageMessage({ type: "ns-prompt-outcome-clear" }, OPTIONS_SENDER);
    await handlePromptOutcomeStorageMessage({
      type: "ns-prompt-outcome-append",
      entry: {
        id: "same-ms-before-clear",
        ts: 1000,
        domain: "late.example",
        type: "nav",
        score: 70,
        outcome: "allow",
      },
    });

    expect(store[PROMPT_OUTCOMES_KEY]).toEqual([]);
  });

  it("drops a delayed runtime append created before an import replacement", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { handlePromptOutcomeStorageMessage } = await import("../extension/src/shared/storage");
    await handlePromptOutcomeStorageMessage({
      type: "ns-prompt-outcome-replace",
      outcomes: [{
        id: "imported-outcome",
        ts: 1,
        domain: "imported.example",
        type: "cred",
        score: 45,
        outcome: "trust",
      }],
    }, OPTIONS_SENDER);
    await handlePromptOutcomeStorageMessage({
      type: "ns-prompt-outcome-append",
      entry: {
        id: "delayed-before-import",
        ts: 1,
        domain: "late.example",
        type: "nav",
        score: 70,
        outcome: "allow",
      },
    });

    const ids = (store[PROMPT_OUTCOMES_KEY] as Array<{ id: string }>).map((entry) => entry.id);
    expect(ids).toEqual(["imported-outcome"]);
  });

  it("drops a delayed runtime append with the same timestamp as an import replacement", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
    vi.spyOn(Date, "now").mockReturnValue(2000);

    const { handlePromptOutcomeStorageMessage } = await import("../extension/src/shared/storage");
    await handlePromptOutcomeStorageMessage({
      type: "ns-prompt-outcome-replace",
      outcomes: [{
        id: "imported-outcome",
        ts: 1,
        domain: "imported.example",
        type: "cred",
        score: 45,
        outcome: "trust",
      }],
    }, OPTIONS_SENDER);
    await handlePromptOutcomeStorageMessage({
      type: "ns-prompt-outcome-append",
      entry: {
        id: "same-ms-before-import",
        ts: 2000,
        domain: "late.example",
        type: "nav",
        score: 70,
        outcome: "allow",
      },
    });

    const ids = (store[PROMPT_OUTCOMES_KEY] as Array<{ id: string }>).map((entry) => entry.id);
    expect(ids).toEqual(["imported-outcome"]);
  });

  it("bounds and filters import outcomes before runtime delegation", async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
    let sentMessage: unknown;
    const runtimeChrome = chrome as unknown as {
      runtime: {
        sendMessage(message: unknown, callback?: (response: unknown) => void): void;
      };
    };
    runtimeChrome.runtime = {
      sendMessage(message, callback) {
        sentMessage = message;
        callback?.({ ok: true });
      },
    };

    vi.resetModules();
    const { importAll } = await import("../extension/src/shared/storage");
    const outcomes = [
      null,
      { id: "invalid" },
      ...Array.from({ length: 520 }, (_, i) => ({
        id: `valid-${i}`,
        ts: i,
        domain: "valid.example",
        type: "nav" as const,
        score: 40,
        outcome: "allow" as const,
      })),
    ];

    await importAll({ promptOutcomes: outcomes });

    expect(sentMessage).toMatchObject({ type: "ns-prompt-outcome-replace" });
    const sentOutcomes = (sentMessage as { outcomes: Array<{ id: string }> }).outcomes;
    expect(sentOutcomes).toHaveLength(500);
    expect(sentOutcomes[0]!.id).toBe("valid-20");
    expect(sentOutcomes[sentOutcomes.length - 1]!.id).toBe("valid-519");
  });

  it("serializes clear after a queued append so the clear wins", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { appendPromptOutcome, clearPromptOutcomes } = await import("../extension/src/shared/storage");
    const append = appendPromptOutcome({
      id: "clear-race",
      domain: "example.com",
      type: "nav",
      score: 70,
      outcome: "block",
    });
    const clear = clearPromptOutcomes();
    await Promise.all([append, clear]);

    expect(store[PROMPT_OUTCOMES_KEY]).toEqual([]);
  });
});

describe("getEventLog", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns empty array when no log exists", async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { getEventLog } = await import("../extension/src/shared/storage");
    expect(await getEventLog()).toEqual([]);
  });

  it("returns existing events", async () => {
    const { chrome } = createChromeMock({
      [EVENT_LOG_KEY]: [{ id: "e1", ts: 1, kind: "nav_click_block" }],
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { getEventLog } = await import("../extension/src/shared/storage");
    const log = await getEventLog();
    expect(log).toHaveLength(1);
    expect(log[0]!.id).toBe("e1");
  });

  it("handles non-array storage value", async () => {
    const { chrome } = createChromeMock({
      [EVENT_LOG_KEY]: "not-an-array",
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { getEventLog } = await import("../extension/src/shared/storage");
    expect(await getEventLog()).toEqual([]);
  });
});

describe("clearEventLog", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clears the event log", async () => {
    const { chrome, store } = createChromeMock({
      [EVENT_LOG_KEY]: [{ id: "e1", ts: 1, kind: "nav_click_block" }],
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { clearEventLog, getEventLog } = await import("../extension/src/shared/storage");
    await clearEventLog();
    expect(store[EVENT_LOG_KEY]).toEqual([]);
    expect(await getEventLog()).toEqual([]);
  });
});

describe("getPromptOutcomes and clearPromptOutcomes", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns empty array when no outcomes exist", async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { getPromptOutcomes } = await import("../extension/src/shared/storage");
    expect(await getPromptOutcomes()).toEqual([]);
  });

  it("filters corrupt stored outcomes when reading", async () => {
    const { chrome } = createChromeMock({
      [PROMPT_OUTCOMES_KEY]: [
        null,
        { id: "missing-required-fields" },
        { id: "valid", ts: 2, domain: "valid.example", type: "nav", score: 80, outcome: "block" },
        undefined,
      ],
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { getPromptOutcomes } = await import("../extension/src/shared/storage");
    expect(await getPromptOutcomes()).toEqual([
      { id: "valid", ts: 2, domain: "valid.example", type: "nav", score: 80, outcome: "block" },
    ]);
  });

  it("clears outcomes", async () => {
    const { chrome, store } = createChromeMock({
      [PROMPT_OUTCOMES_KEY]: [{ id: "o1", ts: 1 }],
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { clearPromptOutcomes } = await import("../extension/src/shared/storage");
    await clearPromptOutcomes();
    expect(store[PROMPT_OUTCOMES_KEY]).toEqual([]);
  });

  it("caps returned outcomes at 500", async () => {
    const outcomes = Array.from({ length: 600 }, (_, i) => ({
      id: `o-${i}`, ts: i, domain: "a.com", type: "nav", score: 10, outcome: "allow",
    }));
    const { chrome } = createChromeMock({
      [PROMPT_OUTCOMES_KEY]: outcomes,
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { getPromptOutcomes } = await import("../extension/src/shared/storage");
    const result = await getPromptOutcomes();
    expect(result).toHaveLength(500);
    expect(result[0]!.id).toBe("o-100");
  });
});

// Round-3 adversarial review (D-STORE) hardening.
describe("prompt outcome storage — sender authorization", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  const seedOutcome = {
    id: "seed-1",
    ts: 10,
    domain: "seed.example",
    type: "nav" as const,
    score: 30,
    outcome: "allow" as const,
  };

  it("rejects a clear from a content-script sender and leaves the log intact", async () => {
    const { chrome, store } = createChromeMock({ [PROMPT_OUTCOMES_KEY]: [seedOutcome] });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
    const { handlePromptOutcomeStorageMessage } = await import("../extension/src/shared/storage");

    const res = await handlePromptOutcomeStorageMessage(
      { type: "ns-prompt-outcome-clear" },
      CONTENT_SCRIPT_SENDER
    );
    expect(res.ok).toBe(false);
    expect(store[PROMPT_OUTCOMES_KEY]).toEqual([seedOutcome]);
  });

  it("rejects a replace from a content-script sender and leaves the log intact", async () => {
    const { chrome, store } = createChromeMock({ [PROMPT_OUTCOMES_KEY]: [seedOutcome] });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
    const { handlePromptOutcomeStorageMessage } = await import("../extension/src/shared/storage");

    const res = await handlePromptOutcomeStorageMessage(
      {
        type: "ns-prompt-outcome-replace",
        outcomes: [{ id: "x", ts: 1, domain: "x.example", type: "nav", score: 1, outcome: "block" }],
      },
      CONTENT_SCRIPT_SENDER
    );
    expect(res.ok).toBe(false);
    expect(store[PROMPT_OUTCOMES_KEY]).toEqual([seedOutcome]);
  });

  it("allows a clear from a trusted options-page sender", async () => {
    const { chrome, store } = createChromeMock({ [PROMPT_OUTCOMES_KEY]: [seedOutcome] });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
    const { handlePromptOutcomeStorageMessage } = await import("../extension/src/shared/storage");

    const res = await handlePromptOutcomeStorageMessage(
      { type: "ns-prompt-outcome-clear" },
      OPTIONS_SENDER
    );
    expect(res.ok).toBe(true);
    expect(store[PROMPT_OUTCOMES_KEY]).toEqual([]);
  });

  it("allows an append from a content-script sender", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
    const { handlePromptOutcomeStorageMessage } = await import("../extension/src/shared/storage");

    const res = await handlePromptOutcomeStorageMessage(
      {
        type: "ns-prompt-outcome-append",
        entry: { id: "cs-1", ts: 5, domain: "cs.example", type: "nav", score: 20, outcome: "allow" },
      },
      CONTENT_SCRIPT_SENDER
    );
    expect(res.ok).toBe(true);
    const ids = (store[PROMPT_OUTCOMES_KEY] as Array<{ id: string }>).map((e) => e.id);
    expect(ids).toContain("cs-1");
  });
});

describe("prompt outcome delegation — retry, drop, and refusal", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("drops and logs (no direct write) when the SW is persistently unreachable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { chrome, store } = createChromeMock();
    let calls = 0;
    const runtime: {
      lastError?: { message?: string };
      sendMessage: (message: unknown, callback?: (response: unknown) => void) => void;
    } = {
      sendMessage(_message, callback) {
        calls++;
        runtime.lastError = { message: "Could not establish connection. Receiving end does not exist." };
        callback?.(undefined);
        delete runtime.lastError;
      },
    };
    (chrome as unknown as { runtime: unknown }).runtime = runtime;
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { appendPromptOutcome } = await import("../extension/src/shared/storage");
    await appendPromptOutcome({ id: "dropped-1", domain: "cs.example", type: "nav", score: 40, outcome: "allow" });

    // No direct-write fallback: the outcome is NOT persisted (bypassing SW
    // serialization could resurrect cleared data / race a concurrent write).
    expect(store[PROMPT_OUTCOMES_KEY]).toBeUndefined();
    // It retried (initial + 3 backoff attempts) and surfaced the loss loudly.
    expect(calls).toBe(4);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("prompt outcome dropped"),
      expect.anything(),
      expect.anything()
    );
  });

  it("retries and succeeds once the SW becomes reachable", async () => {
    const { chrome, store } = createChromeMock();
    const worker = await import("../extension/src/shared/storage");
    let calls = 0;
    const runtime: {
      lastError?: { message?: string };
      sendMessage: (message: unknown, callback?: (response: unknown) => void) => void;
    } = {
      sendMessage(message, callback) {
        calls++;
        if (calls === 1) {
          runtime.lastError = { message: "Could not establish connection." };
          callback?.(undefined);
          delete runtime.lastError;
          return;
        }
        void worker.handlePromptOutcomeStorageMessage(
          message as Parameters<typeof worker.handlePromptOutcomeStorageMessage>[0]
        ).then((r) => callback?.(r));
      },
    };
    (chrome as unknown as { runtime: unknown }).runtime = runtime;
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    vi.resetModules();
    const contentScript = await import("../extension/src/shared/storage");
    await contentScript.appendPromptOutcome({ id: "retry-1", domain: "cs.example", type: "nav", score: 40, outcome: "allow" });

    expect(calls).toBeGreaterThanOrEqual(2);
    const ids = (store[PROMPT_OUTCOMES_KEY] as Array<{ id: string }>).map((e) => e.id);
    expect(ids).toContain("retry-1");
  });

  it("does NOT retry an unauthorized refusal and never writes", async () => {
    const seed = { id: "keep-1", ts: 10, domain: "keep.example", type: "nav" as const, score: 30, outcome: "allow" as const };
    const { chrome, store } = createChromeMock({ [PROMPT_OUTCOMES_KEY]: [seed] });
    let calls = 0;
    (chrome as unknown as { runtime: unknown }).runtime = {
      sendMessage(_message: unknown, callback?: (response: unknown) => void) {
        calls++;
        callback?.({ ok: false, error: "Unauthorized prompt-outcome mutation from untrusted sender", code: "unauthorized" });
      },
    };
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { clearPromptOutcomes } = await import("../extension/src/shared/storage");
    await expect(clearPromptOutcomes()).rejects.toThrow(/Unauthorized/);
    expect(calls).toBe(1); // definitive refusal — not retried
    expect(store[PROMPT_OUTCOMES_KEY]).toEqual([seed]); // and not wiped via any fallback
  });

  it("clearPromptOutcomes REJECTS when the SW is persistently unreachable (#188 control op)", async () => {
    // Append drops + resolves on exhaustion (covered above); a user-initiated
    // control op must instead reject so the options UI can surface the failure.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const seed = { id: "keep-1", ts: 10, domain: "keep.example", type: "nav" as const, score: 30, outcome: "allow" as const };
    const { chrome, store } = createChromeMock({ [PROMPT_OUTCOMES_KEY]: [seed] });
    let calls = 0;
    const runtime: {
      lastError?: { message?: string };
      sendMessage: (message: unknown, callback?: (response: unknown) => void) => void;
    } = {
      sendMessage(_message, callback) {
        calls++;
        runtime.lastError = { message: "Could not establish connection. Receiving end does not exist." };
        callback?.(undefined);
        delete runtime.lastError;
      },
    };
    (chrome as unknown as { runtime: unknown }).runtime = runtime;
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { clearPromptOutcomes, PromptOutcomeDeliveryError } = await import("../extension/src/shared/storage");
    const err = await clearPromptOutcomes().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PromptOutcomeDeliveryError);
    // R1 fix: the underlying transport error is preserved as `cause`, matching the
    // diagnostic the append drop-path logs.
    expect((err as Error).cause).toBeDefined();
    expect(String((err as { cause?: unknown }).cause)).toMatch(/establish connection|receiving end/i);
    expect(calls).toBe(4); // initial + 3 retries, then reject (no silent drop)
    expect(store[PROMPT_OUTCOMES_KEY]).toEqual([seed]); // not wiped via any fallback
    // The control op rejects rather than taking the append "dropped" log path.
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining("prompt outcome dropped"),
      expect.anything(),
      expect.anything()
    );
  });

  it("importAll REJECTS (delivery error) on SW exhaustion but is non-atomic — earlier sections persist (#188 R1)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const seed = { id: "keep-1", ts: 10, domain: "keep.example", type: "nav" as const, score: 30, outcome: "allow" as const };
    const { chrome, store } = createChromeMock({ [PROMPT_OUTCOMES_KEY]: [seed] });
    let calls = 0;
    const runtime: {
      lastError?: { message?: string };
      sendMessage: (message: unknown, callback?: (response: unknown) => void) => void;
    } = {
      sendMessage(_message, callback) {
        calls++;
        runtime.lastError = { message: "Could not establish connection. Receiving end does not exist." };
        callback?.(undefined);
        delete runtime.lastError;
      },
    };
    (chrome as unknown as { runtime: unknown }).runtime = runtime;
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { importAll, PromptOutcomeDeliveryError } = await import("../extension/src/shared/storage");
    await expect(
      importAll({
        // Valid entry (id+ts+known kind): importAll now normalizes the eventLog via
        // trimEventLog (#252), which drops malformed rows, so a placeholder lacking
        // id/ts would be filtered to [] and obscure the atomicity assertion below.
        eventLog: [{ id: "e-1", ts: 5, kind: "nav_click_block" }],
        promptOutcomes: [{ id: "imp-1", ts: 5, domain: "d.example", type: "nav", score: 10, outcome: "allow" }],
      })
    ).rejects.toBeInstanceOf(PromptOutcomeDeliveryError);
    expect(calls).toBe(4);
    // Non-atomic: eventLog (written before the prompt-outcome step) IS committed,
    // which is why the options handler must report a *partial* failure (#188 R1)...
    expect(store[EVENT_LOG_KEY]).toEqual([{ id: "e-1", ts: 5, kind: "nav_click_block" }]);
    // ...but the delegated prompt-outcome write never reached storage (seed intact).
    expect(store[PROMPT_OUTCOMES_KEY]).toEqual([seed]);
  });
});

describe("prompt outcome append — non-finite sanitization", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("coerces a non-finite score so the outcome persists instead of being dropped", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
    const { appendPromptOutcome } = await import("../extension/src/shared/storage");

    await appendPromptOutcome({
      id: "nan-score",
      domain: "x.example",
      type: "nav",
      score: Number.NaN,
      outcome: "allow",
    });

    const entries = (store[PROMPT_OUTCOMES_KEY] as Array<{ id: string; score: number }>) ?? [];
    const entry = entries.find((e) => e.id === "nan-score");
    expect(entry).toBeDefined();
    expect(Number.isFinite(entry!.score)).toBe(true);
    expect(entry!.score).toBe(0);
  });

  it("coerces a non-finite ts so the outcome persists with a finite timestamp", async () => {
    const { chrome, store } = createChromeMock();
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);
    const { appendPromptOutcome } = await import("../extension/src/shared/storage");

    await appendPromptOutcome({
      id: "nan-ts",
      ts: Number.NaN,
      domain: "x.example",
      type: "nav",
      score: 12,
      outcome: "allow",
    });

    const entries = (store[PROMPT_OUTCOMES_KEY] as Array<{ id: string; ts: number }>) ?? [];
    const entry = entries.find((e) => e.id === "nan-ts");
    expect(entry).toBeDefined();
    expect(Number.isFinite(entry!.ts)).toBe(true);
  });
});
