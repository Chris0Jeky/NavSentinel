import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runImportFlow } from "../extension/src/options/options_model";

beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

describe("successful import refresh recovery (#828)", () => {
  it.each(["settings", "pane"])("recovers a transient %s failure before reporting success", async (stage) => {
    let rendered: string | null = "old draft";
    let pane = "stale";
    let attempts = 0;
    const importPayload = vi.fn(async () => ({ eventLogDropped: 2 }));
    const refresh = vi.fn(async (replaceDraft?: boolean) => {
      attempts++;
      // Model init(true)'s draft invalidation before independent storage reads.
      if (replaceDraft) rendered = null;
      if (attempts === 1 && stage === "settings") throw new Error("settings read failed");
      rendered = "imported settings";
      if (attempts === 1 && stage === "pane") throw new Error("pane read failed");
      pane = "fresh";
    });
    const seen: Array<{ rendered: string | null; pane: string }> = [];
    const flash = vi.fn(() => { seen.push({ rendered, pane }); });
    await runImportFlow({ importPayload, refresh, flash, isDeliveryFailure: () => false });

    expect(importPayload).toHaveBeenCalledTimes(1);
    expect(refresh.mock.calls).toEqual([[true], [true]]);
    expect(seen).toEqual([{ rendered: "imported settings", pane: "fresh" }]);
    expect(flash.mock.calls).toEqual([["Imported. Event log truncated: 2 older events were not imported."]]);
  });

  it("bounds persistent refresh failure without replaying the committed import", async () => {
    const importPayload = vi.fn(async () => ({ eventLogDropped: 0 }));
    const refresh = vi.fn(async (_replaceDraft?: boolean) => { throw new Error("still offline"); });
    const flash = vi.fn();
    await expect(runImportFlow({ importPayload, refresh, flash, isDeliveryFailure: () => false }))
      .resolves.toBeUndefined();
    expect(importPayload).toHaveBeenCalledTimes(1);
    expect(refresh.mock.calls).toEqual([[true], [true]]);
    expect(flash.mock.calls).toEqual([["Imported."]]);
    expect(console.warn).toHaveBeenCalledWith("[NavSentinel] post-operation refresh failed:", expect.any(Error));
  });

  it("does not retry an already successful refresh", async () => {
    const importPayload = vi.fn(async () => ({ eventLogDropped: 0 }));
    const refresh = vi.fn(async (_replaceDraft?: boolean) => {});
    const flash = vi.fn();
    await runImportFlow({ importPayload, refresh, flash, isDeliveryFailure: () => false });
    expect(importPayload).toHaveBeenCalledTimes(1);
    expect(refresh.mock.calls).toEqual([[true]]);
    expect(flash.mock.calls).toEqual([["Imported."]]);
  });

  it.each([false, true])("keeps the existing import-failure path with partial=%s", async (partial) => {
    const importPayload = vi.fn(async () => { throw new Error("import failed"); });
    const refresh = vi.fn(async (_replaceDraft?: boolean) => {});
    const flash = vi.fn();
    await runImportFlow({ importPayload, refresh, flash, isDeliveryFailure: () => partial });
    expect(importPayload).toHaveBeenCalledTimes(1);
    expect(refresh.mock.calls).toEqual([[partial]]);
    expect(flash.mock.calls).toEqual([[
      partial ? "Imported, but prompt-related data wasn't fully updated — try again." : "Import failed.",
      "error",
    ]]);
  });
});
