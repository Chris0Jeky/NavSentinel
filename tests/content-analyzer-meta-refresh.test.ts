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
    expect(parseRefreshContent(content)?.url).toBe(expected);
    if (expected === undefined) expect(parseRefreshContent(content)).toBeUndefined();
  });

  it.each([
    ["5", 5],
    [".5;url=x", 0],
    ["1.9;url=x", 1],
    ["007, x", 7],
  ])("%j has a delay of %d whole seconds", (content, delay) => {
    expect(parseRefreshContent(content)?.delay).toBe(delay);
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

  it("treats an empty url= as a reload of the document, ignoring <base>, like Chrome", () => {
    // Document::MaybeHandleHttpRefresh uses the document URL for an empty target.
    const offBase = { baseUrl: "https://collector.example/x" };
    expect(flagged(["30;url="], offBase).offsiteRefresh).toBeUndefined();
    expect(flagged(['30;url=""'], offBase).offsiteRefresh).toBeUndefined();
    expect(flagged(["30;url="]).offsiteRefresh).toBeUndefined();
    // A non-empty relative target still resolves against the base.
    expect(flagged(["30;url=next"], offBase).offsiteRefresh).toContain("collector.example");
  });

  it("selects the refresh Chrome schedules: a later one with an equal or shorter delay replaces it", () => {
    const offsite = "30;url=https://account-check.example/";
    // Malformed delays and unparseable URLs schedule nothing.
    expect(flagged(["soon;url=/a", offsite]).offsiteRefresh).toBeDefined();
    expect(flagged(["30;url=https://exa mple.test/", offsite]).offsiteRefresh).toBeDefined();
    expect(flagged(["", offsite]).offsiteRefresh).toBeDefined();
    // HttpRefreshScheduler::Schedule keeps the current refresh only if it is sooner.
    expect(flagged(["300;url=/account", offsite]).offsiteRefresh).toBeDefined();
    expect(flagged(["30;url=/account", offsite]).offsiteRefresh).toBeDefined();
    expect(flagged(["300", offsite]).offsiteRefresh).toBeDefined();
    expect(flagged(["10;url=/account", offsite]).offsiteRefresh).toBeUndefined();
    expect(flagged([offsite, "5;url=/account"]).offsiteRefresh).toBeUndefined();
    expect(flagged([offsite, "30"]).offsiteRefresh).toBeUndefined();
    // A refused javascript: refresh never replaces the scheduled one.
    expect(flagged([offsite, "1;url=javascript:void(0)"]).offsiteRefresh).toBeDefined();
    // A delay past INT_MAX seconds is not scheduled.
    expect(flagged([offsite, "99999999999;url=/account"]).offsiteRefresh).toBeDefined();
  });

  it("fails closed when more refresh declarations exist than the bound inspects (#1241)", () => {
    const offsite = "30;url=https://account-check.example/";
    expect(flagged(Array(MAX_REFRESH_METAS).fill(offsite)).offsiteRefresh).toContain("account-check.example");
    // Inert metas (Chrome ignores these delays) must not buy a silent pass.
    const inert = "99999999999;url=/account";
    expect(flagged(Array(MAX_REFRESH_METAS + 1).fill(inert)).offsiteRefresh).toContain("too many or too long");
    expect(flagged([...Array(MAX_REFRESH_METAS).fill(inert), offsite]).score).toBe(25);
    // Still only on a credential page.
    expect(flagged(Array(MAX_REFRESH_METAS + 1).fill(inert), { hasPasswordField: false }).offsiteRefresh).toBeUndefined();
  });

  it("keeps a host decided inside the bound and fails closed on one the bound cuts (#1241)", () => {
    const longPath = "30;url=https://account-check.example/" + "a".repeat(MAX_REFRESH_CONTENT * 2);
    expect(flagged([longPath.slice(0, MAX_REFRESH_CONTENT + 1)]).offsiteRefresh).toContain("account-check.example");
    const longHost = "30;url=https://" + "a".repeat(MAX_REFRESH_CONTENT * 2) + ".example/";
    const cut = longHost.slice(0, MAX_REFRESH_CONTENT + 1);
    // Cutting the host would manufacture a different destination: undecided, so
    // the page is flagged rather than trusted, whatever follows.
    expect(flagged([cut]).offsiteRefresh).toContain("too many or too long");
    expect(flagged([cut, "30;url=/account"]).offsiteRefresh).toContain("too many or too long");
    // Padding the delay pushes the target past the bound, leaving no URL to read.
    const paddedDelay = " ".repeat(MAX_REFRESH_CONTENT + 1);
    expect(flagged([paddedDelay]).offsiteRefresh).toContain("too many or too long");
    // A cut value that settles on a same-host target is not a signal.
    const sameLong = "30;url=https://shop.example/" + "a".repeat(MAX_REFRESH_CONTENT * 2);
    expect(flagged([sameLong.slice(0, MAX_REFRESH_CONTENT + 1)]).offsiteRefresh).toBeUndefined();
    // Relative targets and non-http schemes are final as soon as their start is.
    for (const settled of ["/account?next=", "next/", "?x=", "mailto:a@b.test?subject="]) {
      const value = "30;url=" + settled + "a".repeat(MAX_REFRESH_CONTENT * 2);
      expect(flagged([value]).offsiteRefresh).toBeUndefined();
    }
  });

  it("ignores a cut value that Chrome would reject whatever follows", () => {
    const junk = "soon;url=//account-check.example/" + "a".repeat(MAX_REFRESH_CONTENT);
    expect(flagged([junk]).offsiteRefresh).toBeUndefined();
  });

  it("states the unreadable case plainly instead of naming a site (#1241)", () => {
    const pad = Array(MAX_REFRESH_METAS + 1).fill("99999999999;url=/account");
    expect(flagged(pad).offsiteRefresh).toBe("Page refresh tags are too many or too long to check");
    expect(flagged(["30;url=https://account-check.example/"]).offsiteRefresh).toBe(
      "Page is set to send you to a different site: account-check.example"
    );
  });

  describe("a cut that lands before the authority is ended", () => {
    // Padding between the delay and url= places the bound exactly `kept` characters
    // into the target, so only a prefix of it is read.
    const target = "https://account-check.example/";
    const withCutAt = (url: string, kept: number) =>
      "0;" + " ".repeat(MAX_REFRESH_CONTENT - 2 - 4 - kept) + "url=" + url;

    it.each([
      ["url=/", "//account-check.example/", 1],
      ["url=//", "//account-check.example/", 2],
      ["h", target, 1],
      ["ht", target, 2],
      ["https:", target, 6],
      ["https:/", target, 7],
      ["https://", target, 8],
      ["inside the host", target, 20],
      ["the end of the host", target, 29],
      ["a backslash authority", "\\\\account-check.example\\", 5],
    ])("fails closed for a cut at %s", (_label, url, kept) => {
      const value = withCutAt(url, kept);
      expect(value.slice(0, MAX_REFRESH_CONTENT).endsWith(url.slice(0, kept))).toBe(true);
      expect(value.length).toBeGreaterThan(MAX_REFRESH_CONTENT);
      expect(flagged([value]).offsiteRefresh).toBe("Page refresh tags are too many or too long to check");
    });

    it("names the site once the authority is ended inside the bound", () => {
      // A trailing character past the bound makes these cut, with the "/" retained.
      expect(flagged([withCutAt(target + "x", 30)]).offsiteRefresh).toContain("account-check.example");
      expect(flagged([withCutAt("//account-check.example/x", 24)]).offsiteRefresh).toContain("account-check.example");
    });

    it("tells 2048 characters (read in full) from 2049 (cut)", () => {
      const exact = "0;" + " ".repeat(MAX_REFRESH_CONTENT - 2 - 4 - target.length) + "url=" + target;
      expect(exact).toHaveLength(MAX_REFRESH_CONTENT);
      expect(flagged([exact]).offsiteRefresh).toContain("different site: account-check.example");
      // One more character: the bound drops the final "/", leaving the host unended.
      expect(flagged([exact.replace("0;", "0; ")]).offsiteRefresh).toBe("Page refresh tags are too many or too long to check");
    });
  });
});

describe("Chrome's refresh delay grammar (#1241, probed in Chromium 143)", () => {
  const offsite = "https://account-check.example/";
  it.each(["1e0", "3e2", "+1", "-1", "0x1", "Infinity", "1e"])("%s never schedules, so it is not parsed", (delay) => {
    expect(parseRefreshContent(`${delay};url=${offsite}`)).toBeUndefined();
    expect(flagged([`${delay};url=${offsite}`]).offsiteRefresh).toBeUndefined();
  });

  it("truncates fractions: a later same-second declaration wins, as in Chrome", () => {
    // Observed: ["1.2;url=/a","1.9;url=/b"] and ["1.9;url=/a","1.2;url=/b"] both land on /b.
    expect(flagged([`300.1;url=${offsite}`, "300.9;url=/account"]).offsiteRefresh).toBeUndefined();
    expect(flagged(["300.9;url=/account", `300.1;url=${offsite}`]).offsiteRefresh).toBeDefined();
  });
});

describe("current domain forms (#1241)", () => {
  // flagged() pins the domain to shop.example, so these call analyzeSnapshot directly.
  function flaggedAt(domain: string, target: string) {
    return analyzeSnapshot(snapshot([`30;url=${target}`], { baseUrl: `https://${domain}/login` }), domain).offsiteRefresh;
  }

  it("compares IP-literal hosts exactly", () => {
    expect(flaggedAt("203.0.113.5", "https://203.0.113.5/next")).toBeUndefined();
    expect(flaggedAt("203.0.113.5", "https://203.0.113.9/next")).toContain("203.0.113.9");
    expect(flaggedAt("203.0.113.5", "https://sub.account-check.example/")).toContain("account-check.example");
  });

  it("compares IDN hosts in their punycode form", () => {
    // URL parsing punycodes a Unicode target, so it matches the (punycode) page host.
    expect(flaggedAt("xn--bcher-kva.example", "https://bücher.example/next")).toBeUndefined();
    expect(flaggedAt("xn--bcher-kva.example", "https://büchér.example/next")).toContain("xn--");
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
    expect(build(many).refreshContents).toHaveLength(MAX_REFRESH_METAS + 1);
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
