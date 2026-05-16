// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from "vitest";
import { checkSRI, type SRIAnalysis } from "../extension/src/content/sri_checker";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PAGE_URL = "https://example.com/login";
const PAGE_ORIGIN = "https://example.com";
const EXTERNAL_ORIGIN = "https://cdn.external.com";

function makeDoc(html: string): Document {
  const parser = new DOMParser();
  return parser.parseFromString(html, "text/html");
}

function scriptTag(src: string, integrity?: string): string {
  const attr = integrity ? ` integrity="${integrity}"` : "";
  return `<script src="${src}"${attr}></script>`;
}

function linkTag(href: string, integrity?: string): string {
  const attr = integrity ? ` integrity="${integrity}"` : "";
  return `<link rel="stylesheet" href="${href}"${attr}>`;
}

function passwordField(): string {
  return '<input type="password" name="pw">';
}

function loginPage(head: string, body?: string): string {
  return `<!doctype html><html><head>${head}</head><body><form>${passwordField()}${body ?? ""}</form></body></html>`;
}

function nonCredentialPage(head: string): string {
  return `<!doctype html><html><head>${head}</head><body><form><input type="text"></form></body></html>`;
}

// ---------------------------------------------------------------------------
// Non-credential pages
// ---------------------------------------------------------------------------

describe("sri_checker - non-credential pages", () => {
  it("returns score 0 when no password field exists", () => {
    const doc = makeDoc(nonCredentialPage(
      scriptTag(`${EXTERNAL_ORIGIN}/app.js`)
    ));
    const result = checkSRI(doc, PAGE_URL, PAGE_ORIGIN);
    expect(result.score).toBe(0);
    expect(result.totalExternal).toBe(0);
    expect(result.reasons).toHaveLength(0);
  });

  it("does not scan resources on non-credential pages", () => {
    const doc = makeDoc(nonCredentialPage(
      scriptTag(`${EXTERNAL_ORIGIN}/a.js`) +
      scriptTag(`${EXTERNAL_ORIGIN}/b.js`) +
      linkTag(`${EXTERNAL_ORIGIN}/style.css`)
    ));
    const result = checkSRI(doc, PAGE_URL, PAGE_ORIGIN);
    expect(result.totalExternal).toBe(0);
    expect(result.withSRI).toBe(0);
    expect(result.withoutSRI).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Same-origin resources (should be excluded)
// ---------------------------------------------------------------------------

describe("sri_checker - same-origin exclusion", () => {
  it("excludes same-origin scripts from the check", () => {
    const doc = makeDoc(loginPage(
      scriptTag(`${PAGE_ORIGIN}/app.js`) +
      scriptTag("/local.js")
    ));
    const result = checkSRI(doc, PAGE_URL, PAGE_ORIGIN);
    expect(result.totalExternal).toBe(0);
    expect(result.score).toBe(0);
  });

  it("excludes relative scripts (same origin by definition)", () => {
    const doc = makeDoc(loginPage(
      scriptTag("./bundle.js") +
      scriptTag("assets/main.js")
    ));
    const result = checkSRI(doc, PAGE_URL, PAGE_ORIGIN);
    expect(result.totalExternal).toBe(0);
  });

  it("excludes same-origin stylesheets", () => {
    const doc = makeDoc(loginPage(
      linkTag(`${PAGE_ORIGIN}/style.css`) +
      linkTag("/theme.css")
    ));
    const result = checkSRI(doc, PAGE_URL, PAGE_ORIGIN);
    expect(result.totalExternal).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// External resources with full SRI coverage
// ---------------------------------------------------------------------------

describe("sri_checker - all SRI present", () => {
  it("returns negative score when all external resources have SRI", () => {
    const hash = "sha384-abc123";
    const doc = makeDoc(loginPage(
      scriptTag(`${EXTERNAL_ORIGIN}/lib.js`, hash) +
      linkTag(`${EXTERNAL_ORIGIN}/lib.css`, hash)
    ));
    const result = checkSRI(doc, PAGE_URL, PAGE_ORIGIN);
    expect(result.totalExternal).toBe(2);
    expect(result.withSRI).toBe(2);
    expect(result.withoutSRI).toBe(0);
    expect(result.score).toBe(-3);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("security-conscious");
  });
});

// ---------------------------------------------------------------------------
// External resources with no SRI
// ---------------------------------------------------------------------------

describe("sri_checker - no SRI present", () => {
  it("returns +8 when zero external resources have SRI", () => {
    const doc = makeDoc(loginPage(
      scriptTag(`${EXTERNAL_ORIGIN}/lib.js`) +
      scriptTag(`${EXTERNAL_ORIGIN}/analytics.js`) +
      linkTag(`${EXTERNAL_ORIGIN}/theme.css`)
    ));
    const result = checkSRI(doc, PAGE_URL, PAGE_ORIGIN);
    expect(result.totalExternal).toBe(3);
    expect(result.withSRI).toBe(0);
    expect(result.withoutSRI).toBe(3);
    expect(result.score).toBe(8);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toContain("None of 3");
  });
});

// ---------------------------------------------------------------------------
// Partial SRI coverage
// ---------------------------------------------------------------------------

describe("sri_checker - partial SRI coverage", () => {
  it("returns +5 when <50% have SRI (1/3)", () => {
    const hash = "sha384-abc123";
    const doc = makeDoc(loginPage(
      scriptTag(`${EXTERNAL_ORIGIN}/a.js`, hash) +
      scriptTag(`${EXTERNAL_ORIGIN}/b.js`) +
      scriptTag(`${EXTERNAL_ORIGIN}/c.js`)
    ));
    const result = checkSRI(doc, PAGE_URL, PAGE_ORIGIN);
    expect(result.totalExternal).toBe(3);
    expect(result.withSRI).toBe(1);
    expect(result.withoutSRI).toBe(2);
    expect(result.score).toBe(5);
    expect(result.reasons[0]).toContain("Only 1/3");
  });

  it("returns 0 when >=50% but <100% have SRI (2/3)", () => {
    const hash = "sha384-abc123";
    const doc = makeDoc(loginPage(
      scriptTag(`${EXTERNAL_ORIGIN}/a.js`, hash) +
      scriptTag(`${EXTERNAL_ORIGIN}/b.js`, hash) +
      scriptTag(`${EXTERNAL_ORIGIN}/c.js`)
    ));
    const result = checkSRI(doc, PAGE_URL, PAGE_ORIGIN);
    expect(result.totalExternal).toBe(3);
    expect(result.withSRI).toBe(2);
    expect(result.withoutSRI).toBe(1);
    expect(result.score).toBe(0);
    expect(result.reasons).toHaveLength(0);
  });

  it("returns +5 when exactly 50% have SRI (is not < 50%)", () => {
    const hash = "sha384-abc123";
    const doc = makeDoc(loginPage(
      scriptTag(`${EXTERNAL_ORIGIN}/a.js`, hash) +
      scriptTag(`${EXTERNAL_ORIGIN}/b.js`)
    ));
    const result = checkSRI(doc, PAGE_URL, PAGE_ORIGIN);
    expect(result.totalExternal).toBe(2);
    expect(result.withSRI).toBe(1);
    expect(result.withoutSRI).toBe(1);
    // 1/2 = 0.5, which is NOT < 0.5, so no score modifier
    expect(result.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("sri_checker - edge cases", () => {
  it("ignores inline scripts (no src attribute)", () => {
    const doc = makeDoc(loginPage(
      "<script>console.log('inline')</script>"
    ));
    const result = checkSRI(doc, PAGE_URL, PAGE_ORIGIN);
    expect(result.totalExternal).toBe(0);
  });

  it("ignores data: URIs", () => {
    const doc = makeDoc(loginPage(
      scriptTag("data:text/javascript,alert(1)")
    ));
    const result = checkSRI(doc, PAGE_URL, PAGE_ORIGIN);
    expect(result.totalExternal).toBe(0);
  });

  it("ignores blob: URLs", () => {
    const doc = makeDoc(loginPage(
      scriptTag("blob:https://example.com/abc-123")
    ));
    const result = checkSRI(doc, PAGE_URL, PAGE_ORIGIN);
    expect(result.totalExternal).toBe(0);
  });

  it("ignores javascript: URIs in script src", () => {
    const doc = makeDoc(loginPage(
      scriptTag("javascript:void(0)")
    ));
    const result = checkSRI(doc, PAGE_URL, PAGE_ORIGIN);
    expect(result.totalExternal).toBe(0);
  });

  it("treats empty integrity attribute as missing", () => {
    const doc = makeDoc(loginPage(
      scriptTag(`${EXTERNAL_ORIGIN}/lib.js`, "")
    ));
    const result = checkSRI(doc, PAGE_URL, PAGE_ORIGIN);
    expect(result.totalExternal).toBe(1);
    expect(result.withSRI).toBe(0);
    expect(result.withoutSRI).toBe(1);
    expect(result.score).toBe(8);
  });

  it("treats whitespace-only integrity attribute as missing", () => {
    const doc = makeDoc(loginPage(
      scriptTag(`${EXTERNAL_ORIGIN}/lib.js`, "   ")
    ));
    const result = checkSRI(doc, PAGE_URL, PAGE_ORIGIN);
    expect(result.withSRI).toBe(0);
    expect(result.withoutSRI).toBe(1);
  });

  it("handles page with password field but no external resources", () => {
    const doc = makeDoc(loginPage(""));
    const result = checkSRI(doc, PAGE_URL, PAGE_ORIGIN);
    expect(result.totalExternal).toBe(0);
    expect(result.score).toBe(0);
    expect(result.reasons).toHaveLength(0);
  });

  it("handles disabled password field (not a credential page)", () => {
    const doc = makeDoc(
      `<!doctype html><html><head>${scriptTag(`${EXTERNAL_ORIGIN}/lib.js`)}</head>` +
      `<body><form><input type="password" disabled></form></body></html>`
    );
    const result = checkSRI(doc, PAGE_URL, PAGE_ORIGIN);
    expect(result.totalExternal).toBe(0);
    expect(result.score).toBe(0);
  });

  it("handles mix of external scripts and stylesheets", () => {
    const doc = makeDoc(loginPage(
      scriptTag(`${EXTERNAL_ORIGIN}/app.js`) +
      linkTag(`${EXTERNAL_ORIGIN}/style.css`) +
      scriptTag(`${PAGE_ORIGIN}/local.js`) +
      linkTag(`${PAGE_ORIGIN}/local.css`)
    ));
    const result = checkSRI(doc, PAGE_URL, PAGE_ORIGIN);
    // Only the 2 external resources should be counted
    expect(result.totalExternal).toBe(2);
    expect(result.withoutSRI).toBe(2);
    expect(result.score).toBe(8);
  });

  it("counts stylesheets and scripts separately but sums correctly", () => {
    const hash = "sha256-xyz";
    const doc = makeDoc(loginPage(
      scriptTag(`${EXTERNAL_ORIGIN}/a.js`, hash) +
      linkTag(`${EXTERNAL_ORIGIN}/b.css`)
    ));
    const result = checkSRI(doc, PAGE_URL, PAGE_ORIGIN);
    expect(result.totalExternal).toBe(2);
    expect(result.withSRI).toBe(1);
    expect(result.withoutSRI).toBe(1);
    // 1/2 = 50%, neutral
    expect(result.score).toBe(0);
  });

  it("ignores link elements that are not stylesheets", () => {
    const doc = makeDoc(loginPage(
      '<link rel="icon" href="' + EXTERNAL_ORIGIN + '/favicon.ico">' +
      '<link rel="preconnect" href="' + EXTERNAL_ORIGIN + '">'
    ));
    const result = checkSRI(doc, PAGE_URL, PAGE_ORIGIN);
    expect(result.totalExternal).toBe(0);
  });

  it("handles multiple external origins", () => {
    const doc = makeDoc(loginPage(
      scriptTag("https://cdn1.example.net/a.js") +
      scriptTag("https://cdn2.example.org/b.js") +
      scriptTag(`${EXTERNAL_ORIGIN}/c.js`)
    ));
    const result = checkSRI(doc, PAGE_URL, PAGE_ORIGIN);
    expect(result.totalExternal).toBe(3);
    expect(result.withoutSRI).toBe(3);
    expect(result.score).toBe(8);
  });

  it("matches stylesheet with rel='stylesheet alternate'", () => {
    const doc = makeDoc(loginPage(
      '<link rel="stylesheet alternate" href="' + EXTERNAL_ORIGIN + '/theme.css">'
    ));
    const result = checkSRI(doc, PAGE_URL, PAGE_ORIGIN);
    expect(result.totalExternal).toBe(1);
    expect(result.withoutSRI).toBe(1);
  });
});
