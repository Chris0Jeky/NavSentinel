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

  it("contains the welcome hero section", () => {
    expect(html).toContain("NavSentinel");
    expect(html).toContain("Safe Browsing");
    expect(html).toContain("hero");
  });

  it("contains the how-it-works section with three feature cards", () => {
    expect(html).toContain("Detection layers");
    expect(html).toContain("Monitors clicks");
    expect(html).toContain("Analyzes navigation");
    expect(html).toContain("Protects credentials");
  });

  it("contains the what-to-expect section with toast mockups", () => {
    expect(html).toContain("Notifications");
    expect(html).toContain("toast-mock--warn");
    expect(html).toContain("toast-mock--block");
    expect(html).toContain("Caution");
    expect(html).toContain("Blocked");
  });

  it("contains the protection modes section with three modes", () => {
    expect(html).toContain("Protection modes");
    expect(html).toContain("mode-badge--green");
    expect(html).toContain("mode-badge--amber");
    expect(html).toContain("mode-badge--muted");
    expect(html).toContain("Smart");
    expect(html).toContain("Strict");
    expect(html).toContain("Off");
  });

  it("contains the get-started CTA section", () => {
    expect(html).toContain('id="getStarted"');
    expect(html).toContain("Get started");
  });

  it("contains the options page link", () => {
    expect(html).toContain('id="openOptions"');
    expect(html).toContain("options dashboard");
  });

  it("references the onboarding script and stylesheet", () => {
    expect(html).toContain('src="./onboarding.ts"');
    expect(html).toContain('href="./onboarding.css"');
  });

  it("references the design tokens stylesheet", () => {
    expect(html).toContain("design_tokens.css");
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

  it("imports icons from the shared icon system", () => {
    expect(ts).toContain("logoSentinel");
    expect(ts).toContain("icon");
  });
});

describe("onboarding CSS", () => {
  const css = readFileSync(CSS_PATH, "utf-8");

  it("CSS file exists and is non-empty", () => {
    expect(css.length).toBeGreaterThan(0);
  });

  it("uses dark theme background colors from design tokens", () => {
    expect(css).toMatch(/#08070a|#030206/);
  });

  it("uses the brass/jade color palette", () => {
    expect(css).toContain("ns-cyan");
    expect(css).toContain("ns-green");
    expect(css).toContain("ns-red");
  });
});
