import { describe, expect, it } from "vitest";
import {
  PENDING_DECISION_MAX_URL_LENGTH,
  isExactHttpUrl,
} from "../extension/src/shared/pending_decision";

describe("isExactHttpUrl regression", () => {
  it.each([
    ["javascript: scheme", "javascript:alert(1)"],
    ["encoded dot-segment", "https://example.com/%2e%2e"],
    ["trailing space", "https://example.com/ "],
  ])("rejects bad input: %s", (_label, value) => {
    expect(isExactHttpUrl(value)).toBe(false);
  });

  it("rejects URLs over 8192 chars", () => {
    const overlong =
      "https://example.com/" +
      "a".repeat(PENDING_DECISION_MAX_URL_LENGTH);
    expect(overlong.length).toBeGreaterThan(PENDING_DECISION_MAX_URL_LENGTH);
    expect(isExactHttpUrl(overlong)).toBe(false);
  });

  it("accepts the canonical good URL", () => {
    expect(isExactHttpUrl("https://example.com/a")).toBe(true);
  });
});
