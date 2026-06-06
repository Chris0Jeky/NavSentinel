import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  pct,
  avg,
  fmtTime,
  parseIntSafe,
  withReentrancyGuard,
  classifyImportError,
  runClearStats,
  runImportFlow,
} from "../extension/src/options/options_model";

describe("pct", () => {
  it("formats percentage with one decimal", () => {
    expect(pct(1, 4)).toBe("25.0%");
  });

  it("returns -- when total is zero", () => {
    expect(pct(5, 0)).toBe("--");
  });

  it("handles 100%", () => {
    expect(pct(10, 10)).toBe("100.0%");
  });

  it("handles 0 out of N", () => {
    expect(pct(0, 100)).toBe("0.0%");
  });

  it("rounds to one decimal", () => {
    expect(pct(1, 3)).toBe("33.3%");
  });

  it("handles n > total (over 100%)", () => {
    expect(pct(3, 2)).toBe("150.0%");
  });
});

describe("avg", () => {
  it("computes average with one decimal", () => {
    expect(avg([10, 20, 30])).toBe("20.0");
  });

  it("returns -- for empty array", () => {
    expect(avg([])).toBe("--");
  });

  it("handles single value", () => {
    expect(avg([42])).toBe("42.0");
  });

  it("rounds to one decimal", () => {
    expect(avg([1, 2])).toBe("1.5");
  });

  it("handles zero values", () => {
    expect(avg([0, 0, 0])).toBe("0.0");
  });

  it("handles negative values", () => {
    expect(avg([-10, 10])).toBe("0.0");
  });
});

describe("fmtTime", () => {
  it("formats a valid timestamp as a locale string with digits", () => {
    const result = fmtTime(1716480000000);
    expect(result).toBeTruthy();
    expect(result).not.toBe("1716480000000");
    expect(result).toMatch(/\d/);
  });

  it("formats timestamp 0 (epoch)", () => {
    const result = fmtTime(0);
    expect(result).toBeTruthy();
    expect(result).not.toBe("0");
  });

  it("returns Invalid Date string for NaN timestamp", () => {
    expect(fmtTime(NaN)).toBe("Invalid Date");
  });

  it("handles negative timestamps", () => {
    const result = fmtTime(-86400000);
    expect(result).toBeTruthy();
  });
});

describe("parseIntSafe", () => {
  it("parses a valid integer string", () => {
    expect(parseIntSafe("42", 0)).toBe(42);
  });

  it("treats empty string as 0 (Number('') === 0)", () => {
    expect(parseIntSafe("", 99)).toBe(0);
  });

  it("truncates fractional values", () => {
    expect(parseIntSafe("3.7", 0)).toBe(3);
  });

  it("returns fallback for non-numeric string", () => {
    expect(parseIntSafe("abc", 10)).toBe(10);
  });

  it("handles negative numbers", () => {
    expect(parseIntSafe("-5", 0)).toBe(-5);
  });

  it("returns fallback for NaN string", () => {
    expect(parseIntSafe("NaN", 7)).toBe(7);
  });

  it("returns fallback for Infinity string", () => {
    expect(parseIntSafe("Infinity", 100)).toBe(100);
  });

  it("handles zero", () => {
    expect(parseIntSafe("0", 50)).toBe(0);
  });

  it("handles whitespace-padded numbers", () => {
    expect(parseIntSafe("  42  ", 0)).toBe(42);
  });

  it("truncates negative fractional values toward zero", () => {
    expect(parseIntSafe("-3.9", 0)).toBe(-3);
  });

  it("handles leading zeros", () => {
    expect(parseIntSafe("007", 0)).toBe(7);
  });
});

describe("withReentrancyGuard", () => {
  it("ignores a re-entrant call while one is in flight (fn runs once)", async () => {
    let busy = false;
    let resolveFn!: () => void;
    const fn = vi.fn(() => new Promise<void>((r) => { resolveFn = r; }));
    const guarded = withReentrancyGuard(() => busy, (b) => { busy = b; }, fn);

    const first = guarded(); // runs synchronously up to the await: sets busy, calls fn once
    expect(busy).toBe(true);
    await guarded(); // re-entrant while busy → ignored
    expect(fn).toHaveBeenCalledTimes(1);

    resolveFn();
    await first;
    expect(busy).toBe(false); // reset after completion
  });

  it("can run again after the previous call completes", async () => {
    let busy = false;
    const fn = vi.fn(() => Promise.resolve());
    const guarded = withReentrancyGuard(() => busy, (b) => { busy = b; }, fn);

    await guarded();
    await guarded();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(busy).toBe(false);
  });

  it("clears the busy flag even if fn rejects, and propagates the rejection", async () => {
    let busy = false;
    const fn = vi.fn(() => Promise.reject(new Error("boom")));
    const guarded = withReentrancyGuard(() => busy, (b) => { busy = b; }, fn);

    await expect(guarded()).rejects.toThrow("boom");
    expect(busy).toBe(false); // not stuck busy
  });
});

describe("classifyImportError (#188)", () => {
  it("words a delivery failure as a partial result", () => {
    const outcome = classifyImportError(true);
    expect(outcome.tone).toBe("error");
    expect(outcome.message).toMatch(/prompt history/i);
    expect(outcome.message).not.toBe("Import failed.");
  });

  it("words any other failure as a total failure", () => {
    const outcome = classifyImportError(false);
    expect(outcome.tone).toBe("error");
    expect(outcome.message).toBe("Import failed.");
  });
});

describe("runClearStats (#188)", () => {
  beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("clears outcomes then adaptive, refreshes, and flashes success", async () => {
    const order: string[] = [];
    const flash = vi.fn();
    await runClearStats({
      clearOutcomes: vi.fn(async () => { order.push("outcomes"); }),
      clearAdaptive: vi.fn(async () => { order.push("adaptive"); }),
      refresh: vi.fn(async () => { order.push("refresh"); }),
      flash,
    });
    expect(order).toEqual(["outcomes", "adaptive", "refresh"]);
    expect(flash).toHaveBeenCalledWith("Stats cleared.");
  });

  it("on a failed outcome clear: skips the adaptive clear (no half-clear), refreshes, flashes error", async () => {
    const clearAdaptive = vi.fn(async () => {});
    const refresh = vi.fn(async () => {});
    const flash = vi.fn();
    await runClearStats({
      clearOutcomes: vi.fn(async () => { throw new Error("SW unreachable"); }),
      clearAdaptive,
      refresh,
      flash,
    });
    expect(clearAdaptive).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
    expect(flash).toHaveBeenCalledWith("Couldn't clear stats — try again.", "error");
  });
});

describe("runImportFlow (#188)", () => {
  beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });

  // A delivery failure is modeled by a sentinel-message error here; in production
  // the predicate is `e instanceof PromptOutcomeDeliveryError`.
  const isDelivery = (e: unknown) => e instanceof Error && e.message === "DELIVERY";

  it("imports, refreshes, and flashes success", async () => {
    const refresh = vi.fn(async () => {});
    const flash = vi.fn();
    await runImportFlow({
      importPayload: vi.fn(async () => {}),
      refresh,
      flash,
      isDeliveryFailure: isDelivery,
    });
    expect(refresh).toHaveBeenCalled();
    expect(flash).toHaveBeenCalledWith("Imported.");
  });

  it("on a delivery failure: refreshes and reports a partial result", async () => {
    const refresh = vi.fn(async () => {});
    const flash = vi.fn();
    await runImportFlow({
      importPayload: vi.fn(async () => { throw new Error("DELIVERY"); }),
      refresh,
      flash,
      isDeliveryFailure: isDelivery,
    });
    expect(refresh).toHaveBeenCalled();
    expect(flash).toHaveBeenCalledWith(expect.stringMatching(/prompt history/i), "error");
  });

  it("on any other failure: still refreshes (import is non-atomic) and reports total failure", async () => {
    const refresh = vi.fn(async () => {});
    const flash = vi.fn();
    await runImportFlow({
      importPayload: vi.fn(async () => { throw new Error("bad json"); }),
      refresh,
      flash,
      isDeliveryFailure: isDelivery,
    });
    expect(refresh).toHaveBeenCalled();
    expect(flash).toHaveBeenCalledWith("Import failed.", "error");
  });

  it("does not let a failed post-error refresh mask the status or escape", async () => {
    const flash = vi.fn();
    await expect(
      runImportFlow({
        importPayload: vi.fn(async () => { throw new Error("bad json"); }),
        refresh: vi.fn(async () => { throw new Error("refresh boom"); }),
        flash,
        isDeliveryFailure: isDelivery,
      }),
    ).resolves.toBeUndefined();
    expect(flash).toHaveBeenCalledWith("Import failed.", "error");
  });
});
