/**
 * Helpers for the history / redirect acceptance procedures (AI-30, AI-47 step 3,
 * AI-24). They only observe: a per-page CDP session that records back/forward
 * cache restores and why Chrome refused one, every renderer-side `window.open`
 * call (so a Chrome-blocked popup can be told apart from a NavSentinel-blocked
 * one), and the main-frame commit timeline (so a rollback or skipped history
 * entry is visible even when it happens between two assertions).
 *
 * Automated agent evidence only; never an owner Gate-3 result.
 */
import { expect, type CDPSession, type Page } from "@playwright/test";
import { AcceptanceSession, SETTINGS_KEY, redactUrl, toastState } from "./acceptance_harness";

export const ALLOWLIST_KEY = "sentinelsuite:nav_allowlist_v1";
export const TRUSTED_DOMAINS_KEY = "sentinelsuite:trusted_domains_v1";

export type BfcacheNotUsed = { url: string | null; reasons: Array<{ type: string; reason: string; context?: string }>; at: number };
export type WindowOpenRecord = { url: string; windowName: string; windowFeatures: string[]; userGesture: boolean; at: number };
export type CommitRecord = { url: string; type: string; at: number };

/**
 * Observer attached to one tab over its own CDP session. Page.windowOpen is
 * emitted by Blink before Chrome's browser-side popup blocker decides, and is
 * NOT emitted when NavSentinel's MAIN-world wrapper refuses the call without
 * reaching the native `window.open`.
 */
export class TabObserver {
  readonly bfcacheNotUsed: BfcacheNotUsed[] = [];
  readonly windowOpens: WindowOpenRecord[] = [];
  readonly commits: CommitRecord[] = [];
  private lastUrl: string | null = null;

  private constructor(readonly page: Page, readonly cdp: CDPSession) {}

  static async attach(page: Page): Promise<TabObserver> {
    const cdp = await page.context().newCDPSession(page);
    const observer = new TabObserver(page, cdp);
    cdp.on("Page.backForwardCacheNotUsed", (event: { frameId: string; notRestoredExplanations?: Array<{ type: string; reason: string; context?: string }> }) => {
      observer.bfcacheNotUsed.push({ url: observer.lastUrl, reasons: event.notRestoredExplanations ?? [], at: Date.now() });
    });
    cdp.on("Page.windowOpen", (event: { url: string; windowName: string; windowFeatures: string[]; userGesture: boolean }) => {
      observer.windowOpens.push({ url: event.url, windowName: event.windowName, windowFeatures: event.windowFeatures, userGesture: event.userGesture, at: Date.now() });
    });
    cdp.on("Page.frameNavigated", (event: { frame: { parentId?: string; url: string; urlFragment?: string }; type?: string }) => {
      if (event.frame.parentId) return;
      observer.lastUrl = event.frame.url;
      observer.commits.push({ url: event.frame.url, type: event.type ?? "Navigation", at: Date.now() });
    });
    await cdp.send("Page.enable");
    return observer;
  }

  commitsSince(at: number): CommitRecord[] {
    return this.commits.filter((commit) => commit.at >= at);
  }

  windowOpensSince(at: number): WindowOpenRecord[] {
    return this.windowOpens.filter((record) => record.at >= at);
  }

  /** Commit timeline with queries kept (the Gym carries no secrets) but hosts shortened. */
  describeCommits(since = 0): string {
    return this.commitsSince(since)
      .map((commit) => `${commit.type}:${shortUrl(commit.url)}`)
      .join(" -> ");
  }

  async detach(): Promise<void> {
    await this.cdp.detach().catch(() => undefined);
  }
}

/** Host:port + path + query, for readable receipts of Gym-only URLs. */
export function shortUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.host}${url.pathname.replace(/^.*\//, "/")}${url.search}`;
  } catch {
    return raw;
  }
}

export function stepOf(page: Page): string | null {
  try {
    return new URL(page.url()).searchParams.get("step");
  } catch {
    return null;
  }
}

/**
 * Smart mode with no loopback allowlist or trusted-domain entry, read both from
 * storage and from the real Options page controls (guide precondition).
 */
export async function assertSmartModeNoLoopbackTrust(session: AcceptanceSession, label: string): Promise<void> {
  const settings = await session.storageLocal<{ nav?: { defaultMode?: string } } | undefined>(SETTINGS_KEY, `${label}: settings`);
  const allowlist = await session.storageLocal(ALLOWLIST_KEY, `${label}: nav allowlist`);
  const trusted = await session.storageLocal(TRUSTED_DOMAINS_KEY, `${label}: trusted domains`);
  const storedMode = settings?.nav?.defaultMode ?? "smart (default; nothing stored)";
  const options = await session.openExtensionPage("src/options/options.html");
  try {
    await options.waitForSelector("#navModeSeg .seg-btn[aria-checked='true']", { timeout: 8000 });
    const uiMode = await options.getAttribute("#navModeSeg .seg-btn[aria-checked='true']", "data-value");
    await options.click("nav button[data-section='allowlist'], .nav-btn[data-section='allowlist']").catch(() => undefined);
    const allowlistText = (await options.locator("#allowlist").innerText().catch(() => "")).trim();
    const trustedText = (await options.locator("#trustedList").innerText().catch(() => "")).trim();
    session.note(`${label}: Options mode=${uiMode}; stored mode=${storedMode}; allowlist pane="${allowlistText.replace(/\s+/g, " ").slice(0, 200)}"; trusted pane="${trustedText.replace(/\s+/g, " ").slice(0, 200)}"`);
    expect(uiMode, "Options shows Smart navigation mode").toBe("smart");
    expect(settings?.nav?.defaultMode ?? "smart").toBe("smart");
    const serialized = JSON.stringify([allowlist ?? null, trusted ?? null]);
    expect(serialized, "no loopback allowlist/trusted entry in storage").not.toMatch(/localhost|127\.0\.0\.1/);
    expect(allowlistText).not.toMatch(/localhost|127\.0\.0\.1/);
    expect(trustedText).not.toMatch(/localhost|127\.0\.0\.1/);
  } finally {
    await options.close();
  }
}

/** Page stays on `predicate` for `ms` with no NavSentinel toast and no extra commit. */
export async function expectStable(page: Page, observer: TabObserver, predicate: () => boolean, ms: number, what: string): Promise<void> {
  const commitsBefore = observer.commits.length;
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    expect(predicate(), `${what}: page left the expected entry (now ${shortUrl(page.url())})`).toBe(true);
    await page.waitForTimeout(200);
  }
  expect(predicate(), `${what}: page left the expected entry (now ${shortUrl(page.url())})`).toBe(true);
  const extra = observer.commits.slice(commitsBefore);
  expect(extra.map((commit) => shortUrl(commit.url)), `${what}: no rollback/extra commit while stable`).toEqual([]);
  const toast = await toastState(page);
  expect(toast.text, `${what}: no NavSentinel toast/prompt`).toBeNull();
}

export async function eventKindsSince(session: AcceptanceSession, sinceMs: number): Promise<Array<{ kind: string; url?: string }>> {
  const log = await session.eventLog();
  return log
    .filter((entry) => typeof entry.ts !== "number" || (entry.ts as number) >= sinceMs)
    .map((entry) => ({ kind: String(entry.kind), ...(typeof entry.url === "string" ? { url: redactUrl(entry.url) } : {}) }));
}

/**
 * Wait for the NavSentinel block/rollback toast whose body matches `pattern`.
 * Toast text is read from the extension's shadow host.
 */
export async function waitForToast(page: Page, pattern: RegExp, timeoutMs: number): Promise<{ text: string; buttons: string[] }> {
  let last: { text: string | null; buttons: string[] } = { text: null, buttons: [] };
  await expect.poll(async () => {
    last = await toastState(page).catch(() => ({ text: null, buttons: [] }));
    return last.text ?? "";
  }, { timeout: timeoutMs, intervals: [100] }).toMatch(pattern);
  return { text: last.text ?? "", buttons: last.buttons };
}

/** Trusted keyboard focus walk to an element id; returns the number of Tab presses. */
export async function tabTo(page: Page, id: string, maxPresses = 20): Promise<number> {
  for (let presses = 1; presses <= maxPresses; presses += 1) {
    await page.keyboard.press("Tab");
    const active = await page.evaluate(() => document.activeElement?.id ?? "");
    if (active === id) return presses;
  }
  throw new Error(`#${id} was not reachable with Tab`);
}

/** Pages currently open in the context (tabs and popup windows). */
export function openPages(session: AcceptanceSession): Page[] {
  return session.context.pages().filter((page) => !page.isClosed());
}
