import assert from "node:assert/strict";
import { setImmediate as nextTask } from "node:timers/promises";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import type { PromptOutcomeEntry, SuiteSettings, SuiteSettingsPatch } from "../extension/src/shared/storage";
import type { DomainAdjustment } from "../extension/src/shared/adaptive_scoring";

type Store = Record<string, unknown>;
type Mode = SuiteSettings["nav"]["defaultMode"];

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function worker(mode: Mode = "smart") {
  const store: Store = {};
  const writes: Store[] = [];
  const reads: Array<string | string[] | undefined> = [];
  let beforeSet: (values: Store) => Promise<void> = async () => {};
  let failOutcomeRead = false;
  vi.stubGlobal("chrome", {
    runtime: { id: "mode-test", getURL: (p: string) => `chrome-extension://mode-test/${p}` },
    storage: { local: {
      async get(keys?: string | string[]) {
        reads.push(keys);
        if (failOutcomeRead && keys === "sentinelsuite:prompt_outcomes_v1") {
          failOutcomeRead = false;
          throw new Error("injected outcome read failure");
        }
        const selected = keys === undefined ? Object.keys(store) : typeof keys === "string" ? [keys] : keys;
        return structuredClone(Object.fromEntries(selected.filter((key) => key in store).map((key) => [key, store[key]])));
      },
      async set(values: Store) {
        const copy = structuredClone(values);
        await beforeSet(copy);
        Object.assign(store, copy);
        writes.push(copy);
      },
      async remove(keys: string | string[]) {
        for (const key of typeof keys === "string" ? [keys] : keys) delete store[key];
      },
    } },
  });
  const storage = await import("../extension/src/shared/storage");
  const adaptive = await import("../extension/src/shared/adaptive_scoring");
  const thresholds = await import("../extension/src/shared/nrs");
  const threshold = (value: Mode) => value === "strict" ? thresholds.NRS_STRICT_BLOCK_THRESHOLD : thresholds.NRS_BLOCK_THRESHOLD;
  const outcomes: PromptOutcomeEntry[] = Array.from({ length: 3 }, (_, i) => ({
    id: `seed-${i}`, ts: Date.now() - 1000 + i, domain: "example.com", type: "nav", outcome: "allow", score: 60,
  }));
  store[storage.SUITE_SETTINGS_KEY] = storage.normalizeStoredSuiteSettings({ nav: { defaultMode: mode } });
  store[storage.PROMPT_OUTCOMES_KEY] = structuredClone(outcomes);
  store[adaptive.ADAPTIVE_SCORES_KEY] = adaptive.computeAdaptiveScoreMap(outcomes, threshold(mode));
  const sender = { id: "mode-test", url: "chrome-extension://mode-test/src/options/options.html" };
  return {
    ...storage, ...adaptive, store, writes, reads, outcomes, threshold,
    patch: (patch: SuiteSettingsPatch, expected?: SuiteSettings) => storage.handleSuiteSettingsUpdateMessage({
      type: "ns-suite-settings-update", patch, ...(expected ? { expected } : {}),
    }, sender),
    append: () => storage.handlePromptOutcomeStorageMessage({
      type: "ns-prompt-outcome-append",
      entry: { id: "later-block", ts: Date.now(), domain: "example.com", type: "nav", outcome: "block", score: 60 },
    }, sender),
    failNextOutcomeRead() { failOutcomeRead = true; },
    holdNextSet(predicate: (values: Store) => boolean, failure?: Error) {
      const entered = deferred();
      const release = deferred();
      let claimed = false;
      beforeSet = async (values) => {
        if (claimed || !predicate(values)) return;
        claimed = true;
        entered.resolve();
        await release.promise;
        if (failure) throw failure;
      };
      return { entered: entered.promise, release: release.resolve };
    },
  };
}

function withoutTimes(value: unknown) {
  const scores = value as Record<string, DomainAdjustment>;
  return Object.fromEntries(Object.entries(scores).map(([domain, score]) => {
    const { lastUpdated: _lastUpdated, ...rest } = score;
    assert.equal(typeof _lastUpdated, "number");
    return [domain, rest];
  }));
}

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("mode changes keep the adaptive cache consistent (#891)", () => {
  for (const [initial, next] of [["smart", "strict"], ["strict", "smart"], ["strict", "off"]] as const) {
    it(`atomically derives scores for ${initial} -> ${next} without rewriting outcomes`, async () => {
      const w = await worker(initial);
      const originalOutcomes = structuredClone(w.store[w.PROMPT_OUTCOMES_KEY]);
      const expected = w.computeAdaptiveScoreMap(w.outcomes, w.threshold(next));
      assert.notDeepEqual(withoutTimes(w.store[w.ADAPTIVE_SCORES_KEY]), withoutTimes(expected));
      const result = await w.patch({ nav: { defaultMode: next } });
      assert.equal(result.nav.defaultMode, next);
      assert.deepEqual(withoutTimes(w.store[w.ADAPTIVE_SCORES_KEY]), withoutTimes(expected));
      assert.deepEqual(w.store[w.PROMPT_OUTCOMES_KEY], originalOutcomes);
      assert.equal(w.writes.length, 1, "settings and their derivative require one atomic set");
      assert.deepEqual(Object.keys(w.writes[0]!).sort(), [w.SUITE_SETTINGS_KEY, w.ADAPTIVE_SCORES_KEY].sort());
    });
  }

  it("does not resurrect a cleared cache for an unrelated or same-mode settings patch", async () => {
    const w = await worker();
    w.store[w.ADAPTIVE_SCORES_KEY] = {};
    await w.patch({ credential: { mode: "strict" } });
    await w.patch({ nav: { defaultMode: "smart" } });
    assert.deepEqual(w.store[w.ADAPTIVE_SCORES_KEY], {});
    assert.ok(w.writes.every((entry) => !(w.ADAPTIVE_SCORES_KEY in entry)));
    assert.ok(!w.reads.includes(w.PROMPT_OUTCOMES_KEY));
  });

  for (const stored of [undefined, { malformed: true }, []]) {
    it(`clears obsolete scores when outcome data is ${JSON.stringify(stored)}`, async () => {
      const w = await worker();
      w.store[w.PROMPT_OUTCOMES_KEY] = stored;
      await w.patch({ nav: { defaultMode: "strict" } });
      assert.deepEqual(w.store[w.ADAPTIVE_SCORES_KEY], {});
      assert.equal(w.writes.length, 1);
      assert.ok(w.SUITE_SETTINGS_KEY in w.writes[0]!);
      assert.ok(w.ADAPTIVE_SCORES_KEY in w.writes[0]!);
    });
  }

  it("rejects stale conflicting Options edits without touching adaptive state", async () => {
    const w = await worker("strict");
    const before = structuredClone(w.store);
    const expected = w.normalizeStoredSuiteSettings({ nav: { defaultMode: "smart" } });
    const result = await w.patch({ nav: { defaultMode: "off" } }, expected);
    assert.equal(result.conflict, true);
    assert.deepEqual(w.store, before);
    assert.equal(w.writes.length, 0);
  });

  it("waits for an earlier prompt append before deriving the new-mode cache", async () => {
    const w = await worker();
    const gate = w.holdNextSet((values) => w.PROMPT_OUTCOMES_KEY in values);
    const appending = w.append();
    await gate.entered;
    const patching = w.patch({ nav: { defaultMode: "strict" } });
    try {
      await nextTask();
      assert.equal(w.writes.length, 0, "the mode must not overtake a held prompt write");
    } finally {
      gate.release();
      await Promise.allSettled([appending, patching]);
    }
    assert.equal((await appending).ok, true);
    assert.equal((await patching).nav.defaultMode, "strict");
    const outcomes = w.store[w.PROMPT_OUTCOMES_KEY] as PromptOutcomeEntry[];
    assert.equal(outcomes.length, 4);
    assert.deepEqual(withoutTimes(w.store[w.ADAPTIVE_SCORES_KEY]),
      withoutTimes(w.computeAdaptiveScoreMap(outcomes, w.threshold("strict"))));
  });

  it("a later prompt append reads the mode only after its atomic settings/cache commit", async () => {
    const w = await worker();
    const gate = w.holdNextSet((values) => w.SUITE_SETTINGS_KEY in values);
    const patching = w.patch({ nav: { defaultMode: "strict" } });
    await gate.entered;
    const reads = w.reads.length;
    const appending = w.append();
    try {
      await nextTask();
      assert.equal(w.reads.length, reads, "later prompt work cannot read an old mode");
      assert.equal(w.writes.length, 0);
    } finally {
      gate.release();
      await Promise.allSettled([patching, appending]);
    }
    assert.equal((await patching).nav.defaultMode, "strict");
    assert.equal((await appending).ok, true);
    const outcomes = w.store[w.PROMPT_OUTCOMES_KEY] as PromptOutcomeEntry[];
    assert.equal(outcomes.length, 4);
    assert.deepEqual(withoutTimes(w.store[w.ADAPTIVE_SCORES_KEY]),
      withoutTimes(w.computeAdaptiveScoreMap(outcomes, w.threshold("strict"))));
  });

  it("an outcome-read failure leaves both settings and cache unchanged and permits retry", async () => {
    const w = await worker();
    const before = structuredClone(w.store);
    w.failNextOutcomeRead();
    await assert.rejects(w.patch({ nav: { defaultMode: "strict" } }), /injected outcome read failure/);
    assert.deepEqual(w.store, before);
    assert.equal(w.writes.length, 0);
    assert.equal((await w.patch({ nav: { defaultMode: "strict" } })).nav.defaultMode, "strict");
    assert.deepEqual(withoutTimes(w.store[w.ADAPTIVE_SCORES_KEY]),
      withoutTimes(w.computeAdaptiveScoreMap(w.outcomes, w.threshold("strict"))));
  });

  it("an atomic-write failure leaves both keys unchanged and releases all three queues", async () => {
    const w = await worker();
    const before = structuredClone(w.store);
    const error = new Error("injected mode write failure");
    const gate = w.holdNextSet((values) => w.SUITE_SETTINGS_KEY in values, error);
    const rejected = assert.rejects(w.patch({ nav: { defaultMode: "strict" } }), (value) => value === error);
    try { await gate.entered; } finally { gate.release(); }
    await rejected;
    assert.deepEqual(w.store, before);
    assert.equal((await w.patch({ nav: { defaultMode: "strict" } })).nav.defaultMode, "strict");
    assert.equal((await w.append()).ok, true);
    const outcomes = w.store[w.PROMPT_OUTCOMES_KEY] as PromptOutcomeEntry[];
    assert.equal(outcomes.length, 4);
    assert.deepEqual(withoutTimes(w.store[w.ADAPTIVE_SCORES_KEY]),
      withoutTimes(w.computeAdaptiveScoreMap(outcomes, w.threshold("strict"))));
  });
});
