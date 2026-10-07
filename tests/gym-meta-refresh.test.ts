// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { analyzePageContent } from "../extension/src/content/content_analyzer";
import { getRegistrableDomain } from "../extension/src/shared/domain";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function load(name: string): Document {
  return new DOMParser().parseFromString(readFileSync(resolve(root, "gym", name), "utf8"), "text/html");
}

function assess(name: string) {
  const doc = load(name);
  const href = doc.querySelector('link[rel="canonical"]')?.getAttribute("href");
  if (!href) throw new Error("fixture missing canonical");
  const domain = getRegistrableDomain(new URL(href).hostname);
  return analyzePageContent(doc, domain);
}

describe("gym/meta-refresh-offsite.html and gym/meta-refresh-samesite.html", () => {
  it("treats gym/meta-refresh-offsite.html as deceptive and gym/meta-refresh-samesite.html as not", () => {
    const attack = assess("meta-refresh-offsite.html");
    const benign = assess("meta-refresh-samesite.html");
    const mentionsRefresh = (reason: string) => /meta refresh/i.test(reason);

    expect(attack.reasons.some(mentionsRefresh)).toBe(true);
    expect(attack.score).toBeGreaterThan(benign.score);
    expect(benign.reasons.some(mentionsRefresh)).toBe(false);
    expect(benign.score).toBe(0);
  });
});
