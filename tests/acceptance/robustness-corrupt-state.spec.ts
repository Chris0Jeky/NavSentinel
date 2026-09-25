/**
 * Corrupt-state resilience in a real browser for the 2026-09-20..24 storage
 * hardening wave (#793 NRS hops, #808 prototype-named allowlist keys, #830
 * journal caps, #833 adaptive finite guard, #835 profile heal, #795/#841 state
 * shape). Unit tests prove each sanitizer in isolation; this proves the
 * shipped build restarts on hostile persisted state, keeps protecting, renders
 * every extension surface, and heals rather than compounds.
 */
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { AcceptanceSession, EVENT_LOG_KEY, SETTINGS_KEY, toastState, trustedClick } from "./acceptance_harness";

const ALLOWLIST_KEY = "sentinelsuite:nav_allowlist_v1";
const TRUSTED_DOMAINS_KEY = "sentinelsuite:trusted_domains_v1";
const DOMAIN_PROFILES_KEY = "sentinelsuite:domain_profiles_v1";
const ADAPTIVE_SCORES_KEY = "sentinelsuite:adaptive_scores_v1";
const PROMPT_OUTCOMES_KEY = "sentinelsuite:prompt_outcomes_v1";

/** JSON text, so `__proto__`/`constructor` arrive as own properties like a real corrupt store. */
const HOSTILE_STATE_JSON = JSON.stringify({
  [SETTINGS_KEY]: { nav: { defaultMode: "bogus", debug: "yes", autoDismissOverlays: "true" }, credential: { mode: 7 }, logLimit: -5 },
  [ADAPTIVE_SCORES_KEY]: {
    "127.0.0.1": { domain: "127.0.0.1", adjustment: 1e300, allowCount: "many", blockCount: -1, lastUpdated: "x" },
    localhost: { domain: "localhost", adjustment: 30, allowCount: 99, blockCount: 0, lastUpdated: 1 },
  },
  [DOMAIN_PROFILES_KEY]: {
    "127.0.0.1": { domain: "127.0.0.1", visits: "12", totalNRS: "9999", maxNRS: "x", triggerCount: 3, lastSeen: "yesterday", factors: [1, 2], nrsHistory: [1, "a", null] },
    "stale.example": { domain: "stale.example", visits: 2, totalNRS: 80, maxNRS: 40, triggerCount: 1, lastSeen: 1, factors: { nrs_x: "NaN" }, nrsHistory: [40, "40"] },
  },
  [PROMPT_OUTCOMES_KEY]: [null, 7, "x", { domain: 5, outcome: "allow", ts: "now" }],
  [EVENT_LOG_KEY]: [
    null,
    5,
    "x",
    { id: "corrupt-big", ts: 1, kind: "nav_click_block", site: "127.0.0.1", score: 80, extra: { blob: "b".repeat(200_000) }, detail: "d".repeat(50_000) },
    { id: "corrupt-kind", ts: "now", kind: 123, site: {} },
  ],
});

const HOSTILE_ALLOWLIST_JSON = '{"__proto__":["localhost"],"constructor":["localhost"],"127.0.0.1":"not-an-array","toString":[42,null,{}]}';

async function assertLevel1Blocked(session: AcceptanceSession, page: Page, label: string): Promise<void> {
  await session.gotoReady(page, session.url("/level1-basic-opacity.html"));
  const before = session.context.pages().length;
  await trustedClick(page, "#play");
  await expect.poll(async () => (await toastState(page)).text, { timeout: 6000, message: `${label}: block notice` }).not.toBeNull();
  await page.waitForTimeout(1200);
  const toast = await toastState(page);
  session.note(`${label}: toast "${toast.text}" buttons [${toast.buttons.join(", ")}]`);
  expect(toast.text ?? "").toMatch(/block/i);
  expect(session.context.pages().length, `${label}: no destination tab opened`).toBe(before);
}

test("hardening wave: hostile persisted state restarts cleanly, keeps protecting and heals", async ({}, testInfo) => {
  const session = await AcceptanceSession.open(testInfo, "robustness-corrupt-state");
  try {
    let page = await session.newPage();

    await session.step("baseline: level-1 invisible overlay is blocked in a fresh profile", async () => {
      await assertLevel1Blocked(session, page, "baseline");
    });

    await session.step("seed hostile persisted state, then terminate the service worker as MV3 idle shutdown does", async () => {
      await session.worker.evaluate(async ({ state, allowlist, allowKey }) => {
        await chrome.storage.local.set({ ...JSON.parse(state), [allowKey]: JSON.parse(allowlist) });
      }, { state: HOSTILE_STATE_JSON, allowlist: HOSTILE_ALLOWLIST_JSON, allowKey: ALLOWLIST_KEY });
      await session.stopServiceWorker();
      expect(await session.worker.evaluate(() => typeof chrome.runtime.id === "string")).toBe(true);
    });

    await session.step("after the worker restart, blocking still works on the hostile store", async () => {
      await assertLevel1Blocked(session, page, "after worker restart");
    });

    await session.step("quit and relaunch Chrome on the same profile; the extension starts on the hostile store", async () => {
      const seeded = await session.storageLocal<Record<string, unknown>>(ADAPTIVE_SCORES_KEY);
      session.note(`adaptive store before relaunch: ${JSON.stringify(seeded).slice(0, 300)}`);
      await session.restartBrowser();
      page = await session.newPage();
      const retained = await session.storageLocal<Record<string, unknown>>(ALLOWLIST_KEY, "allowlist after relaunch");
      session.note(`allowlist retained across relaunch: ${JSON.stringify(retained)}`);
    });

    await session.step("protection survives: invalid mode, out-of-range adaptive boost and prototype-named allowlist keys do not disable blocking", async () => {
      await assertLevel1Blocked(session, page, "after corruption");
      const adaptive = await session.storageLocal(ADAPTIVE_SCORES_KEY, "adaptive scores after block");
      session.note(`adaptive store after block: ${JSON.stringify(adaptive).slice(0, 400)}`);
    });

    await session.step("held new-tab destination on the other loopback host is not allowlisted by __proto__/constructor keys", async () => {
      await session.gotoReady(page, session.url("/acceptance/held-blank.html"));
      await page.evaluate(() => (window as unknown as { setAcceptanceMarker: (m: string) => void }).setAcceptanceMarker("NSROBUST"));
      const before = session.context.pages().length;
      await trustedClick(page, "#play");
      await expect.poll(async () => (await toastState(page)).text, { timeout: 6000 }).not.toBeNull();
      await page.waitForTimeout(1200);
      expect(session.context.pages().length).toBe(before);
    });

    await session.step("popup renders on the corrupted store and reports a protective navigation mode", async () => {
      const popup = await session.openPopup(page);
      const state = await popup.evaluate<{ nav: string | null; cred: string | null; events: number; site: string }>(() => ({
        nav: document.querySelector("#navSeg [aria-checked='true']")?.getAttribute("data-value") ?? null,
        cred: document.querySelector("#credSeg [aria-checked='true']")?.getAttribute("data-value") ?? null,
        events: document.querySelectorAll("#events > *").length,
        site: document.getElementById("site")?.textContent ?? "",
      }));
      session.note(`popup state on corrupt store: ${JSON.stringify(state)}`);
      expect(state.nav, "an invalid stored navigation mode must not render as Off").not.toBe("off");
      await session.screenshotPopup("popup-on-corrupt-store");
      const popupErrors = session.consoleErrors().filter((entry) => entry.source === "popup");
      session.note(`popup console errors on corrupt store: ${JSON.stringify(popupErrors).slice(0, 800)}`);
      await session.closePopup();
      expect(state.nav, "an invalid stored navigation mode must not render as Off").not.toBe("off");
      expect(state.cred).not.toBe("off");
      expect(state.site, "popup must finish rendering the current site").not.toBe("-");
    }, { soft: true });

    await session.step("Options and Protection Center render the corrupted journal without page errors", async () => {
      const options = await session.openExtensionPage("src/options/options.html");
      await options.waitForTimeout(1500);
      const optionsErrors: string[] = [];
      options.on("pageerror", (error) => optionsErrors.push(error.message));
      await expect(options.locator("body")).toBeVisible();
      await session.screenshot(options, "options-on-corrupt-store");
      const evidence = await session.openExtensionPage("src/evidence/evidence.html");
      await evidence.waitForTimeout(1500);
      await session.screenshot(evidence, "protection-center-on-corrupt-store");
      const renderedText = await evidence.evaluate(() => document.body.innerText.length);
      expect(renderedText).toBeGreaterThan(0);
      expect(optionsErrors).toEqual([]);
      await options.close();
      await evidence.close();
    });

    await session.step("persisted state healed rather than compounded", async () => {
      const profiles = await session.storageLocal<Record<string, Record<string, unknown>>>(DOMAIN_PROFILES_KEY, "domain profiles after activity");
      const loopback = profiles?.["127.0.0.1"];
      session.note(`127.0.0.1 profile after activity: ${JSON.stringify(loopback)}`);
      if (loopback) {
        for (const field of ["visits", "totalNRS", "maxNRS", "triggerCount", "lastSeen"]) {
          expect(typeof loopback[field], `profile.${field} is numeric`).toBe("number");
          expect(Number.isFinite(loopback[field] as number)).toBe(true);
        }
        expect(Array.isArray(loopback.nrsHistory) && (loopback.nrsHistory as unknown[]).every((n) => typeof n === "number")).toBe(true);
        expect(String(loopback.totalNRS)).not.toContain("9999");
      }
      const log = await session.eventLog("event log after activity");
      const serializedLog = JSON.stringify(log);
      session.note(`event log entries=${log.length} bytes=${serializedLog.length}`);
      expect.soft(serializedLog.length, "a pre-existing 200 KB extra blob is re-capped when the journal is rewritten").toBeLessThan(200_000);
      const allowlist = await session.worker.evaluate(async (key) => {
        const stored = (await chrome.storage.local.get(key))[key] as Record<string, unknown>;
        return { ownKeys: Object.keys(stored ?? {}), protoIsObject: Object.getPrototypeOf(stored ?? {}) === Object.prototype };
      }, ALLOWLIST_KEY);
      session.note(`allowlist after activity: ${JSON.stringify(allowlist)}`);
    });

    await session.step("malicious backup import through Options: rejected or sanitized, never protection-lowering by accident", async () => {
      const hostileBackup = {
        settings: { nav: { defaultMode: "bogus" }, credential: { mode: "nope" }, logLimit: "9999999" },
        allowlist: JSON.parse('{"__proto__":["localhost"],"127.0.0.1":["LOCALHOST "," localhost"]}') as Record<string, unknown>,
        trustedDomains: ["__proto__", 7, "a".repeat(5000), "Example.COM"],
        eventLog: Array.from({ length: 300 }, (_, index) => ({
          id: `import-${index}`, ts: index, kind: "nav_click_block", site: "127.0.0.1", pageSite: "https://evil.test/a?token=SECRET#frag", score: 70, extra: { note: "x".repeat(10_000) },
        })),
        promptOutcomes: "not-an-array",
        adaptiveScores: { "127.0.0.1": { adjustment: 15 } },
      };
      const file = path.join(testInfo.outputDir, "hostile-backup.json");
      fs.mkdirSync(testInfo.outputDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(hostileBackup));
      const options = await session.openExtensionPage("src/options/options.html");
      await options.waitForTimeout(800);
      await options.setInputFiles("#importFile", file);
      await options.waitForTimeout(2500);
      const status = await options.evaluate(() => document.getElementById("status")?.textContent ?? "");
      session.note(`import status text: ${status}`);
      await session.screenshot(options, "options-after-hostile-import");
      const settings = await session.storageLocal<{ nav: { defaultMode: string }; credential: { mode: string }; logLimit: number }>(SETTINGS_KEY, "settings after hostile import");
      session.note(`settings after hostile import: nav.defaultMode=${JSON.stringify(settings.nav.defaultMode)} credential.mode=${JSON.stringify(settings.credential.mode)} logLimit=${JSON.stringify(settings.logLimit)}`);
      expect.soft(["off", "smart", "strict"], "import must not persist an unknown navigation mode").toContain(settings.nav.defaultMode);
      expect.soft(["off", "smart", "strict"], "import must not persist an unknown credential mode").toContain(settings.credential.mode);
      expect(settings.logLimit).toBeLessThanOrEqual(5000);
      const log = await session.eventLog();
      const serialized = JSON.stringify(log);
      expect(serialized, "imported pageSite must not keep a query secret").not.toContain("SECRET");
      expect(serialized).not.toContain("/a?token");
      const trusted = await session.storageLocal<string[]>(TRUSTED_DOMAINS_KEY, "trusted domains after hostile import");
      session.note(`trusted after import: ${JSON.stringify(trusted)?.slice(0, 300)}`);
      const allowlist = await session.worker.evaluate(async (key) => {
        const stored = (await chrome.storage.local.get(key))[key] as Record<string, string[]>;
        return JSON.parse(JSON.stringify(stored ?? {})) as Record<string, string[]>;
      }, ALLOWLIST_KEY);
      session.note(`allowlist after import: ${JSON.stringify(allowlist)}`);
      await options.close();
      // The imported allowlist deliberately permits 127.0.0.1 -> localhost (a user
      // choice), so the level-1 overlay (same-host harm target) must still block.
      await assertLevel1Blocked(session, page, "after hostile import");
    });

    await session.step("no uncaught extension exceptions during the whole procedure", async () => {
      const errors = session.consoleErrors([/Failed to load resource/]);
      session.note(`console errors: ${JSON.stringify(errors).slice(0, 2000)}`);
      expect(errors.filter((entry) => entry.level === "exception")).toEqual([]);
    }, { soft: true });
  } finally {
    await session.close();
  }
});
