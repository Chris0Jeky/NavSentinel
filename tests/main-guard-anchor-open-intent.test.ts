import { describe, expect, it } from "vitest";
import { anchorOpenIntentFor, matchesAnchorOpenIntent } from "../extension/src/content/main_guard_helpers";

const BASE = "https://publisher.example/page";
const HREF = "https://www.youtube.com/watch?v=M7lc1UVf-VE&feature=emb";

describe("anchor open intent (#943)", () => {
  it("arms only for an http(s) link", () => {
    expect(anchorOpenIntentFor(HREF, 0, 1000)).toEqual({ origin: "https://www.youtube.com", pathname: "/watch", until: 1000 });
    expect(anchorOpenIntentFor("javascript:void(0)", 0, 1000)).toBeNull();
    expect(anchorOpenIntentFor("data:text/html,x", 0, 1000)).toBeNull();
    expect(anchorOpenIntentFor("not a url", 0, 1000)).toBeNull();
  });

  it("matches the link's own origin and path, whatever the query or fragment", () => {
    const intent = anchorOpenIntentFor(HREF, 0, 1000);
    expect(matchesAnchorOpenIntent(intent, 10, HREF, undefined, BASE)).toBe(true);
    expect(matchesAnchorOpenIntent(intent, 10, "https://www.youtube.com/watch?v=M7lc1UVf-VE", "_blank", BASE)).toBe(true);
    expect(matchesAnchorOpenIntent(intent, 10, "https://www.youtube.com/watch#t=5", "", BASE)).toBe(true);
    expect(matchesAnchorOpenIntent(intent, 10, "https://www.youtube.com/watch", " _BLANK ", BASE)).toBe(true);
  });

  it("refuses another destination", () => {
    const intent = anchorOpenIntentFor(HREF, 0, 1000);
    expect(matchesAnchorOpenIntent(intent, 10, "https://www.youtube.com/elsewhere", undefined, BASE)).toBe(false);
    expect(matchesAnchorOpenIntent(intent, 10, "https://ads.example/watch", undefined, BASE)).toBe(false);
    expect(matchesAnchorOpenIntent(intent, 10, "http://www.youtube.com/watch", undefined, BASE)).toBe(false);
    expect(matchesAnchorOpenIntent(intent, 10, "https://www.youtube.com:8443/watch", undefined, BASE)).toBe(false);
    // A relative URL resolves against the opener, not the link.
    expect(matchesAnchorOpenIntent(intent, 10, "/watch", undefined, BASE)).toBe(false);
  });

  it("refuses a target that could navigate an existing browsing context", () => {
    const intent = anchorOpenIntentFor(HREF, 0, 1000);
    for (const target of ["_top", "_self", "_parent", "sink", "player"]) {
      expect(matchesAnchorOpenIntent(intent, 10, HREF, target, BASE), target).toBe(false);
    }
  });

  it("refuses a missing or empty URL, an expired intent, and no intent", () => {
    const intent = anchorOpenIntentFor(HREF, 0, 1000);
    expect(matchesAnchorOpenIntent(intent, 10, undefined, undefined, BASE)).toBe(false);
    expect(matchesAnchorOpenIntent(intent, 10, "  ", undefined, BASE)).toBe(false);
    expect(matchesAnchorOpenIntent(intent, 1000, HREF, undefined, BASE)).toBe(true);
    expect(matchesAnchorOpenIntent(intent, 1001, HREF, undefined, BASE)).toBe(false);
    expect(matchesAnchorOpenIntent(null, 10, HREF, undefined, BASE)).toBe(false);
  });
});
