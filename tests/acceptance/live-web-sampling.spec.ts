/**
 * Live-web false-positive sampling (opt-in: NAVSENTINEL_LIVE=1).
 *
 * The owner guides end with "everyday browsing" checks that fixtures cannot
 * model: former AI-41 step 7 (real embeds, consent/login frames, ad-heavy
 * pages) and former AI-46 step 5 (ordinary GET forms and declared submit
 * controls), plus the AI-29 overlay-cleanup feature on real publisher pages.
 * Each scenario performs navigations a user explicitly asks for and records
 * every NavSentinel intervention (toast text, journal rows, rollbacks) and any
 * element the overlay cleanup hid. No credentials are entered and consent
 * prompts are never accepted.
 */
import { expect, test, type Page } from "@playwright/test";
import { AcceptanceSession, toastState } from "./acceptance_harness";

test.skip(process.env.NAVSENTINEL_LIVE !== "1", "Live-web sampling is opt-in: set NAVSENTINEL_LIVE=1.");
test.setTimeout(600_000);

const LOUD_KINDS = new Set([
  "nav_blank_prompt", "nav_click_block", "nav_rollback", "cred_submit_prompt", "cred_paste_warn",
  "clickfix_detected", "dblclickjack_detected", "mutation_alert", "pushstate_abuse", "nav_reputation_late_warn",
]);

type Watch = { stop: () => Promise<string[]> };

/** Poll NavSentinel's toast host on every open tab and keep each distinct text. */
function watchToasts(session: AcceptanceSession): Watch {
  const seen = new Set<string>();
  let active = true;
  const loop = (async () => {
    while (active) {
      for (const page of session.context.pages()) {
        if (page.isClosed() || !/^https?:/.test(page.url())) continue;
        const state = await toastState(page).catch(() => null);
        if (state?.text) seen.add(`${new URL(page.url()).hostname}: ${state.text}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  })();
  return { stop: async () => { active = false; await loop; return [...seen]; } };
}

async function loudEventsSince(session: AcceptanceSession, before: number): Promise<Array<Record<string, unknown>>> {
  const log = await session.eventLog();
  return log.slice(before).filter((entry) => LOUD_KINDS.has(String(entry.kind)))
    .map((entry) => ({ kind: entry.kind, site: entry.site, pageSite: entry.pageSite, score: entry.score, destHost: entry.destHost, reasons: entry.reasons }));
}

async function trustedClickLocator(page: Page, selector: string): Promise<boolean> {
  const locator = page.locator(selector).filter({ visible: true }).first();
  if (!(await locator.isVisible().catch(() => false))) return false;
  await locator.scrollIntoViewIfNeeded().catch(() => undefined);
  const box = await locator.boundingBox();
  if (!box) return false;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return true;
}

/** Elements NavSentinel's overlay cleanup hid carry inline `display: none !important`. */
async function cleanupHiddenElements(page: Page): Promise<string[]> {
  return page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>("body *"))
    .filter((element) => element.style.getPropertyValue("display") === "none" && element.style.getPropertyPriority("display") === "important")
    .slice(0, 20)
    .map((element) => {
      const id = element.id ? `#${element.id}` : "";
      const classes = typeof element.className === "string" && element.className ? `.${element.className.trim().split(/\s+/).slice(0, 3).join(".")}` : "";
      return `${element.tagName.toLowerCase()}${id}${classes}`;
    })).catch(() => []);
}

/** What the toolbar popup's Current page card tells the user about this tab. */
async function popupAudit(session: AcceptanceSession, page: Page, label: string): Promise<void> {
  const popup = await session.openPopup(page);
  const card = await popup.evaluate<{ site: string; note: string; signals: string }>(() => ({
    site: document.getElementById("site")?.textContent ?? "",
    note: document.getElementById("gaugeNote")?.textContent ?? "",
    signals: document.getElementById("signals")?.textContent ?? "",
  }));
  session.note(`${label} popup: site=${card.site} note=${JSON.stringify(card.note)} signals=${JSON.stringify(card.signals)}`);
  await session.screenshotPopup(`${label}-popup`);
  await session.closePopup();
}

async function scenario(
  session: AcceptanceSession,
  name: string,
  body: () => Promise<void>,
  expectations: { allowToasts?: boolean } = {},
): Promise<void> {
  await session.step(`live: ${name}`, async () => {
    const before = (await session.eventLog()).length;
    const watch = watchToasts(session);
    let bodyError: unknown;
    try {
      await body();
    } catch (error) {
      bodyError = error;
    }
    const toasts = await watch.stop();
    const loud = await loudEventsSince(session, before);
    session.note(`${name}: toasts=${JSON.stringify(toasts)} loudEvents=${JSON.stringify(loud)}`);
    if (bodyError) throw bodyError;
    if (!expectations.allowToasts) {
      expect(toasts, `${name}: no NavSentinel intervention on a user-requested flow`).toEqual([]);
      expect(loud, `${name}: no loud journal rows`).toEqual([]);
    }
  }, { soft: true });
}

test("live web: user-requested navigation on real sites is never blocked or rolled back", async ({}, testInfo) => {
  const session = await AcceptanceSession.open(testInfo, "live-web-sampling");
  try {
    const page = await session.newPage();

    await scenario(session, "Wikipedia top-frame GET search form, article link, Back", async () => {
      await session.gotoReady(page, "https://en.wikipedia.org/wiki/Main_Page");
      await page.waitForTimeout(6000);
      const start = page.url();
      const search = page.locator('input[name="search"]:visible').first();
      await search.click();
      await page.keyboard.type("Browser extension", { delay: 40 });
      await Promise.all([page.waitForURL((url) => url.href !== start, { timeout: 15_000 }), page.keyboard.press("Enter")]);
      await page.waitForLoadState("domcontentloaded");
      const afterSearch = page.url();
      session.note(`wikipedia search landed on ${new URL(afterSearch).pathname}`);
      await page.waitForTimeout(6000);
      const linkIndex = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLAnchorElement>('#mw-content-text a[href^="/wiki/"]'))
        .findIndex((link) => !link.getAttribute("href")!.includes(":") && link.getBoundingClientRect().width > 0 && link.getBoundingClientRect().top > 0 && link.getBoundingClientRect().bottom < window.innerHeight));
      expect(linkIndex, "an in-viewport article link exists").toBeGreaterThanOrEqual(0);
      const articleLink = page.locator('#mw-content-text a[href^="/wiki/"]').nth(linkIndex);
      const articleBox = await articleLink.boundingBox();
      if (!articleBox) throw new Error("article link not rendered");
      await page.mouse.click(articleBox.x + Math.min(20, articleBox.width / 2), articleBox.y + articleBox.height / 2);
      await page.waitForURL((url) => url.href !== afterSearch, { timeout: 15_000 });
      await page.waitForTimeout(3000);
      await page.goBack();
      await page.waitForTimeout(2000);
      expect(page.url()).toBe(afterSearch);
    });

    await scenario(session, "Bing result click through its cross-site click redirector", async () => {
      await session.gotoReady(page, "https://www.bing.com/search?q=chromium+project+source");
      await trustedClickLocator(page, "#bnp_btn_reject");
      await page.waitForTimeout(6000);
      await popupAudit(session, page, "bing");
      const newTab = session.context.waitForEvent("page", { timeout: 20_000 }).catch(() => null);
      const clicked = await trustedClickLocator(page, "#b_results li.b_algo h2 a");
      expect(clicked, "an organic result was clickable").toBe(true);
      // Bing opens results in the same tab or a new tab depending on its settings.
      const target = await Promise.race([
        page.waitForURL((url) => !url.hostname.endsWith("bing.com"), { timeout: 20_000 }).then(() => page),
        newTab,
      ]);
      if (!target) throw new Error("the result opened neither in this tab nor a new one");
      await target.waitForLoadState("domcontentloaded").catch(() => undefined);
      await target.waitForURL((url) => /^https?:$/.test(url.protocol) && !url.hostname.endsWith("bing.com"), { timeout: 20_000 });
      await target.waitForTimeout(5000);
      const settled = new URL(target.url()).hostname;
      session.note(`bing result settled on ${settled} (${target === page ? "same tab" : "new tab"})`);
      expect(settled.endsWith("bing.com"), "the result stays open (no rollback to the search page)").toBe(false);
      if (target !== page) await target.close();
    });

    await scenario(session, "DuckDuckGo: click the first result title (text inside a <span> in the link)", async () => {
      await session.gotoReady(page, "https://duckduckgo.com/?q=chromium+browser+project&ia=web");
      await page.waitForTimeout(6000);
      const title = page.locator('a[data-testid="result-title-a"]').first();
      await title.waitFor({ state: "visible", timeout: 15_000 });
      const destination = new URL((await title.getAttribute("href")) ?? "", page.url()).hostname;
      const box = await title.boundingBox();
      if (!box) throw new Error("result title not rendered");
      const x = box.x + Math.min(40, box.width / 2);
      const y = box.y + box.height / 2;
      await page.mouse.move(x - 60, y + 30);
      await page.mouse.move(x, y, { steps: 10 });
      await page.waitForTimeout(450);
      await page.mouse.down();
      await page.waitForTimeout(90);
      await page.mouse.up();
      const reached = await page.waitForURL((url) => url.hostname === destination, { timeout: 10_000 }).then(() => true, () => false);
      session.note(`duckduckgo first result ${destination}: reached=${reached}`);
      expect(reached, "the user's click on a search result must open it").toBe(true);
    });

    await scenario(session, "GitHub SPA tab navigation (history.pushState) and Back", async () => {
      await session.gotoReady(page, "https://github.com/microsoft/playwright");
      await page.waitForTimeout(6000);
      expect(await trustedClickLocator(page, "#issues-tab")).toBe(true);
      await page.waitForURL(/\/issues/, { timeout: 15_000 });
      await page.waitForTimeout(2500);
      expect(await trustedClickLocator(page, "#pull-requests-tab")).toBe(true);
      await page.waitForURL(/\/pulls/, { timeout: 15_000 });
      await page.waitForTimeout(2500);
      await page.goBack();
      await page.waitForURL(/\/issues/, { timeout: 15_000 });
      await page.goBack();
      await page.waitForURL(/microsoft\/playwright\/?$/, { timeout: 15_000 });
    });

    await scenario(session, "Stack Overflow 'Log in with Google' OAuth redirect to accounts.google.com (no sign-in)", async () => {
      await session.gotoReady(page, "https://stackoverflow.com/users/login");
      await trustedClickLocator(page, "button#onetrust-reject-all-handler");
      await page.waitForTimeout(6000);
      const clicked = await trustedClickLocator(page, 'button[data-provider="google"]');
      expect(clicked, "the Google login button was clickable").toBe(true);
      await page.waitForURL(/accounts\.google\.com/, { timeout: 20_000 });
      await page.waitForTimeout(5000);
      expect(new URL(page.url()).hostname).toBe("accounts.google.com");
    });

    await scenario(session, "Real YouTube embed: play, then the player's own YouTube link (child-frame navigation the user asked for)", async () => {
      await session.gotoReady(page, session.url("/acceptance/live-youtube-embed.html"));
      await page.waitForTimeout(6500);
      const frame = page.frameLocator("#player");
      const link = frame.locator('a:has-text("Watch on"), a.ytp-youtube-button, a.ytp-title-link').first();
      await link.waitFor({ state: "visible", timeout: 15_000 });
      const linkBox = await link.boundingBox();
      if (!linkBox) throw new Error("YouTube link not rendered");
      const opened = session.context.waitForEvent("page", { timeout: 10_000 }).catch(() => null);
      await page.mouse.click(linkBox.x + linkBox.width / 2, linkBox.y + linkBox.height / 2);
      const tab = await opened;
      if (tab) {
        await tab.waitForLoadState("domcontentloaded").catch(() => undefined);
        await tab.waitForTimeout(3000);
        session.note(`player link opened ${new URL(tab.url()).hostname}`);
        expect(new URL(tab.url()).hostname).toMatch(/youtube\.com$/);
        await tab.close();
      } else {
        await page.waitForTimeout(3000);
        session.note(`player link navigated the tab to ${new URL(page.url()).hostname}`);
        expect(new URL(page.url()).hostname).toMatch(/youtube\.com$/);
      }
    });

    await scenario(session, "Overlay cleanup ON: BBC News scroll and headline click (hidden elements recorded for review)", async () => {
      await session.patchNavigation({ autoDismissOverlays: true });
      await session.gotoReady(page, "https://www.bbc.co.uk/news");
      for (let index = 0; index < 8; index += 1) {
        await page.mouse.wheel(0, 900);
        await page.waitForTimeout(1500);
      }
      const hidden = await cleanupHiddenElements(page);
      session.note(`bbc: elements hidden with inline display:none !important: ${JSON.stringify(hidden)}`);
      await session.screenshot(page, "live-bbc-cleanup-on");
      await page.mouse.wheel(0, -20_000);
      await page.waitForTimeout(1500);
      const before = page.url();
      const clicked = await trustedClickLocator(page, 'a[href*="/news/articles/"]');
      if (clicked) {
        await page.waitForURL((url) => url.href !== before, { timeout: 15_000 });
        await page.waitForTimeout(3000);
      } else {
        session.note("bbc: no headline link matched; navigation part not exercised");
      }
    }, { allowToasts: true });

    await scenario(session, "Overlay cleanup ON: Reddit logged-out community page scroll (login/app prompts recorded for review)", async () => {
      await session.gotoReady(page, "https://www.reddit.com/r/chrome/");
      for (let index = 0; index < 6; index += 1) {
        await page.mouse.wheel(0, 900);
        await page.waitForTimeout(1500);
      }
      const hidden = await cleanupHiddenElements(page);
      session.note(`reddit: elements hidden with inline display:none !important: ${JSON.stringify(hidden)}`);
      await session.screenshot(page, "live-reddit-cleanup-on");
      await popupAudit(session, page, "reddit");
      await session.patchNavigation({ autoDismissOverlays: false });
    }, { allowToasts: true });

    await session.step("extension surfaces raised no exceptions on real sites", async () => {
      const extensionErrors = session.consoleErrors().filter((entry) =>
        entry.source === "service-worker" || entry.source === "popup" || /\[NavSentinel\]/.test(entry.text));
      session.note(`extension-attributed console errors: ${JSON.stringify(extensionErrors).slice(0, 1500)}`);
      expect(extensionErrors.filter((entry) => entry.level === "exception")).toEqual([]);
    }, { soft: true });
  } finally {
    await session.close();
  }
});
