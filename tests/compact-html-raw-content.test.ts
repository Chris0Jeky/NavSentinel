import { describe, expect, it } from "vitest";
import { compactHtml } from "../scripts/compact-html.mjs";

const literalMarkup = '</p><div></option><option></head><body></body></html>';
const rawCases = [
  ["script", `const template = ${JSON.stringify(literalMarkup)};\n  // Keep this spacing.\n`],
  ["style", `.example::after { content: ${JSON.stringify(literalMarkup)}; }\n`],
  ["pre", `  first line\n    ${literalMarkup}\n  last line  `],
  ["textarea", `  first line\n    ${literalMarkup}\n  last line  `],
] as const;

describe("HTML compaction raw-content boundary", () => {
  it.each(rawCases)("preserves %s bodies through optional-end-tag stripping", (tag, body) => {
    const raw = `<${tag}>${body}</${tag}>`;
    expect(compactHtml(raw)).toBe(raw);
    expect(compactHtml(`<div>  before  </div>${raw}<div>  after  </div>`))
      .toBe(`<div>before</div>${raw}<div>after</div>`);
  });

  it.each(rawCases)("preserves the entire unterminated %s suffix", (tag, body) => {
    const suffix = `<${tag} data-note="keep quoted">${body}`;
    expect(compactHtml(`<div>  before  </div>${suffix}`))
      .toBe(`<div>before</div>${suffix}`);
  });

  it.each(rawCases)("does not leak the scanner cursor after an unclosed %s", (tag) => {
    compactHtml(`<div>${"prefix".repeat(20)}</div><${tag}>unterminated`);
    const next = '<pre>  Keep\n    these bytes  </pre>';
    expect(compactHtml(next)).toBe(next);
    expect(compactHtml(next)).toBe(next);
  });

  it("retains legal optional-end-tag compaction adjacent to a protected raw element", () => {
    expect(compactHtml('<p>before</p><pre>  raw\n bytes  </pre><p>after</p><div>end</div>'))
      .toBe('<p>before<pre>  raw\n bytes  </pre><p>after<div>end</div>');
  });
});
