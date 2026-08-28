import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  pct,
  avg,
  deriveOptionsSettingsPatch,
  fmtTime,
  parseIntSafe,
  computePromptOutcomeStats,
  rebaseOptionsSettingsDraft,
  withReentrancyGuard,
  classifyImportError,
  describeBehaviouralReset,
  runClearBehaviouralData,
  runClearStats,
  runImportFlow,
} from "../extension/src/options/options_model";
import type { SuiteSettings } from "../extension/src/shared/storage";

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

  it("returns fallback for an empty string (not 0) (#367)", () => {
    // Number("") === 0 is finite, so the empty-field case must be guarded
    // explicitly or it would silently store 0 instead of the default.
    expect(parseIntSafe("", 99)).toBe(99);
  });

  it("returns fallback for a whitespace-only string (#367)", () => {
    expect(parseIntSafe("   ", 99)).toBe(99);
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

function makeSuiteSettings(): SuiteSettings {
  return {
    nav: { defaultMode: "smart", debug: false, autoDismissOverlays: false },
    credential: {
      mode: "smart",
      promptOnUntrustedDomain: true,
      promptOnMediumRisk: true,
      mediumRiskThreshold: 40,
      blockHttpPasswordSubmit: true,
      warnOnPaste: true,
      similarity: { enabled: true, maxDistance: 2 },
    },
    logLimit: 300,
  };
}

describe("Options settings patch and rebase (#558)", () => {
  it("derives only changed nested leaves and omits empty branches", () => {
    const baseline = makeSuiteSettings();
    const draft = makeSuiteSettings();
    draft.credential.similarity.maxDistance = 5;
    draft.nav.debug = true;
    draft.nav.autoDismissOverlays = true;

    expect(deriveOptionsSettingsPatch(baseline, draft)).toEqual({
      nav: { debug: true, autoDismissOverlays: true },
      credential: { similarity: { maxDistance: 5 } },
    });
  });

  it("returns an empty patch when the draft still equals the rendered baseline", () => {
    const patch = deriveOptionsSettingsPatch(makeSuiteSettings(), makeSuiteSettings());
    expect(patch).toEqual({});
  });

  it("adopts external updates for clean Options controls", () => {
    const baseline = makeSuiteSettings();
    const incoming = makeSuiteSettings();
    incoming.nav.defaultMode = "strict";
    incoming.credential.mode = "off";
    incoming.credential.similarity.maxDistance = 4;
    incoming.logLimit = 800;

    expect(rebaseOptionsSettingsDraft(baseline, makeSuiteSettings(), incoming)).toEqual(incoming);
  });

  it("preserves an unrelated dirty Options leaf while adopting a clean popup update", () => {
    const baseline = makeSuiteSettings();
    const draft = makeSuiteSettings();
    draft.credential.warnOnPaste = false;
    const incoming = makeSuiteSettings();
    incoming.nav.defaultMode = "strict";

    const rebased = rebaseOptionsSettingsDraft(baseline, draft, incoming);
    expect(rebased.nav.defaultMode).toBe("strict");
    expect(rebased.credential.warnOnPaste).toBe(false);
  });

  it("preserves a same-field dirty Options value until conflict UI is added", () => {
    const baseline = makeSuiteSettings();
    const draft = makeSuiteSettings();
    draft.credential.mode = "strict";
    const incoming = makeSuiteSettings();
    incoming.credential.mode = "off";

    const rebased = rebaseOptionsSettingsDraft(baseline, draft, incoming);
    expect(rebased.credential.mode).toBe("strict");
  });
});

describe("computePromptOutcomeStats", () => {
  const mk = (outcome: string, score: number) => ({ outcome: outcome as never, score });

  it("counts the bare 'allow' variant in the allow bucket (#367 repro)", () => {
    // Issue repro: one 'allow' (80) + one 'allow_once' (60). Pre-fix the bare
    // 'allow' was dropped → allow-rate 50.0% / avg 60.0. Both must be allows.
    const stats = computePromptOutcomeStats([mk("allow", 80), mk("allow_once", 60)]);
    expect(stats.allowRate).toBe("100.0%");
    expect(stats.avgScoreAllow).toBe("70.0");
    expect(stats.total).toBe(2);
  });

  it("partitions every PromptOutcome variant so the four rates sum to 100%", () => {
    const stats = computePromptOutcomeStats([
      mk("allow", 10),
      mk("allow_once", 20),
      mk("always_allow", 30),
      mk("block", 40),
      mk("cancel", 50),
      mk("trust", 60),
      mk("dismiss", 70),
    ]);
    // allows 3/7, blocks 2/7, trust 1/7, dismiss 1/7 → 42.9 + 28.6 + 14.3 + 14.3 = 100.1
    // (rounding); the point is no entry is uncounted.
    expect(stats.allowRate).toBe("42.9%");
    expect(stats.blockRate).toBe("28.6%");
    expect(stats.trustRate).toBe("14.3%");
    expect(stats.dismissRate).toBe("14.3%");
    expect(stats.avgScoreAllow).toBe("20.0"); // (10+20+30)/3
    expect(stats.avgScoreBlock).toBe("45.0"); // (40+50)/2
  });

  it("returns '--' rates and avgs for an empty set", () => {
    const stats = computePromptOutcomeStats([]);
    expect(stats.total).toBe(0);
    expect(stats.allowRate).toBe("--");
    expect(stats.avgScoreAllow).toBe("--");
    expect(stats.avgScoreBlock).toBe("--");
  });

  it("groups 'cancel' with blocks", () => {
    const stats = computePromptOutcomeStats([mk("block", 90), mk("cancel", 70)]);
    expect(stats.blockRate).toBe("100.0%");
    expect(stats.avgScoreBlock).toBe("80.0");
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
    expect(outcome.message).toMatch(/prompt-related/i);
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

  it("on a failed adaptive clear: refreshes and flashes error", async () => {
    const refresh = vi.fn(async () => {});
    const flash = vi.fn();
    await runClearStats({
      clearOutcomes: vi.fn(async () => {}),
      clearAdaptive: vi.fn(async () => { throw new Error("SW unreachable"); }),
      refresh,
      flash,
    });
    expect(refresh).toHaveBeenCalled();
    expect(flash).toHaveBeenCalledWith("Couldn't clear stats — try again.", "error");
  });
});

describe("runClearBehaviouralData (RI-06 / #474)", () => {
  beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("names what was erased and what was kept on a complete reset", () => {
    const outcome = describeBehaviouralReset({
      ok: true,
      cleared: ["promptOutcomes", "adaptiveScores", "eventLog", "domainProfiles"],
      failed: [],
    });
    expect(outcome.tone).toBeUndefined();
    expect(outcome.message).toBe(
      "Behavioural data cleared. Settings, allowlist, and trusted domains were kept.",
    );
  });

  it("never reports success on a partial reset — it names the lanes that survived", () => {
    const outcome = describeBehaviouralReset({
      ok: false,
      cleared: ["promptOutcomes", "adaptiveScores"],
      failed: [
        { lane: "eventLog", error: "quota" },
        { lane: "domainProfiles", error: "quota" },
      ],
    });
    expect(outcome.tone).toBe("error");
    expect(outcome.message).toBe("Partly cleared — still stored: event log, domain profiles. Try again.");
  });

  it("words a total failure as nothing cleared", () => {
    const outcome = describeBehaviouralReset({
      ok: false,
      cleared: [],
      failed: [{ lane: "eventLog", error: "quota" }],
    });
    expect(outcome.tone).toBe("error");
    expect(outcome.message).toBe("Couldn't clear behavioural data (event log) — try again.");
  });

  it("does nothing when the user cancels the confirmation", async () => {
    const reset = vi.fn(async () => ({ ok: true, cleared: [], failed: [] }));
    const refresh = vi.fn(async () => {});
    const flash = vi.fn();
    await runClearBehaviouralData({ confirm: () => false, reset, refresh, flash });
    expect(reset).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(flash).not.toHaveBeenCalled();
  });

  it("resets through the single entry point, refreshes, then flashes the outcome", async () => {
    const order: string[] = [];
    const flash = vi.fn();
    await runClearBehaviouralData({
      confirm: () => true,
      reset: vi.fn(async () => {
        order.push("reset");
        return { ok: true as const, cleared: ["eventLog" as const], failed: [] };
      }),
      refresh: vi.fn(async () => { order.push("refresh"); }),
      flash,
    });
    expect(order).toEqual(["reset", "refresh"]);
    expect(flash).toHaveBeenCalledWith(
      "Behavioural data cleared. Settings, allowlist, and trusted domains were kept.",
      undefined,
    );
  });

  it("refreshes and reports an error when the reset throws", async () => {
    const refresh = vi.fn(async () => {});
    const flash = vi.fn();
    await runClearBehaviouralData({
      confirm: () => true,
      reset: vi.fn(async () => { throw new Error("SW unreachable"); }),
      refresh,
      flash,
    });
    expect(refresh).toHaveBeenCalled();
    expect(flash).toHaveBeenCalledWith("Couldn't clear behavioural data — try again.", "error");
  });

  // --- Review round 2, finding (2): an un-finalized marker is not success, and the
  // status line has to say so rather than fall through the partial-reset wording.
  it("warns about a replayable reset when the marker could not be finalized", () => {
    const outcome = describeBehaviouralReset({
      ok: false,
      cleared: ["promptOutcomes", "adaptiveScores", "eventLog", "domainProfiles"],
      failed: [],
      markerError: "marker store full",
    });
    expect(outcome.tone).toBe("error");
    expect(outcome.message).toBe(
      "Cleared, but the reset wasn't finalized — it may run again at the next browser start.",
    );
  });

  // --- Review round 2, finding (3): the refresh ran after storage had already been
  // mutated, and its rejection escaped the un-awaited click listener unreported.
  it("still reports the reset outcome when the post-reset refresh fails", async () => {
    const flash = vi.fn();
    await expect(runClearBehaviouralData({
      confirm: () => true,
      reset: vi.fn(async () => ({
        ok: true as const,
        cleared: ["eventLog" as const],
        failed: [],
      })),
      refresh: vi.fn(async () => { throw new Error("refresh boom"); }),
      flash,
    })).resolves.toBeUndefined();
    expect(flash).toHaveBeenCalledWith(
      "Behavioural data cleared. Settings, allowlist, and trusted domains were kept.",
      undefined,
    );
  });

  it("still reports the failure when the reset throws and the refresh also fails", async () => {
    const flash = vi.fn();
    await expect(runClearBehaviouralData({
      confirm: () => true,
      reset: vi.fn(async () => { throw new Error("SW unreachable"); }),
      refresh: vi.fn(async () => { throw new Error("refresh boom"); }),
      flash,
    })).resolves.toBeUndefined();
    expect(flash).toHaveBeenCalledWith("Couldn't clear behavioural data — try again.", "error");
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
    expect(refresh).toHaveBeenCalledWith(true);
    expect(flash).toHaveBeenCalledWith("Imported.");
  });

  it("reports a singular event-log truncation on success (#391)", async () => {
    const refresh = vi.fn(async () => {});
    const flash = vi.fn();
    await runImportFlow({
      importPayload: vi.fn(async () => ({ eventLogDropped: 1 })),
      refresh,
      flash,
      isDeliveryFailure: isDelivery,
    });
    expect(flash).toHaveBeenCalledWith(
      "Imported. Event log truncated: 1 older event was not imported."
    );
  });

  it("reports plural event-log truncation on success (#391)", async () => {
    const refresh = vi.fn(async () => {});
    const flash = vi.fn();
    await runImportFlow({
      importPayload: vi.fn(async () => ({ eventLogDropped: 2 })),
      refresh,
      flash,
      isDeliveryFailure: isDelivery,
    });
    expect(flash).toHaveBeenCalledWith(
      "Imported. Event log truncated: 2 older events were not imported."
    );
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
    expect(refresh).toHaveBeenCalledWith(true);
    expect(flash).toHaveBeenCalledWith(expect.stringMatching(/prompt-related/i), "error");
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
    expect(refresh).toHaveBeenCalledWith(false);
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
