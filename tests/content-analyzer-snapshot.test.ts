// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  boundedSample,
  buildPageSnapshot,
  HTML_SNIPPET_MAX,
  MAX_IMG_ATTR,
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

describe("boundedSample", () => {
  it("returns the input unchanged when within max", () => {
    expect(boundedSample("hello", 10)).toBe("hello");
  });

  it("keeps the head and the tail when over max, dropping the middle", () => {
    const s = "HEAD" + "x".repeat(100) + "TAIL";
    const out = boundedSample(s, 8);
    expect(out).toContain("HEAD");
    expect(out).toContain("TAIL");
    expect(out).not.toContain("xxxxx");
    expect(out.length).toBeLessThanOrEqual(9);
  });
});

describe("buildPageSnapshot title cap (#401)", () => {
  it("bounds an oversized title to ~MAX_TITLE_LEN chars", () => {
    document.documentElement.innerHTML = "<head></head><body></body>";
    document.title = "x".repeat(MAX_TITLE_LEN + 500);
    expect(buildPageSnapshot(document).title.length).toBeLessThanOrEqual(MAX_TITLE_LEN + 1);
  });

  it("keeps the title tail so a front-padded hostile title can't hide the brand", () => {
    document.documentElement.innerHTML = "<head></head><body></body>";
    // Brand/login terms after MAX_TITLE_LEN of padding -- a head-only cap would
    // drop them (a content-fingerprinting evasion; flagged by Codex on #403).
    document.title = "x".repeat(MAX_TITLE_LEN * 2) + " PayPal Login";
    const snap = buildPageSnapshot(document);
    expect(snap.title).toContain("paypal");
    expect(snap.title).toContain("login");
  });

  it("does not truncate a normal title and still lowercases it", () => {
    document.documentElement.innerHTML = "<head></head><body></body>";
    document.title = "PayPal Login";
    expect(buildPageSnapshot(document).title).toBe("paypal login");
  });
});

describe("buildPageSnapshot imgSignals cap (#401)", () => {
  it("bounds a single multi-MB data-URI src but keeps the alt brand keyword", () => {
    const bigSrc = "data:image/png;base64," + "a".repeat(MAX_IMG_ATTR * 20);
    document.documentElement.innerHTML =
      `<body><img alt="paypal" src="${bigSrc}"></body>`;
    const snap = buildPageSnapshot(document);
    // The huge src is reduced to ~MAX_IMG_ATTR chars, far below the original.
    expect(snap.imgSignals.length).toBeLessThan(2 * MAX_IMG_ATTR + 64);
    expect(snap.imgSignals).toContain("paypal");
  });

  it("head+tail samples a long src: keeps leading domain + trailing filename, drops the middle", () => {
    const src = "https://paypal-cdn.test/" + "z".repeat(MAX_IMG_ATTR * 4) +
      "MIDDLEX" + "z".repeat(MAX_IMG_ATTR * 4) + "/logo-paypal.png";
    document.documentElement.innerHTML =
      `<body><img alt="logo" src="${src}"></body>`;
    const snap = buildPageSnapshot(document);
    expect(snap.imgSignals).toContain("paypal-cdn");   // head
    expect(snap.imgSignals).toContain("logo-paypal");  // tail (a head-only cap would drop this)
    expect(snap.imgSignals).not.toContain("middlex");  // omitted middle
  });

  it("retains every image's signal regardless of count/order (no ordering drop)", () => {
    let html = "<body>";
    for (let i = 0; i < 50; i++) {
      html += `<img alt="brand${i}" src="https://cdn.example.com/${"p".repeat(600)}.png">`;
    }
    html += "</body>";
    document.documentElement.innerHTML = html;
    const snap = buildPageSnapshot(document);
    // Both the first and a late image contribute -- a late brand logo is never
    // dropped (guards against re-introducing a truncating total cap).
    expect(snap.imgSignals).toContain("brand0");
    expect(snap.imgSignals).toContain("brand49");
    // Total stays bounded by the per-attribute sample x the 50-image limit.
    expect(snap.imgSignals.length).toBeLessThanOrEqual(50 * (2 * (MAX_IMG_ATTR + 1) + 2));
  });

  it("does not truncate a small set of images and preserves brand keywords", () => {
    document.documentElement.innerHTML =
      `<body><img alt="Google logo" src="https://cdn.test/google.png"></body>`;
    const snap = buildPageSnapshot(document);
    expect(snap.imgSignals).toContain("google");
  });
});
