import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * WCAG 2.1 AA (1.4.3) text-contrast guard for the popup signal chips (#274).
 *
 * The chips render reason-code text in a category colour over a very-low-opacity
 * tinted background, so their effective contrast depends on what is *behind* the
 * chip, not just on the two declared colours. This test reconstructs the real
 * popup paint stack from the shipped CSS, composites it, and asserts every
 * `.signal-chip--*` variant clears 4.5:1.
 *
 * The variants are enumerated from `popup.css` rather than hard-coded, so a new
 * chip category added later is covered automatically.
 *
 * Chip font-size is 9.5px, i.e. normal text — the 3:1 "large text" allowance
 * does not apply.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POPUP_CSS = readFileSync(
  path.resolve(__dirname, "..", "extension", "src", "popup", "popup.css"),
  "utf8",
);
const TOKENS_CSS = readFileSync(
  path.resolve(__dirname, "..", "extension", "src", "shared", "design_tokens.css"),
  "utf8",
);

const AA_NORMAL_TEXT = 4.5;

type Rgba = readonly [number, number, number, number];

// ---------------------------------------------------------------- colour math

function srgbToLinear(channel8Bit: number): number {
  const s = channel8Bit / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG 2.1 relative luminance. Alpha is ignored — composite first. */
function relativeLuminance([r, g, b]: Rgba): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(a: Rgba, b: Rgba): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Paint `src` over an opaque `dst` (simple source-over). */
function over(src: Rgba, dst: Rgba): Rgba {
  const a = src[3];
  return [
    a * src[0] + (1 - a) * dst[0],
    a * src[1] + (1 - a) * dst[1],
    a * src[2] + (1 - a) * dst[2],
    1,
  ];
}

/** Source-over of two translucent layers (`top` painted onto `bottom`). */
function stack(top: Rgba, bottom: Rgba): Rgba {
  const outAlpha = top[3] + bottom[3] * (1 - top[3]);
  if (outAlpha === 0) return [0, 0, 0, 0];
  const mix = (t: number, b: number): number =>
    (t * top[3] + b * bottom[3] * (1 - top[3])) / outAlpha;
  return [mix(top[0], bottom[0]), mix(top[1], bottom[1]), mix(top[2], bottom[2]), outAlpha];
}

/** Composite CSS background layers, where the first-listed layer is painted on top. */
function compositeCssBackgrounds(layers: readonly Rgba[]): Rgba {
  if (layers.length === 0) return [0, 0, 0, 0];
  return layers.reduceRight((bottom, top) => stack(top, bottom));
}

function withAlpha(color: Rgba, alpha: number): Rgba {
  return [color[0], color[1], color[2], alpha];
}

// ------------------------------------------------------------------- CSS read

/** Required capture group — a miss means the CSS drifted, so fail loudly. */
function group(match: RegExpMatchArray, index: number): string {
  const value = match[index];
  if (value === undefined) throw new Error(`capture group ${index} did not match`);
  return value;
}

/** All `--ns-*` custom properties declared in the design-token sheet. */
function readTokens(css: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const m of css.matchAll(/(--ns-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    const name = group(m, 1);
    if (!tokens.has(name)) tokens.set(name, group(m, 2).trim());
  }
  return tokens;
}

const TOKENS = readTokens(TOKENS_CSS);

/** Resolve `var(--ns-x)` chains (the token sheet aliases e.g. --ns-amber -> --ns-cyan). */
function resolveVars(value: string): string {
  let out = value.trim();
  for (let i = 0; i < 8; i++) {
    const m = out.match(/^var\(\s*(--ns-[a-z0-9-]+)\s*\)$/);
    if (!m) return out;
    const name = group(m, 1);
    const next = TOKENS.get(name);
    if (next === undefined) throw new Error(`unknown design token ${name}`);
    out = next.trim();
  }
  throw new Error(`var() chain did not resolve: ${value}`);
}

function parseColor(rawValue: string): Rgba {
  const value = resolveVars(rawValue);
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(group(hex, 1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = value.match(
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/i,
  );
  if (rgba) {
    const alpha = rgba[4];
    return [
      Number(group(rgba, 1)),
      Number(group(rgba, 2)),
      Number(group(rgba, 3)),
      alpha === undefined ? 1 : Number(alpha),
    ];
  }
  throw new Error(`unsupported colour value: ${rawValue}`);
}

interface Rule {
  selector: string;
  body: string;
}

function parseRules(css: string): Rule[] {
  const flat = css
    .replace(/\/\*[\s\S]*?\*\//g, "") // comments would otherwise glue onto selectors
    .replace(/@[^{};]*\{/g, ""); // drop at-rule preludes so nested rules stay reachable
  const rules: Rule[] = [];
  for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({ selector: group(m, 1).trim(), body: group(m, 2) });
  }
  return rules;
}

const POPUP_RULES = parseRules(POPUP_CSS);

function ruleBody(selector: string): string {
  const rule = POPUP_RULES.find((r) =>
    r.selector.split(",").some((s) => s.trim() === selector),
  );
  if (!rule) throw new Error(`popup.css has no rule for "${selector}"`);
  return rule.body;
}

function declaration(body: string, property: string): string {
  const m = body.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`));
  if (!m) throw new Error(`missing "${property}" declaration`);
  return group(m, 1).trim();
}

// -------------------------------------------------- reconstruct the backdrop

/**
 * The chips sit inside `.site-card`, inside `.hero`, on `body`. Everything the
 * chip tint composites onto is parsed from popup.css so a backdrop change
 * re-proves contrast rather than silently invalidating these numbers.
 */
function popupBackdrops(): Array<{ name: string; color: Rgba }> {
  // body: linear-gradient(180deg, #08070a 0%, #030206 100%)
  const bodyStops = [...declaration(ruleBody("body"), "background").matchAll(/#[0-9a-f]{6}/gi)].map(
    (m) => parseColor(m[0]),
  );
  expect(bodyStops.length, "body gradient should declare hex stops").toBeGreaterThanOrEqual(2);

  const card = parseColor(declaration(ruleBody(".site-card"), "background"));

  // .hero::before paints two radial glows at element opacity. Their peak alpha is
  // an upper bound on how much the glow lightens the backdrop under the chips
  // (the chips sit low in the hero, where both ellipses have already faded), so
  // using the peak is the conservative case for light-on-dark contrast.
  const heroGlow = ruleBody(".hero::before");
  const glowLayers = [...heroGlow.matchAll(/rgba\([^)]*\)/g)].map((m) => parseColor(m[0]));
  expect(glowLayers.length, ".hero::before should declare rgba glow layers").toBeGreaterThan(0);
  const heroOpacity = Number(declaration(heroGlow, "opacity"));
  expect(Number.isFinite(heroOpacity)).toBe(true);

  // Multiple CSS backgrounds composite first-listed on top.
  const merged = compositeCssBackgrounds(glowLayers);
  const glow = withAlpha(merged, merged[3] * heroOpacity);

  const backdrops: Array<{ name: string; color: Rgba }> = [];
  for (const stop of bodyStops) {
    const label = `rgb(${stop.slice(0, 3).join(",")})`;
    backdrops.push({ name: `${label} + site-card`, color: over(card, stop) });
    backdrops.push({
      name: `${label} + hero-glow(peak) + site-card`,
      color: over(card, over(glow, stop)),
    });
  }
  return backdrops;
}

function signalChipVariants(): Array<{ selector: string; text: Rgba; tint: Rgba }> {
  const seen = new Set<string>();
  const variants: Array<{ selector: string; text: Rgba; tint: Rgba }> = [];
  for (const rule of POPUP_RULES) {
    for (const raw of rule.selector.split(",")) {
      const selector = raw.trim();
      if (!/^\.signal-chip--[a-z0-9-]+$/.test(selector) || seen.has(selector)) continue;
      seen.add(selector);
      variants.push({
        selector,
        text: parseColor(declaration(rule.body, "color")),
        tint: parseColor(declaration(rule.body, "background")),
      });
    }
  }
  return variants;
}

// ------------------------------------------------------------------- the tests

describe("contrast helpers", () => {
  it("matches known WCAG reference ratios", () => {
    expect(contrastRatio([255, 255, 255, 1], [0, 0, 0, 1])).toBeCloseTo(21, 5);
    expect(contrastRatio([0, 0, 0, 1], [0, 0, 0, 1])).toBeCloseTo(1, 5);
    // #767676 is the canonical minimum grey that passes AA on white.
    expect(contrastRatio([118, 118, 118, 1], [255, 255, 255, 1])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio([119, 119, 119, 1], [255, 255, 255, 1])).toBeLessThan(4.5);
  });

  it("composites a translucent layer onto an opaque backdrop", () => {
    expect(over([255, 255, 255, 0.5], [0, 0, 0, 1])).toEqual([127.5, 127.5, 127.5, 1]);
    expect(over([10, 20, 30, 0], [1, 2, 3, 1])).toEqual([1, 2, 3, 1]);
  });

  it("composites CSS background layers in source order", () => {
    const firstListedTop: Rgba = [240, 30, 20, 0.35];
    const secondListedBottom: Rgba = [20, 100, 240, 0.65];

    expect(compositeCssBackgrounds([firstListedTop, secondListedBottom])).toEqual(
      stack(firstListedTop, secondListedBottom),
    );
    expect(compositeCssBackgrounds([firstListedTop, secondListedBottom])).not.toEqual(
      stack(secondListedBottom, firstListedTop),
    );
  });
});

describe("popup signal chips meet WCAG AA 1.4.3 (#274)", () => {
  const variants = signalChipVariants();
  const backdrops = popupBackdrops();

  it("enumerates the shipped chip variants", () => {
    // Guards the enumeration itself: a rename must not quietly empty this suite.
    expect(variants.map((v) => v.selector).sort()).toEqual(
      expect.arrayContaining([".signal-chip--ok", ".signal-chip--warn"]),
    );
  });

  it("every chip variant declares a distinct text colour", () => {
    // WCAG 1.4.1 is already satisfied by the reason-code label, but the categories
    // must stay visually separable after any contrast tuning.
    const colors = variants.map((v) => v.text.slice(0, 3).join(","));
    expect(new Set(colors).size).toBe(colors.length);
  });

  for (const variant of signalChipVariants()) {
    it(`${variant.selector} clears ${AA_NORMAL_TEXT}:1 on every popup backdrop`, () => {
      for (const backdrop of backdrops) {
        const chipSurface = over(variant.tint, backdrop.color);
        const ratio = contrastRatio(variant.text, chipSurface);
        expect(
          ratio,
          `${variant.selector} on ${backdrop.name} => ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      }
    });
  }
});

/**
 * The unscored-threat gauge state (#219) introduces one new colour usage in the
 * popup: gold (--ns-purple) for the "!" gauge mark and for the note that explains
 * a threat was recorded with no risk score. Both sit inside `.site-card`, so they
 * reuse the same reconstructed backdrops as the chips.
 */
describe("popup unscored-threat gauge (#219) meets WCAG AA 1.4.3", () => {
  const backdrops = popupBackdrops();

  it(".gauge-note text clears 4.5:1 over its own tint on every popup backdrop", () => {
    const body = ruleBody(".gauge-note");
    const text = parseColor(declaration(body, "color"));
    const tint = parseColor(declaration(body, "background"));
    for (const backdrop of backdrops) {
      const surface = over(tint, backdrop.color);
      const ratio = contrastRatio(text, surface);
      expect(
        ratio,
        `.gauge-note on ${backdrop.name} => ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    }
  });

  it(".shield-arc-mark--unscored clears 4.5:1 on every popup backdrop", () => {
    // The mark has no background of its own; it paints straight onto the card.
    const text = parseColor(declaration(ruleBody(".shield-arc-mark--unscored"), "color"));
    for (const backdrop of backdrops) {
      const ratio = contrastRatio(text, backdrop.color);
      expect(
        ratio,
        `.shield-arc-mark--unscored on ${backdrop.name} => ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    }
  });

  it("is a distinct colour from every scored-gauge colour", () => {
    // WCAG 1.4.1 is satisfied by the note text and the "!" mark, but the state
    // must also not be mistakable for safe-green or a scored red at a glance.
    const unscored = parseColor(declaration(ruleBody(".gauge-note"), "color"));
    for (const token of ["--ns-green", "--ns-orange", "--ns-red"]) {
      const scored = parseColor(`var(${token})`);
      expect(unscored.slice(0, 3), `must differ from ${token}`).not.toEqual(scored.slice(0, 3));
    }
  });
});
