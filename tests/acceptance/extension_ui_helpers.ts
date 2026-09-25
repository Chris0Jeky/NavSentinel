/**
 * Helpers for the extension-owned UI acceptance procedures (popup, Options,
 * Protection Center, export). They only drive and observe the browser; they
 * never modify product code. Automated agent evidence, not an owner Gate-3.
 */
import fs from "node:fs";
import sharp from "sharp";
import { expect, type Download, type Page } from "@playwright/test";
import type { AcceptanceSession } from "./acceptance_harness";
import type { CdpPageClient } from "./cdp_page_client";

export const OPTIONS_PAGE = "src/options/options.html";
export const EVIDENCE_PAGE = "src/evidence/evidence.html";
export const TRUSTED_DOMAINS_KEY = "sentinelsuite:trusted_domains_v1";

export function uniqueMarker(prefix = "nsx"): string {
  return `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e8).toString(36)}`.toLowerCase();
}

/**
 * Open an extension page in its own browser window (not a tab), so two
 * Options surfaces are both visible and neither is a throttled background tab.
 */
export async function openExtensionWindow(session: AcceptanceSession, relative: string, size = { width: 1100, height: 850 }): Promise<Page> {
  const url = session.extensionUrl(relative);
  // A new page's URL is often still about:blank when the "page" event fires,
  // so match on the event and then wait for the extension URL to commit.
  const pagePromise = session.context.waitForEvent("page", { timeout: 15_000 });
  await session.worker.evaluate(async ({ target, width, height }) => {
    await chrome.windows.create({ url: target, width, height, focused: true, type: "normal" });
  }, { target: url, width: size.width, height: size.height });
  const page = await pagePromise;
  await page.waitForURL((current) => current.toString().startsWith(url), { timeout: 15_000 });
  await page.waitForLoadState("load");
  return page;
}

/** Press Tab on a Playwright page until `predicate` (evaluated in-page) holds. */
export async function tabUntil(page: Page, predicate: string, max = 60, shift = false): Promise<string[]> {
  const visited: string[] = [];
  for (let index = 0; index < max; index += 1) {
    await page.keyboard.press(shift ? "Shift+Tab" : "Tab");
    visited.push(await activeDescriptor(page));
    if (await page.evaluate(`Boolean(${predicate})`)) return visited;
  }
  throw new Error(`Tab never satisfied ${predicate}; visited ${visited.join(" > ")}`);
}

export async function activeDescriptor(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return "body";
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.className && typeof el.className === "string" ? `.${el.className.trim().split(/\s+/).join(".")}` : ""}[${(el.textContent ?? "").trim().slice(0, 30)}]`;
  });
}

/** Press Tab in the real popup until `predicate` holds. */
export async function popupTabUntil(popup: CdpPageClient, predicate: string, max = 40): Promise<string[]> {
  const visited: string[] = [];
  for (let index = 0; index < max; index += 1) {
    await popup.press("Tab");
    visited.push(await popup.evaluate<string>(`(() => { const el = document.activeElement; if (!el || el === document.body) return "body"; return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + "[" + (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30) + "]"; })()`));
    if (await popup.evaluate<boolean>(`Boolean(${predicate})`)) return visited;
  }
  throw new Error(`popup Tab never satisfied ${predicate}; visited ${visited.join(" > ")}`);
}

/** Resolve with the download if one starts within `ms`, otherwise null. */
export async function downloadWithin(page: Page, ms: number): Promise<Download | null> {
  return page.waitForEvent("download", { timeout: ms }).catch(() => null);
}

export async function readDownload(download: Download): Promise<Buffer> {
  const file = await download.path();
  if (!file) throw new Error("download has no local path");
  return fs.readFileSync(file);
}

/** Buttons (in the light DOM or any open shadow root) whose label mentions Allow/Proceed. */
export async function allowProceedControls(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    const visit = (root: Document | ShadowRoot) => {
      for (const el of Array.from(root.querySelectorAll("button, a, [role=button], input[type=button], input[type=submit]"))) {
        const label = `${el.textContent ?? ""} ${(el as HTMLElement).getAttribute("aria-label") ?? ""} ${(el as HTMLInputElement).value ?? ""}`;
        if (/\b(allow|proceed)\b/i.test(label)) found.push(label.trim().replace(/\s+/g, " ").slice(0, 80));
      }
      for (const host of Array.from(root.querySelectorAll("*"))) {
        if ((host as HTMLElement).shadowRoot) visit((host as HTMLElement).shadowRoot!);
      }
    };
    visit(document);
    return found;
  });
}

/** Centre of a visible button, by exact label, inside any open shadow root on the page. */
export async function shadowButtonPoint(page: Page, label: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate((expected) => {
    const visit = (root: Document | ShadowRoot): { x: number; y: number } | null => {
      for (const host of Array.from(root.querySelectorAll("*"))) {
        const shadow = (host as HTMLElement).shadowRoot;
        if (!shadow) continue;
        const button = Array.from(shadow.querySelectorAll("button")).find((candidate) => candidate.textContent?.trim() === expected);
        if (button) {
          const rect = button.getBoundingClientRect();
          if (rect.width && rect.height) return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }
        const nested = visit(shadow);
        if (nested) return nested;
      }
      return null;
    };
    return visit(document);
  }, label);
}

// ------------------------------------------------------------ colour/contrast

export type Rgb = [number, number, number];

export function parseCssColor(value: string): { rgb: Rgb; alpha: number } {
  const match = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/.exec(value);
  if (!match) throw new Error(`unparseable colour ${value}`);
  const alphaText = match[4];
  const alpha = alphaText === undefined ? 1 : alphaText.endsWith("%") ? Number(alphaText.slice(0, -1)) / 100 : Number(alphaText);
  return { rgb: [Number(match[1]), Number(match[2]), Number(match[3])], alpha };
}

function linear(channel: number): number {
  const s = channel / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export type PillMeasurement = {
  text: string;
  state: string;
  className: string;
  color: string;
  backgroundColor: string;
  borderColor: string;
  fontSizePx: number;
  rect: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
  scrollWidth: number;
  clientWidth: number;
  clippedBy: string[];
  renderedBackground: Rgb;
  renderedTextExtreme: Rgb;
  contrastComputedTextVsRenderedBackground: number;
  contrastRenderedExtremeVsRenderedBackground: number;
  distinctFromChips: Array<{ className: string; color: string; backgroundColor: string; text: string }>;
};

/**
 * Measure an element in the real popup: geometry/clipping from the DOM, the
 * effective background from actual rendered pixels (the padding strips beside
 * the label, captured with Page.captureScreenshot), and WCAG contrast of the
 * computed text colour against that rendered background.
 */
export async function measurePopupPill(popup: CdpPageClient, selector: string, shotFile?: string): Promise<PillMeasurement> {
  const dom = await popup.evaluate<Omit<PillMeasurement, "renderedBackground" | "renderedTextExtreme" | "contrastComputedTextVsRenderedBackground" | "contrastRenderedExtremeVsRenderedBackground"> & { padLeft: number; padRight: number; borderLeft: number; borderRight: number; borderTop: number; borderBottom: number; dpr: number }>((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const clippedBy: string[] = [];
    for (let node = el.parentElement; node; node = node.parentElement) {
      const s = getComputedStyle(node);
      if (/(hidden|clip|scroll|auto)/.test(`${s.overflowX} ${s.overflowY}`)) {
        const r = node.getBoundingClientRect();
        if (rect.left < r.left - 0.5 || rect.right > r.right + 0.5 || rect.top < r.top - 0.5 || rect.bottom > r.bottom + 0.5) {
          clippedBy.push(`${node.tagName.toLowerCase()}.${node.className}`);
        }
      }
    }
    const chips = Array.from(document.querySelectorAll(".signal-chip")).map((chip) => {
      const cs = getComputedStyle(chip);
      return { className: (chip as HTMLElement).className, color: cs.color, backgroundColor: cs.backgroundColor, text: chip.textContent ?? "" };
    });
    return {
      text: (el.textContent ?? "").trim(),
      state: el.dataset.state ?? "",
      className: el.className,
      color: style.color,
      backgroundColor: style.backgroundColor,
      borderColor: style.borderTopColor,
      fontSizePx: parseFloat(style.fontSize),
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      clippedBy,
      distinctFromChips: chips,
      padLeft: parseFloat(style.paddingLeft),
      padRight: parseFloat(style.paddingRight),
      borderLeft: parseFloat(style.borderLeftWidth),
      borderRight: parseFloat(style.borderRightWidth),
      borderTop: parseFloat(style.borderTopWidth),
      borderBottom: parseFloat(style.borderBottomWidth),
      dpr: window.devicePixelRatio,
    };
  }, selector as never);

  const { data } = await popup.send<{ data: string }>("Page.captureScreenshot", {
    format: "png",
    clip: { x: dom.rect.x, y: dom.rect.y, width: dom.rect.width, height: dom.rect.height, scale: 1 },
    captureBeyondViewport: false,
  });
  const png = Buffer.from(data, "base64");
  if (shotFile) fs.writeFileSync(shotFile, png);
  const { data: raw, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const scaleX = info.width / dom.rect.width;
  const scaleY = info.height / dom.rect.height;
  const pixel = (x: number, y: number): Rgb => {
    const offset = (y * info.width + x) * info.channels;
    return [raw[offset]!, raw[offset + 1]!, raw[offset + 2]!];
  };
  // Background: the inner padding strips beside the label (inside the border,
  // before the first glyph) — pure pill paint over the real popup backdrop.
  const background: Rgb[] = [];
  const yStart = Math.ceil((dom.borderTop + 0.5) * scaleY);
  const yEnd = Math.floor((dom.rect.height - dom.borderBottom - 0.5) * scaleY);
  const strips = [
    [Math.ceil((dom.borderLeft + 0.5) * scaleX), Math.floor((dom.borderLeft + dom.padLeft - 1) * scaleX)],
    [Math.ceil((dom.rect.width - dom.borderRight - dom.padRight + 1) * scaleX), Math.floor((dom.rect.width - dom.borderRight - 0.5) * scaleX)],
  ] as const;
  for (const [x0, x1] of strips) {
    for (let x = x0; x <= x1; x += 1) for (let y = yStart; y < yEnd; y += 1) background.push(pixel(x, y));
  }
  if (!background.length) throw new Error("no background pixels sampled");
  const median = (values: number[]) => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
  const renderedBackground: Rgb = [0, 1, 2].map((channel) => median(background.map((p) => p[channel]!))) as Rgb;
  // Most extreme rendered glyph pixel in the label box (anti-aliasing means
  // small text rarely reaches the full declared colour; observation only).
  let extreme: Rgb = renderedBackground;
  let best = 1;
  const x0 = Math.ceil((dom.borderLeft + dom.padLeft) * scaleX);
  const x1 = Math.floor((dom.rect.width - dom.borderRight - dom.padRight) * scaleX);
  for (let x = x0; x < x1; x += 1) {
    for (let y = yStart; y < yEnd; y += 1) {
      const candidate = pixel(x, y);
      const ratio = contrastRatio(candidate, renderedBackground);
      if (ratio > best) { best = ratio; extreme = candidate; }
    }
  }
  const text = parseCssColor(dom.color);
  expect(text.alpha, "pill text colour is opaque").toBe(1);
  const { padLeft: _pl, padRight: _pr, borderLeft: _bl, borderRight: _br, borderTop: _bt, borderBottom: _bb, dpr: _dpr, ...rest } = dom;
  return {
    ...rest,
    renderedBackground,
    renderedTextExtreme: extreme,
    contrastComputedTextVsRenderedBackground: Number(contrastRatio(text.rgb, renderedBackground).toFixed(2)),
    contrastRenderedExtremeVsRenderedBackground: Number(best.toFixed(2)),
  };
}
