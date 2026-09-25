/**
 * AI-47 step 7 / former AI-44 — popup Current page event association (#585,
 * PR #644; #646 follow-up PR #657). Mirrors docs/agentic/ISSUE_585_GATE3.md
 * steps 2-5 in a fresh branded Chrome profile: rows are imported through the
 * real Options Import control, storage and the Options event log are checked
 * for URL residue and canonical hostnames, and the real toolbar popup is read
 * on loopback pages (IPv4, a noncanonical IPv4 spelling, and IPv6 ::1).
 * Automated agent evidence, not the owner Gate-3 result.
 */
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { AcceptanceSession, EVENT_LOG_KEY, repoRoot } from "./acceptance_harness";
import {
  OPTIONS_PAGE,
  forbiddenHits,
  importThroughOptions,
  optionsEventRows,
  showOptionsEventLog,
  startIpv6LoopbackServer,
  waitForPopupGauge,
  writeImportFile,
  type ImportRow,
  type PopupGauge,
} from "./attribution_helpers";

const PR_644_MERGE_SUBJECT = /Merge pull request #644\b/;
const PR_657_MERGE_SUBJECT = /Merge pull request #657\b/;
const URL_RESIDUE = ["https://other.test", "other.test/account", "/account", "token=", "secret", "#fragment", "fragment"];

// Keep the guide's ordering while rebasing its example timestamps into the
// popup's ten-minute Current page window.
function guideRows(baseTs: number): ImportRow[] {
  return [
    { id: "ai44-valid-page", ts: baseTs + 1, kind: "nav_click_block", site: "frame.other.test", pageSite: "127.0.0.1", score: 80 },
    { id: "ai44-empty-page", ts: baseTs + 2, kind: "nav_click_block", site: "127.0.0.1", pageSite: "", score: 70 },
    { id: "ai44-url-page", ts: baseTs + 3, kind: "nav_click_block", site: "127.0.0.1", pageSite: "https://other.test/account?token=secret#fragment", score: 60 },
  ];
}

test.setTimeout(240_000);

type StoredRow = { id: string; ts: number; kind: string; site?: string; pageSite?: string; score?: number };

function byId(log: Array<Record<string, unknown>>): Map<string, StoredRow> {
  return new Map(log.map((entry) => [String(entry.id), entry as unknown as StoredRow]));
}

test("AI-47.7 / former AI-44: imported rows never keep a URL pageSite, IP literals are canonical, and the popup gauge follows the newest applicable association", async ({}, testInfo) => {
  const baseTs = Date.now() - 60_000;
  const GUIDE_ROWS = guideRows(baseTs);
  const session = await AcceptanceSession.open(testInfo, "AI-47.7-former-AI-44-PR644-PR657");
  const failures: string[] = [];
  const soft = async (title: string, body: () => Promise<void>): Promise<boolean> => {
    const ok = (await session.step(title, async () => { await body(); return true; }, { soft: true })) === true;
    if (!ok) failures.push(title);
    return ok;
  };
  const importDir = testInfo.outputPath("imports");
  const ipv6 = await startIpv6LoopbackServer();
  let options: Page | undefined;

  const popupOn = async (page: Page, shot: string, expectedScore: number): Promise<PopupGauge> => {
    const popup = await session.openPopup(page);
    const gauge = await waitForPopupGauge(popup, expectedScore);
    session.note(`popup on ${new URL(page.url()).host}: ${JSON.stringify(gauge)}`);
    await session.screenshotPopup(shot);
    await session.closePopup();
    return gauge;
  };
  const importRows = async (name: string, rows: ImportRow[]): Promise<Array<Record<string, unknown>>> => {
    const status = await importThroughOptions(options!, writeImportFile(importDir, name, rows));
    session.note(`${name}: Options status "${status}"`);
    expect(status, "import must complete without an error").toContain("Imported.");
    expect(status).not.toMatch(/fail|error|wasn't/i);
    return session.eventLog(`event log after ${name}`);
  };

  try {
    session.note(`tested head ${session.receipt.git.head}; product tree ${session.receipt.git.productSourceTree}; last product commit ${session.receipt.git.lastProductCommit}; Chrome ${session.chromeVersion}; ui-guard ${session.guardRevision}`);
    session.note(`IPv6 loopback fixture: ${ipv6 ? ipv6.baseUrl : "unavailable (::1 bind failed)"}`);

    await soft("1. tested head contains the #644 and #657 merges; product source clean", async () => {
      const merges = execFileSync("git", ["log", "--merges", "--format=%H %s", "-n", "400", "HEAD"], { cwd: repoRoot, encoding: "utf8" });
      expect(merges, "PR #644 merged into the tested head").toMatch(PR_644_MERGE_SUBJECT);
      expect(merges, "PR #657 merged into the tested head").toMatch(PR_657_MERGE_SUBJECT);
      expect(session.receipt.git.productSourceClean).toBe(true);
    });

    const page = await session.newPage();
    const pageReady = await soft("2a. fresh HTTP page at 127.0.0.1/level1-basic-opacity.html is ready", async () => {
      const markers = await session.gotoReady(page, session.url("/level1-basic-opacity.html"));
      expect(markers).toEqual({ capture: "1", bridge: "1", guard: session.guardRevision });
    });
    options = await session.openExtensionPage(OPTIONS_PAGE);

    const imported = pageReady && await soft("2b. Options Import of the guide rows completes; stored rows keep no URL pageSite (empty/URL values dropped, valid 127.0.0.1 kept)", async () => {
      const log = await importRows("import-a-guide-order", GUIDE_ROWS);
      session.note(`stored after import A: ${JSON.stringify(log)}`);
      expect(log.map((entry) => entry.id)).toEqual(["ai44-valid-page", "ai44-empty-page", "ai44-url-page"]);
      const rows = byId(log);
      expect(rows.get("ai44-valid-page")!.pageSite).toBe("127.0.0.1");
      expect(rows.get("ai44-valid-page")!.site).toBe("frame.other.test");
      expect(rows.get("ai44-empty-page")!.pageSite, "empty pageSite is not retained").toBeUndefined();
      expect(rows.get("ai44-url-page")!.pageSite, "full-URL pageSite is not retained").toBeUndefined();
      expect(rows.get("ai44-url-page")!.site).toBe("127.0.0.1");
      const local = JSON.stringify(await session.worker.evaluate(async () => chrome.storage.local.get(null)));
      const sessionArea = JSON.stringify(await session.storageSessionAll());
      expect(forbiddenHits(local, URL_RESIDUE), "no path/query/fragment residue anywhere in storage.local").toEqual([]);
      expect(forbiddenHits(sessionArea, URL_RESIDUE), "no path/query/fragment residue anywhere in storage.session").toEqual([]);
    });

    if (imported) {
      await soft("2c. Options event log shows no full URL, path, query or fragment as a pageSite", async () => {
        await expect.poll(async () => (await optionsEventRows(options!)).length, { timeout: 5000 }).toBe(3);
        const rows = await optionsEventRows(options!);
        session.note(`Options event rows (newest first): ${JSON.stringify(rows)}`);
        const html = await options!.evaluate(() => document.documentElement.outerHTML);
        expect(forbiddenHits(rows.join("\n"), URL_RESIDUE)).toEqual([]);
        expect(forbiddenHits(html, URL_RESIDUE), "no residue anywhere in the Options DOM").toEqual([]);
        expect(rows[2], "valid cross-host row shows its page association").toContain("page=127.0.0.1");
        expect(rows.filter((row) => row.includes("page=")).length, "only the valid row carries a page= association").toBe(1);
        await showOptionsEventLog(options!);
        await session.screenshot(options!, "ai47-7-options-after-guide-import");
      });

      await soft("3a. popup Current page on the loopback page shows the imported loopback risk 60 (malformed pageSite fell back to site)", async () => {
        const gauge = await popupOn(page, "ai47-7-popup-guide-order-60", 60);
        expect(gauge.site).toBe("127.0.0.1");
        expect(gauge.ariaLabel).toBe("Tab risk score: 60");
        expect(gauge.noteHidden).toBe(true);
      });

      await soft("3b. repeat with the valid cross-host row last: popup shows 80 via its pageSite association", async () => {
        const reordered = [GUIDE_ROWS[1]!, GUIDE_ROWS[2]!, { ...GUIDE_ROWS[0]!, ts: baseTs + 4 }];
        const log = await importRows("import-b-valid-row-last", reordered);
        expect(log.map((entry) => entry.id)).toEqual(["ai44-empty-page", "ai44-url-page", "ai44-valid-page"]);
        const gauge = await popupOn(page, "ai47-7-popup-valid-row-last-80", 80);
        expect(gauge.site).toBe("127.0.0.1");
        expect(gauge.ariaLabel).toBe("Tab risk score: 80");
      });
    }

    await soft("4. ordinary, IPv4 and IPv6 pageSite values import canonically; invalid ones are dropped; the popup follows the newest IPv4 association", async () => {
      const rows: ImportRow[] = [
        { id: "s4-ordinary", ts: baseTs + 11, kind: "nav_click_block", site: "frame.other.test", pageSite: "Example.COM.", score: 21 },
        { id: "s4-ipv6", ts: baseTs + 12, kind: "nav_click_block", site: "frame.other.test", pageSite: "2001:db8::1", score: 22 },
        { id: "s4-ipv6-bracketed", ts: baseTs + 13, kind: "nav_click_block", site: "frame.other.test", pageSite: "[::1]", score: 23 },
        { id: "s4-host-port", ts: baseTs + 14, kind: "nav_click_block", site: "frame.other.test", pageSite: "127.0.0.1:8080", score: 24 },
        { id: "s4-bad-ipv4", ts: baseTs + 15, kind: "nav_click_block", site: "frame.other.test", pageSite: "256.1.1.1", score: 25 },
        { id: "s4-path", ts: baseTs + 16, kind: "nav_click_block", site: "frame.other.test", pageSite: "example.com/path?q=secret", score: 26 },
        { id: "s4-ipv4", ts: baseTs + 17, kind: "nav_click_block", site: "frame.other.test", pageSite: "127.0.0.1", score: 33 },
      ];
      const log = await importRows("import-c-ordinary-ipv4-ipv6", rows);
      const stored = byId(log);
      const pageSites = Object.fromEntries(rows.map((row) => [String(row.id), stored.get(String(row.id))?.pageSite ?? null]));
      session.note(`step 4 stored pageSite by id: ${JSON.stringify(pageSites)}`);
      expect(pageSites).toEqual({
        "s4-ordinary": "example.com",
        "s4-ipv6": "2001:db8::1",
        "s4-ipv6-bracketed": "::1",
        "s4-host-port": null,
        "s4-bad-ipv4": null,
        "s4-path": null,
        "s4-ipv4": "127.0.0.1",
      });
      expect(forbiddenHits(JSON.stringify(log), ["secret", "/path"])).toEqual([]);
      const gauge = await popupOn(page, "ai47-7-popup-step4-ipv4-33", 33);
      expect(gauge.ariaLabel).toBe("Tab risk score: 33");
    });

    await soft("5a. noncanonical 127.000.000.001 and [2001:0DB8:0:0:0:0:0:1] (and [0:0:0:0:0:0:0:1]) are stored as 127.0.0.1, 2001:db8::1 and ::1", async () => {
      const rows: ImportRow[] = [
        { id: "s5-ipv6-doc", ts: baseTs + 21, kind: "nav_click_block", site: "frame.other.test", pageSite: "[2001:0DB8:0:0:0:0:0:1]", score: 42 },
        { id: "s5-ipv6-loopback", ts: baseTs + 22, kind: "nav_click_block", site: "frame.other.test", pageSite: "[0:0:0:0:0:0:0:1]", score: 43 },
        { id: "s5-ipv4", ts: baseTs + 23, kind: "nav_click_block", site: "frame.other.test", pageSite: "127.000.000.001", score: 41 },
      ];
      const log = await importRows("import-d-noncanonical-ip", rows);
      const stored = byId(log);
      const pageSites = Object.fromEntries(rows.map((row) => [String(row.id), stored.get(String(row.id))?.pageSite ?? null]));
      session.note(`step 5 stored pageSite by id: ${JSON.stringify(pageSites)}`);
      expect(pageSites).toEqual({ "s5-ipv6-doc": "2001:db8::1", "s5-ipv6-loopback": "::1", "s5-ipv4": "127.0.0.1" });
      const rendered = await optionsEventRows(options!);
      session.note(`Options rows after import D: ${JSON.stringify(rendered)}`);
      expect(rendered.join("\n")).not.toMatch(/127\.000|0DB8|0db8|\[/);
      await showOptionsEventLog(options!);
      await session.screenshot(options!, "ai47-7-options-after-noncanonical-import");
    });

    await soft("5b. popup association follows location.hostname for a page opened as http://127.000.000.001 (canonical 127.0.0.1)", async () => {
      const port = new URL(session.gym.baseUrl).port;
      await page.goto(`http://127.000.000.001:${port}/level1-basic-opacity.html?ai47=noncanonical`, { waitUntil: "domcontentloaded", timeout: 20_000 });
      const markers = await session.requireReady(page);
      expect(markers).toEqual({ capture: "1", bridge: "1", guard: session.guardRevision });
      const hostname = await page.evaluate(() => location.hostname);
      session.note(`noncanonical navigation committed as ${new URL(page.url()).host}; location.hostname=${hostname}`);
      expect(hostname).toBe("127.0.0.1");
      const gauge = await popupOn(page, "ai47-7-popup-noncanonical-ipv4-41", 41);
      expect(gauge.site).toBe("127.0.0.1");
      expect(gauge.ariaLabel).toBe("Tab risk score: 41");
    });

    if (!ipv6) session.observe("5c IPv6 popup association", "NOT-AUTOMATED: the host refused a ::1 bind (environment limitation)");
    else await soft("5c. popup association follows location.hostname on an IPv6 [::1] page (row imported as [0:0:0:0:0:0:0:1])", async () => {
      const v6 = await session.newPage();
      await v6.goto(`${ipv6.baseUrl}/ai47-ipv6.html`, { waitUntil: "domcontentloaded", timeout: 20_000 });
      const markers = await session.requireReady(v6);
      expect(markers).toEqual({ capture: "1", bridge: "1", guard: session.guardRevision });
      const hostname = await v6.evaluate(() => location.hostname);
      session.note(`IPv6 page location.hostname=${hostname}`);
      expect(hostname).toBe("[::1]");
      const gauge = await popupOn(v6, "ai47-7-popup-ipv6-loopback-43", 43);
      expect(gauge.site).toBe("::1");
      expect(gauge.ariaLabel).toBe("Tab risk score: 43");
      await v6.close();
    });
    session.observe("5 2001:db8::1 popup association", "NOT-AUTOMATED: 2001:db8::/32 is a documentation prefix with no reachable page on this host; its canonical storage is asserted in 5a and the IPv6 popup association is proven on ::1 in 5c.");

    await soft("4/5. no popup, Options, page or service-worker console errors", async () => {
      const errors = session.consoleErrors([/favicon\.ico/]);
      session.note(`console errors: ${JSON.stringify(errors)}`);
      expect(errors).toEqual([]);
    });

    session.note(`final event log key ${EVENT_LOG_KEY}; AI-47.7 soft-step failures: ${JSON.stringify(failures)}`);
    expect(failures, "every AI-47.7 step passes").toEqual([]);
  } catch (error) {
    session.markFailed(error);
    throw error;
  } finally {
    await session.close();
    await ipv6?.close();
  }
});
