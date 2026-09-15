import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventLogEntry } from "../extension/src/shared/storage";

const eventKey = "sentinelsuite:event_log_v1";

function installStorage(entries: EventLogEntry[]): Record<string, unknown> {
  const store: Record<string, unknown> = {
    [eventKey]: entries,
    "sentinelsuite:nav_allowlist_v1": {},
  };
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        async get(keys?: string | string[] | Record<string, unknown>) {
          if (keys === undefined) return { ...store };
          if (typeof keys === "string") return { [keys]: store[keys] };
          if (Array.isArray(keys)) return Object.fromEntries(keys.map(key => [key, store[key]]));
          return { ...keys, ...store };
        },
        async set(values: Record<string, unknown>) { Object.assign(store, values); },
      },
      onChanged: { addListener() {} },
    },
  });
  return store;
}

describe("full backup export revalidates legacy page associations (#691)", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it.each([false, true])("omits a legacy URL-shaped pageSite even when url is present=%s", async withUrl => {
    const row: EventLogEntry = {
      id: "legacy", ts: 1, kind: "nav_click_block", site: "source.test",
      pageSite: "https://source.test/account?token=private-secret#session",
      ...(withUrl ? { url: "https://source.test/login?code=private-secret#session" } : {}),
    };
    const store = installStorage([row]);
    const before = JSON.stringify(store[eventKey]);
    const { exportAll } = await import("../extension/src/shared/storage");
    const result = await exportAll();

    expect(result.eventLog).toHaveLength(1);
    expect(result.eventLog[0]).not.toHaveProperty("pageSite");
    expect(result.eventLog[0]?.site).toBe("source.test");
    expect(result.eventLog[0]?.url).toBe(withUrl ? "https://source.test/login" : undefined);
    expect(JSON.stringify(result)).not.toContain("private-secret");
    expect(JSON.stringify(store[eventKey])).toBe(before);
    expect(result.eventLog[0]).not.toBe(row);
  });

  it.each([
    ["PORTAL.Example.Test.", "portal.example.test"],
    ["127.000.000.001", "127.0.0.1"],
    ["127.0.0.1", "127.0.0.1"],
    ["[2001:0DB8:0:0:0:0:0:1]", "2001:db8::1"],
    ["::1", "::1"],
    ["source.test/private?secret", undefined],
    ["source.test?token=secret", undefined],
    ["source.test#secret", undefined],
    ["user@source.test", undefined],
    ["source.test:443", undefined],
    ["[::1]:443", undefined],
    ["999.0.0.1", undefined],
    ["", undefined],
    [undefined, undefined],
  ])("exports hostname-only %j as %j", async (pageSite, expected) => {
    installStorage([{
      id: "legacy", ts: 1, kind: "nav_click_block",
      ...(pageSite === undefined ? {} : { pageSite }),
    }]);
    const { exportAll } = await import("../extension/src/shared/storage");
    const result = (await exportAll()).eventLog[0];
    expect(result?.pageSite).toBe(expected);
    if (expected === undefined) expect(result).not.toHaveProperty("pageSite");
  });
});
