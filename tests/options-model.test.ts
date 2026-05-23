import { describe, expect, it } from "vitest";
import { pct, avg, fmtTime, parseIntSafe } from "../extension/src/options/options_model";

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
  it("formats a valid timestamp", () => {
    const result = fmtTime(1716480000000);
    expect(result).toBeTruthy();
    expect(result).not.toBe("1716480000000");
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
});
