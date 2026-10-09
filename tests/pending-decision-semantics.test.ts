import { describe, expect, it } from "vitest";
import {
  PENDING_DECISION_MAX_URL_LENGTH,
  PENDING_DECISION_TTL_MS,
  parsePendingDecision,
  parsePendingDecisionSemantics,
} from "../extension/src/shared/pending_decision";

const baseSemantics = {
  kind: "navigation",
  reason: "navigation-blocked",
  actions: ["proceed-once"],
  destinationUrl: "https://a.test/x",
};

function baseRecord(): Record<string, unknown> {
  return {
    kind: "navigation",
    reason: "navigation-blocked",
    actions: ["proceed-once"],
    id: "a".repeat(32),
    deliveryToken: "b".repeat(32),
    tabId: 1,
    windowId: 1,
    frameId: 0,
    documentId: "ABCDEF0123456789",
    sourceUrlHash: "a".repeat(64),
    topUrlHash: "b".repeat(64),
    destinationUrlHash: "c".repeat(64),
    sourceOrigin: "https://a.test",
    topOrigin: "https://a.test",
    destinationOrigin: "https://b.test",
    createdAt: 1000,
    expiresAt: 1000 + PENDING_DECISION_TTL_MS,
  };
}

describe("parsePendingDecisionSemantics", () => {
  it("parses valid base semantics", () => {
    const result = parsePendingDecisionSemantics(baseSemantics);
    expect(result).not.toBeNull();
    expect(result?.destinationUrl).toBe("https://a.test/x");
  });

  it.each([
    ["tabId", 1],
    ["windowId", 1],
    ["frameId", 0],
    ["documentId", "doc"],
    ["sourceUrl", "https://a.test/y"],
    ["topUrl", "https://a.test/y"],
    ["sourceUrlHash", "a".repeat(64)],
    ["topUrlHash", "b".repeat(64)],
    ["destinationUrlHash", "c".repeat(64)],
    ["sourceOrigin", "https://a.test"],
    ["topOrigin", "https://a.test"],
    ["destinationOrigin", "https://b.test"],
    ["id", "x"],
    ["deliveryToken", "x"],
    ["createdAt", 1],
    ["expiresAt", 2],
  ] as Array<[string, unknown]>)("rejects verified identity field %s", (field, value) => {
    expect(parsePendingDecisionSemantics({ ...baseSemantics, [field]: value })).toBeNull();
  });

  it.each([
    ["javascript scheme", "javascript:alert(1)"],
    ["non-canonical host root", "https://a.test"],
    ["non-canonical host case", "https://A.test/x"],
    ["empty string", ""],
    ["non-string", 5],
    ["undefined", undefined],
  ] as Array<[string, unknown]>)("rejects non-exact destinationUrl (%s)", (_label, destinationUrl) => {
    expect(parsePendingDecisionSemantics({ ...baseSemantics, destinationUrl })).toBeNull();
  });

  it("rejects an over-length destinationUrl", () => {
    const destinationUrl = `https://a.test/${"a".repeat(10000)}`;
    expect(destinationUrl.length).toBeGreaterThan(PENDING_DECISION_MAX_URL_LENGTH);
    expect(parsePendingDecisionSemantics({ ...baseSemantics, destinationUrl })).toBeNull();
  });

  it("still parses an already-canonical trailing-slash URL", () => {
    const result = parsePendingDecisionSemantics({
      ...baseSemantics,
      destinationUrl: "https://a.test/x/",
    });
    expect(result).not.toBeNull();
    expect(result?.destinationUrl).toBe("https://a.test/x/");
  });

  it.each([[null], ["str"], [[]]])("rejects non-record input %s", (value) => {
    expect(parsePendingDecisionSemantics(value)).toBeNull();
  });
});

describe("parsePendingDecision", () => {
  it("parses a valid persisted record", () => {
    const result = parsePendingDecision(baseRecord(), 1000);
    expect(result).not.toBeNull();
    expect(result?.id).toBe("a".repeat(32));
    expect(result?.deliveryToken).toBe("b".repeat(32));
  });

  it("rejects id === deliveryToken", () => {
    expect(
      parsePendingDecision({ ...baseRecord(), id: "a".repeat(32), deliveryToken: "a".repeat(32) }, 1000),
    ).toBeNull();
  });

  it.each([-1, 1])("rejects expiresAt offset by %i from the exact TTL", (delta) => {
    expect(
      parsePendingDecision(
        { ...baseRecord(), expiresAt: 1000 + PENDING_DECISION_TTL_MS + delta },
        1000,
      ),
    ).toBeNull();
  });

  it("rejects createdAt in the future", () => {
    expect(
      parsePendingDecision(
        { ...baseRecord(), createdAt: 2000, expiresAt: 2000 + PENDING_DECISION_TTL_MS },
        1000,
      ),
    ).toBeNull();
  });

  it.each([["destinationUrl", "https://a.test/x"], ["sourceUrl", "https://a.test/y"]])(
    "does not leak raw %s into the parsed record",
    (field, url) => {
      const result = parsePendingDecision({ ...baseRecord(), [field]: url }, 1000);
      expect(result).not.toBeNull();
      expect(result !== null && field in result).toBe(false);
    },
  );
});
