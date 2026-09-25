/**
 * AI-47 row 2 / former AI-39 — extension-origin Proceed once (#601, PR #608).
 * Mirrors docs/agentic/GATE3_GUIDES.md "Active guide: AI-39" step by step in
 * a fresh branded-Chrome profile, adding direct replay attempts the manual
 * guide can only approximate. Automated agent evidence, not the owner result.
 */
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { AcceptanceSession, repoRoot, toastState, trustedClick } from "./acceptance_harness";

const PR_608_MERGE = "595903af89ff3bfb526e71de68f71f8c9459e6d1";

function uniqueMarker(): string {
  return `NSACC${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e6).toString(36).toUpperCase()}`;
}

async function trigger(session: AcceptanceSession, page: Page, marker: string): Promise<void> {
  await session.gotoReady(page, session.url("/acceptance/held-blank.html"));
  await page.evaluate((value) => (window as unknown as { setAcceptanceMarker: (m: string) => void }).setAcceptanceMarker(value), marker);
  await trustedClick(page, "#play");
  await expect.poll(async () => (await toastState(page)).text, { timeout: 5000 }).not.toBeNull();
}

function tabCount(session: AcceptanceSession): number {
  return session.context.pages().filter((page) => !page.isClosed()).length;
}

async function listDecisionsFromPopup(session: AcceptanceSession): Promise<unknown> {
  const popup = await session.openPopup(session.context.pages().find((page) => page.url().includes("held-blank"))!);
  return popup.evaluate(async () => chrome.runtime.sendMessage({ type: "ns-pending-decision-list" }));
}

test("AI-47.2 / former AI-39: Proceed once lives only in the popup, opens exactly once and fails closed", async ({}, testInfo) => {
  const session = await AcceptanceSession.open(testInfo, "AI-47.2-former-AI-39-PR608");
  try {
    await session.step("1. tested head contains the #608 merge", async () => {
      execFileSync("git", ["merge-base", "--is-ancestor", PR_608_MERGE, "HEAD"], { cwd: repoRoot });
      expect(session.receipt.git.productSourceClean, "no uncommitted product source changes").toBe(true);
    });

    const page = await session.newPage();
    const marker = uniqueMarker();

    await session.step("4. held navigation: no tab opens and the page toast offers Dismiss only", async () => {
      const before = tabCount(session);
      await trigger(session, page, marker);
      await page.waitForTimeout(1500);
      expect(tabCount(session), "no destination tab may open on the held click").toBe(before);
      const toast = await toastState(page);
      session.note(`page toast: ${toast.text} | buttons: ${toast.buttons.join(", ")}`);
      expect(toast.buttons).toEqual(["Dismiss"]);
      for (const forbidden of ["Proceed", "Allow once", "Always allow", "Undo"]) {
        expect(toast.buttons.some((label) => label.includes(forbidden)), `page toast must not offer ${forbidden}`).toBe(false);
      }
      await session.screenshot(page, "held-page-toast");
    });

    await session.step("8. chrome.storage.session holds no path/query/fragment marker while pending", async () => {
      const sessionStorage = await session.storageSessionAll("session storage while pending");
      const decision = sessionStorage["ns_sw:pendingDecision"];
      expect(decision, "a pending decision record exists in session storage").toBeTruthy();
      expect(JSON.stringify(decision)).not.toContain(marker);
      expect(JSON.stringify(decision)).not.toMatch(/"(sourceUrl|topUrl|destinationUrl)"/);
      // The destination marker must not be retained anywhere in session storage.
      expect(JSON.stringify(sessionStorage)).not.toContain(marker);
    });

    let decisionToken = "";
    await session.step("5. toolbar popup shows only origins and a countdown; no marker or delivery token in its DOM", async () => {
      const popup = await session.openPopup(page);
      await popup.waitFor("!document.getElementById('pendingDecisions').hidden && document.querySelector('.pending-proceed')");
      const card = await popup.evaluate<{ text: string; html: string }>(() => {
        const host = document.getElementById("pendingDecisions")!;
        return { text: host.innerText, html: document.documentElement.outerHTML };
      });
      session.note(`popup card: ${card.text.replace(/\s+/g, " ")}`);
      const pageOrigin = new URL(page.url()).origin;
      const destinationOrigin = pageOrigin.replace("127.0.0.1", "localhost");
      expect(card.text).toMatch(/navigation held/i);
      expect(card.text).toContain(`From ${pageOrigin}`);
      expect(card.text).toContain(`To ${destinationOrigin}`);
      expect(card.text).toMatch(/\d+s remaining/);
      expect(card.html).not.toContain(marker);
      const listed = await popup.evaluate<{ decisions?: Array<{ deliveryToken?: string; id?: string }> }>(
        async () => chrome.runtime.sendMessage({ type: "ns-pending-decision-list" }),
      );
      decisionToken = listed.decisions?.[0]?.deliveryToken ?? "";
      expect(decisionToken.length).toBeGreaterThan(0);
      expect(card.html, "opaque delivery token must not be rendered").not.toContain(decisionToken);
      await session.screenshotPopup("popup-navigation-held");
    });

    await session.step("6a. mouse Proceed once (double-click) opens exactly one openerless tab at the full URL", async () => {
      const popup = await session.openPopup(page);
      await popup.waitFor("document.querySelector('.pending-proceed')");
      const listed = await popup.evaluate<{ decisions: Array<{ id: string; deliveryToken: string }> }>(
        async () => chrome.runtime.sendMessage({ type: "ns-pending-decision-list" }),
      );
      const decision = listed.decisions[0]!;
      const before = tabCount(session);
      const opened = session.context.waitForEvent("page", { timeout: 8000 });
      await popup.click(".pending-proceed", 2);
      const destination = await opened;
      await destination.waitForLoadState("domcontentloaded");
      await expect.poll(() => destination.url()).toContain(`/acceptance/dest/${marker}/landing.html`);
      expect(destination.url()).toContain(`probe=${marker}`);
      expect(destination.url()).toContain(`#frag-${marker}`);
      expect(await destination.evaluate(() => document.documentElement.dataset.acceptanceOpener)).toBe("false");
      expect(await destination.evaluate(() => window.opener === null)).toBe(true);
      await page.waitForTimeout(1500);
      expect(tabCount(session), "a double-click must open exactly one tab").toBe(before + 1);
      await session.screenshot(destination, "proceed-once-destination");

      // Direct replay of the burned decision with the same id and token.
      const replayPopup = await session.openPopup(page);
      const replay = await replayPopup.evaluate<Record<string, unknown>>(
        async (message: unknown) => chrome.runtime.sendMessage(message),
        { type: "ns-pending-decision-consume", id: decision.id, deliveryToken: decision.deliveryToken, action: "proceed-once" } as never,
      );
      session.note(`replay of consumed decision -> ${JSON.stringify(replay)}`);
      expect(replay.status).not.toBe("consumed");
      await page.waitForTimeout(1000);
      expect(tabCount(session), "a replay must not open a second tab").toBe(before + 1);
      const relist = await replayPopup.evaluate<{ decisions: unknown[] }>(async () => chrome.runtime.sendMessage({ type: "ns-pending-decision-list" }));
      expect(relist.decisions.length, "decision is absent after use").toBe(0);
      await destination.close();
    });

    await session.step("6b. keyboard Tab + Enter Proceed once opens exactly one tab", async () => {
      const keyboardMarker = uniqueMarker();
      await trigger(session, page, keyboardMarker);
      const popup = await session.openPopup(page);
      await popup.waitFor("document.querySelector('.pending-proceed')");
      let focused = "";
      for (let index = 0; index < 25 && focused !== "pending-proceed"; index += 1) {
        await popup.press("Tab");
        focused = await popup.evaluate<string>("document.activeElement?.className ?? ''");
      }
      expect(focused, "Proceed once is reachable with Tab").toBe("pending-proceed");
      const before = tabCount(session);
      const opened = session.context.waitForEvent("page", { timeout: 8000 });
      await popup.press("Enter");
      const destination = await opened;
      await destination.waitForLoadState("domcontentloaded");
      expect(destination.url()).toContain(`/acceptance/dest/${keyboardMarker}/landing.html`);
      expect(await destination.evaluate(() => window.opener === null)).toBe(true);
      await page.waitForTimeout(1000);
      expect(tabCount(session)).toBe(before + 1);
      await destination.close();
    });

    await session.step("7a. an unacted decision expires after 30 s and cannot open a tab", async () => {
      const expiryMarker = uniqueMarker();
      await trigger(session, page, expiryMarker);
      const listedBefore = await listDecisionsFromPopup(session) as { decisions: Array<{ id: string; deliveryToken: string }> };
      expect(listedBefore.decisions.length).toBe(1);
      const stale = listedBefore.decisions[0]!;
      await session.closePopup();
      await page.waitForTimeout(31_500);
      const popup = await session.openPopup(page);
      const hidden = await popup.evaluate<boolean>("document.getElementById('pendingDecisions').hidden");
      expect(hidden, "expired card is not offered").toBe(true);
      const before = tabCount(session);
      const late = await popup.evaluate<Record<string, unknown>>(
        async (message: unknown) => chrome.runtime.sendMessage(message),
        { type: "ns-pending-decision-consume", id: stale.id, deliveryToken: stale.deliveryToken, action: "proceed-once" } as never,
      );
      session.note(`consume after expiry -> ${JSON.stringify(late)}`);
      expect(late.status).not.toBe("consumed");
      await page.waitForTimeout(1000);
      expect(tabCount(session)).toBe(before);
    });

    await session.step("7b. a decision is not offered or executable from a different active HTTP tab", async () => {
      const crossMarker = uniqueMarker();
      await trigger(session, page, crossMarker);
      const listed = await listDecisionsFromPopup(session) as { decisions: Array<{ id: string; deliveryToken: string }> };
      const decision = listed.decisions[0]!;
      await session.closePopup();
      const other = await session.newPage();
      await session.gotoReady(other, session.url("/index.html", "localhost"));
      const popup = await session.openPopup(other);
      const hidden = await popup.evaluate<boolean>("document.getElementById('pendingDecisions').hidden");
      expect(hidden, "other tab's popup must not offer tab A's decision").toBe(true);
      const before = tabCount(session);
      const crossTab = await popup.evaluate<Record<string, unknown>>(
        async (message: unknown) => chrome.runtime.sendMessage(message),
        { type: "ns-pending-decision-consume", id: decision.id, deliveryToken: decision.deliveryToken, action: "proceed-once" } as never,
      );
      session.note(`cross-tab consume -> ${JSON.stringify(crossTab)}`);
      expect(crossTab.status).not.toBe("consumed");
      await other.waitForTimeout(1000);
      expect(tabCount(session)).toBe(before);
      await session.closePopup();
      await other.close();
    });

    await session.step("7c. navigating the source document retires its decision", async () => {
      const navMarker = uniqueMarker();
      await trigger(session, page, navMarker);
      const listed = await listDecisionsFromPopup(session) as { decisions: Array<{ id: string; deliveryToken: string }> };
      const decision = listed.decisions[0]!;
      await session.closePopup();
      await session.gotoReady(page, session.url("/acceptance/held-blank.html?renav=1"));
      const popup = await session.openPopup(page);
      const hidden = await popup.evaluate<boolean>("document.getElementById('pendingDecisions').hidden");
      expect(hidden).toBe(true);
      const before = tabCount(session);
      const stale = await popup.evaluate<Record<string, unknown>>(
        async (message: unknown) => chrome.runtime.sendMessage(message),
        { type: "ns-pending-decision-consume", id: decision.id, deliveryToken: decision.deliveryToken, action: "proceed-once" } as never,
      );
      session.note(`consume after source navigation -> ${JSON.stringify(stale)}`);
      expect(stale.status).not.toBe("consumed");
      await page.waitForTimeout(1000);
      expect(tabCount(session)).toBe(before);
    });

    await session.step("9. no new console errors on page, popup or service worker", async () => {
      const errors = session.consoleErrors([/favicon\.ico/]);
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
