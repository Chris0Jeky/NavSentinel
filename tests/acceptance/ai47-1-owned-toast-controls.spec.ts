/**
 * AI-47 step 1 / former AI-38 — PR #600 extension-owned toast controls.
 * Mirrors docs/agentic/GATE3_GUIDES.md "AI-47 former AI-38 PR 600 current-main
 * toast-control subprocedure" in a fresh branded-Chrome profile, using the
 * guide's site-neutral stand-in (`evasion-01-opacity-009.html`), and adds the
 * adversarial page-script variants a hostile page can realistically attempt.
 * Automated agent evidence, never the owner Gate-3 result.
 */
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { AcceptanceSession, repoRoot, trustedClick } from "./acceptance_harness";
import {
  briefCardCount,
  clickToastButton,
  elementVisibility,
  expectEventuallyHidden,
  fullCardCount,
  hitTargetId,
  installPageInputCounter,
  nextPage,
  openTabCount,
  readPageInputEvents,
  tabToToastButton,
  toastButtonCenter,
  toastCards,
} from "./page_ui_helpers";

const PR_600_MERGE = "c8b1a70bef3c92600fdf7af3fb9fdc5e73b236f2";
const MEDIA_STAND_IN = "/evasion-01-opacity-009.html";
const CLEANUP_FIXTURE = "/mutation-01-delayed-overlay.html";
const LEGACY_PROMPT_FIXTURE = "/evasion-02-size-34pct.html";
const ALLOWLIST_KEY = "sentinelsuite:nav_allowlist_v1";
const CONSOLE_NOISE = [/favicon\.ico/];

function requireHead(session: AcceptanceSession): Promise<void | undefined> {
  return session.step("1. tested head contains the PR #600 merge and has no product-source changes", async () => {
    execFileSync("git", ["merge-base", "--is-ancestor", PR_600_MERGE, "HEAD"], { cwd: repoRoot });
    expect(session.receipt.git.productSourceClean, "no uncommitted product source changes").toBe(true);
    session.note(`tested head ${session.receipt.git.head}; ui-guard ${session.guardRevision}; Chrome ${session.chromeVersion}`);
  });
}

/** Load the stand-in, confirm the markers, click the deceptive overlay with real input and wait for the block card. */
async function triggerBlockCard(session: AcceptanceSession, page: Page): Promise<number> {
  const markers = await session.gotoReady(page, session.url(MEDIA_STAND_IN));
  expect(markers).toEqual({ capture: "1", bridge: "1", guard: session.guardRevision });
  await trustedClick(page, "#trap");
  await expect.poll(() => fullCardCount(page), { timeout: 4000, intervals: [50], message: "block card appears" }).toBe(1);
  return Date.now();
}

/** A card removed by its control, not by the 4-second idle timeout. */
async function expectCardLeftPromptly(page: Page, shownAt: number, label: string): Promise<void> {
  await expect.poll(() => fullCardCount(page), { timeout: 900, intervals: [50], message: `${label}: card must leave` }).toBe(0);
  expect(Date.now() - shownAt, `${label}: removal must precede the card's 4 s idle timeout`).toBeLessThan(3600);
}

function trackOpenedPages(session: AcceptanceSession): Page[] {
  const opened: Page[] = [];
  session.context.on("page", (candidate) => opened.push(candidate));
  return opened;
}

test("AI-47.1 / former AI-38: regular block card Dismiss (mouse, Tab+Enter, Tab+Space), Proceed once and a late max-z layer", async ({}, testInfo) => {
  const session = await AcceptanceSession.open(testInfo, "AI-47.1-former-AI-38-PR600");
  try {
    await requireHead(session);
    const page = await session.newPage();
    const opened = trackOpenedPages(session);

    await session.step("4. stand-in page reports capture=1, bridge=1 and the built ui-guard revision", async () => {
      const markers = await session.gotoReady(page, session.url(MEDIA_STAND_IN));
      session.note(`markers: ${JSON.stringify(markers)}`);
      expect(markers).toEqual({ capture: "1", bridge: "1", guard: session.guardRevision });
    });

    await session.step("5a. mouse Dismiss: card leaves, no tab opens, no second blocked notice, zero page input", async () => {
      const shownAt = await triggerBlockCard(session, page);
      const cards = await toastCards(page);
      session.note(`regular block card: ${JSON.stringify(cards)}`);
      await session.screenshot(page, "5a-block-card");
      await installPageInputCounter(page);
      const openedBefore = opened.length;
      await clickToastButton(page, page, "Dismiss", "full");
      await expectCardLeftPromptly(page, shownAt, "mouse Dismiss");
      await page.waitForTimeout(1500);
      expect(await fullCardCount(page), "no second blocked notice may follow the click").toBe(0);
      expect(opened.length - openedBefore, "Dismiss must not open a tab").toBe(0);
      expect(await readPageInputEvents(page), "no page-owned listener may observe the Dismiss click").toEqual([]);
      expect(page.url()).toContain(MEDIA_STAND_IN);
    });

    await session.step("5b. page card offers Dismiss only (post-#608); popup Proceed once opens exactly one tab", async () => {
      await triggerBlockCard(session, page);
      const cards = await toastCards(page);
      expect(cards.filter((card) => !card.persistent).map((card) => card.buttons)).toEqual([["Dismiss"]]);
      session.note("Allow once is no longer on the regular page card since PR #608; the owner-facing equivalent is the popup's Proceed once.");
      const popup = await session.openPopup(page);
      await popup.waitFor("document.querySelector('.pending-proceed')", 5000);
      await session.screenshotPopup("5b-popup-navigation-held");
      const before = openTabCount(session.context);
      const destinationPromise = nextPage(session.context, 8000);
      await popup.click(".pending-proceed");
      const destination = await destinationPromise;
      expect(destination, "Proceed once must open the held destination").not.toBeNull();
      await destination!.waitForLoadState("domcontentloaded");
      expect(destination!.url()).toContain("/local-fixture-sink.html");
      await page.waitForTimeout(1500);
      expect(openTabCount(session.context), "exactly one approved tab").toBe(before + 1);
      await session.screenshot(destination!, "5b-proceed-once-destination");
      await session.closePopup();
      await destination!.close();
    });

    for (const key of ["Enter", "Space"] as const) {
      await session.step(`6. Tab to Dismiss and press ${key}: card leaves with zero page input`, async () => {
        const shownAt = await triggerBlockCard(session, page);
        const presses = await tabToToastButton(page, page, "Dismiss");
        expect(presses, "Dismiss is reachable with Tab").toBeGreaterThan(0);
        session.note(`Tab presses to reach Dismiss: ${presses}`);
        await installPageInputCounter(page);
        const openedBefore = opened.length;
        await page.keyboard.press(key);
        await expectCardLeftPromptly(page, shownAt, `Tab + ${key}`);
        await page.waitForTimeout(1000);
        expect(await readPageInputEvents(page), `no page-owned listener may observe ${key}`).toEqual([]);
        expect(opened.length - openedBefore).toBe(0);
        expect(await fullCardCount(page)).toBe(0);
      });
    }

    await session.step("8. a later fixed inset:0 z-index:2147483647 layer on <html> neither covers nor disables the card", async () => {
      const shownAt = await triggerBlockCard(session, page);
      await page.evaluate(() => {
        const counts = { div: 0, frame: 0 };
        (window as unknown as { __lateLayerClicks: typeof counts }).__lateLayerClicks = counts;
        const layer = document.createElement("div");
        layer.id = "late-hostile-layer";
        layer.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.02)";
        for (const type of ["pointerdown", "mousedown", "click"]) layer.addEventListener(type, () => { counts.div += 1; });
        document.documentElement.appendChild(layer);
        const frame = document.createElement("iframe");
        frame.id = "late-cover-frame";
        frame.style.cssText = "position:fixed!important;inset:0!important;width:100%!important;height:100%!important;" +
          "z-index:2147483647!important;border:0!important;background:transparent!important;opacity:0.999";
        document.documentElement.appendChild(frame);
      });
      const dismiss = await toastButtonCenter(page, "Dismiss", "full");
      const hit = await hitTargetId(page, dismiss);
      session.note(`hit target at Dismiss after late layers: ${hit}`);
      expect(hit, "the late layer must not sit above the toast host").toBe("__navsentinel_toast_host");
      await session.screenshot(page, "8-late-layer-card-on-top");
      await installPageInputCounter(page);
      await page.mouse.click(dismiss.x, dismiss.y);
      await expectCardLeftPromptly(page, shownAt, "Dismiss above late layer");
      expect(await page.evaluate(() => (window as unknown as { __lateLayerClicks: { div: number } }).__lateLayerClicks.div)).toBe(0);
      expect(await readPageInputEvents(page)).toEqual([]);
    });

    await session.step("9. no new console errors on page, popup or service worker", async () => {
      const errors = session.consoleErrors(CONSOLE_NOISE);
      session.note(`console errors: ${JSON.stringify(errors)}`);
      expect(errors).toEqual([]);
    }, { soft: true });
  } finally {
    await session.close();
  }
});

test("AI-47.1 / former AI-38: cleanup Undo by mouse and keyboard; cleanup prompt Allow once opens exactly one tab", async ({}, testInfo) => {
  const session = await AcceptanceSession.open(testInfo, "AI-47.1-former-AI-38-PR600-cleanup");
  try {
    await requireHead(session);
    await session.patchNavigation({ defaultMode: "smart", autoDismissOverlays: true });
    const page = await session.newPage();
    const opened = trackOpenedPages(session);

    for (const input of ["mouse", "keyboard Tab+Enter"] as const) {
      await session.step(`7. mutation-01 cleanup card: Undo by ${input} restores the layer with zero page input`, async () => {
        await session.gotoReady(page, session.url(CLEANUP_FIXTURE));
        await installPageInputCounter(page);
        const openedBefore = opened.length;
        // Human fallback timer (10 s); the E2E-only trigger event is not used.
        await expectEventuallyHidden(page, "#malicious-overlay", 16_000, "overlay is hidden automatically");
        await expect.poll(() => briefCardCount(page), { timeout: 1500, intervals: [25] }).toBe(1);
        if (input === "mouse") {
          await clickToastButton(page, page, "Undo", "brief");
        } else {
          const presses = await tabToToastButton(page, page, "Undo");
          expect(presses, "Undo is reachable with Tab inside its brief window").toBeGreaterThan(0);
          await installPageInputCounter(page);
          await page.keyboard.press("Enter");
        }
        await expect.poll(async () => (await elementVisibility(page, "#malicious-overlay")).visible, { timeout: 1500, intervals: [50] }).toBe(true);
        await page.waitForTimeout(800);
        expect((await elementVisibility(page, "#malicious-overlay")).visible, "restored layer stays restored").toBe(true);
        expect(await readPageInputEvents(page), "Undo must not reach page listeners").toEqual([]);
        expect(opened.length - openedBefore).toBe(0);
        expect(page.url()).toContain(CLEANUP_FIXTURE);
        await session.screenshot(page, `7-undo-${input.split(" ")[0]}-restored`);
      });
    }

    await session.step("5 (cleanup variant). click-time cleanup prompt: trusted Allow once opens exactly one tab", async () => {
      await session.gotoReady(page, session.url(LEGACY_PROMPT_FIXTURE));
      await expectEventuallyHidden(page, "#trap", 3000, "trap hidden automatically on load");
      await clickToastButton(page, page, "Undo", "brief");
      await expect.poll(async () => (await elementVisibility(page, "#trap")).visible, { timeout: 1500 }).toBe(true);
      const openedBefore = opened.length;
      await trustedClick(page, "#trap");
      await expect.poll(() => fullCardCount(page), { timeout: 3000, intervals: [50] }).toBe(1);
      const card = (await toastCards(page)).find((candidate) => !candidate.persistent)!;
      session.note(`click-time cleanup card: ${JSON.stringify(card)}`);
      expect(card.text).toContain("(overlay hidden)");
      expect(card.buttons).toContain("Allow once");
      expect(card.buttons).toContain("Undo");
      expect(opened.length - openedBefore, "the trap's tab stays blocked").toBe(0);
      await session.screenshot(page, "5-cleanup-prompt");
      const before = openTabCount(session.context);
      const destinationPromise = nextPage(session.context, 6000);
      await clickToastButton(page, page, "Allow once", "full");
      const destination = await destinationPromise;
      expect(destination, "Allow once opens the approved tab").not.toBeNull();
      await destination!.waitForLoadState("domcontentloaded");
      session.note(`Allow once destination: ${destination!.url().split("?")[0]}`);
      await page.waitForTimeout(1500);
      expect(openTabCount(session.context), "exactly one approved tab").toBe(before + 1);
      await destination!.close();
    });

    await session.step("9. no new console errors on page, popup or service worker", async () => {
      const errors = session.consoleErrors(CONSOLE_NOISE);
      session.note(`console errors: ${JSON.stringify(errors)}`);
      expect(errors).toEqual([]);
    }, { soft: true });
  } finally {
    await session.close();
  }
});

type SyntheticKind = "element.click()" | "dispatched MouseEvent/PointerEvent" | "focus + dispatched KeyboardEvent Enter/Space";

/** Page-world script attempts to activate a real extension-owned control; returns what it could reach. */
async function pageScriptActivate(page: Page, label: string, kind: SyntheticKind): Promise<string> {
  return page.evaluate(({ expected, how }) => {
    const button = Array.from(document.querySelectorAll("#__navsentinel_toast_host"))
      .flatMap((host) => Array.from(host.shadowRoot?.querySelectorAll("button") ?? []))
      .find((candidate) => candidate.textContent?.trim() === expected) as HTMLButtonElement | undefined;
    if (!button) return "control-not-reachable-from-page";
    const rect = button.getBoundingClientRect();
    const init = { bubbles: true, composed: true, cancelable: true, view: window, clientX: rect.x + 4, clientY: rect.y + 4, detail: 1 };
    if (how === "element.click()") {
      button.click();
    } else if (how === "dispatched MouseEvent/PointerEvent") {
      button.dispatchEvent(new PointerEvent("pointerdown", init));
      button.dispatchEvent(new MouseEvent("mousedown", init));
      button.dispatchEvent(new PointerEvent("pointerup", init));
      button.dispatchEvent(new MouseEvent("mouseup", init));
      button.dispatchEvent(new MouseEvent("click", init));
    } else {
      button.focus();
      for (const [key, code] of [["Enter", "Enter"], [" ", "Space"]] as const) {
        for (const type of ["keydown", "keypress", "keyup"]) {
          button.dispatchEvent(new KeyboardEvent(type, { key, code, bubbles: true, composed: true, cancelable: true }));
        }
      }
    }
    return "dispatched";
  }, { expected: label, how: kind });
}

/**
 * NavSentinel's own window-capture click classifier also sees a page-script
 * click. Right after a trusted pointerdown it treats the synthetic click as a
 * deceptive click, blocks it and REPLACES the card; after the 1.5 s pointer
 * correlation window it may not. Each variant is therefore run both
 * immediately and after the page idles past that window, as a patient hostile
 * page would.
 */
const IDLE_PAST_POINTER_WINDOW_MS = 1700;
type Timing = "immediately" | "after 1.7 s idle";

test("AI-47.1 adversarial: page scripts and a forged host cannot activate NavSentinel-owned controls", async ({}, testInfo) => {
  const session = await AcceptanceSession.open(testInfo, "AI-47.1-adversarial-owned-controls");
  try {
    await requireHead(session);
    const page = await session.newPage();
    const opened = trackOpenedPages(session);

    const variants: Array<[SyntheticKind, Timing]> = [
      ["element.click()", "immediately"],
      ["element.click()", "after 1.7 s idle"],
      ["dispatched MouseEvent/PointerEvent", "after 1.7 s idle"],
      ["focus + dispatched KeyboardEvent Enter/Space", "after 1.7 s idle"],
    ];
    for (const [kind, timing] of variants) {
      await session.step(`A. regular block card: page ${kind} on Dismiss ${timing} does not dismiss the warning`, async () => {
        await triggerBlockCard(session, page);
        const original = (await toastCards(page)).find((card) => !card.persistent)!.text;
        if (timing !== "immediately") await page.waitForTimeout(IDLE_PAST_POINTER_WINDOW_MS);
        const reach = await pageScriptActivate(page, "Dismiss", kind);
        await page.waitForTimeout(300);
        const after = await toastCards(page);
        session.note(`Dismiss via page ${kind} ${timing}: ${reach}; cards after: ${JSON.stringify(after)}`);
        if (after.some((card) => !card.persistent && card.text !== original)) {
          session.observe(`A. ${kind} ${timing}: original card replaced`, `NavSentinel's click classifier blocked the synthetic click and replaced "${original}" with ${JSON.stringify(after)}`);
        }
        expect(after.filter((card) => !card.persistent).length, `page ${kind} ${timing} must not remove the NavSentinel warning`).toBeGreaterThan(0);
      }, { soft: true });
    }

    await session.step("B. a page-forged #__navsentinel_toast_host cannot activate the real Dismiss", async () => {
      await triggerBlockCard(session, page);
      await page.evaluate(() => {
        const real = document.querySelector("#__navsentinel_toast_host");
        const dismiss = Array.from(real?.shadowRoot?.querySelectorAll("button") ?? [])
          .find((button) => button.textContent?.trim() === "Dismiss");
        const fakeHost = document.createElement("div");
        fakeHost.id = "__navsentinel_toast_host";
        fakeHost.style.cssText = "position:fixed;inset:0;z-index:2147483646;";
        const fakeRoot = fakeHost.attachShadow({ mode: "open" });
        const bait = document.createElement("button");
        bait.style.cssText = "position:fixed;inset:0;opacity:0.01";
        bait.textContent = "Dismiss";
        for (const attribute of Array.from(dismiss?.attributes ?? [])) bait.setAttribute(attribute.name, attribute.value);
        fakeRoot.appendChild(bait);
        document.body.appendChild(fakeHost);
      });
      const openedBefore = opened.length;
      await page.mouse.click(40, 40);
      await page.waitForTimeout(250);
      const realCards = await page.evaluate(() => Array.from(document.querySelectorAll("#__navsentinel_toast_host"),
        (host) => host.shadowRoot?.querySelectorAll(".wrap:not([data-persistent='true'])").length ?? 0));
      session.note(`full cards per host element after the forged-host click: ${JSON.stringify(realCards)}`);
      expect(realCards.reduce((sum, value) => sum + value, 0), "the real card must remain unactivated").toBe(1);
      expect(opened.length - openedBefore).toBe(0);
    }, { soft: true });

    await session.patchNavigation({ defaultMode: "smart", autoDismissOverlays: true });

    await session.step("C. brief cleanup card: page element.click() on Undo cannot restore the hidden trap", async () => {
      await session.gotoReady(page, session.url(LEGACY_PROMPT_FIXTURE));
      await expectEventuallyHidden(page, "#trap", 3000, "trap hidden automatically on load");
      await expect.poll(() => briefCardCount(page), { timeout: 1500, intervals: [25] }).toBe(1);
      const reach = await pageScriptActivate(page, "Undo", "element.click()");
      await page.waitForTimeout(300);
      const trapVisible = (await elementVisibility(page, "#trap")).visible;
      const log = (await session.eventLog("event log after page click on brief Undo")).slice(-3);
      session.note(`brief Undo via page element.click(): ${reach}; trap visible=${trapVisible}; last events=${JSON.stringify(log.map((entry) => ({ kind: entry.kind, reasons: entry.reasons })))}`);
      await session.screenshot(page, "C-after-page-click-on-brief-undo");
      expect(trapVisible, "a page script must not undo NavSentinel's cleanup").toBe(false);
    }, { soft: true });

    for (const timing of ["immediately", "after 1.7 s idle"] as const) {
      for (const label of ["Always allow", "Allow once", "Undo"] as const) {
        await session.step(`D. click-time cleanup prompt: page element.click() on "${label}" ${timing} is inert`, async () => {
          await session.gotoReady(page, session.url(LEGACY_PROMPT_FIXTURE));
          await expectEventuallyHidden(page, "#trap", 3000, "trap hidden automatically on load");
          await clickToastButton(page, page, "Undo", "brief");
          await expect.poll(async () => (await elementVisibility(page, "#trap")).visible, { timeout: 1500 }).toBe(true);
          await trustedClick(page, "#trap");
          await expect.poll(() => fullCardCount(page), { timeout: 3000, intervals: [50] }).toBe(1);
          await expect.poll(async () => (await elementVisibility(page, "#trap")).visible, { timeout: 1500 }).toBe(false);
          const allowlistBefore = JSON.stringify(await session.storageLocal(ALLOWLIST_KEY) ?? null);
          const openedBefore = opened.length;
          if (timing !== "immediately") await page.waitForTimeout(IDLE_PAST_POINTER_WINDOW_MS);
          const reach = await pageScriptActivate(page, label, "element.click()");
          await page.waitForTimeout(1200);
          const allowlistAfter = JSON.stringify(await session.storageLocal(ALLOWLIST_KEY, `allowlist after page click on ${label} ${timing}`) ?? null);
          const state = {
            reach,
            cards: await toastCards(page),
            tabsOpened: opened.length - openedBefore,
            trapVisible: (await elementVisibility(page, "#trap")).visible,
            allowlistChanged: allowlistBefore !== allowlistAfter,
          };
          session.note(`cleanup prompt "${label}" via page element.click() ${timing}: ${JSON.stringify(state)}; allowlist after=${allowlistAfter}`);
          if (state.tabsOpened || state.allowlistChanged || state.trapVisible) await session.screenshot(page, `D-${label}-${timing}-activated`);
          for (const extra of opened.slice(openedBefore)) await extra.close().catch(() => undefined);
          if (state.allowlistChanged) {
            // Restore the profile so later variants start from an empty allowlist.
            await session.worker.evaluate(async ({ key, before }) => { if (before === null) await chrome.storage.local.remove(key); else await chrome.storage.local.set({ [key]: before }); }, { key: ALLOWLIST_KEY, before: JSON.parse(allowlistBefore) });
          }
          expect(state.tabsOpened, `page click on ${label} must not open a tab`).toBe(0);
          expect(state.allowlistChanged, `page click on ${label} must not persist an allowlist entry`).toBe(false);
          expect(state.trapVisible, `page click on ${label} must not restore the hidden trap`).toBe(false);
        }, { soft: true });
      }
    }

    await session.step("E. every adversarial variant above was inert", async () => {
      const failed = session.receipt.steps.filter((step) => step.status === "failed").map((step) => step.title);
      expect(failed).toEqual([]);
    });
  } finally {
    await session.close();
  }
});
