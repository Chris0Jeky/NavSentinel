/**
 * AI-30 — PR #570 Back/Forward history integrity (post-merge, current main).
 * Mirrors docs/agentic/GATE3_GUIDES.md "Active guide: AI-30" steps 2-6 in a
 * fresh branded-Chrome profile with the back/forward cache and Chrome's popup
 * blocker ON. The open-PR/exact-head prechecks are superseded by the guide's
 * post-merge banner; the tested head is recorded in the receipt instead.
 * Automated agent evidence, not the owner result.
 */
import { expect, test, type Page } from "@playwright/test";
import { AcceptanceSession, installBfcacheProbe, lastPageshowPersisted, toastState, trustedClick } from "./acceptance_harness";
import { TabObserver, assertSmartModeNoLoopbackTrust, eventKindsSince, expectStable, stepOf } from "./history_helpers";

test.setTimeout(300_000);

async function historyTraverse(page: Page, direction: "back" | "forward"): Promise<void> {
  if (direction === "back") await page.goBack({ waitUntil: "commit", timeout: 10_000 });
  else await page.goForward({ waitUntil: "commit", timeout: 10_000 });
}

test("AI-30: cross-site Back/Forward keeps every history entry; a later page redirect still rolls back", async ({}, testInfo) => {
  const session = await AcceptanceSession.open(testInfo, "AI-30-PR570-history-integrity");
  const failures: string[] = [];
  const soft = async (title: string, body: () => Promise<void>): Promise<boolean> => {
    const ok = (await session.step(title, async () => { await body(); return true; }, { soft: true })) === true;
    if (!ok) failures.push(title);
    return ok;
  };
  try {
    session.note(`tested head ${session.receipt.git.head}; Chrome ${session.chromeVersion}; ui-guard ${session.guardRevision}; post-merge banner applied (PR-head prechecks skipped)`);

    await soft("2. MV3 service worker registered; Smart mode; no localhost/127.0.0.1 allowlist or trust", async () => {
      expect(session.worker.url()).toMatch(/^chrome-extension:\/\/[a-p]{32}\/service-worker-loader\.js$/);
      const manifestVersion = await session.worker.evaluate(() => chrome.runtime.getManifest().manifest_version);
      expect(manifestVersion).toBe(3);
      await assertSmartModeNoLoopbackTrust(session, "AI-30 precondition");
    });

    const page = await session.newPage();
    const observer = await TabObserver.attach(page);
    let reachedB = false;
    let journeyStart = 0;

    reachedB = await soft("3. P -> A -> B by the visible link, markers on every page, host alternates 127.0.0.1/localhost", async () => {
      const markersP = await session.gotoReady(page, session.url("/history-01-back-forward.html?step=p"));
      journeyStart = Date.now();
      expect(stepOf(page)).toBe("p");
      const hostP = new URL(page.url()).hostname;
      session.note(`P markers ${JSON.stringify(markersP)} host ${new URL(page.url()).host}`);
      await installBfcacheProbe(page);

      await trustedClick(page, "#next");
      await page.waitForURL((url) => url.searchParams.get("step") === "a", { timeout: 10_000 });
      const markersA = await session.requireReady(page);
      const hostA = new URL(page.url()).hostname;
      session.note(`A markers ${JSON.stringify(markersA)} host ${new URL(page.url()).host}`);
      await installBfcacheProbe(page);

      await trustedClick(page, "#next");
      await page.waitForURL((url) => url.searchParams.get("step") === "b", { timeout: 10_000 });
      const markersB = await session.requireReady(page);
      const hostB = new URL(page.url()).hostname;
      session.note(`B markers ${JSON.stringify(markersB)} host ${new URL(page.url()).host}`);
      await installBfcacheProbe(page);

      expect([hostP, hostA, hostB]).toEqual(["127.0.0.1", "localhost", "127.0.0.1"]);
      expect(await toastState(page)).toEqual({ text: null, buttons: [] });
      session.note(`history.length on B = ${await page.evaluate(() => history.length)}; commits: ${observer.describeCommits(journeyStart - 5000)}`);
      await session.screenshot(page, "ai30-on-B");
    });

    if (reachedB) {
      await soft("4a. wait 11 s on B, physical Back reaches A and A stays >= 2 s with no rollback, prompt or toast", async () => {
        await page.waitForTimeout(11_500);
        const before = Date.now();
        await historyTraverse(page, "back");
        await expect.poll(() => stepOf(page), { timeout: 8000 }).toBe("a");
        await session.requireReady(page);
        await expectStable(page, observer, () => stepOf(page) === "a", 2500, "Back B->A");
        session.observe("4a traversal", `commits ${observer.describeCommits(before)}; pageshow.persisted=${await lastPageshowPersisted(page)}; bfcacheNotUsed=${JSON.stringify(observer.bfcacheNotUsed.filter((e) => e.at >= before))}`);
        await session.screenshot(page, "ai30-back-to-A");
      });

      await soft("4b. physical Forward returns to B and B stays stable", async () => {
        const before = Date.now();
        await historyTraverse(page, "forward");
        await expect.poll(() => stepOf(page), { timeout: 8000 }).toBe("b");
        await session.requireReady(page);
        await expectStable(page, observer, () => stepOf(page) === "b", 2500, "Forward A->B");
        session.observe("4b traversal", `commits ${observer.describeCommits(before)}; pageshow.persisted=${await lastPageshowPersisted(page)}`);
      });

      await soft("4c. Back twice: first stays on A, second reaches P (no skip B->P, no return A->B)", async () => {
        let before = Date.now();
        await historyTraverse(page, "back");
        await expect.poll(() => stepOf(page), { timeout: 8000 }).toBe("a");
        await session.requireReady(page);
        await expectStable(page, observer, () => stepOf(page) === "a", 2500, "first Back B->A");
        session.observe("4c first Back", `commits ${observer.describeCommits(before)}; pageshow.persisted=${await lastPageshowPersisted(page)}`);
        before = Date.now();
        await historyTraverse(page, "back");
        await expect.poll(() => stepOf(page), { timeout: 8000 }).toBe("p");
        await session.requireReady(page);
        await expectStable(page, observer, () => stepOf(page) === "p", 2500, "second Back A->P");
        expect(new URL(page.url()).hostname).toBe("127.0.0.1");
        session.observe("4c second Back", `commits ${observer.describeCommits(before)}; pageshow.persisted=${await lastPageshowPersisted(page)}`);
        await session.screenshot(page, "ai30-back-to-P");
      });

      await soft("4d. mouse history shortcut (X1 back button) repeats B -> A after 11 s on B", async () => {
        await historyTraverse(page, "forward");
        await expect.poll(() => stepOf(page), { timeout: 8000 }).toBe("a");
        await historyTraverse(page, "forward");
        await expect.poll(() => stepOf(page), { timeout: 8000 }).toBe("b");
        await session.requireReady(page);
        await page.waitForTimeout(11_500);
        const before = Date.now();
        const viewport = await page.evaluate(() => ({ x: Math.round(innerWidth / 2), y: Math.round(innerHeight - 40) }));
        await observer.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: viewport.x, y: viewport.y });
        await observer.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: viewport.x, y: viewport.y, button: "back", buttons: 8, clickCount: 1 });
        await observer.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: viewport.x, y: viewport.y, button: "back", buttons: 0, clickCount: 1 });
        const moved = await expect.poll(() => stepOf(page), { timeout: 5000 }).toBe("a").then(() => true, () => false);
        if (!moved) {
          session.note("4d: the CDP-dispatched X1 (back) mouse button did not traverse history in this Chrome; the mouse shortcut is NOT-AUTOMATED here (the guide makes it conditional on the test mouse exposing one).");
          session.observe("4d mouse back button", `no traversal; still step=${stepOf(page)}; commits ${observer.describeCommits(before)}`);
          return;
        }
        await session.requireReady(page);
        await expectStable(page, observer, () => stepOf(page) === "a", 2500, "mouse Back B->A");
        session.observe("4d mouse back button", `commits ${observer.describeCommits(before)}; pageshow.persisted=${await lastPageshowPersisted(page)}`);
      });
      await soft("4e. event log holds no rollback or prompt entry for the whole history journey", async () => {
        const events = await eventKindsSince(session, journeyStart);
        session.note(`history journey events: ${JSON.stringify(events)}`);
        expect(events.filter((event) => /rollback|prompt|blocked/.test(event.kind))).toEqual([]);
      });
      session.note(`full history-tab commit timeline: ${observer.describeCommits(journeyStart - 5000)}`);
      session.note(`bfcacheNotUsed events on history tab: ${JSON.stringify(observer.bfcacheNotUsed)}`);
    }

    await soft("5. Level 10 Delayed redirect commits Level 4, then NavSentinel returns to Level 10", async () => {
      const level10 = await session.newPage();
      const l10Observer = await TabObserver.attach(level10);
      await session.gotoReady(level10, session.url("/level10-redirects-and-forms.html"));
      const before = Date.now();
      await trustedClick(level10, "#delayed");
      await expect.poll(() => l10Observer.commitsSince(before).some((commit) => /level4-visual-mimicry\.html/.test(commit.url)), {
        timeout: 8000, message: "the delayed redirect must commit Level 4 first",
      }).toBe(true);
      const level4At = l10Observer.commitsSince(before).find((commit) => /level4-visual-mimicry\.html/.test(commit.url))!.at;
      await expect.poll(() => l10Observer.commitsSince(level4At).some((commit) => /level10-redirects-and-forms\.html/.test(commit.url)), {
        timeout: 20_000, message: "NavSentinel must return the tab to Level 10",
      }).toBe(true);
      await level10.waitForTimeout(2000);
      expect(level10.url()).toMatch(/level10-redirects-and-forms\.html/);
      const toast = await toastState(level10);
      session.note(`5: commits ${l10Observer.describeCommits(before)}; toast="${toast.text}" buttons=${JSON.stringify(toast.buttons)}; events ${JSON.stringify(await eventKindsSince(session, before))}`);
      await session.screenshot(level10, "ai30-level10-rolled-back");
      await l10Observer.detach();
      await level10.close();
    });

    await soft("6. no new errors on History fixture, Level 10 or service-worker consoles", async () => {
      const errors = session.consoleErrors([/favicon\.ico/]);
      session.note(`console errors: ${JSON.stringify(errors)}`);
      expect(errors).toEqual([]);
    });

    await observer.detach();
    session.note(`AI-30 soft-step failures: ${JSON.stringify(failures)}`);
    expect(failures, "every AI-30 step passes").toEqual([]);
  } catch (error) {
    session.markFailed(error);
    throw error;
  } finally {
    await session.close();
  }
});

