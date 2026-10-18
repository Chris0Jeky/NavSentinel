import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const core = createRequire(resolve("package.json"))(
  "./experiments/vision-lab/shared/core.js",
) as {
  normalizeEvent: (input: unknown) => { context: Record<string, string> };
  sameContext: (a: unknown, b: unknown) => boolean;
};

const baseEvent = (context: unknown) => ({
  id: "event",
  journeyId: "session",
  actor: "browser",
  action: "navigate",
  source: "https://article.test/read",
  destination: "https://reference.test/article",
  signals: [],
  context,
  evidence: "fixture",
});

describe("vision-lab core context identity", () => {
  it.each([{ x: 1 }, { y: 2 }, ["doc-1"], true, false])(
    "rejects non-string/non-finite-number context.document %j",
    (document) => {
      expect(() =>
        core.normalizeEvent(baseEvent({ document })),
      ).toThrow(TypeError);
    },
  );

  it("never normalizes distinct object documents to the same identity", () => {
    const a = baseEvent({ document: { x: 1 } });
    const b = baseEvent({ document: { y: 2 } });
    expect(() => core.normalizeEvent(a)).toThrow(TypeError);
    expect(() => core.normalizeEvent(b)).toThrow(TypeError);
    expect(() => core.sameContext(a, b)).toThrow(TypeError);
  });

  it("rejects boolean, array, and non-finite number context values", () => {
    expect(() =>
      core.normalizeEvent(baseEvent({ tab: true })),
    ).toThrow(TypeError);
    expect(() =>
      core.normalizeEvent(baseEvent({ tab: ["demo-tab-7"] })),
    ).toThrow(TypeError);
    expect(() =>
      core.normalizeEvent(baseEvent({ frame: Number.NaN })),
    ).toThrow(TypeError);
    expect(() =>
      core.normalizeEvent(baseEvent({ frame: Number.POSITIVE_INFINITY })),
    ).toThrow(TypeError);
  });

  it("still accepts strings and preserves distinct finite numbers", () => {
    expect(
      core.normalizeEvent(baseEvent({ document: "doc-a" })).context.document,
    ).toBe("doc-a");
    expect(
      core.normalizeEvent(baseEvent({ frame: 7 })).context.frame,
    ).toBe("7");
    expect(
      core.normalizeEvent(baseEvent({ frame: 7 })).context.frame,
    ).not.toBe(
      core.normalizeEvent(baseEvent({ frame: 8 })).context.frame,
    );
  });

  it("preserves the missing-frame default of 0", () => {
    expect(core.normalizeEvent(baseEvent({})).context.frame).toBe("0");
    expect(core.normalizeEvent(baseEvent(undefined)).context.frame).toBe(
      "0",
    );
  });

  it("keeps distinct string documents distinct", () => {
    const a = baseEvent({ document: "doc-a" });
    const b = baseEvent({ document: "doc-b" });
    expect(core.normalizeEvent(a).context.document).not.toBe(
      core.normalizeEvent(b).context.document,
    );
    expect(core.sameContext(a, b)).toBe(false);
  });
});
