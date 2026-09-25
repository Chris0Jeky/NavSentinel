/**
 * AI-24 — optional post-merge real-Chrome confirmation of the merged
 * #356/#464/#466 result (ACTION_ITEMS.md AI-24; procedure detail retained in
 * docs/agentic/GATE3_GUIDES.md AI-21/AI-22 and the archived AI-13 step 5):
 * delayed-redirect rollback + toast, programmatic-submit block then exactly
 * one Allow once, Level-5 popunder block, OAuth popup by physical click /
 * Tab+Enter / submit input (exactly one popup, no prompt), MV3 worker.
 *
 * Chrome's own popup blocker is ON here, so every popup case records who
 * decided: a NavSentinel MAIN-world refusal never reaches native window.open
 * (no CDP Page.windowOpen), while a Chrome block does reach it but creates no
 * window. Automated agent evidence, not the owner result.
 */
import { expect, test, type Page } from "@playwright/test";
import { AcceptanceSession, toastButtonPoint, toastState, trustedClick } from "./acceptance_harness";
import { listTargets } from "./cdp_page_client";
import { TabObserver, assertSmartModeNoLoopbackTrust, eventKindsSince, expectStable, openPages, shortUrl, tabTo, waitForToast } from "./history_helpers";

test.setTimeout(420_000);

type Created = { url: string; at: number; page: Page };

function recordCreatedPages(session: AcceptanceSession): Created[] {
  const created: Created[] = [];
  session.context.on("page", (page) => created.push({ url: page.url(), at: Date.now(), page }));
  return created;
}

async function clickToastButton(page: Page, label: string): Promise<void> {
  const point = await toastButtonPoint(page, label);
  if (!point) throw new Error(`toast button "${label}" is not rendered`);
  await page.mouse.click(point.x, point.y);
}

test("AI-24: merged #356/#464/#466 behaviour in branded Chrome", async ({}, testInfo) => {
  const session = await AcceptanceSession.open(testInfo, "AI-24-merged-356-464-466");
  const created = recordCreatedPages(session);
  const failures: string[] = [];
  const soft = async (title: string, body: () => Promise<void>): Promise<boolean> => {
    const ok = (await session.step(title, async () => { await body(); return true; }, { soft: true })) === true;
    if (!ok) failures.push(title);
    return ok;
  };
  try {
    session.note(`tested head ${session.receipt.git.head}; Chrome ${session.chromeVersion}; ui-guard ${session.guardRevision}`);

    await soft("0. MV3 service worker registered (DevTools target list) without a startup error; Smart mode; no loopback trust", async () => {
      const manifest = await session.worker.evaluate(() => {
        const m = chrome.runtime.getManifest() as chrome.runtime.Manifest & { background?: { service_worker?: string; type?: string } };
        return { mv: m.manifest_version, background: m.background ?? null };
      });
      session.note(`manifest_version=${manifest.mv}; background=${JSON.stringify(manifest.background)}`);
      expect(manifest.mv).toBe(3);
      expect(manifest.background?.service_worker).toBe("service-worker-loader.js");
      const targets = await listTargets(session.devToolsPort);
      const workerTargets = targets.filter((target) => target.type === "service_worker" && target.url.startsWith(`chrome-extension://${session.extensionId}/`));
      session.note(`service_worker targets: ${JSON.stringify(workerTargets.map((target) => target.url))}`);
      expect(workerTargets.map((target) => target.url)).toContain(`chrome-extension://${session.extensionId}/service-worker-loader.js`);
      const startupErrors = session.consoleErrors().filter((entry) => entry.source === "service-worker");
      expect(startupErrors, "no service-worker startup/import error").toEqual([]);
      await assertSmartModeNoLoopbackTrust(session, "AI-24 precondition");
      session.note("The chrome://extensions card itself is human-owned and was not opened; registration is proven by the DevTools service_worker target and a live worker evaluation.");
    });

    await soft("1. Level 10 Immediate redirect reaches Level 4 and stays", async () => {
      const page = await session.newPage();
      const observer = await TabObserver.attach(page);
      await session.gotoReady(page, session.url("/level10-redirects-and-forms.html"));
      const before = Date.now();
      await trustedClick(page, "#immediate");
      await expect.poll(() => /level4-visual-mimicry\.html/.test(page.url()), { timeout: 8000 }).toBe(true);
      await session.requireReady(page);
      await expectStable(page, observer, () => /level4-visual-mimicry\.html/.test(page.url()), 4000, "immediate redirect");
      session.note(`1: commits ${observer.describeCommits(before)}`);
      await observer.detach();
      await page.close();
    });

    await soft("2. Delayed redirect: Level 4 commits, NavSentinel rolls back to Level 10 with the rollback toast; Proceed opens Level 4", async () => {
      const page = await session.newPage();
      const observer = await TabObserver.attach(page);
      await session.gotoReady(page, session.url("/level10-redirects-and-forms.html"));
      const before = Date.now();
      await trustedClick(page, "#delayed");
      await expect.poll(() => observer.commitsSince(before).some((commit) => /level4-visual-mimicry\.html/.test(commit.url)), { timeout: 8000, message: "Level 4 commits first" }).toBe(true);
      await expect.poll(() => /level10-redirects-and-forms\.html/.test(page.url()), { timeout: 20_000, message: "rolled back to Level 10" }).toBe(true);
      const toast = await waitForToast(page, /rolled back a suspicious redirect to 127\.0\.0\.1/, 8000);
      session.note(`2: rollback toast "${toast.text}" buttons ${JSON.stringify(toast.buttons)}; commits ${observer.describeCommits(before)}`);
      await session.screenshot(page, "ai24-delayed-redirect-rollback-toast");
      expect(toast.buttons).toContain("Proceed");
      const beforeProceed = Date.now();
      await clickToastButton(page, "Proceed");
      await expect.poll(() => /level4-visual-mimicry\.html/.test(page.url()), { timeout: 8000, message: "Proceed opens Level 4" }).toBe(true);
      await session.requireReady(page);
      await expectStable(page, observer, () => /level4-visual-mimicry\.html/.test(page.url()), 3000, "after Proceed");
      session.note(`2: after Proceed commits ${observer.describeCommits(beforeProceed)}; events ${JSON.stringify(await eventKindsSince(session, before))}`);
      await observer.detach();
      await page.close();
    });

    await soft("3. Programmatic form submit: 'Blocked form submit' before navigation; Allow once submits exactly the form action once; a fresh attempt blocks again", async () => {
      const page = await session.newPage();
      const observer = await TabObserver.attach(page);
      await session.gotoReady(page, session.url("/level10-redirects-and-forms.html"));
      const pagesBefore = openPages(session).length;
      const before = Date.now();
      await trustedClick(page, "#submitDelayed");
      const toast = await waitForToast(page, /^Blocked form submit/, 7000);
      session.note(`3: first attempt toast "${toast.text}" buttons ${JSON.stringify(toast.buttons)}`);
      await session.screenshot(page, "ai24-blocked-form-submit");
      expect(observer.commitsSince(before), "no navigation before the decision").toEqual([]);
      expect(page.url()).toMatch(/level10-redirects-and-forms\.html$/);
      expect(toast.buttons).toContain("Allow once");
      const beforeAllow = Date.now();
      await clickToastButton(page, "Allow once");
      await expect.poll(() => /level1-basic-opacity\.html/.test(page.url()), { timeout: 8000, message: "Allow once reaches Level 1" }).toBe(true);
      const landed = new URL(page.url());
      expect(landed.pathname).toBe("/level1-basic-opacity.html");
      expect(landed.search, "exactly the form action and its field").toBe("?from=level10");
      await session.requireReady(page);
      await page.waitForTimeout(2500);
      const level1Commits = observer.commitsSince(beforeAllow).filter((commit) => /level1-basic-opacity\.html/.test(commit.url));
      session.note(`3: after Allow once commits ${observer.describeCommits(beforeAllow)}`);
      expect(level1Commits.length, "exactly one form navigation").toBe(1);
      expect(observer.commitsSince(beforeAllow).length, "no further navigation after the allowed submit").toBe(1);
      expect(openPages(session).length, "no extra tab").toBe(pagesBefore);

      await session.gotoReady(page, session.url("/level10-redirects-and-forms.html"));
      const again = Date.now();
      await trustedClick(page, "#submitDelayed");
      const second = await waitForToast(page, /^Blocked form submit/, 7000);
      await page.waitForTimeout(3000);
      session.note(`3: fresh attempt toast "${second.text}"; commits since ${observer.describeCommits(again)}`);
      expect(observer.commitsSince(again).filter((commit) => /level1-basic-opacity\.html/.test(commit.url)), "the one-time allowance must not carry over").toEqual([]);
      expect(page.url()).toMatch(/level10-redirects-and-forms\.html$/);
      session.note(`3: events ${JSON.stringify(await eventKindsSince(session, before))}`);
      await observer.detach();
      await page.close();
    });

    await soft("4. Level 5 popunder: click area -> 'Blocked popup', no popup opens; record who blocked it", async () => {
      const page = await session.newPage();
      const observer = await TabObserver.attach(page);
      await session.gotoReady(page, session.url("/level5-window-open-popunder.html"));
      const before = Date.now();
      const pagesBefore = openPages(session).length;
      await trustedClick(page, "#area");
      const toast = await waitForToast(page, /^Blocked popup/, 5000).catch(() => null);
      await page.waitForTimeout(2500);
      const newPages = created.filter((entry) => entry.at >= before);
      const nativeOpens = observer.windowOpensSince(before);
      const blocker = newPages.length > 0 ? "NOT BLOCKED (a popup opened)"
        : nativeOpens.length === 0 ? "NavSentinel (native window.open never reached)"
          : "Chrome popup blocker (native window.open reached but no window was created)";
      session.observe("4 popup decision", `blocker=${blocker}; NavSentinel toast="${toast?.text ?? "none"}"; native window.open calls=${JSON.stringify(nativeOpens.map((open) => ({ url: shortUrl(open.url), userGesture: open.userGesture })))}; new pages=${newPages.length}`);
      await session.screenshot(page, "ai24-level5-blocked-popup");
      expect(newPages.length, "no popup may open").toBe(0);
      expect(openPages(session).length).toBe(pagesBefore);
      expect(toast?.text ?? null, "NavSentinel's own Blocked popup card").toMatch(/^Blocked popup/);
      expect(nativeOpens, "NavSentinel, not Chrome, refused the popup").toEqual([]);
      await observer.detach();
      await page.close();
    });

    const oauthCases: Array<{ id: string; path: string; activation: "click" | "keyboard" }> = [
      { id: "5a", path: "/level8-legit-oauth-popup.html", activation: "click" },
      { id: "5b", path: "/level8-legit-oauth-popup.html", activation: "keyboard" },
      { id: "5c", path: "/level8-legit-oauth-popup.html?input=1", activation: "click" },
      { id: "5d", path: "/level8-legit-oauth-popup.html?input=1", activation: "keyboard" },
    ];
    for (const oauthCase of oauthCases) {
      const how = oauthCase.activation === "click" ? "physical click" : "Tab + Enter";
      const control = oauthCase.path.includes("input=1") ? "submit input" : "Sign in button";
      await soft(`${oauthCase.id}. OAuth popup by ${how} on the ${control}: exactly one popup, no NavSentinel prompt`, async () => {
        const page = await session.newPage();
        const observer = await TabObserver.attach(page);
        await session.gotoReady(page, session.url(oauthCase.path));
        expect(await page.evaluate(() => document.getElementById("signin")?.tagName)).toBe(oauthCase.path.includes("input=1") ? "INPUT" : "BUTTON");
        const before = Date.now();
        if (oauthCase.activation === "click") {
          await trustedClick(page, "#signin");
        } else {
          const presses = await tabTo(page, "signin");
          session.note(`${oauthCase.id}: #signin focused after ${presses} Tab press(es)`);
          await page.keyboard.press("Enter");
        }
        await page.waitForTimeout(3000);
        const newPages = created.filter((entry) => entry.at >= before);
        const nativeOpens = observer.windowOpensSince(before);
        const toast = await toastState(page);
        const popupUrls = newPages.map((entry) => shortUrl(entry.page.isClosed() ? entry.url : entry.page.url()));
        session.observe(`${oauthCase.id} popup decision`, `new pages=${JSON.stringify(popupUrls)}; native window.open calls=${JSON.stringify(nativeOpens.map((open) => ({ url: shortUrl(open.url), name: open.windowName, userGesture: open.userGesture })))}; NavSentinel toast="${toast.text ?? "none"}"`);
        if (newPages.length === 0) {
          session.note(`${oauthCase.id}: no popup -> ${nativeOpens.length === 0 ? "NavSentinel refused before native window.open" : "native window.open reached; Chrome's popup blocker (or the browser) refused it"}`);
        }
        expect(newPages.length, "exactly one OAuth popup").toBe(1);
        expect(popupUrls[0]).toMatch(/level8-oauth-consent\.html\?oauth=1$/);
        expect(toast.text, "no NavSentinel prompt").toBeNull();
        expect(nativeOpens.length, "one native window.open").toBe(1);
        await session.screenshot(newPages[0]!.page, `ai24-${oauthCase.id}-oauth-popup`).catch(() => undefined);
        for (const entry of newPages) if (!entry.page.isClosed()) await entry.page.close();
        await observer.detach();
        await page.close();
      });
    }

    await soft("6. no new errors on page or service-worker consoles", async () => {
      const errors = session.consoleErrors([/favicon\.ico/]);
      session.note(`console errors: ${JSON.stringify(errors)}`);
      expect(errors).toEqual([]);
    });

    session.note(`AI-24 soft-step failures: ${JSON.stringify(failures)}`);
    expect(failures, "every AI-24 step passes").toEqual([]);
  } finally {
    await session.close();
  }
});
