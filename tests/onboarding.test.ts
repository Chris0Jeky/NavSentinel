import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const HTML_PATH = resolve(__dirname, "../extension/src/onboarding/onboarding.html");
const TS_PATH = resolve(__dirname, "../extension/src/onboarding/onboarding.ts");
const CSS_PATH = resolve(__dirname, "../extension/src/onboarding/onboarding.css");

describe("onboarding page", () => {
  const html = readFileSync(HTML_PATH, "utf-8");

  it("onboarding HTML file exists and is non-empty", () => {
    expect(html.length).toBeGreaterThan(0);
  });

  it("contains the welcome section", () => {
    expect(html).toContain('data-section="welcome"');
    expect(html).toContain("NavSentinel");
    expect(html).toContain("Safe Browsing");
  });

  it("contains the how-it-works section with three cards", () => {
    expect(html).toContain('data-section="how-it-works"');
    expect(html).toContain("Monitors clicks");
    expect(html).toContain("Analyzes navigation");
    expect(html).toContain("Protects credentials");
  });

  it("contains the what-to-expect section with toast mockups", () => {
    expect(html).toContain('data-section="what-to-expect"');
    expect(html).toContain("toast-caution");
    expect(html).toContain("toast-blocked");
    expect(html).toContain("Caution");
    expect(html).toContain("Blocked");
  });

  it("contains the settings section with three modes", () => {
    expect(html).toContain('data-section="settings"');
    expect(html).toContain("mode-badge-smart");
    expect(html).toContain("mode-badge-strict");
    expect(html).toContain("mode-badge-off");
    expect(html).toContain("Smart");
    expect(html).toContain("Strict");
    expect(html).toContain("Off");
  });

  it("contains the get-started CTA section", () => {
    expect(html).toContain('data-section="cta"');
    expect(html).toContain('id="getStarted"');
    expect(html).toContain("Get started");
  });

  it("contains the options page link", () => {
    expect(html).toContain('id="openOptions"');
    expect(html).toContain("options page");
  });

  it("references the onboarding script and stylesheet", () => {
    expect(html).toContain('src="./onboarding.ts"');
    expect(html).toContain('href="./onboarding.css"');
  });

  it("has no external CDN or network URLs", () => {
    expect(html).not.toMatch(/https?:\/\/(?!example)/);
  });
});

describe("onboarding TypeScript module", () => {
  const ts = readFileSync(TS_PATH, "utf-8");

  it("TS file exists and is non-empty", () => {
    expect(ts.length).toBeGreaterThan(0);
  });

  it("handles the getStarted button", () => {
    expect(ts).toContain("getStarted");
    expect(ts).toContain("window.close");
  });

  it("handles the openOptions link", () => {
    expect(ts).toContain("openOptions");
    expect(ts).toContain("openOptionsPage");
  });
});

describe("onboarding CSS", () => {
  const css = readFileSync(CSS_PATH, "utf-8");

  it("CSS file exists and is non-empty", () => {
    expect(css.length).toBeGreaterThan(0);
  });

  it("uses the specified dark theme background", () => {
    expect(css).toMatch(/#0a0a0a|#1a1a1a/);
  });

  it("uses the extension color palette", () => {
    expect(css).toContain("#4ade80"); // green
    expect(css).toContain("#facc15"); // yellow
    expect(css).toContain("#f87171"); // red
  });
});
