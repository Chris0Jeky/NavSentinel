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
    expect(log.length).toBeGreaterThanOrEqual(2);
    expect(log.some((e) => e?.id === "valid-1")).toBe(true);
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
    expect(ids).toContain("concurrent-3");
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
