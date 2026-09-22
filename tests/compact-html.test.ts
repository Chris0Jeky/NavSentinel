import { describe, expect, it } from "vitest";
import { compactHtml } from "../scripts/compact-html.mjs";

describe("compactHtml", () => {
  it("removes structural layout whitespace without changing text spacing", () => {
    const source = `<!doctype html>
      <main>
        <p>  A\n          sentence with <strong>inline</strong> text.  </p>
      </main>`;

    expect(compactHtml(source)).toBe(
      "<!doctype html><main><p>A sentence with <strong>inline</strong> text.</main>",
    );
  });

  it("preserves meaningful whitespace between inline elements", () => {
    const source = `<span>One</span>\n  <span>two</span> <a href="/next">next</a>`;

    expect(compactHtml(source)).toBe("<span>One</span> <span>two</span> <a href=/next>next</a>");
  });

  it("leaves raw text elements byte-for-byte intact", () => {
    const source = `<pre>  keep\n    this  </pre><script>const value = "  keep  ";</script><style>.x {  color: red; }</style>`;

    expect(compactHtml(source)).toBe(source);
  });

  it("uses HTML-safe compact spelling for attributes and void tags", () => {
    expect(compactHtml('<a href="/local/path#part">Open</a><input type="text" disabled="true" />'))
      .toBe("<a href=/local/path#part>Open</a><input type=text disabled=true>");
  });

  it("omits HTML end tags only where the parser defines them as optional", () => {
    const source = `<!doctype html><html lang="en"><head><title>Page</title></head><body>
      <select><option value="one">One</option><option value="two">Two</option></select>
      <p>Copy</p>
    </body></html>`;

    expect(compactHtml(source)).toBe(
      "<!doctype html><html lang=en><head><title>Page</title><select><option value=one>One<option value=two>Two</select><p>Copy",
    );
  });

  it("can remove redundant bare same-origin crossorigin attributes", () => {
    expect(compactHtml(
      '<script type="module" crossorigin src="/assets/page.js"></script>',
      { stripCrossOrigin: true },
    )).toBe("<script type=module src=/assets/page.js></script>");
  });

  it("removes comments and their structural layout whitespace", () => {
    const source = `<div><!-- build note -->\n  <section>content</section>\n</div>`;

    expect(compactHtml(source)).toBe("<div><section>content</section></div>");
  });
});
