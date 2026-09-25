/**
 * Helpers for the event-attribution acceptance procedures (AI-35 cross-host
 * child-event attribution, AI-47 step 7 popup event association). They only
 * drive and observe the browser; they never modify product code. Automated
 * agent evidence, not an owner Gate-3 result.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { expect, type Frame, type Page } from "@playwright/test";
import type { AcceptanceSession, Markers } from "./acceptance_harness";
import type { CdpPageClient } from "./cdp_page_client";

export const OPTIONS_PAGE = "src/options/options.html";

/** Read the three NavSentinel readiness markers from any frame. */
export async function frameMarkers(frame: Frame): Promise<Markers> {
  return frame.evaluate(() => ({
    capture: document.documentElement.getAttribute("data-navsentinel-capture-ready"),
    bridge: document.documentElement.getAttribute("data-navsentinel-bridge-ready"),
    guard: document.documentElement.getAttribute("data-navsentinel-ui-guard"),
  }));
}

/** Require capture=1, bridge=1 and the exact built guard revision inside a child frame. */
export async function requireFrameReady(frame: Frame, guard: string, timeoutMs = 15_000): Promise<Markers> {
  try {
    await frame.waitForFunction(
      (expected) =>
        document.documentElement.getAttribute("data-navsentinel-capture-ready") === "1" &&
        document.documentElement.getAttribute("data-navsentinel-bridge-ready") === "1" &&
        document.documentElement.getAttribute("data-navsentinel-ui-guard") === expected,
      guard,
      { timeout: timeoutMs },
    );
  } catch (error) {
    const seen = await frameMarkers(frame).catch(() => null);
    throw new Error(`child frame not ready: ${JSON.stringify(seen)} (${error instanceof Error ? error.message.split("\n")[0] : String(error)})`, { cause: error });
  }
  return frameMarkers(frame);
}

/**
 * One trusted click on an element inside a child frame. Playwright reports
 * frame element boxes in main-frame viewport coordinates, so the page mouse
 * (trusted input) can hit it directly. The frame element box is checked as a
 * cross-check that the point really lies inside the visible iframe.
 */
export async function trustedClickInFrame(page: Page, frameSelector: string, frame: Frame, innerSelector: string): Promise<{ x: number; y: number }> {
  const frameBox = await page.locator(frameSelector).boundingBox();
  const innerBox = await frame.locator(innerSelector).first().boundingBox();
  if (!frameBox || !innerBox) throw new Error(`${frameSelector} ${innerSelector} is not rendered`);
  const x = innerBox.x + innerBox.width / 2;
  const y = innerBox.y + innerBox.height / 2;
  if (x < frameBox.x || x > frameBox.x + frameBox.width || y < frameBox.y || y > frameBox.y + frameBox.height) {
    throw new Error(`computed click point ${x},${y} is outside the frame box ${JSON.stringify(frameBox)}`);
  }
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
  return { x, y };
}

export type PopupGauge = {
  site: string;
  ariaLabel: string;
  arcText: string;
  unscoredMark: boolean;
  noteHidden: boolean;
  note: string;
  signals: string[];
  events: string[];
};

/** Snapshot of the real popup's Current page card and activity feed. */
export async function readPopupGauge(popup: CdpPageClient): Promise<PopupGauge> {
  return popup.evaluate<PopupGauge>(() => {
    const arc = document.getElementById("shieldArc");
    const note = document.getElementById("gaugeNote") as HTMLElement | null;
    return {
      site: document.getElementById("site")?.textContent?.trim() ?? "",
      ariaLabel: arc?.getAttribute("aria-label") ?? "",
      arcText: (arc as HTMLElement | null)?.innerText?.replace(/\s+/g, " ").trim() ?? "",
      unscoredMark: Boolean(arc?.querySelector(".shield-arc-mark--unscored")),
      noteHidden: note ? note.hidden : true,
      note: note?.textContent?.trim() ?? "",
      signals: Array.from(document.querySelectorAll("#signals .signal-chip"), (chip) => chip.textContent?.trim() ?? ""),
      events: Array.from(document.querySelectorAll("#events .event-row"), (row) => row.textContent?.replace(/\s+/g, " ").trim() ?? ""),
    };
  });
}

/** Wait until the popup has rendered its gauge (refreshUi is async after load). */
export async function waitForPopupGauge(popup: CdpPageClient): Promise<PopupGauge> {
  await popup.waitFor("/^(Tab risk score: \\d+|Threat alert recorded)/.test(document.getElementById('shieldArc')?.getAttribute('aria-label') ?? '')", 8000);
  return readPopupGauge(popup);
}

export type ImportRow = Record<string, unknown>;

/** Write a temporary Options export containing only `eventLog` rows. */
export function writeImportFile(directory: string, name: string, rows: ImportRow[]): string {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${name}.json`);
  fs.writeFileSync(file, `${JSON.stringify({ eventLog: rows }, null, 2)}\n`);
  return file;
}

/**
 * Import a JSON file through the real Options "Import" file control and wait
 * for its status message. Returns the status text observed.
 */
export async function importThroughOptions(options: Page, file: string): Promise<string> {
  await options.bringToFront();
  await options.evaluate(() => {
    const state = window as unknown as { __nsAttrStatus?: string[]; __nsAttrObserving?: boolean };
    const status = document.getElementById("status");
    state.__nsAttrStatus = [];
    if (!status || state.__nsAttrObserving) return;
    state.__nsAttrObserving = true;
    new MutationObserver(() => {
      const text = status.textContent?.trim();
      if (text) (window as unknown as { __nsAttrStatus: string[] }).__nsAttrStatus.push(text);
    }).observe(status, { childList: true, characterData: true, subtree: true });
  });
  await options.locator("#importFile").setInputFiles(file);
  await expect.poll(
    () => options.evaluate(() => ((window as unknown as { __nsAttrStatus?: string[] }).__nsAttrStatus ?? []).join(" | ")),
    { timeout: 10_000, message: "Options import must report a status" },
  ).toMatch(/Import/);
  return options.evaluate(() => ((window as unknown as { __nsAttrStatus?: string[] }).__nsAttrStatus ?? []).join(" | "));
}

/** Switch Options to its Event log pane with a real click, as the owner would. */
export async function showOptionsEventLog(options: Page): Promise<void> {
  await options.bringToFront();
  await options.locator(".nav-btn[data-section='log']").click({ timeout: 5000 });
  await options.locator("#pane-log").waitFor({ state: "visible", timeout: 5000 });
}

/** Options event-log rows as rendered (newest first). */
export async function optionsEventRows(options: Page): Promise<string[]> {
  return options.evaluate(() =>
    Array.from(document.querySelectorAll("#eventLog .event-row-opt"), (row) => row.textContent?.replace(/\s+/g, " ").trim() ?? ""),
  );
}

/** Every string in `haystack` that contains any forbidden fragment. */
export function forbiddenHits(haystack: string, forbidden: string[]): string[] {
  const lower = haystack.toLowerCase();
  return forbidden.filter((fragment) => lower.includes(fragment.toLowerCase()));
}

/** A hostname-only value: no scheme, port, path, query, fragment or whitespace. */
export function isBareHostname(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  if (/[/?#@\s[\]]|:\/\/|^https?:/i.test(value)) return false;
  // One colon is a host:port pair; an IPv6 literal (unbracketed) has several.
  return (value.match(/:/g) ?? []).length !== 1;
}

/**
 * A minimal static page server bound to IPv6 loopback, for the popup
 * association check on an IPv6 top-level page. Resolves null when the host has
 * no usable ::1 (recorded as an environment limitation, not a product result).
 */
export async function startIpv6LoopbackServer(): Promise<{ baseUrl: string; close: () => Promise<void> } | null> {
  const server = http.createServer((req, res) => {
    if ((req.url ?? "").startsWith("/favicon.ico")) {
      res.statusCode = 204;
      res.end();
      return;
    }
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end("<!doctype html><html><head><meta charset=\"utf-8\"><title>AI-47.7 IPv6 loopback page</title></head><body><h1>IPv6 loopback page</h1><p>Popup association fixture.</p></body></html>");
  });
  const bound = await new Promise<boolean>((resolve) => {
    server.once("error", () => resolve(false));
    server.listen(0, "::1", () => resolve(true));
  });
  if (!bound) return null;
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    return null;
  }
  return {
    baseUrl: `http://[::1]:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export function tabCount(session: AcceptanceSession): number {
  return session.context.pages().filter((page) => !page.isClosed()).length;
}
