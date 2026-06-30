// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  buildPageSnapshot,
  HTML_SNIPPET_MAX,
  MAX_IMG_SIGNALS,
  MAX_TITLE_LEN,
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

  it("still flags a field with a CSS-invalid multi-token value (#196 R1)", () => {
    // `display:none none` is invalid CSS -> dropped by the engine -> visible.
    document.documentElement.innerHTML =
      "<head></head><body><form><input type=\"password\" style=\"display:none none\"></form></body>";
    expect(buildPageSnapshot(document).hasPasswordField).toBe(true);
  });
});

describe("buildPageSnapshot title cap (#401)", () => {
  it("caps title length at MAX_TITLE_LEN for an oversized title", () => {
    document.documentElement.innerHTML = "<head></head><body></body>";
    document.title = "x".repeat(MAX_TITLE_LEN + 500);
    expect(buildPageSnapshot(document).title.length).toBe(MAX_TITLE_LEN);
  });

  it("does not truncate a normal title and still lowercases it", () => {
    document.documentElement.innerHTML = "<head></head><body></body>";
    document.title = "PayPal Login";
    expect(buildPageSnapshot(document).title).toBe("paypal login");
  });
});

describe("buildPageSnapshot imgSignals cap (#401)", () => {
  it("truncates a single multi-MB data-URI src but keeps the alt brand keyword", () => {
    const bigSrc = "data:image/png;base64," + "a".repeat(MAX_IMG_SIGNALS * 4);
    document.documentElement.innerHTML =
      `<body><img alt="paypal" src="${bigSrc}"></body>`;
    const snap = buildPageSnapshot(document);
    // Per-attribute cap keeps a lone huge src far below the multi-MB original.
    expect(snap.imgSignals.length).toBeLessThan(2000);
    expect(snap.imgSignals).toContain("paypal");
  });

  it("caps the total imgSignals length across many images", () => {
    let html = "<body>";
    for (let i = 0; i < 50; i++) {
      html += `<img alt="brand${i}" src="https://cdn.example.com/${"p".repeat(600)}.png">`;
    }
    html += "</body>";
    document.documentElement.innerHTML = html;
    expect(buildPageSnapshot(document).imgSignals.length).toBe(MAX_IMG_SIGNALS);
  });

  it("does not truncate a small set of images and preserves brand keywords", () => {
    document.documentElement.innerHTML =
      `<body><img alt="Google logo" src="https://cdn.test/google.png"></body>`;
    const snap = buildPageSnapshot(document);
    expect(snap.imgSignals.length).toBeLessThan(MAX_IMG_SIGNALS);
    expect(snap.imgSignals).toContain("google");
  });
});
