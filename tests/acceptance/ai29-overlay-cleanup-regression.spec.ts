/**
 * AI-29 regression — issue #555 / PR #557 opt-in "hide risky overlays on load",
 * the last owner-tested feature (completed 2026-08-28). Re-runs the retained
 * procedure in docs/agentic/GATE3_GUIDES.md "Completed record: AI-29" (steps
 * 3-11) and the expectations recorded in ACTION_ITEMS.md against the current
 * build in a fresh branded-Chrome profile, to prove the baseline still holds
 * after everything merged since. Automated agent evidence, never an owner
 * Gate-3 result; AI-29 is not reopened by this lane.
 */
import { execFileSync } from "node:child_process";
import { expect, test, type Frame, type Page } from "@playwright/test";
import { AcceptanceSession, SETTINGS_KEY, repoRoot, trustedClick } from "./acceptance_harness";
import {
  briefCardCount,
  clickToastButton,
  elementVisibility,
  expectEventuallyHidden,
  fullCardCount,
  hitTargetId,
  nextPage,
  openTabCount,
  toastCards,
} from "./page_ui_helpers";

const PR_557_MERGE = "d132eace0d2b7e905d5d6eb5ad4c831236f925b2";
const CONSOLE_NOISE = [/favicon\.ico/];

async function requireHead(session: AcceptanceSession): Promise<void> {
  await session.step("1-2. tested head contains the PR #557 merge; build markers recorded", async () => {
    execFileSync("git", ["merge-base", "--is-ancestor", PR_557_MERGE, "HEAD"], { cwd: repoRoot });
    expect(session.receipt.git.productSourceClean).toBe(true);
    session.note(`tested head ${session.receipt.git.head}; ui-guard ${session.guardRevision}; Chrome ${session.chromeVersion}`);
  });
}

async function navSettings(session: AcceptanceSession): Promise<{ defaultMode?: string; autoDismissOverlays?: boolean }> {
  const stored = await session.storageLocal<{ nav?: { defaultMode?: string; autoDismissOverlays?: boolean } }>(SETTINGS_KEY);
  return stored?.nav ?? {};
}

function trackOpenedPages(session: AcceptanceSession): Page[] {
  const opened: Page[] = [];
  session.context.on("page", (candidate) => opened.push(candidate));
  return opened;
}

async function visible(scope: Page | Frame, selector: string): Promise<boolean> {
  return (await elementVisibility(scope, selector)).visible;
}

/** Records, from document start, when `#trap` first becomes display:none relative to DOMContentLoaded. */
async function installHideTimer(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = { dcl: -1, hiddenAt: -1, trapClicks: 0 };
    (window as unknown as { __nsAccHide: typeof state }).__nsAccHide = state;
    document.addEventListener("DOMContentLoaded", () => { state.dcl = performance.now(); });
    new MutationObserver(() => {
      const trap = document.getElementById("trap");
      if (trap && state.hiddenAt < 0 && getComputedStyle(trap).display === "none") state.hiddenAt = performance.now();
    }).observe(document, { attributes: true, attributeFilter: ["style"], subtree: true, childList: true });
  });
}

async function readHideTimer(page: Page): Promise<{ dcl: number; hiddenAt: number }> {
  return page.evaluate(() => (window as unknown as { __nsAccHide: { dcl: number; hiddenAt: number } }).__nsAccHide);
}

test("AI-29 regression: setting surfaces, mutation-01 fallback, load-time trap cleanup with Undo, grouped layers", async ({}, testInfo) => {
  test.setTimeout(240_000);
  const session = await AcceptanceSession.open(testInfo, "AI-29-regression-PR557-core");
  try {
    await requireHead(session);
    const page = await session.newPage();
    const opened = trackOpenedPages(session);
    await session.gotoReady(page, session.url("/index.html"));

    await session.step("3a. Options: Auto-dismiss overlays is off by default, high-risk wording, works by mouse and keyboard", async () => {
      const options = await session.openExtensionPage("src/options/options.html");
      const toggle = options.locator("#dismiss");
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      const description = (await options.locator("#desc-od").textContent()) ?? "";
      session.note(`Options description: ${description}`);
      expect(description.toLowerCase()).toContain("high-risk");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "true");
      // Options auto-saves (250 ms debounce) — the mouse change must persist.
      await expect.poll(async () => (await navSettings(session)).autoDismissOverlays, { timeout: 3000 }).toBe(true);
      await toggle.focus();
      await options.keyboard.press("Space");
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      await expect.poll(async () => (await navSettings(session)).autoDismissOverlays, { timeout: 3000 }).toBe(false);
      await session.screenshot(options, "3a-options-default-off");
      await options.close();
    });

    await session.step("3b. popup: same default-off checkbox, works by mouse and keyboard; turned on it survives popup and Options reopen", async () => {
      let popup = await session.openPopup(page);
      expect(await popup.evaluate<boolean>("document.getElementById('autoDismiss').checked")).toBe(false);
      await popup.click("#autoDismiss");
      await popup.waitFor("document.getElementById('autoDismiss').checked === true", 2000);
      await popup.click("#autoDismiss");
      await popup.waitFor("document.getElementById('autoDismiss').checked === false", 2000);
      let focused = "";
      for (let index = 0; index < 40 && focused !== "autoDismiss"; index += 1) {
        await popup.press("Tab");
        focused = await popup.evaluate<string>("document.activeElement?.id ?? ''");
      }
      expect(focused, "the popup checkbox is reachable with Tab").toBe("autoDismiss");
      await popup.press("Space");
      await popup.waitFor("document.getElementById('autoDismiss').checked === true", 2000);
      await expect.poll(async () => (await navSettings(session)).autoDismissOverlays, { timeout: 3000 }).toBe(true);
      await session.closePopup();
      popup = await session.openPopup(page);
      expect(await popup.evaluate<boolean>("document.getElementById('autoDismiss').checked"), "still on after popup reopen").toBe(true);
      await session.screenshotPopup("3b-popup-cleanup-on");
      await session.closePopup();
      const options = await session.openExtensionPage("src/options/options.html");
      await expect(options.locator("#dismiss"), "Options shows it on after reopen").toHaveAttribute("aria-checked", "true");
      await options.close();
    });

    await session.step("4. mutation-01 human fallback: overlay hidden automatically, Undo notice, page usable, Undo restores", async () => {
      const markers = await session.gotoReady(page, session.url("/mutation-01-delayed-overlay.html"));
      expect(markers).toEqual({ capture: "1", bridge: "1", guard: session.guardRevision });
      const openedBefore = opened.length;
      await expectEventuallyHidden(page, "#malicious-overlay", 16_000, "fake session overlay hidden automatically");
      await expect.poll(() => briefCardCount(page), { timeout: 1500, intervals: [25] }).toBe(1);
      const card = (await toastCards(page)).find((candidate) => candidate.brief)!;
      const timing = (await page.locator("#timing").textContent()) ?? "";
      const email = await page.locator("input[type=email]").first().boundingBox();
      const hit = await hitTargetId(page, { x: email!.x + 5, y: email!.y + email!.height / 2 });
      session.note(`mutation-01 card ${JSON.stringify(card)}; timing "${timing}"; hit at email field: ${hit}`);
      await session.screenshot(page, "4-mutation01-hidden");
      await clickToastButton(page, page, "Undo", "brief");
      await expect.poll(() => visible(page, "#malicious-overlay"), { timeout: 1500 }).toBe(true);
      expect(card.text).toContain("Overlay hidden; still watching");
      expect(card.buttons).toEqual(["Undo"]);
      expect(timing).toMatch(/human fallback timer/i);
      expect(hit, "the underlying page is usable while the overlay is hidden").not.toBe("malicious-overlay");
      expect(opened.length - openedBefore, "no popup").toBe(0);
      expect(page.url()).toContain("/mutation-01-delayed-overlay.html");
    });

    await session.step("5a. popup still shows cleanup on", async () => {
      const popup = await session.openPopup(page);
      expect(await popup.evaluate<boolean>("document.getElementById('autoDismiss').checked")).toBe(true);
      await session.closePopup();
    });

    await installHideTimer(page);
    await session.step("5b. evasion-02: the pink trap is hidden before any interaction; Real Link exposed; small card without Dismiss", async () => {
      const openedBefore = opened.length;
      await session.gotoReady(page, session.url("/evasion-02-size-34pct.html"));
      await expectEventuallyHidden(page, "#trap", 2500, "trap hidden automatically (manual allowance 2 s)");
      const timer = await readHideTimer(page);
      const afterDcl = Math.round(timer.hiddenAt - timer.dcl);
      session.note(`trap hidden ${afterDcl} ms after DOMContentLoaded (guide: normally ~500 ms, allow 2 s)`);
      expect(afterDcl, "hidden within the 2 s manual allowance after DOM readiness").toBeLessThanOrEqual(2000);
      if (afterDcl > 500) session.observe("5b. slower than the nominal 500 ms", `${afterDcl} ms after DOMContentLoaded`);
      await expect.poll(() => briefCardCount(page), { timeout: 1500, intervals: [25] }).toBe(1);
      const card = (await toastCards(page)).find((candidate) => candidate.brief)!;
      const link = await page.locator(".real-link").boundingBox();
      const hit = await hitTargetId(page, { x: link!.x + link!.width / 2, y: link!.y + link!.height / 2 });
      await session.screenshot(page, "5b-evasion02-auto-hidden");
      // Undo within its 2 s window; the trap must return without any click being synthesized or replayed.
      await page.evaluate(() => {
        const state = (window as unknown as { __nsAccHide: { trapClicks: number } }).__nsAccHide;
        document.getElementById("trap")!.addEventListener("click", () => { state.trapClicks += 1; }, { capture: true });
      });
      await clickToastButton(page, page, "Undo", "brief");
      await expect.poll(() => visible(page, "#trap"), { timeout: 1500 }).toBe(true);
      await page.waitForTimeout(800);
      const trapClicks = await page.evaluate(() => (window as unknown as { __nsAccHide: { trapClicks: number } }).__nsAccHide.trapClicks);
      session.note(`evasion-02 card ${JSON.stringify(card)}; Real Link hit ${hit}; trap clicks after Undo ${trapClicks}`);
      expect(card.text).toContain("Overlay hidden; still watching");
      expect(card.buttons, "no separate Dismiss button").toEqual(["Undo"]);
      expect(hit, "the visible Real Link is exposed").not.toBe("trap");
      expect(await visible(page, "#trap"), "Undo keeps the trap restored").toBe(true);
      expect(trapClicks, "Undo must not synthesize or replay a click").toBe(0);
      expect(opened.length - openedBefore, "no popup or navigation").toBe(0);
    });

    await session.step("5c. clicking the restored trap: new tab blocked, trap hidden again, card shows (overlay hidden) with Undo", async () => {
      const openedBefore = opened.length;
      await trustedClick(page, "#trap");
      await expect.poll(() => fullCardCount(page), { timeout: 3000, intervals: [50] }).toBe(1);
      await expect.poll(() => visible(page, "#trap"), { timeout: 1500 }).toBe(false);
      const card = (await toastCards(page)).find((candidate) => !candidate.persistent)!;
      session.note(`click-time fallback card: ${JSON.stringify(card)}`);
      await session.screenshot(page, "5c-click-fallback");
      await page.waitForTimeout(1000);
      expect(opened.length - openedBefore, "the new tab stays blocked").toBe(0);
      expect(card.text).toContain("(overlay hidden)");
      expect(card.buttons).toContain("Undo");
    });

    await session.step("6a. evasion-12: both stacked traps hidden without interaction; one card; Undo restores both and they stay", async () => {
      const openedBefore = opened.length;
      await session.gotoReady(page, session.url("/evasion-12-multiple-overlays.html"));
      await expectEventuallyHidden(page, "#trap-a", 2500, "trap-a hidden");
      await expectEventuallyHidden(page, "#trap-b", 2500, "trap-b hidden");
      await expect.poll(() => briefCardCount(page), { timeout: 1500, intervals: [25] }).toBe(1);
      const cards = await toastCards(page);
      expect(cards.filter((card) => card.brief).map((card) => card.text)).toEqual(["Overlay hidden; still watching."]);
      await clickToastButton(page, page, "Undo", "brief");
      await expect.poll(async () => (await visible(page, "#trap-a")) && (await visible(page, "#trap-b")), { timeout: 1500 }).toBe(true);
      await page.waitForTimeout(1500);
      expect(await visible(page, "#trap-a"), "trap-a stays restored").toBe(true);
      expect(await visible(page, "#trap-b"), "trap-b stays restored").toBe(true);
      expect(opened.length - openedBefore).toBe(0);
    });

    await session.step("6b. mutation-05: both sequential layers stay hidden; one Undo restores the group and it stays restored", async () => {
      let restored = false;
      for (let attempt = 1; attempt <= 2 && !restored; attempt += 1) {
        await session.gotoReady(page, session.url("/mutation-05-sequential-overlays.html"));
        await expectEventuallyHidden(page, "#trap-a", 16_000, "first sequential layer hidden");
        await expectEventuallyHidden(page, "#trap-b", 4_000, "second delayed layer hidden");
        if (await briefCardCount(page) === 0) {
          session.note(`mutation-05 attempt ${attempt}: the 2 s Undo window expired before the second layer settled; reloading as the guide allows`);
          continue;
        }
        await clickToastButton(page, page, "Undo", "brief");
        await expect.poll(async () => (await visible(page, "#trap-a")) && (await visible(page, "#trap-b")), { timeout: 1500 }).toBe(true);
        await page.waitForTimeout(1500);
        expect(await visible(page, "#trap-a")).toBe(true);
        expect(await visible(page, "#trap-b")).toBe(true);
        restored = true;
      }
      expect(restored, "one Undo restored both grouped layers").toBe(true);
    });

    await session.step("11. no new console errors on page, popup or service worker", async () => {
      const errors = session.consoleErrors(CONSOLE_NOISE);
      session.note(`console errors: ${JSON.stringify(errors)}`);
      expect(errors).toEqual([]);
    }, { soft: true });
  } catch (error) {
    session.markFailed(error);
    throw error;
  } finally {
    await session.close();
  }
});

async function nestedFrame(session: AcceptanceSession, page: Page, fixtureCase: string): Promise<Frame> {
  await expect.poll(() => page.frames().some((frame) => frame.url().includes("/overlay-nesting-frame.html") &&
    new URL(frame.url()).searchParams.get("case") === fixtureCase), { timeout: 10_000 }).toBe(true);
  const frame = page.frames().find((candidate) => candidate.url().includes("/overlay-nesting-frame.html") &&
    new URL(candidate.url()).searchParams.get("case") === fixtureCase)!;
  await frame.waitForFunction((guard) => document.documentElement.dataset.fixtureReady === "true" &&
    document.documentElement.getAttribute("data-navsentinel-capture-ready") === "1" &&
    document.documentElement.getAttribute("data-navsentinel-bridge-ready") === "1" &&
    document.documentElement.getAttribute("data-navsentinel-ui-guard") === guard, session.guardRevision, { timeout: 10_000 });
  return frame;
}

async function loadNested(session: AcceptanceSession, page: Page, fixtureCase: string): Promise<Frame> {
  await session.gotoReady(page, session.url(`/overlay-nesting-lab.html?case=${fixtureCase}`));
  return nestedFrame(session, page, fixtureCase);
}

/** Samples every [data-attack] layer in the frame for `durationMs`; returns samples where any was visible. */
async function attackExposures(frame: Frame, durationMs: number): Promise<Array<{ at: number; phase: string; visible: string[] }>> {
  return frame.evaluate(async (duration) => {
    const exposures: Array<{ at: number; phase: string; visible: string[] }> = [];
    const started = performance.now();
    while (performance.now() - started < duration) {
      const shown = Array.from(document.querySelectorAll<HTMLElement>("[data-attack='true']")).filter((attack) => {
        const style = getComputedStyle(attack);
        const rect = attack.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      }).map((attack) => attack.id);
      if (shown.length) exposures.push({ at: Math.round(performance.now() - started), phase: document.documentElement.dataset.hostilePhase ?? "", visible: shown });
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    return exposures;
  }, durationMs);
}

test("AI-29 regression: child-frame nesting lab — exact Undo, hostile persistence, scroll reinsertion, compact and benign", async ({}, testInfo) => {
  test.setTimeout(240_000);
  const session = await AcceptanceSession.open(testInfo, "AI-29-regression-PR557-nesting");
  try {
    await requireHead(session);
    await session.patchNavigation({ defaultMode: "smart", autoDismissOverlays: true });
    const page = await session.newPage();
    const opened = trackOpenedPages(session);

    await session.step("7. case=exact: outer media frame stays, nested ad hidden, underlay exposed, Undo card inside the frame restores it", async () => {
      const openedBefore = opened.length;
      const frame = await loadNested(session, page, "exact");
      await expectEventuallyHidden(frame, "#exact-overlay-frame", 4000, "nested advertisement hidden");
      expect(await visible(page, "#media-frame"), "outer synthetic media frame remains").toBe(true);
      expect(await visible(frame, "#underlay"), "Nested frame content exposed").toBe(true);
      await expect.poll(() => briefCardCount(frame), { timeout: 1500, intervals: [25] }).toBe(1);
      await session.screenshot(page, "7-exact-hidden");
      await clickToastButton(page, frame, "Undo", "brief");
      await expect.poll(() => visible(frame, "#exact-overlay-frame"), { timeout: 1500 }).toBe(true);
      await page.waitForTimeout(800);
      expect(await visible(frame, "#exact-overlay-frame"), "restored ad stays").toBe(true);
      expect(opened.length - openedBefore, "no tab").toBe(0);
    });

    await session.step("8a. case=hostile: one Undo click — page capture counter stays 0, layer returns, no tab", async () => {
      const openedBefore = opened.length;
      const frame = await loadNested(session, page, "hostile");
      await expectEventuallyHidden(frame, "#exact-overlay-frame", 4000, "hostile nested ad hidden");
      await expect.poll(() => briefCardCount(frame), { timeout: 1500, intervals: [25] }).toBe(1);
      await clickToastButton(page, frame, "Undo", "brief");
      await expect.poll(() => visible(frame, "#exact-overlay-frame"), { timeout: 1200 }).toBe(true);
      const counter = await frame.evaluate(() => document.documentElement.dataset.pageControlEventCount);
      const status = await frame.locator("#hostile-click-status").textContent();
      session.note(`hostile Undo: pageControlEventCount=${counter}; status="${status}"`);
      await page.waitForTimeout(800);
      expect(counter).toBe("0");
      expect(opened.length - openedBefore).toBe(0);
    });

    await session.step("8b. case=hostile untouched ≥ 8 s: nested ad disappears and stays hidden through flood, rewrite, replacement", async () => {
      const frame = await loadNested(session, page, "hostile");
      await expectEventuallyHidden(frame, "#exact-overlay-frame", 4000, "hostile nested ad hidden");
      const exposures = await attackExposures(frame, 8000);
      const phase = await frame.evaluate(() => document.documentElement.dataset.hostilePhase ?? "");
      session.note(`hostile dwell: final phase ${phase}; exposures ${JSON.stringify(exposures.slice(0, 10))}`);
      await session.screenshot(page, "8b-hostile-after-8s");
      expect(phase, "the fixture reached its node-replacement phase").toBe("node-reinserted");
      expect(exposures, "no attack layer visible after the first hidden state").toEqual([]);
    });

    await session.step("8c. case=hostile: trusted click on Trigger scroll-time reinsertion while the notice shows — delivered, notice leaves, new layer hidden", async () => {
      const openedBefore = opened.length;
      const frame = await loadNested(session, page, "hostile");
      await expectEventuallyHidden(frame, "#exact-overlay-frame", 4000, "hostile nested ad hidden");
      await expect.poll(() => briefCardCount(frame), { timeout: 1500, intervals: [25] }).toBe(1);
      const churn = await frame.locator("#trigger-scroll-churn").boundingBox();
      await page.mouse.click(churn!.x + churn!.width / 2, churn!.y + churn!.height / 2);
      await expect.poll(() => frame.evaluate(() => Boolean(document.getElementById("scroll-overlay-frame"))), { timeout: 2000, message: "page interaction delivered" }).toBe(true);
      await expect.poll(() => briefCardCount(frame), { timeout: 1500 }).toBe(0);
      await expectEventuallyHidden(frame, "#scroll-overlay-frame", 3000, "scroll-reinserted layer hidden");
      const exposures = await attackExposures(frame, 2500);
      expect(exposures).toEqual([]);
      expect(opened.length - openedBefore, "no popup or tab").toBe(0);
    });

    await session.step("8d. the local event log identifies the cleanup outcome", async () => {
      const log = await session.eventLog("event log after hostile cleanup");
      const cleanupRows = log.filter((entry) => entry.kind === "mutation_alert" &&
        typeof (entry.extra as Record<string, unknown> | undefined)?.overlayCleanupOutcome === "string");
      session.note(`cleanup rows: ${JSON.stringify(cleanupRows.slice(-4).map((entry) => ({ reasons: entry.reasons, extra: entry.extra })))}`);
      expect(cleanupRows.length).toBeGreaterThan(0);
      const options = await session.openExtensionPage("src/options/options.html");
      await options.locator('[data-section="log"]').click();
      await options.waitForTimeout(800);
      await session.screenshot(options, "8d-options-event-log");
      await options.close();
    });

    await session.step("8e. case=compact-hostile: the compact interactive attack disappears", async () => {
      const frame = await loadNested(session, page, "compact-hostile");
      await expectEventuallyHidden(frame, "#compact-hostile", 4000, "compact attack hidden");
      expect(await attackExposures(frame, 900)).toEqual([]);
    });

    await session.step("8f. case=benign: all three 'expected visible' controls remain visible", async () => {
      const frame = await loadNested(session, page, "benign");
      await page.waitForTimeout(2500);
      for (const id of ["#benign-dialog", "#low-z-overlay", "#small-overlay"]) {
        expect(await visible(frame, id), `${id} stays visible`).toBe(true);
      }
      expect(await briefCardCount(frame)).toBe(0);
      await session.screenshot(page, "8f-benign");
    });

    await session.step("11. no new console errors on page, popup or service worker", async () => {
      const errors = session.consoleErrors(CONSOLE_NOISE);
      session.note(`console errors: ${JSON.stringify(errors)}`);
      expect(errors).toEqual([]);
    }, { soft: true });
  } catch (error) {
    session.markFailed(error);
    throw error;
  } finally {
    await session.close();
  }
});

test("AI-29 regression: cleanup off and Navigation Off stay inert; legitimate modal and video overlays stay usable", async ({}, testInfo) => {
  test.setTimeout(240_000);
  const session = await AcceptanceSession.open(testInfo, "AI-29-regression-PR557-inert-and-legit");
  try {
    await requireHead(session);
    const page = await session.newPage();

    await session.step("9a. cleanup off: mutation-01 overlay remains visible and the warning is available", async () => {
      await session.patchNavigation({ defaultMode: "smart", autoDismissOverlays: false });
      await session.gotoReady(page, session.url("/mutation-01-delayed-overlay.html"));
      await expect.poll(() => visible(page, "#malicious-overlay"), { timeout: 16_000 }).toBe(true);
      await expect.poll(async () => (await toastCards(page)).map((card) => card.text).join(" | "), { timeout: 4000 }).toMatch(/suspicious overlay/i);
      await page.waitForTimeout(1500);
      expect(await visible(page, "#malicious-overlay"), "overlay stays visible with cleanup off").toBe(true);
      session.note(`cards: ${JSON.stringify(await toastCards(page))}`);
      await session.screenshot(page, "9a-cleanup-off");
    });

    await session.step("9b. Navigation Off + cleanup on: NavSentinel neither hides nor blocks page content", async () => {
      await session.patchNavigation({ defaultMode: "off", autoDismissOverlays: true });
      await session.gotoReady(page, session.url("/mutation-01-delayed-overlay.html"));
      await expect.poll(() => visible(page, "#malicious-overlay"), { timeout: 16_000 }).toBe(true);
      await page.waitForTimeout(2000);
      expect(await visible(page, "#malicious-overlay"), "overlay stays visible in Off mode").toBe(true);
      expect(await toastCards(page), "no NavSentinel card in Off mode").toEqual([]);
      await session.gotoReady(page, session.url("/evasion-02-size-34pct.html"));
      await page.waitForTimeout(2500);
      expect(await visible(page, "#trap"), "load-time trap is not hidden in Off mode").toBe(true);
      expect(await toastCards(page)).toEqual([]);
    });

    await session.step("10a. Smart + cleanup: level7 legitimate modal/backdrop stays visible and usable", async () => {
      await session.patchNavigation({ defaultMode: "smart", autoDismissOverlays: true });
      await session.gotoReady(page, session.url("/level7-legit-modal-backdrop.html"));
      await trustedClick(page, "#open");
      await page.waitForTimeout(3000);
      expect(await visible(page, "#backdrop"), "backdrop not hidden").toBe(true);
      expect(await visible(page, "#modal"), "dialog not hidden").toBe(true);
      expect(await briefCardCount(page), "no cleanup notice").toBe(0);
      await session.screenshot(page, "10a-level7-modal");
      await trustedClick(page, "#close");
      await expect.poll(() => visible(page, "#modal"), { timeout: 1500 }).toBe(false);
      await trustedClick(page, "#open");
      await expect.poll(() => visible(page, "#modal"), { timeout: 1500 }).toBe(true);
      await page.mouse.click(20, 400);
      await expect.poll(() => visible(page, "#backdrop"), { timeout: 1500, message: "backdrop click closes it" }).toBe(false);
    });

    await session.step("10b. Smart + cleanup: level9 legitimate video overlay controls stay visible and usable", async () => {
      await session.gotoReady(page, session.url("/level9-legit-video-overlay.html"));
      await page.waitForTimeout(3000);
      expect(await visible(page, "#overlayBtn")).toBe(true);
      expect(await briefCardCount(page)).toBe(0);
      await trustedClick(page, "#overlayBtn");
      await expect(page.locator("#status")).toHaveText("Status: playing");
      await trustedClick(page, "#overlayBtn");
      await expect(page.locator("#status")).toHaveText("Status: paused");
      expect(await visible(page, "a[target=_blank]"), "docs link visible").toBe(true);
      const before = openTabCount(session.context);
      const docs = nextPage(session.context, 5000);
      await trustedClick(page, "a[target=_blank]");
      const docsPage = await docs;
      await docsPage?.waitForLoadState("domcontentloaded").catch(() => undefined);
      session.note(`level9 docs link opened: ${docsPage ? docsPage.url().split("?")[0] : "none"}; toast cards: ${JSON.stringify(await toastCards(page))}`);
      expect(docsPage, "the ordinary visible link still opens").not.toBeNull();
      expect(openTabCount(session.context)).toBe(before + 1);
      await docsPage?.close();
    });

    await session.step("11. no new console errors on page, popup or service worker", async () => {
      const errors = session.consoleErrors(CONSOLE_NOISE);
      session.note(`console errors: ${JSON.stringify(errors)}`);
      expect(errors).toEqual([]);
    }, { soft: true });
  } catch (error) {
    session.markFailed(error);
    throw error;
  } finally {
    await session.close();
  }
});
