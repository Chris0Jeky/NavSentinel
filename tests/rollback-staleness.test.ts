import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isStaleDelivery,
  stripUrlFragment,
} from "../extension/src/content/rollback_staleness";

const contentRoot = path.resolve(import.meta.dirname, "../extension/src/content");
const swRoot = path.resolve(import.meta.dirname, "../extension/src/sw");

describe("stripUrlFragment (#774)", () => {
  it("strips the fragment", () => {
    expect(stripUrlFragment("https://a.test/x#section")).toBe("https://a.test/x");
  });

  it("leaves fragment-less URLs untouched", () => {
    expect(stripUrlFragment("https://a.test/x?q=1")).toBe("https://a.test/x?q=1");
  });

  it("keeps a bare fragment-only tail cut at the first hash", () => {
    expect(stripUrlFragment("https://a.test/#a#b")).toBe("https://a.test/");
  });
});

describe("isStaleDelivery (#774)", () => {
  it("treats an exact location match as fresh", () => {
    expect(isStaleDelivery("https://a.test/x", "https://a.test/x")).toBe(false);
  });

  it("treats same-document fragment drift as fresh", () => {
    // Fragment navigations fire onCommitted; a naive exact match would drop
    // legitimate rollbacks after an in-page anchor jump.
    expect(isStaleDelivery("https://a.test/x", "https://a.test/x#section")).toBe(false);
    expect(isStaleDelivery("https://a.test/x#old", "https://a.test/x#new")).toBe(false);
  });

  it("treats a moved-on tab as stale", () => {
    expect(isStaleDelivery("https://evil.test/a", "https://evil.test/b")).toBe(true);
    expect(isStaleDelivery("https://evil.test/a", "https://bank.test/a")).toBe(true);
  });

  it("treats query drift as stale (different document)", () => {
    expect(isStaleDelivery("https://a.test/x", "https://a.test/x?q=2")).toBe(true);
  });

  it("treats an empty target as stale", () => {
    expect(isStaleDelivery("", "https://a.test/x")).toBe(true);
    expect(isStaleDelivery("", "")).toBe(true);
  });
});

describe("rollback/forward staleness wiring (#774)", () => {
  it("guards handleRollback (covers push + poll paths, which both funnel through it)", () => {
    const source = fs.readFileSync(path.join(contentRoot, "capture_isolated.ts"), "utf8");

    expect(source).toContain('from "./rollback_staleness"');
    expect(source).toContain("if (isStaleDelivery(url, location.href)) return;");
  });

  it("guards the forward-offer listener against moved-on and already-there races", () => {
    const source = fs.readFileSync(path.join(contentRoot, "capture_isolated.ts"), "utf8");

    // The tab is legitimately NEVER at message.url for an offer (it is at
    // returnUrl), so the guard keys on returnUrl + an already-there check.
    expect(source).toContain("if (!isStaleDelivery(url, location.href)) return;");
    expect(source).toContain("if (returnUrl && isStaleDelivery(returnUrl, location.href)) return;");
  });

  it("carries returnUrl on the pushed forward offer when known", () => {
    const source = fs.readFileSync(path.join(swRoot, "sw.ts"), "utf8");

    expect(source).toContain("type: \"ns-forward-offer\"");
    expect(source).toContain("forward.returnUrl !== undefined ? { returnUrl: forward.returnUrl } : {}");
  });
});
