import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ADAPTIVE_SCORES_KEY,
  getEffectiveThresholdAdjustment,
  resolveThresholdAdjustment,
} from "../extension/src/shared/adaptive_scoring";

afterEach(() => vi.unstubAllGlobals());

describe("stored adaptive adjustments stay inside the generated range (#832)", () => {
  it.each([-Number.MAX_VALUE, -16, -15.0001, 15.0001, 16, Number.MAX_VALUE])(
    "rejects finite out-of-range adjustment %s instead of clamping it", async (value) => {
      vi.stubGlobal("chrome", { storage: { local: {
        get: async () => ({ [ADAPTIVE_SCORES_KEY]: { "sample.example": { adjustment: value } } }),
      } } });
      expect(resolveThresholdAdjustment(value)).toBe(0);
      expect(await getEffectiveThresholdAdjustment("sample.example")).toBe(0);
      // A large positive corrupt value must not relax the threshold to 100.
      const threshold = Math.max(30, Math.min(100, 70 + resolveThresholdAdjustment(value)));
      expect(threshold).toBe(70);
    },
  );

  it.each([-15, -14.5, 0, 14.5, 15])("preserves in-range adjustment %s", async (value) => {
    vi.stubGlobal("chrome", { storage: { local: {
      get: async () => ({ [ADAPTIVE_SCORES_KEY]: { "sample.example": { adjustment: value } } }),
    } } });
    expect(resolveThresholdAdjustment(value)).toBe(value);
    expect(await getEffectiveThresholdAdjustment("sample.example")).toBe(value);
  });
});
