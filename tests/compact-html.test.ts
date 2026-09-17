import { describe, expect, it } from "vitest";
import { compactHtml } from "../scripts/compact-html.mjs";

describe("compactHtml", () => {
  it("removes non-semantic layout whitespace without changing text spacing", () => {
    const source = `<!doctype html>
      <main>
        <p>  A\n          sentence with <strong>inline</strong> text.  </p>
      </main>`;

    expect(compactHtml(source)).toBe(
      "<!doctype html> <main> <p> A sentence with <strong>inline</strong> text. </p> </main>",
    );
  });

  it("leaves raw text elements byte-for-byte intact", () => {
    const source = `<pre>  keep\n    this  </pre><script>const value = "  keep  ";</script><style>.x {  color: red; }</style>`;

    expect(compactHtml(source)).toBe(source);
  });

  it("uses HTML-safe compact spelling for simple attributes and void tags", () => {
    expect(compactHtml('<div id="panel" role="main"><input type="text" disabled="true" /></div>'))
      .toBe("<div id=panel role=main><input type=text disabled=true></div>");
  });

  it("can remove redundant bare same-origin crossorigin attributes", () => {
    expect(compactHtml(
      '<script type="module" crossorigin src="/assets/page.js"></script>',
      { stripCrossOrigin: true },
    )).toBe('<script type=module src="/assets/page.js"></script>');
  });

  it("removes comments while retaining the normalized text node", () => {
    const source = `<div><!-- build note -->\n  <section>content</section>\n</div>`;

    expect(compactHtml(source)).toBe("<div> <section>content</section> </div>");
  });
});
