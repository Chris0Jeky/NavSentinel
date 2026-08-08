import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BEHAVIOURAL_DATA_LANES,
  BEHAVIOURAL_RESET_STATE_KEY,
} from "../extension/src/shared/behavioural_reset";
import {
  EVENT_LOG_KEY,
  PROMPT_OUTCOMES_KEY,
  SUITE_SETTINGS_KEY,
  TRUSTED_DOMAINS_KEY,
} from "../extension/src/shared/storage";
import { ADAPTIVE_SCORES_KEY } from "../extension/src/shared/adaptive_scoring";
import { ALLOWLIST_KEY } from "../extension/src/shared/allowlist";
import { DOMAIN_PROFILES_KEY } from "../extension/src/shared/domain_profile";

type Store = Record<string, unknown>;

/** Reject a write that touches this key, simulating one lane failing to clear. */
interface MockOptions {
  failLocalWriteForKey?: string;
  failLocalWriteMessage?: string;
  /**
   * Let this many writes touching `failLocalWriteForKey` through before failing.
   * Used to let the pre-flight reset marker persist and then fail only its
   * finalization, which is the window review finding (2) is about.
   */
  allowLocalWritesForKey?: number;
  /** Make `chrome.storage.local.remove` reject with this message. */
  failLocalRemove?: string;
  /** Observe every committed local write, so a test can interleave a writer. */
  onLocalSet?: (next: Record<string, unknown>) => void;
}

function createChromeMock(initial: Store = {}, options: MockOptions = {}) {
  const store: Store = { ...initial };
  const sessionStore: Store = {};
  let allowedWrites = options.allowLocalWritesForKey ?? 0;

  return {
    store,
    sessionStore,
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
            if (options.failLocalWriteForKey && options.failLocalWriteForKey in next) {
              if (allowedWrites > 0) allowedWrites--;
              else throw new Error(options.failLocalWriteMessage ?? "quota exceeded");
            }
            for (const [key, value] of Object.entries(next)) {
              store[key] = value;
            }
            options.onLocalSet?.(next);
          },
          async remove(keys: string | string[]) {
            if (options.failLocalRemove) throw new Error(options.failLocalRemove);
            for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
          },
        },
        session: {
          async get(keys?: string | string[]) {
            if (keys === undefined) return { ...sessionStore };
            if (typeof keys === "string") {
              return keys in sessionStore ? { [keys]: sessionStore[keys] } : {};
            }
            return Object.fromEntries(
              (keys ?? []).filter((key) => key in sessionStore).map((key) => [key, sessionStore[key]]),
            );
          },
          async set(next: Record<string, unknown>) {
            for (const [key, value] of Object.entries(next)) sessionStore[key] = value;
          },
        },
        onChanged: { addListener() {} },
      },
    },
  };
}

/** A trusted extension-page sender (options/popup) carries no `tab`. */
const OPTIONS_SENDER = {
  url: "chrome-extension://navsentinel-test/options.html",
} as chrome.runtime.MessageSender;

const CONTENT_SCRIPT_SENDER = {
  tab: { id: 3 },
  url: "https://evil.example/page",
} as chrome.runtime.MessageSender;

function seededBehaviouralStore(): Store {
  return {
    // In-scope behavioural lanes.
    [EVENT_LOG_KEY]: [{ id: "e1", ts: 1, kind: "nav_click_block" }],
    [PROMPT_OUTCOMES_KEY]: [
      { id: "p1", ts: 1, domain: "example.com", type: "nav", score: 70, outcome: "block" },
    ],
    [ADAPTIVE_SCORES_KEY]: { "example.com": { adjustment: -5, lastUpdated: 1 } },
    [DOMAIN_PROFILES_KEY]: {
      "example.com": {
        domain: "example.com",
        visits: 4,
        totalNRS: 120,
        maxNRS: 40,
        triggerCount: 2,
        lastSeen: 1,
        factors: {},
        nrsHistory: [30, 40],
      },
    },
    // Deliberately EXCLUDED user configuration.
    [SUITE_SETTINGS_KEY]: { nav: { defaultMode: "strict", debug: true }, logLimit: 300 },
    [ALLOWLIST_KEY]: ["kept.example"],
    [TRUSTED_DOMAINS_KEY]: ["bank.example"],
  };
}

function expectConfigurationPreserved(store: Store): void {
  expect(store[SUITE_SETTINGS_KEY]).toMatchObject({ nav: { defaultMode: "strict" } });
  expect(store[ALLOWLIST_KEY]).toEqual(["kept.example"]);
  expect(store[TRUSTED_DOMAINS_KEY]).toEqual(["bank.example"]);
}

describe("unified behavioural-data reset (RI-06 / #474)", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("declares the lane boundary in one place", () => {
    expect([...BEHAVIOURAL_DATA_LANES]).toEqual([
      "promptOutcomes",
      "adaptiveScores",
      "eventLog",
      "domainProfiles",
    ]);
  });

  it("clears every in-scope lane and leaves user configuration untouched", async () => {
    const { chrome, store } = createChromeMock(seededBehaviouralStore());
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { clearBehaviouralData } = await import("../extension/src/shared/behavioural_reset");
    const result = await clearBehaviouralData();

    expect(result.ok).toBe(true);
    expect(result.failed).toEqual([]);
    expect([...result.cleared].sort()).toEqual([...BEHAVIOURAL_DATA_LANES].sort());

    expect(store[EVENT_LOG_KEY]).toEqual([]);
    expect(store[PROMPT_OUTCOMES_KEY]).toEqual([]);
    expect(store[ADAPTIVE_SCORES_KEY]).toEqual({});
    expect(store[DOMAIN_PROFILES_KEY]).toEqual({});

    expectConfigurationPreserved(store);
    // A completed reset leaves no crash-window marker behind.
    expect(BEHAVIOURAL_RESET_STATE_KEY in store).toBe(false);
  });

  it("reports honestly when one lane fails and keeps it in the restart marker", async () => {
    const { chrome, store } = createChromeMock(seededBehaviouralStore(), {
      failLocalWriteForKey: DOMAIN_PROFILES_KEY,
      failLocalWriteMessage: "profile store unavailable",
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { clearBehaviouralData } = await import("../extension/src/shared/behavioural_reset");
    const result = await clearBehaviouralData();

    expect(result.ok).toBe(false);
    expect(result.cleared).toEqual(["promptOutcomes", "adaptiveScores", "eventLog"]);
    expect(result.failed).toEqual([
      { lane: "domainProfiles", error: "profile store unavailable" },
    ]);

    // The lanes that did clear stayed cleared; the failed one still holds data.
    expect(store[EVENT_LOG_KEY]).toEqual([]);
    expect(store[PROMPT_OUTCOMES_KEY]).toEqual([]);
    expect(store[DOMAIN_PROFILES_KEY]).toHaveProperty("example.com");

    // The operation is not left half-applied without a record.
    expect(store[BEHAVIOURAL_RESET_STATE_KEY]).toMatchObject({ pending: ["domainProfiles"] });
  });

  it("does not erase anything when the crash-window marker cannot be persisted", async () => {
    const { chrome, store } = createChromeMock(seededBehaviouralStore(), {
      failLocalWriteForKey: BEHAVIOURAL_RESET_STATE_KEY,
      failLocalWriteMessage: "storage full",
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { clearBehaviouralData } = await import("../extension/src/shared/behavioural_reset");
    const result = await clearBehaviouralData();

    expect(result.ok).toBe(false);
    expect(result.cleared).toEqual([]);
    expect(result.failed.map((entry) => entry.lane)).toEqual([...BEHAVIOURAL_DATA_LANES]);
    for (const failure of result.failed) {
      expect(failure.error).toContain("storage full");
    }

    expect(store[EVENT_LOG_KEY]).toHaveLength(1);
    expect(store[PROMPT_OUTCOMES_KEY]).toHaveLength(1);
    expect(store[ADAPTIVE_SCORES_KEY]).toHaveProperty("example.com");
    expect(store[DOMAIN_PROFILES_KEY]).toHaveProperty("example.com");
  });

  it("finishes an interrupted reset on the next service-worker start", async () => {
    const seeded = seededBehaviouralStore();
    // Simulate a worker termination after the prompt lanes cleared.
    seeded[PROMPT_OUTCOMES_KEY] = [];
    seeded[ADAPTIVE_SCORES_KEY] = {};
    seeded[BEHAVIOURAL_RESET_STATE_KEY] = {
      startedAt: 10,
      pending: ["domainProfiles", "eventLog"],
    };
    const { chrome, store } = createChromeMock(seeded);
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { resumeInterruptedBehaviouralReset } = await import("../extension/src/shared/behavioural_reset");
    const result = await resumeInterruptedBehaviouralReset();

    expect(result.ok).toBe(true);
    // Resume replays in the declared source-before-derivative order.
    expect(result.cleared).toEqual(["eventLog", "domainProfiles"]);
    expect(store[EVENT_LOG_KEY]).toEqual([]);
    expect(store[DOMAIN_PROFILES_KEY]).toEqual({});
    expect(BEHAVIOURAL_RESET_STATE_KEY in store).toBe(false);
    expectConfigurationPreserved(store);
  });

  it("is a no-op when no interrupted reset is recorded", async () => {
    const { chrome, store } = createChromeMock(seededBehaviouralStore());
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { resumeInterruptedBehaviouralReset } = await import("../extension/src/shared/behavioural_reset");
    const result = await resumeInterruptedBehaviouralReset();

    expect(result).toEqual({ ok: true, cleared: [], failed: [] });
    expect(store[EVENT_LOG_KEY]).toHaveLength(1);
    expect(store[PROMPT_OUTCOMES_KEY]).toHaveLength(1);
  });

  it("does not resurrect data appended concurrently with the reset", async () => {
    const { chrome, store } = createChromeMock(seededBehaviouralStore());
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const storage = await import("../extension/src/shared/storage");
    const behaviouralReset = await import("../extension/src/shared/behavioural_reset");
    // Both appends are queued before the reset is issued, so the serialized
    // lanes must order them ahead of the clear and the barrier must reject any
    // that lands after it.
    const appendEvent = storage.appendEvent({ kind: "nav_click_block", site: "race.example" });
    const appendOutcome = storage.appendPromptOutcome({
      id: "race-1",
      domain: "race.example",
      type: "nav",
      score: 80,
      outcome: "block",
    });
    const reset = behaviouralReset.clearBehaviouralData();
    const [, , result] = await Promise.all([appendEvent, appendOutcome, reset]);

    expect(result.ok).toBe(true);
    expect(store[EVENT_LOG_KEY]).toEqual([]);
    expect(store[PROMPT_OUTCOMES_KEY]).toEqual([]);
    expect(store[ADAPTIVE_SCORES_KEY]).toEqual({});
  });

  // --- Review round 2, finding (2): a suppressed marker-finalization failure was
  // reported as success, and the surviving marker was replayed destructively later.
  it("does not report success while an un-finalized reset marker survives", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { chrome, store } = createChromeMock(seededBehaviouralStore(), {
      failLocalWriteForKey: BEHAVIOURAL_RESET_STATE_KEY,
      failLocalWriteMessage: "marker store full",
      // The pre-flight marker write succeeds; only its finalization fails.
      allowLocalWritesForKey: 1,
      failLocalRemove: "remove unavailable",
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { clearBehaviouralData } = await import("../extension/src/shared/behavioural_reset");
    const result = await clearBehaviouralData();

    // Every lane genuinely cleared, so `failed` stays empty and honest...
    expect(result.cleared).toEqual([...BEHAVIOURAL_DATA_LANES]);
    expect(result.failed).toEqual([]);
    // ...but an ACTIVE marker still names every lane, so a later worker start
    // would replay the reset over data created afterwards. That is not success.
    expect(result.ok).toBe(false);
    expect(result.markerError).toContain("marker store full");
    expect(store[BEHAVIOURAL_RESET_STATE_KEY]).toMatchObject({
      pending: [...BEHAVIOURAL_DATA_LANES],
    });
  });

  it("tombstones the marker when removal fails so a later start replays nothing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { chrome, store } = createChromeMock(seededBehaviouralStore(), {
      failLocalRemove: "remove unavailable",
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const storage = await import("../extension/src/shared/storage");
    const behaviouralReset = await import("../extension/src/shared/behavioural_reset");
    const result = await behaviouralReset.clearBehaviouralData();

    // `remove` is unavailable, but the non-replayable tombstone stands in for it,
    // so the reset really is finished and may be reported as such.
    expect(result.ok).toBe(true);
    expect(result.markerError).toBeUndefined();

    // Behavioural data the user creates AFTER the visible reset completed.
    await storage.appendEvent({
      kind: "nav_click_block",
      site: "after-reset.example",
      ts: Date.now() + 1000,
    });
    expect(store[EVENT_LOG_KEY]).toHaveLength(1);

    const resumed = await behaviouralReset.resumeInterruptedBehaviouralReset();
    expect(resumed).toEqual({ ok: true, cleared: [], failed: [] });
    // The finished reset must NOT be replayed over the new record.
    expect(store[EVENT_LOG_KEY]).toHaveLength(1);
  });

  // --- Review round 2, finding (1): an outcome appended between the two prompt
  // lanes kept its source row while the later adaptive-only clear dropped its score.
  it("keeps the adaptive cache consistent with an outcome appended between lanes", async () => {
    // Armed after the module import; fires exactly once, on the prompt-outcome
    // clear itself, so the appends queue behind the clear and land BEFORE the
    // adaptive lane is queued.
    const injector: { run?: () => void } = {};
    const { chrome, store } = createChromeMock(seededBehaviouralStore(), {
      onLocalSet(next) {
        const written = next[PROMPT_OUTCOMES_KEY];
        if (!injector.run || !Array.isArray(written) || written.length !== 0) return;
        const run = injector.run;
        injector.run = undefined;
        run();
      },
    });
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const storage = await import("../extension/src/shared/storage");
    const { clearBehaviouralData } = await import("../extension/src/shared/behavioural_reset");
    injector.run = () => {
      // computeAdjustment needs >= 3 decisive outcomes to produce a score.
      for (let i = 0; i < 3; i++) {
        void storage.appendPromptOutcome({
          id: `between-${i}`,
          ts: Date.now() + 1000 + i,
          domain: "between.example",
          type: "nav",
          score: 80,
          outcome: "block",
        });
      }
    };
    const result = await clearBehaviouralData();

    expect(result.ok).toBe(true);
    // Proves the injection actually fired at the reset's prompt-outcome clear.
    expect(injector.run).toBeUndefined();
    // The appends landed after the clear, so their rows survive by design.
    expect(store[PROMPT_OUTCOMES_KEY]).toHaveLength(3);
    // The derived cache must remain the derivative of what is actually stored —
    // a blind adaptive-only clear would strand these rows with no score.
    expect(store[ADAPTIVE_SCORES_KEY]).toHaveProperty("between.example");
  });

  // --- Review round 2, finding (4): the reset serialized only against other
  // resets, so a suite import could restore lanes it had just reported cleared.
  it("serializes against a suite import so the final state matches the report", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { chrome, store } = createChromeMock(seededBehaviouralStore());
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const storage = await import("../extension/src/shared/storage");
    const behaviouralReset = await import("../extension/src/shared/behavioural_reset");

    const payload = {
      eventLog: [{ id: "imported-e1", ts: 5, kind: "nav_click_block", site: "imported.example" }],
      promptOutcomes: [0, 1, 2].map((i) => ({
        id: `imported-p${i}`,
        ts: 5 + i,
        domain: "imported.example",
        type: "nav",
        score: 80,
        outcome: "block",
      })),
    };

    // The user starts an import and clicks the clear-all before it finishes.
    const importing = storage.importAll(payload);
    const resetting = behaviouralReset.clearBehaviouralData();
    const [, result] = await Promise.all([importing, resetting]);

    expect(result.ok).toBe(true);
    expect([...result.cleared].sort()).toEqual([...BEHAVIOURAL_DATA_LANES].sort());
    // "Every lane cleared" must be true of the FINAL state: the import's separate
    // prompt-outcome phase must not land behind the completed reset.
    expect(store[PROMPT_OUTCOMES_KEY]).toEqual([]);
    expect(store[ADAPTIVE_SCORES_KEY]).toEqual({});
    expect(store[EVENT_LOG_KEY]).toEqual([]);
  });

  it("keeps the barrier so a delayed pre-clear append cannot resurrect a lane", async () => {
    const { chrome, store, sessionStore } = createChromeMock(seededBehaviouralStore());
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const storage = await import("../extension/src/shared/storage");
    const { clearBehaviouralData } = await import("../extension/src/shared/behavioural_reset");
    const before = Date.now();
    await clearBehaviouralData();

    // A retried message built BEFORE the reset arrives afterwards.
    await storage.appendEvent({ kind: "nav_click_block", site: "late.example", ts: before - 1 });
    await storage.appendPromptOutcome({
      id: "late-1",
      ts: before - 1,
      domain: "late.example",
      type: "nav",
      score: 80,
      outcome: "block",
    });

    expect(store[EVENT_LOG_KEY]).toEqual([]);
    expect(store[PROMPT_OUTCOMES_KEY]).toEqual([]);
    // Both restart-surviving cutoffs were persisted by the unified reset.
    expect(sessionStore["ns_sw:eventLogResetTs"]).toBeTypeOf("number");
    expect(sessionStore["ns_sw:promptOutcomeResetTs"]).toBeTypeOf("number");
  });
});

describe("behavioural reset message handling", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("recognizes only the reset message shape", async () => {
    const { isBehaviouralResetMessage } = await import("../extension/src/shared/behavioural_reset");
    expect(isBehaviouralResetMessage({ type: "ns-behavioural-reset" })).toBe(true);
    expect(isBehaviouralResetMessage({ type: "ns-event-log-clear" })).toBe(false);
    expect(isBehaviouralResetMessage(null)).toBe(false);
    expect(isBehaviouralResetMessage("ns-behavioural-reset")).toBe(false);
  });

  it("clears for a trusted extension page sender", async () => {
    const { chrome, store } = createChromeMock(seededBehaviouralStore());
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { handleBehaviouralResetMessage } = await import("../extension/src/shared/behavioural_reset");
    const response = await handleBehaviouralResetMessage(OPTIONS_SENDER);

    expect(response).toMatchObject({ ok: true, result: { ok: true } });
    expect(store[EVENT_LOG_KEY]).toEqual([]);
    expect(store[DOMAIN_PROFILES_KEY]).toEqual({});
  });

  it("refuses a content-script sender without mutating any lane", async () => {
    const { chrome, store } = createChromeMock(seededBehaviouralStore());
    vi.stubGlobal("chrome", chrome as unknown as typeof globalThis.chrome);

    const { handleBehaviouralResetMessage } = await import("../extension/src/shared/behavioural_reset");
    const response = await handleBehaviouralResetMessage(CONTENT_SCRIPT_SENDER);

    expect(response).toMatchObject({ ok: false, code: "unauthorized" });
    expect(store[EVENT_LOG_KEY]).toHaveLength(1);
    expect(store[PROMPT_OUTCOMES_KEY]).toHaveLength(1);
    expect(store[DOMAIN_PROFILES_KEY]).toHaveProperty("example.com");
  });
});

describe("behavioural reset delegation from a page context", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("delegates to the service worker instead of clearing lanes locally", async () => {
    const { chrome, store } = createChromeMock(seededBehaviouralStore());
    let sent: unknown;
    const withRuntime = {
      ...chrome,
      runtime: {
        lastError: undefined,
        sendMessage(message: unknown, cb: (response: unknown) => void) {
          sent = message;
          cb({
            ok: true,
            result: { ok: true, cleared: [...BEHAVIOURAL_DATA_LANES], failed: [] },
          });
        },
      },
    };
    vi.stubGlobal("chrome", withRuntime as unknown as typeof globalThis.chrome);

    const { clearBehaviouralData } = await import("../extension/src/shared/behavioural_reset");
    const result = await clearBehaviouralData();

    expect(sent).toEqual({ type: "ns-behavioural-reset" });
    expect(result.ok).toBe(true);
    // The page context must not have written to any lane itself.
    expect(store[EVENT_LOG_KEY]).toHaveLength(1);
    expect(store[DOMAIN_PROFILES_KEY]).toHaveProperty("example.com");
  });

  it("reports every lane as not cleared when the worker refuses", async () => {
    const { chrome } = createChromeMock(seededBehaviouralStore());
    const withRuntime = {
      ...chrome,
      runtime: {
        lastError: undefined,
        sendMessage(_message: unknown, cb: (response: unknown) => void) {
          cb({ ok: false, error: "Unauthorized behavioural reset", code: "unauthorized" });
        },
      },
    };
    vi.stubGlobal("chrome", withRuntime as unknown as typeof globalThis.chrome);

    const { clearBehaviouralData } = await import("../extension/src/shared/behavioural_reset");
    const result = await clearBehaviouralData();

    expect(result.ok).toBe(false);
    expect(result.cleared).toEqual([]);
    expect(result.failed.map((entry) => entry.lane)).toEqual([...BEHAVIOURAL_DATA_LANES]);
  });
});
