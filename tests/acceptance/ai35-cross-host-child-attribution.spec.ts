/**
 * AI-35 — #539 cross-host child-event attribution (PR #586, post-merge).
 * Mirrors docs/agentic/GATE3_GUIDES.md "AI-35" steps 3-6 in a fresh branded
 * Chrome profile. The open-PR/branch/exact-head prechecks (steps 1-2) are
 * superseded by the guide's post-merge banner; the tested head, product tree,
 * build hash and Chrome version are recorded in the receipt instead. The
 * guide's DevTools snippets are driven through Playwright (page/frame
 * evaluation) and the service worker; the Play click is trusted input.
 * Automated agent evidence, not the owner Gate-3 result.
 */
import { execFileSync } from "node:child_process";
import { expect, test, type Frame, type Page } from "@playwright/test";
import { AcceptanceSession, EVENT_LOG_KEY, SETTINGS_KEY, repoRoot } from "./acceptance_harness";
import {
  isBareHostname,
  readPopupGauge,
  requireFrameReady,
  tabCount,
  trustedClickInFrame,
  waitForPopupGauge,
} from "./attribution_helpers";

const PR_586_MERGE = "b68f403a7f14379305cf1376f3ee4f188ef31493";
const THREAT_NOTE = "Threat alert recorded, no risk score";
const FRAME_SELECTOR = "#ai35-child-frame";

test.setTimeout(240_000);

test("AI-35: a cross-host child-frame event keeps site=localhost, gains pageSite=127.0.0.1, and stays on its own tab's popup", async ({}, testInfo) => {
  const session = await AcceptanceSession.open(testInfo, "AI-35-PR586-cross-host-child-attribution");
  const failures: string[] = [];
  const soft = async (title: string, body: () => Promise<void>): Promise<boolean> => {
    const ok = (await session.step(title, async () => { await body(); return true; }, { soft: true })) === true;
    if (!ok) failures.push(title);
    return ok;
  };
  try {
    session.note(`tested head ${session.receipt.git.head}; product tree ${session.receipt.git.productSourceTree}; last product commit ${session.receipt.git.lastProductCommit}; Chrome ${session.chromeVersion}; ui-guard ${session.guardRevision}; post-merge banner applied (PR-head prechecks skipped)`);

    await soft("2. tested head contains the PR #586 merge; product source clean; Smart mode; no loopback allowlist", async () => {
      execFileSync("git", ["merge-base", "--is-ancestor", PR_586_MERGE, "HEAD"], { cwd: repoRoot });
      expect(session.receipt.git.productSourceClean, "no uncommitted product source changes").toBe(true);
      const settings = await session.storageLocal<Record<string, unknown> | undefined>(SETTINGS_KEY, "settings at start");
      const nav = (settings?.nav ?? {}) as Record<string, unknown>;
      session.note(`nav settings at start: ${JSON.stringify(nav)}`);
      expect(nav.defaultMode ?? "smart", "Navigation must be Smart").toBe("smart");
      const allowlist = await session.storageLocal<unknown>("sentinelsuite:nav_allowlist_v1", "nav allowlist at start");
      const trusted = await session.storageLocal<unknown>("sentinelsuite:trusted_domains_v1", "trusted domains at start");
      expect(JSON.stringify([allowlist ?? null, trusted ?? null]), "no localhost/127.0.0.1 allowlist or trust entry").not.toMatch(/localhost|127\.0\.0\.1/);
    });

    const page = await session.newPage();
    let child: Frame | undefined;

    const framesReady = await soft("3. top page on 127.0.0.1 and injected visible localhost child frame both report capture=1, bridge=1 and the built guard", async () => {
      const top = await session.gotoReady(page, session.url("/index.html?ai35=top"));
      session.note(`top markers ${JSON.stringify(top)} at ${new URL(page.url()).host}`);
      expect(top).toEqual({ capture: "1", bridge: "1", guard: session.guardRevision });
      expect(new URL(page.url()).hostname).toBe("127.0.0.1");

      // The guide's DevTools snippet, verbatim in effect.
      const src = await page.evaluate(async () => {
        const frame = document.createElement("iframe");
        frame.id = "ai35-child-frame";
        frame.src = `http://localhost:${location.port}/level1-basic-opacity.html?ai35=child`;
        frame.style.cssText =
          "position:fixed;left:24px;top:160px;width:520px;height:360px;z-index:2147483647;border:1px solid #777";
        const loaded = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
        document.body.appendChild(frame);
        await loaded;
        return frame.src;
      });
      expect(new URL(src).hostname).toBe("localhost");
      await expect.poll(() => page.frames().some((frame) => frame.url().includes("ai35=child")), { timeout: 10_000 }).toBe(true);
      child = page.frames().find((frame) => frame.url().includes("ai35=child"))!;
      const childMarkers = await requireFrameReady(child, session.guardRevision);
      session.receipt.markers.push({ url: `child:${new URL(child.url()).origin}${new URL(child.url()).pathname}`, markers: childMarkers });
      session.note(`child markers ${JSON.stringify(childMarkers)} at ${new URL(child.url()).host}`);
      expect(childMarkers).toEqual({ capture: "1", bridge: "1", guard: session.guardRevision });
      const targetsReady = await child.evaluate(() => document.documentElement.dataset.navsentinelLocalTargetsReady ?? null);
      session.note(`child fixture trap target ready=${targetsReady}`);
      expect(targetsReady, "Level-1 trap anchor has its local fixture target").toBe("1");
      await session.screenshot(page, "ai35-top-with-child-frame");
    });

    let eventRow: Record<string, unknown> | undefined;
    const clicked = framesReady && child !== undefined && await soft("4. clear the event log, one trusted click on the child's visible Play -> one nav_blank_prompt with site=localhost, pageSite=127.0.0.1; no tab opens", async () => {
      await session.setStorageLocal({ [EVENT_LOG_KEY]: [] });
      expect(await session.eventLog("event log after clear")).toEqual([]);
      const before = tabCount(session);
      const point = await trustedClickInFrame(page, FRAME_SELECTOR, child!, "#play");
      session.note(`trusted click at main-frame viewport point ${JSON.stringify(point)}`);
      await expect.poll(async () => (await session.eventLog()).filter((entry) => entry.kind === "nav_blank_prompt").length, {
        timeout: 10_000, message: "a nav_blank_prompt row must be logged",
      }).toBeGreaterThan(0);
      await page.waitForTimeout(1500);
      const log = await session.eventLog("event log after child Play click");
      session.note(`event log after click (kind/site/pageSite/score): ${JSON.stringify(log.map((entry) => ({ kind: entry.kind, site: entry.site, pageSite: entry.pageSite, score: entry.score })))}`);
      const prompts = log.filter((entry) => entry.kind === "nav_blank_prompt");
      expect(prompts.length, "exactly one nav_blank_prompt for one click").toBe(1);
      eventRow = prompts.at(-1)!;
      expect(eventRow.site, "emitting frame hostname is retained in site").toBe("localhost");
      expect(eventRow.pageSite, "top-level page hostname is recorded in pageSite").toBe("127.0.0.1");
      for (const field of ["site", "pageSite"] as const) {
        expect(isBareHostname(eventRow[field]), `${field} must hold a bare hostname with no path/query/fragment/full URL`).toBe(true);
      }
      expect(tabCount(session), "no destination tab may open").toBe(before);
      const destinations = session.context.pages().filter((candidate) => /local-fixture-sink/.test(candidate.url()));
      expect(destinations.map((candidate) => candidate.url()), "no fixture sink page opened").toEqual([]);
      await session.screenshot(page, "ai35-after-child-play-click");
    });

    let unrelated: Page | undefined;
    if (clicked) {
      await soft("5a. unrelated top-level localhost tab: popup Current page shows no threat note or signal; gauge clear", async () => {
        unrelated = await session.newPage();
        const markers = await session.gotoReady(unrelated, session.url("/index.html?ai35=unrelated", "localhost"));
        expect(markers).toEqual({ capture: "1", bridge: "1", guard: session.guardRevision });
        const popup = await session.openPopup(unrelated);
        const gauge = await waitForPopupGauge(popup);
        session.note(`popup on localhost tab: ${JSON.stringify(gauge)}`);
        await session.screenshotPopup("ai35-popup-on-unrelated-localhost-tab");
        expect(gauge.site).toBe("localhost");
        expect(gauge.noteHidden, "threat note must be hidden on the unrelated tab").toBe(true);
        expect(gauge.note).not.toContain(THREAT_NOTE);
        expect(gauge.unscoredMark, "no unscored-threat gauge mark").toBe(false);
        expect(gauge.ariaLabel, "gauge must remain clear").toBe("Tab risk score: 0");
        expect(gauge.signals, "no threat signal chips").toEqual([]);
        session.observe("5a activity feed on localhost tab (global feed may list the event; not current-page attribution)", JSON.stringify(gauge.events));
        await session.closePopup();
      });

      await soft("5b. back on the 127.0.0.1 tab the popup restores the threat note for its own event", async () => {
        const popup = await session.openPopup(page);
        const gauge = await waitForPopupGauge(popup);
        session.note(`popup on 127.0.0.1 tab: ${JSON.stringify(gauge)}`);
        await session.screenshotPopup("ai35-popup-back-on-127-tab");
        expect(gauge.site).toBe("127.0.0.1");
        expect(gauge.noteHidden, "threat note must be visible on the attributed tab").toBe(false);
        expect(gauge.note).toContain(THREAT_NOTE);
        expect(gauge.note).toContain("blank-target navigation was held");
        expect(gauge.unscoredMark).toBe(true);
        expect(gauge.ariaLabel).toContain(THREAT_NOTE);
        await session.closePopup();
      });

      await soft("5c. reopening the popup on the localhost tab still shows no leakage (idempotent association)", async () => {
        const popup = await session.openPopup(unrelated!);
        const gauge = await readPopupGauge(popup);
        session.note(`popup on localhost tab (second open): ${JSON.stringify(gauge)}`);
        expect(gauge.noteHidden).toBe(true);
        expect(gauge.ariaLabel).toBe("Tab risk score: 0");
        await session.closePopup();
      });
    }

    await soft("5d. no page, child-frame, popup or service-worker console errors", async () => {
      const errors = session.consoleErrors([/favicon\.ico/]);
      session.note(`console errors: ${JSON.stringify(errors)}`);
      expect(errors).toEqual([]);
    });

    session.note(`AI-35 soft-step failures: ${JSON.stringify(failures)}; row=${JSON.stringify(eventRow ?? null)}`);
    expect(failures, "every AI-35 step passes").toEqual([]);
  } finally {
    // 6. Close all tabs and the disposable profile; close() removes the profile directory.
    await session.close();
  }
});
