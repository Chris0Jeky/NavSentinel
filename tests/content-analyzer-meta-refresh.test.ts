// @vitest-environment happy-dom
// Off-site meta refresh on credential pages (#1144): the WHATWG lexical rules,
// which declaration operates, the bounds, and the scoring signal.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyzeSnapshot,
  buildPageSnapshot,
  MAX_REFRESH_CONTENT,
  MAX_REFRESH_METAS,
  parseRefreshContent,
  type PageSnapshot,
} from "../extension/src/content/content_analyzer";

describe("parseRefreshContent (shared declarative refresh steps)", () => {
  it.each([
    // [content, expected]: undefined = the steps return (no refresh scheduled),
    // null = refresh of the document itself, string = URL text to parse.
    ["5", null],
    ["0", null],
    ["  5  ", null],
    ["5;", null],
    ["5 , ", null],
    [".5", null],
    ["5;url=https://a.test/", "https://a.test/"],
    ["5, https://a.test/", "https://a.test/"],
    ["5 https://a.test/", "https://a.test/"],
    ["5;URL = 'https://a.test/x'y", "https://a.test/x"],
    ['5;url="https://a.test/', "https://a.test/"],
    ["5;'https://a.test/'", "https://a.test/"],
    ["5;urx=foo", "urx=foo"],
    ["5;uri", "uri"],
    ["5;url https://a.test/", "url https://a.test/"],
    ["5;url=", ""],
    [".5;url=x", "x"],
    ["1.5.6;url=x", "x"],
    ["\t\n5\r\f;\turl=x", "x"],
    ["", undefined],
    ["   ", undefined],
    ["not-a-delay;url=https://other.test/", undefined],
    ["5x;url=https://other.test/", undefined],
    ["-1;url=https://other.test/", undefined],
    ["5:url=https://other.test/", undefined],
  ])("%j -> %j", (content, expected) => {
    expect(parseRefreshContent(content)).toBe(expected);
  });
});

function snapshot(refreshContents: string[], overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    title: "",
    bodyText: "",
    htmlSnippet: "",
    scriptText: "",
    imgSignals: "",
    hasPasswordField: true,
    formActions: [],
    metaTags: [],
    matchedSelectors: [],
    baseUrl: "https://shop.example/continue",
    refreshContents,
    ...overrides,
  };
}

const flagged = (contents: string[], overrides: Partial<PageSnapshot> = {}) =>
  analyzeSnapshot(snapshot(contents, overrides), "shop.example");

describe("off-site refresh signal", () => {
  it("scores a pending refresh to another registrable domain", () => {
    const result = flagged(["30;url=https://account-check.example/login"]);
    expect(result.offsiteRefresh).toContain("account-check.example");
    expect(result.score).toBe(25);
    // Reported on its own channel so the guard can attach its own reason code.
    expect(result.reasons).toEqual([]);
  });

  it.each([
    ["same registrable domain", "30;url=https://login.shop.example/dashboard"],
    ["relative target", "30;url=/account"],
    ["refresh to self", "30"],
    ["query mentioning another site", "30;url=/next?url=https://other.example/b"],
    ["javascript: target", "30;url=javascript:alert(1)"],
  ])("stays quiet for a %s", (_label, content) => {
    const result = flagged([content]);
    expect(result.offsiteRefresh).toBeUndefined();
    expect(result.score).toBe(0);
  });

  it("needs a credential page", () => {
    expect(flagged(["30;url=https://account-check.example/"], { hasPasswordField: false }).offsiteRefresh).toBeUndefined();
  });

  it("resolves an empty url= against the document base, like the browser", () => {
    expect(flagged(["30;url="], { baseUrl: "https://collector.example/x" }).offsiteRefresh).toContain("collector.example");
    expect(flagged(["30;url="]).offsiteRefresh).toBeUndefined();
  });

  it("only the first declaration that schedules a refresh operates", () => {
    const offsite = "30;url=https://account-check.example/";
    // Malformed delays and unparseable URLs schedule nothing, so a later one operates.
    expect(flagged(["soon;url=/a", offsite]).offsiteRefresh).toBeDefined();
    expect(flagged(["30;url=https://exa mple.test/", offsite]).offsiteRefresh).toBeDefined();
    expect(flagged(["", offsite]).offsiteRefresh).toBeDefined();
    // A valid earlier declaration wins, so the later off-site one never runs.
    expect(flagged(["30;url=/account", offsite]).offsiteRefresh).toBeUndefined();
    expect(flagged(["30", offsite]).offsiteRefresh).toBeUndefined();
  });

  it("keeps a host decided inside the bound and refuses one the bound cuts", () => {
    const longPath = "30;url=https://account-check.example/" + "a".repeat(MAX_REFRESH_CONTENT * 2);
    expect(flagged([longPath.slice(0, MAX_REFRESH_CONTENT + 1)]).offsiteRefresh).toContain("account-check.example");
    const longHost = "30;url=https://" + "a".repeat(MAX_REFRESH_CONTENT * 2) + ".example/";
    const cut = longHost.slice(0, MAX_REFRESH_CONTENT + 1);
    // Cutting the host would manufacture a different destination: undecided, and
    // a later declaration must not be taken as operative in its place.
    expect(flagged([cut]).offsiteRefresh).toBeUndefined();
    expect(flagged([cut, "30;url=https://account-check.example/"]).offsiteRefresh).toBeUndefined();
    const paddedDelay = " ".repeat(MAX_REFRESH_CONTENT + 1);
    expect(flagged([paddedDelay, "30;url=https://account-check.example/"]).offsiteRefresh).toBeUndefined();
  });
});

describe("buildPageSnapshot refresh channel", () => {
  const offsite = "https://account-check.example/login";
  const build = (head: string) => {
    document.head.innerHTML = head;
    document.body.innerHTML = '<form><input type="password"></form>';
    return buildPageSnapshot(document);
  };

  // happy-dom ignores the selector's `i` flag, so the case-insensitive keyword
  // match is proven in Chrome by tests/e2e/meta-refresh-credential.spec.ts.
  it("collects only http-equiv refresh directives, whatever the name", () => {
    const snap = build(
      `<meta name="refresh" content="1;url=${offsite}">` +
      `<meta http-equiv="refresh " content="2;url=${offsite}">` +
      `<meta http-equiv="content-type" content="text/html">` +
      `<meta http-equiv="refresh">` +
      `<meta name="description" HTTP-EQUIV="refresh" content="3;url=${offsite}">`
    );
    expect(snap.refreshContents).toEqual([`3;url=${offsite}`]);
  });

  it("name=refresh alone is inert metadata, not a refresh", () => {
    const snap = build(`<meta name="refresh" content="1;url=${offsite}">`);
    expect(analyzeSnapshot(snap, "shop.example").offsiteRefresh).toBeUndefined();
  });

  it("inert metas cannot exhaust the budget before a real refresh", () => {
    const inert = '<meta name="x" content="y">'.repeat(500);
    const snap = build(`${inert}<meta http-equiv="refresh" content="30;url=${offsite}">`);
    expect(snap.refreshContents).toEqual([`30;url=${offsite}`]);
    expect(analyzeSnapshot(snap, "shop.example").offsiteRefresh).toContain("account-check.example");
  });

  it("bounds refresh candidates and content length", () => {
    const many = '<meta http-equiv="refresh" content="x">'.repeat(MAX_REFRESH_METAS + 20);
    expect(build(many).refreshContents).toHaveLength(MAX_REFRESH_METAS);
    const huge = build(`<meta http-equiv="refresh" content="30;url=https://a.example/${"p".repeat(100_000)}">`);
    expect(huge.refreshContents![0]).toHaveLength(MAX_REFRESH_CONTENT + 1);
  });
});

describe("gym meta-refresh fixtures", () => {
  const gym = (name: string) => {
    const html = readFileSync(resolve(__dirname, "..", "gym", name), "utf8");
    const doc = new DOMParser().parseFromString(html, "text/html");
    return { ...buildPageSnapshot(doc), baseUrl: `https://shop.example/${name}` };
  };

  it("flags the off-site fixture and not the same-site contrast", () => {
    expect(analyzeSnapshot(gym("meta-refresh-offsite.html"), "shop.example").offsiteRefresh).toContain("account-check.example");
    const contrast = gym("meta-refresh-samesite.html");
    expect(contrast.refreshContents).toHaveLength(1);
    expect(analyzeSnapshot(contrast, "shop.example").offsiteRefresh).toBeUndefined();
  });
});
