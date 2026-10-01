// @vitest-environment happy-dom
// #980: popup needs a real h1; the evidence h1 must expose a spaced
// accessible name ("Your browsing. A clearer picture.") for screen readers.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const accessibleName = (element: Element): string =>
  (element.textContent ?? "").replace(/\s+/g, " ").trim();

const parse = (page: string): Document =>
  new DOMParser().parseFromString(
    readFileSync(resolve(`extension/src/${page}`), "utf8"),
    "text/html",
  );

describe("popup heading (#980)", () => {
  it("exposes the brand title as a single compact h1", () => {
    const headings = parse("popup/popup.html").querySelectorAll("h1");
    expect(headings).toHaveLength(1);
    const h1 = headings[0]!;
    expect(h1.classList.contains("hero-title")).toBe(true);
    expect(h1.classList.contains("ns-serif")).toBe(true);
    expect(accessibleName(h1)).toBe("Heedline");
  });
});

describe("evidence heading (#980)", () => {
  it("reads 'Your browsing. A clearer picture.' with a space for screen readers", () => {
    const headings = parse("evidence/evidence.html").querySelectorAll("h1");
    expect(headings).toHaveLength(1);
    expect(accessibleName(headings[0]!)).toBe("Your browsing. A clearer picture.");
  });
});
