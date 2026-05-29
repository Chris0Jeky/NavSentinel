// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { icon, logoSentinel } from "../extension/src/shared/icons";

describe("icon() accessibility", () => {
  it("includes aria-hidden on generated SVGs", () => {
    const svg = icon("shield", 16);
    expect(svg).toContain('aria-hidden="true"');
  });

  it("returns empty string for unknown icon names", () => {
    expect(icon("nonexistent")).toBe("");
  });

  it("generates valid SVG with expected attributes", () => {
    const svg = icon("key", 20, "red", 2);
    expect(svg).toContain('width="20"');
    expect(svg).toContain('height="20"');
    expect(svg).toContain('stroke="red"');
    expect(svg).toContain('stroke-width="2"');
  });

  it("aria-hidden is present for every known icon", () => {
    const names = [
      "shield", "key", "eye", "bolt", "block", "alert", "check", "x",
      "chevron", "gear", "clock", "download", "upload", "plus", "trash",
      "search", "filter", "chart", "list", "cube", "lock", "globe",
      "cursor", "layers", "activity", "rollback", "target", "tab",
    ];
    for (const name of names) {
      const svg = icon(name);
      expect(svg, `icon("${name}") missing aria-hidden`).toContain('aria-hidden="true"');
    }
  });
});

describe("logoSentinel() accessibility", () => {
  it("includes aria-hidden on generated logo SVG", () => {
    const svg = logoSentinel(40, false);
    expect(svg).toContain('aria-hidden="true"');
  });

  it("includes aria-hidden when animated", () => {
    const svg = logoSentinel(40, true);
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toContain("animateTransform");
  });

  it("generates valid SVG with expected size", () => {
    const svg = logoSentinel(56, false);
    expect(svg).toContain('width="56"');
    expect(svg).toContain('height="56"');
  });
});
