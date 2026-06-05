// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  buildPageSnapshot,
  HTML_SNIPPET_MAX,
} from "../extension/src/content/content_analyzer";

// Guards the slice <-> HTML_SNIPPET_MAX coupling (D-REDOS R3 nit): the exfil
// htmlPatterns derive their {0,HTML_SNIPPET_MAX} bounds from the constant, and
// their zero-false-negative equivalence to the prior `*` only holds while the
// htmlSnippet slice is also bounded by that same constant. The coupling test in
// content-analyzer.test.ts asserts the regex<->constant link; this asserts the
// slice<->constant link, so a future edit that re-hardcoded the slice (e.g.
// slice(0, 5000)) while leaving the constant at 10000 would be caught here.
describe("buildPageSnapshot htmlSnippet cap", () => {
  it("caps htmlSnippet length at HTML_SNIPPET_MAX for oversized DOM", () => {
    document.documentElement.innerHTML = "x".repeat(HTML_SNIPPET_MAX + 5000);
    const snap = buildPageSnapshot(document);
    expect(snap.htmlSnippet.length).toBe(HTML_SNIPPET_MAX);
  });

  it("does not truncate a small DOM", () => {
    document.documentElement.innerHTML = "<form><input type=\"password\" /></form>";
    const snap = buildPageSnapshot(document);
    expect(snap.htmlSnippet.length).toBeLessThan(HTML_SNIPPET_MAX);
    expect(snap.htmlSnippet).toContain("password");
  });
});

describe("buildPageSnapshot credential-page gate (#196)", () => {
  it("flags a plain visible password field", () => {
    document.documentElement.innerHTML =
      "<head></head><body><form><input type=\"password\"></form></body>";
    expect(buildPageSnapshot(document).hasPasswordField).toBe(true);
  });

  it("does not flag an inline-hidden password field", () => {
    document.documentElement.innerHTML =
      "<head></head><body><form><input type=\"password\" style=\"display:none\"></form></body>";
    expect(buildPageSnapshot(document).hasPasswordField).toBe(false);
  });

  it("still flags a visible field carrying a decoy hiding substring (#196)", () => {
    // Pre-#196 the substring check matched "display:none" inside the unrelated
    // `content` property and wrongly cleared hasPasswordField on a real field.
    document.documentElement.innerHTML =
      "<head></head><body><form><input type=\"password\" style=\"content:'display:none'\"></form></body>";
    expect(buildPageSnapshot(document).hasPasswordField).toBe(true);
  });
});
