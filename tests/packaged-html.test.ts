// @vitest-environment happy-dom

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error Build helpers are plain ESM and intentionally ship without runtime TypeScript.
import { compactKnownOptionsHtml } from "../scripts/packaged-html.mjs";

const OPTIONS_PATH = "options/options.html";
const SAFE_STYLES = new Map([
  ["/assets/tokens-test.css", ":root{color-scheme:dark}.label{white-space:normal}"],
  ["/assets/options-test.css", ".row{display:flex}.value{white-space:nowrap}"],
]);

function optionsDocument(body: string, script = '<script type="module" crossorigin src="/assets/options.html-test.js"></script>'): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <link rel="stylesheet" href="/assets/tokens-test.css">
    <link rel="stylesheet" href="/assets/options-test.css">
  </head>
  <body>
    ${body}
    ${script}
  </body>
</html>
`;
}

function semanticSnapshot(html: string): unknown {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  return Array.from(parsed.querySelectorAll("*")).map((element) => ({
    tag: element.tagName,
    attributes: Array.from(element.attributes)
      .map(({ name, value }): [string, string] => [name, value])
      .sort(([left], [right]) => left.localeCompare(right)),
    text: (element.textContent ?? "").replace(/\s+/g, " ").trim(),
  }));
}

describe("known Options artifact HTML compaction", () => {
  it("preserves the real page's structure, attributes, and text", () => {
    const source = fs.readFileSync(path.resolve("extension/src/options/options.html"), "utf8")
      .replace(/\r\n?/g, "\n")
      .replace(/<!--(?!\[if\b)[\s\S]*?-->/gi, "")
      .replace(
        '<link rel="stylesheet" href="../shared/design_tokens.css" />',
        '<link rel="stylesheet" href="/assets/tokens-test.css">',
      )
      .replace(
        '<link rel="stylesheet" href="./options.css" />',
        '<link rel="stylesheet" href="/assets/options-test.css">',
      )
      .replace(
        '<script type="module" src="./options.ts"></script>',
        '<script type="module" crossorigin src="/assets/options.html-test.js"></script>',
      );

    const compacted = compactKnownOptionsHtml(OPTIONS_PATH, source, SAFE_STYLES);
    expect(Buffer.byteLength(source) - Buffer.byteLength(compacted)).toBeGreaterThan(4_000);
    expect(semanticSnapshot(compacted)).toEqual(semanticSnapshot(source));
  });

  it.each([
    ["pre", "<pre>\r\n  <span>x</span>\r\n</pre>"],
    ["textarea", "<textarea>\r\n  <span>x</span>\r\n</textarea>"],
    ["script", "<script>\r\n  const x = '<span>x</span><!--keep-->';\r\n</script>"],
    ["style", "<style>\r\n  .x::before { content: '<span>x</span>'; }\r\n</style>"],
  ])("leaves %s content byte-for-byte unchanged", (_name, fragment) => {
    const html = optionsDocument(fragment);
    expect(compactKnownOptionsHtml(OPTIONS_PATH, html, SAFE_STYLES)).toBe(html);
  });

  it.each([
    ["inline style", '<div style="white-space:pre">\n  <span>x</span>\n</div>'],
    ["XML whitespace", '<div xml:space="preserve">\n  <span>x</span>\n</div>'],
  ])("leaves %s markup byte-for-byte unchanged", (_name, fragment) => {
    const html = optionsDocument(fragment);
    expect(compactKnownOptionsHtml(OPTIONS_PATH, html, SAFE_STYLES)).toBe(html);
  });

  it.each([
    "white-space:pre",
    "white-space:pre-wrap",
    "white-space:break-spaces",
    "white-space:inherit",
    "white-space:var(--mode)",
    "white-space-collapse:preserve",
    "@import url('/assets/more.css')",
    ".broken{display:block",
  ])("leaves HTML unchanged when CSS is unsafe or unresolved: %s", (css) => {
    const html = optionsDocument("<div>\n      <span>x</span>\n    </div>");
    const styles = new Map(SAFE_STYLES);
    styles.set("/assets/options-test.css", css);
    expect(compactKnownOptionsHtml(OPTIONS_PATH, html, styles)).toBe(html);
  });

  it("leaves HTML unchanged when a linked stylesheet is missing or malformed", () => {
    const missing = optionsDocument("<div>\n      <span>x</span>\n    </div>");
    expect(compactKnownOptionsHtml(OPTIONS_PATH, missing, new Map())).toBe(missing);

    const malformed = missing.replace(
      'href="/assets/options-test.css"',
      "href=/assets/options-test.css",
    );
    expect(compactKnownOptionsHtml(OPTIONS_PATH, malformed, SAFE_STYLES)).toBe(malformed);
  });

  it.each([
    ["inline", "<script>const x = 1;</script>"],
    ["nonempty external", '<script type="module" crossorigin src="/assets/options.html-test.js"> </script>'],
    ["unexpected external", '<script type="module" src="/assets/other.js"></script>'],
  ])("leaves HTML unchanged for an %s script", (_name, script) => {
    const html = optionsDocument("<div>\n      <span>x</span>\n    </div>", script);
    expect(compactKnownOptionsHtml(OPTIONS_PATH, html, SAFE_STYLES)).toBe(html);
  });

  it("never compacts another extension page", () => {
    const html = optionsDocument("<div>\n      <span>x</span>\n    </div>");
    expect(compactKnownOptionsHtml("popup/popup.html", html, SAFE_STYLES)).toBe(html);
  });
});
