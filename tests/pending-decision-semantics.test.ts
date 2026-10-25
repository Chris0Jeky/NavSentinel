import { describe, expect, it } from "vitest";
import {
  PENDING_DECISION_MAX_URL_LENGTH,
  PENDING_DECISION_TTL_MS,
  parsePendingDecision,
  parsePendingDecisionSemantics,
  parsePendingDecisionVerifiedContext,
  parsePendingDecisionVerifiedTabContext,
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

describe("parsePendingDecisionSemantics page-input guards", () => {
  it("rejects an identity field even when the page sets it to undefined", () => {
    // The guard is key presence (`in`), not value truthiness: a forged key must not slip through.
    expect(parsePendingDecisionSemantics({ ...baseSemantics, tabId: undefined })).toBeNull();
    expect(parsePendingDecisionSemantics({ ...baseSemantics, expiresAt: undefined })).toBeNull();
  });

  it.each([
    ["credential reason under navigation kind", { kind: "navigation", reason: "credential-submit-blocked", actions: ["proceed-once"] }],
    ["navigation reason under credential kind", { kind: "credential", reason: "navigation-blocked", actions: ["proceed-once"] }],
    ["unknown reason", { reason: "forged-reason" }],
    ["unknown kind", { kind: "forged" }],
    ["empty actions", { actions: [] }],
    ["duplicate actions", { actions: ["proceed-once", "proceed-once"] }],
    ["non-string action", { actions: [1] }],
    ["non-array actions", { actions: "proceed-once" }],
    ["unknown signal", { signals: ["free-form text"] }],
  ] as Array<[string, Record<string, unknown>]>)("rejects %s", (_label, patch) => {
    expect(parsePendingDecisionSemantics({ ...baseSemantics, ...patch })).toBeNull();
  });
});

describe("parsePendingDecisionVerifiedContext / TabContext", () => {
  const context = {
    tabId: 1, windowId: 2, frameId: 0, documentId: "ABCDEF0123456789",
    sourceUrl: "https://a.test/x", topUrl: "https://a.test/y",
  };

  it("keeps only the six verified fields", () => {
    expect(parsePendingDecisionVerifiedContext({ ...context, extra: "x" })).toEqual(context);
    expect(parsePendingDecisionVerifiedTabContext({ tabId: 1, windowId: 2, topUrl: "https://a.test/y", extra: "x" })).toEqual({
      tabId: 1, windowId: 2, topUrl: "https://a.test/y",
    });
  });

  it.each([
    ["negative tabId", { tabId: -1 }],
    ["fractional windowId", { windowId: 1.5 }],
    ["string frameId", { frameId: "0" }],
    ["empty documentId", { documentId: "" }],
    ["documentId with illegal characters", { documentId: "doc id" }],
    ["over-length documentId", { documentId: "d".repeat(129) }],
    ["non-http sourceUrl", { sourceUrl: "javascript:alert(1)" }],
    ["non-canonical topUrl", { topUrl: "https://A.test/y" }],
  ] as Array<[string, Record<string, unknown>]>)("rejects %s", (_label, patch) => {
    expect(parsePendingDecisionVerifiedContext({ ...context, ...patch })).toBeNull();
  });

  it.each([[null], ["str"], [[]]])("rejects non-record input %j", (value) => {
    expect(parsePendingDecisionVerifiedContext(value)).toBeNull();
    expect(parsePendingDecisionVerifiedTabContext(value)).toBeNull();
  });

  it("rejects a tab context with a forged ID or a non-http top URL", () => {
    const tab = { tabId: 1, windowId: 2, topUrl: "https://a.test/y" };
    expect(parsePendingDecisionVerifiedTabContext({ ...tab, tabId: -1 })).toBeNull();
    expect(parsePendingDecisionVerifiedTabContext({ ...tab, windowId: "2" })).toBeNull();
    expect(parsePendingDecisionVerifiedTabContext({ ...tab, topUrl: "file:///etc/passwd" })).toBeNull();
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

  it("rejects a fractional createdAt and an expiresAt outside the safe-integer range", () => {
    // `now` is far ahead so the future-createdAt guard cannot be what rejects these.
    expect(
      parsePendingDecision(
        { ...baseRecord(), createdAt: 1000.5, expiresAt: 1000.5 + PENDING_DECISION_TTL_MS },
        5000,
      ),
    ).toBeNull();
    const createdAt = Number.MAX_SAFE_INTEGER - 1001;
    const expiresAt = createdAt + PENDING_DECISION_TTL_MS;
    expect(expiresAt - createdAt).toBe(PENDING_DECISION_TTL_MS);
    expect(Number.isSafeInteger(expiresAt)).toBe(false);
    expect(parsePendingDecision({ ...baseRecord(), createdAt, expiresAt }, Number.MAX_SAFE_INTEGER)).toBeNull();
  });

  it("accepts createdAt exactly equal to now and rejects one millisecond later", () => {
    const at = (createdAt: number) => ({ ...baseRecord(), createdAt, expiresAt: createdAt + PENDING_DECISION_TTL_MS });
    expect(parsePendingDecision(at(1000), 1000)).not.toBeNull();
    expect(parsePendingDecision(at(1001), 1000)).toBeNull();
  });

  it.each([
    ["short id", { id: "a".repeat(21) }],
    ["id with a non-opaque character", { id: `${"a".repeat(31)}.` }],
    ["over-length id", { id: "a".repeat(129) }],
    ["short deliveryToken", { deliveryToken: "b".repeat(21) }],
    ["deliveryToken with a non-opaque character", { deliveryToken: `${"b".repeat(31)}/` }],
    ["negative tabId", { tabId: -1 }],
    ["fractional windowId", { windowId: 1.5 }],
    ["string frameId", { frameId: "0" }],
    ["empty documentId", { documentId: "" }],
    ["documentId with illegal characters", { documentId: "doc id" }],
    ["over-length documentId", { documentId: "d".repeat(129) }],
    ["uppercase sourceUrlHash", { sourceUrlHash: "A".repeat(64) }],
    ["short topUrlHash", { topUrlHash: "b".repeat(63) }],
    ["non-hex destinationUrlHash", { destinationUrlHash: "g".repeat(64) }],
    ["sourceOrigin carrying a path", { sourceOrigin: "https://a.test/x" }],
    ["non-http topOrigin", { topOrigin: "ftp://a.test" }],
    ["javascript destinationOrigin", { destinationOrigin: "javascript:alert(1)" }],
    ["non-canonical destinationOrigin", { destinationOrigin: "https://B.test" }],
    ["fractional createdAt", { createdAt: 1000.5, expiresAt: 1000.5 + PENDING_DECISION_TTL_MS }],
    ["negative expiresAt", { expiresAt: -1 }],
  ] as Array<[string, Record<string, unknown>]>)("rejects a persisted record with %s", (_label, patch) => {
    expect(parsePendingDecision({ ...baseRecord(), ...patch }, 1000)).toBeNull();
  });

  it.each([
    ["an action the reason does not permit", { actions: ["allow-route"], reason: "navigation-rollback" }],
    ["a credential action under a navigation kind", { actions: ["trust-source"] }],
    ["empty actions", { actions: [] }],
    ["duplicate actions", { actions: ["proceed-once", "proceed-once"] }],
    ["a kind/reason mismatch", { reason: "credential-submit-blocked" }],
    ["an out-of-range score", { score: 101 }],
    ["a fractional score", { score: 1.5 }],
    ["an unknown signal", { signals: ["free-form text"] }],
    ["duplicate signals", { signals: ["cross_site", "cross_site"] }],
  ] as Array<[string, Record<string, unknown>]>)("rejects a persisted record with %s", (_label, patch) => {
    expect(parsePendingDecision({ ...baseRecord(), ...patch }, 1000)).toBeNull();
  });
});
