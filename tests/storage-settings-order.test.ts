import assert from "node:assert/strict";
import { setImmediate as nextTask } from "node:timers/promises";
import { afterEach, beforeEach, describe, it, vi } from "vitest";

type Store = Record<string, unknown>;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

/** One worker module, with separate authenticated Popup and Options senders. */
async function worker() {
  const store: Store = {};
  const writes: Store[] = [];
  const reads: Array<string | string[] | undefined> = [];
  let beforeSet: (values: Store) => Promise<void> = async () => {};
  const local = {
    async get(keys?: string | string[]) {
      reads.push(keys);
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
  };
  vi.stubGlobal("chrome", {
    runtime: { id: "order-test", getURL: (path: string) => `chrome-extension://order-test/${path}` },
    storage: { local },
  });
  const storage = await import("../extension/src/shared/storage");
  const defaults = await storage.getSuiteSettings();
  store[storage.SUITE_SETTINGS_KEY] = structuredClone(defaults);
  const popup = { id: "order-test", url: "chrome-extension://order-test/src/popup/popup.html" };
  const options = { id: "order-test", url: "chrome-extension://order-test/src/options/options.html" };
  const patch = (value: unknown, expected?: unknown) =>
    storage.handleSuiteSettingsUpdateMessage({ type: "ns-suite-settings-update", patch: value,
      ...(expected === undefined ? {} : { expected }) }, expected === undefined ? popup : options);
  const importSuite = (payload: unknown) => storage.handleSuiteImportMessage({ type: "ns-suite-import", payload }, options);
  return {
    ...storage, defaults, store, writes, reads, patch, importSuite,
    holdNextSet(predicate: (values: Store) => boolean, failure?: Error) {
      const entered = deferred();
      const released = deferred();
      let claimed = false;
      beforeSet = async (values) => {
        if (claimed || !predicate(values)) return;
        claimed = true;
        entered.resolve();
        await released.promise;
        if (failure) throw failure;
      };
      return { entered: entered.promise, release: released.resolve };
    },
  };
}

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("worker settings/import queue boundaries (#891)", () => {
  it("does not read settings for a later patch while an earlier import is held", async () => {
    const w = await worker();
    const gate = w.holdNextSet((values) => w.SUITE_SETTINGS_KEY in values);
    const importing = w.importSuite({ settings: { nav: { defaultMode: "off" } } });
    await gate.entered;
    const readsBeforePatch = w.reads.length;
    const patching = w.patch({ credential: { mode: "strict" } });
    try {
      // Drain runnable jobs, not an assumed number of promise microtasks. The
      // explicit write gate remains closed until the assertions finish.
      await nextTask();
      assert.equal(w.reads.length, readsBeforePatch);
      assert.equal(w.writes.length, 0);
    } finally {
      gate.release();
      await Promise.allSettled([importing, patching]);
    }
    assert.equal((await importing).ok, true);
    assert.equal((await patching).credential.mode, "strict");
    const result = await w.getSuiteSettings();
    assert.equal(result.nav.defaultMode, "off");
    assert.equal(result.credential.mode, "strict");
  });

  it("lets a later full import replace an earlier patch, atomically with core sections", async () => {
    const w = await worker();
    const gate = w.holdNextSet((values) => w.SUITE_SETTINGS_KEY in values);
    const patching = w.patch({ credential: { mode: "strict" } });
    await gate.entered;
    const importing = w.importSuite({
      settings: { nav: { defaultMode: "off" } },
      trustedDomains: ["login.example.com"],
    });
    try {
      await nextTask();
      assert.equal(w.writes.length, 0, "a later import cannot overtake the held patch");
    } finally {
      gate.release();
      await Promise.allSettled([patching, importing]);
    }
    assert.equal((await patching).credential.mode, "strict");
    assert.equal((await importing).ok, true);
    const result = await w.getSuiteSettings();
    assert.equal(result.nav.defaultMode, "off");
    assert.equal(result.credential.mode, w.defaults.credential.mode);
    const core = w.writes.find((values) => w.TRUSTED_DOMAINS_KEY in values);
    assert.ok(core);
    assert.ok(w.SUITE_SETTINGS_KEY in core);
    assert.deepEqual(core[w.TRUSTED_DOMAINS_KEY], ["example.com"]);
    assert.equal(w.writes.filter((values) => w.SUITE_SETTINGS_KEY in values).length, 2);
  });

  it("recovers both queues after a failed patch without losing a queued import or subsequent patch", async () => {
    const w = await worker();
    const failure = new Error("injected patch write failure");
    const gate = w.holdNextSet((values) => w.SUITE_SETTINGS_KEY in values, failure);
    const patching = w.patch({ nav: { defaultMode: "strict" } });
    const rejected = assert.rejects(patching, (error) => error === failure);
    await gate.entered;
    const importing = w.importSuite({ settings: { nav: { defaultMode: "off" } } });
    const laterPatch = w.patch({ credential: { mode: "strict" } });
    try {
      await nextTask();
      assert.equal(w.writes.length, 0);
    } finally {
      gate.release();
      await Promise.allSettled([rejected, importing, laterPatch]);
    }
    await rejected;
    assert.equal((await importing).ok, true);
    assert.equal((await laterPatch).credential.mode, "strict");
    const result = await w.getSuiteSettings();
    assert.equal(result.nav.defaultMode, "off");
    assert.equal(result.credential.mode, "strict");
  });

  it("recovers after a rejected import core without applying its settings or trusted domains", async () => {
    const w = await worker();
    const gate = w.holdNextSet((values) => w.SUITE_SETTINGS_KEY in values, new Error("injected import failure"));
    const importing = w.importSuite({ settings: { nav: { defaultMode: "off" } }, trustedDomains: ["example.com"] });
    await gate.entered;
    const patching = w.patch({ credential: { mode: "strict" } });
    try {
      await nextTask();
      assert.equal(w.writes.length, 0);
    } finally {
      gate.release();
      await Promise.allSettled([importing, patching]);
    }
    assert.deepEqual(await importing, { ok: false, error: "injected import failure" });
    assert.equal((await patching).credential.mode, "strict");
    const result = await w.getSuiteSettings();
    assert.equal(result.nav.defaultMode, w.defaults.nav.defaultMode);
    assert.equal(result.credential.mode, "strict");
    assert.equal(w.TRUSTED_DOMAINS_KEY in w.store, false);
  });

  it("holds patches through the prompt phase and recovers after a partial import", async () => {
    const w = await worker();
    const gate = w.holdNextSet((values) => w.PROMPT_OUTCOMES_KEY in values, new Error("injected prompt failure"));
    const importing = w.importSuite({ settings: { nav: { defaultMode: "off" } }, promptOutcomes: [] });
    await gate.entered;
    const readsBeforePatch = w.reads.length;
    const writesBeforePatch = w.writes.length;
    const patching = w.patch({ credential: { mode: "strict" } });
    try {
      await nextTask();
      assert.equal(w.reads.length, readsBeforePatch);
      assert.equal(w.writes.length, writesBeforePatch);
    } finally {
      gate.release();
      await Promise.allSettled([importing, patching]);
    }
    const imported = await importing;
    assert.ok(!imported.ok);
    assert.equal(imported.code, "partial");
    assert.equal((await patching).credential.mode, "strict");
    const result = await w.getSuiteSettings();
    assert.equal(result.nav.defaultMode, "off", "the already committed core is not rolled back");
    assert.equal(result.credential.mode, "strict");
  });

  for (const sameLeaf of [true, false]) {
    it(`${sameLeaf ? "rejects a conflicting" : "preserves a disjoint"} stale Options patch after import`, async () => {
      const w = await worker();
      const expected = await w.getSuiteSettings();
      const gate = w.holdNextSet((values) => w.SUITE_SETTINGS_KEY in values);
      const importing = w.importSuite({ settings: { nav: { defaultMode: "off" } } });
      await gate.entered;
      const patching = w.patch(sameLeaf ? { nav: { defaultMode: "strict" } } : { credential: { mode: "strict" } }, expected);
      try {
        await nextTask();
        assert.equal(w.writes.length, 0);
      } finally {
        gate.release();
        await Promise.allSettled([importing, patching]);
      }
      assert.equal((await importing).ok, true);
      const patched = await patching;
      assert.equal(patched.conflict === true, sameLeaf);
      const result = await w.getSuiteSettings();
      assert.equal(result.nav.defaultMode, "off");
      assert.equal(result.credential.mode, sameLeaf ? expected.credential.mode : "strict");
      assert.equal(w.writes.filter((values) => w.SUITE_SETTINGS_KEY in values).length, sameLeaf ? 1 : 2);
    });
  }
});
