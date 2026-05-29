import { describe, expect, it } from "vitest";
import { icon, logoSentinel } from "../extension/src/shared/icons";

describe("icon", () => {
  it("returns an SVG string for a known icon name", () => {
    const svg = icon("shield");
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).toContain("<path");
  });

  it("returns empty string for unknown icon name", () => {
    expect(icon("nonexistent")).toBe("");
  });

  it("returns empty string for empty string name", () => {
    expect(icon("")).toBe("");
  });

  it("applies default size of 16", () => {
    const svg = icon("shield");
    expect(svg).toContain('width="16"');
    expect(svg).toContain('height="16"');
  });

  it("applies custom size", () => {
    const svg = icon("shield", 24);
    expect(svg).toContain('width="24"');
    expect(svg).toContain('height="24"');
  });

  it("applies custom stroke color", () => {
    const svg = icon("shield", 16, "red");
    expect(svg).toContain('stroke="red"');
  });

  it("uses currentColor as default stroke", () => {
    const svg = icon("shield");
    expect(svg).toContain('stroke="currentColor"');
  });

  it("applies custom stroke width", () => {
    const svg = icon("shield", 16, "currentColor", 2.5);
    expect(svg).toContain('stroke-width="2.5"');
  });

  it("uses 1.6 as default stroke width", () => {
    const svg = icon("shield");
    expect(svg).toContain('stroke-width="1.6"');
  });

  it("always uses 0 0 24 24 viewBox", () => {
    const svg = icon("key");
    expect(svg).toContain('viewBox="0 0 24 24"');
  });

  it("sets fill to none", () => {
    const svg = icon("shield");
    expect(svg).toContain('fill="none"');
  });

  it("includes stroke-linecap and stroke-linejoin", () => {
    const svg = icon("shield");
    expect(svg).toContain('stroke-linecap="round"');
    expect(svg).toContain('stroke-linejoin="round"');
  });

  it("includes inline display style", () => {
    const svg = icon("shield");
    expect(svg).toContain("display:block");
    expect(svg).toContain("flex-shrink:0");
  });

  it("accepts CSS variable as stroke color", () => {
    const svg = icon("lock", 12, "var(--ns-green)");
    expect(svg).toContain('stroke="var(--ns-green)"');
    expect(svg).toContain('width="12"');
  });

  it("renders different path content for different icons", () => {
    const shield = icon("shield");
    const key = icon("key");
    expect(shield).not.toBe(key);
    expect(key).toContain("<circle");
  });

  it("renders all documented icon names", () => {
    const names = [
      "shield", "key", "eye", "bolt", "block", "alert", "check", "x",
      "chevron", "gear", "clock", "download", "upload", "plus", "trash",
      "search", "filter", "chart", "list", "cube", "lock", "globe",
      "cursor", "layers", "activity", "rollback", "target", "tab",
    ];
    for (const name of names) {
      const svg = icon(name);
      expect(svg, `icon("${name}") should return non-empty SVG`).toContain("<svg");
    }
  });
});

describe("logoSentinel", () => {
  it("returns an SVG string", () => {
    const svg = logoSentinel();
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });

  it("applies default size of 40", () => {
    const svg = logoSentinel();
    expect(svg).toContain('width="40"');
    expect(svg).toContain('height="40"');
  });

  it("applies custom size", () => {
    const svg = logoSentinel(30);
    expect(svg).toContain('width="30"');
    expect(svg).toContain('height="30"');
  });

  it("uses 0 0 40 40 viewBox", () => {
    const svg = logoSentinel();
    expect(svg).toContain('viewBox="0 0 40 40"');
  });

  it("includes animation with correct parameters by default", () => {
    const svg = logoSentinel();
    expect(svg).toContain("animateTransform");
    expect(svg).toContain('from="0 20 20"');
    expect(svg).toContain('to="360 20 20"');
    expect(svg).toContain('dur="3.6s"');
    expect(svg).toContain('repeatCount="indefinite"');
  });

  it("excludes animation when animated=false", () => {
    const svg = logoSentinel(40, false);
    expect(svg).not.toContain("animateTransform");
  });

  it("includes gradient definitions", () => {
    const svg = logoSentinel();
    expect(svg).toContain("<defs>");
    expect(svg).toContain("linearGradient");
    expect(svg).toContain("radialGradient");
  });

  it("generates unique gradient IDs per call", () => {
    const svg1 = logoSentinel();
    const svg2 = logoSentinel();
    const extractIds = (svg: string) => {
      const matches = svg.match(/id="(ns-\d+)/g) ?? [];
      return matches.map((m) => m.replace('id="', ""));
    };
    const ids1 = extractIds(svg1);
    const ids2 = extractIds(svg2);
    expect(ids1.length).toBeGreaterThan(0);
    for (const id of ids1) {
      expect(ids2).not.toContain(id);
    }
  });

  it("includes the green status dot", () => {
    const svg = logoSentinel();
    expect(svg).toContain('fill="#7ab787"');
  });

  it("includes radar blades", () => {
    const svg = logoSentinel();
    expect(svg).toContain('rotate(0 20 20)');
    expect(svg).toContain('rotate(60 20 20)');
    expect(svg).toContain('rotate(120 20 20)');
  });

  it("includes concentric circles", () => {
    const svg = logoSentinel();
    expect(svg).toContain('r="15.5"');
    expect(svg).toContain('r="12"');
    expect(svg).toContain('r="7.5"');
  });

  it("gradient url() references match defined ids", () => {
    const svg = logoSentinel();
    const urlRefs = svg.match(/url\(#([^)]+)\)/g) ?? [];
    const refIds = urlRefs.map((u) => u.replace("url(#", "").replace(")", ""));
    const definedIds = (svg.match(/id="([^"]+)"/g) ?? []).map((m) => m.replace('id="', "").replace('"', ""));
    expect(refIds.length).toBeGreaterThan(0);
    for (const ref of refIds) {
      expect(definedIds, `url(#${ref}) should reference a defined id`).toContain(ref);
    }
  });
});

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
