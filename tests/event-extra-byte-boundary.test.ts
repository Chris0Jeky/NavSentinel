import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Store = Record<string, unknown>;
let store: Store;
const EVENT_LOG_KEY = "sentinelsuite:event_log_v1";

beforeEach(() => {
  vi.resetModules();
  store = {};
  vi.stubGlobal("chrome", { storage: { local: {
    get: async () => structuredClone(store),
    set: async (items: Store) => { Object.assign(store, structuredClone(items)); },
    remove: async (keys: string | string[]) => {
      for (const key of typeof keys === "string" ? [keys] : keys) delete store[key];
    },
  } } });
});
afterEach(() => vi.unstubAllGlobals());

const cases = [
  { label: "ASCII exact", value: "x".repeat(4088), bytes: 4096, keep: true },
  { label: "ASCII over", value: "x".repeat(4089), bytes: 4097, keep: false },
  { label: "CJK exact", value: "界".repeat(1362) + "aa", bytes: 4096, keep: true },
  { label: "CJK over", value: "界".repeat(1362) + "aaa", bytes: 4097, keep: false },
  { label: "CJK large", value: "界".repeat(4000), bytes: 12008, keep: false },
  { label: "astral large", value: "\u{1f600}".repeat(1100), bytes: 4408, keep: false },
];

function persistedEntry() {
  const log = store[EVENT_LOG_KEY] as Array<Record<string, unknown>>;
  expect(log).toHaveLength(1);
  return log[0]!;
}

for (const mode of ["live", "import"] as const) {
  describe(mode + " journal extra UTF-8 boundary (#829)", () => {
    it.each(cases)("retains only byte-bounded extras: $label", async ({ label, value, bytes, keep }) => {
      const { appendEvent, importAll } = await import("../extension/src/shared/storage");
      const extra = { v: value };
      // Independent byte oracle: the production guard uses TextEncoder.
      expect(Buffer.byteLength(JSON.stringify(extra), "utf8")).toBe(bytes);
      const entry = { id: label, ts: Date.now(), kind: "nav_click_block" as const, extra };
      if (mode === "live") await appendEvent(entry);
      else await importAll({ eventLog: [entry] });
      expect(persistedEntry().id).toBe(label);
      expect(persistedEntry().extra).toEqual(keep ? extra : undefined);
    });
  });
}

describe("journal extra admission snapshot (#829)", () => {
  it("does not retain a caller alias while the queued write waits", async () => {
    const { appendEvent } = await import("../extension/src/shared/storage");
    const extra = { nested: { value: "bounded" } };
    const pending = appendEvent({ id: "alias", kind: "nav_click_block", extra });
    extra.nested.value = "A".repeat(5000);
    await pending;
    expect(persistedEntry().extra).toEqual({ nested: { value: "bounded" } });
  });

  it("keeps the event while dropping a cyclic extra", async () => {
    const { appendEvent } = await import("../extension/src/shared/storage");
    const extra: Record<string, unknown> = {};
    extra.self = extra;
    await appendEvent({ id: "cycle", kind: "nav_click_block", extra });
    expect(persistedEntry().id).toBe("cycle");
    expect(persistedEntry().extra).toBeUndefined();
  });
});
