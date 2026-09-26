/**
 * AI-47 row 8 / former AI-37 — #599 clipboard pressure on a release build.
 * Mirrors docs/agentic/GATE3_GUIDES.md "AI-47 row 8" (historical AI-37 steps
 * 4-7) in a fresh branded Chrome profile. A benign copy-code page and its local
 * verification checkbox stay silent, the ClickFix page warns, the event log
 * records the mixed trial only, gains no bridge_buffer_overflow row, and never
 * shows a raw clipboard value.
 *
 * Limitation (#947): on clickfix-01 the benign prewrite ALONE already raises
 * the warning and the clickfix_detected row, and the trial runs after the bridge
 * is verified, so this procedure cannot fail on a #599 regression. The step
 * records whether the prewrite warned by itself. The #599 regression oracle is
 * tests/e2e/bridge-clipboard-pressure.spec.ts (NS-ADV-SELF-005), which also
 * keeps the hostile unverified retry automated-only (#186).
 * Automated agent evidence, not the owner Gate-3 result.
 */
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { AcceptanceSession, repoRoot, toastState, trustedClick } from "./acceptance_harness";
import { OPTIONS_PAGE, TRUSTED_DOMAINS_KEY } from "./extension_ui_helpers";
import { optionsEventRows, showOptionsEventLog } from "./attribution_helpers";

const PR_599_MERGE = "d4b1acf5843605f519ffe1732050a2c1bb501ee1";
const ALLOWLIST_KEY = "sentinelsuite:nav_allowlist_v1";
const CLICKFIX_WARNING = /ClickFix|clipboard|fake.*verification|Do NOT paste/i;
const RAW_CLIPBOARD_VALUES = ["847293", "NAVSENTINEL_SENTINEL_DO_NOT_RUN"];
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1"];
const CONSOLE_NOISE = [/favicon\.ico/];

test.setTimeout(180_000);

/** Every distinct toast text seen on the page during the window. */
async function toastsDuring(page: Page, ms: number): Promise<string[]> {
  const seen = new Set<string>();
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const state = await toastState(page).catch(() => null);
    if (state?.text) seen.add(state.text);
    await page.waitForTimeout(100);
  }
  return [...seen];
}

async function waitForWarning(page: Page, ms: number): Promise<string | null> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const state = await toastState(page).catch(() => null);
    if (state?.text && CLICKFIX_WARNING.test(state.text)) return state.text;
    await page.waitForTimeout(100);
  }
  return null;
}

function kindCount(log: Array<Record<string, unknown>>, kind: string): number {
  return log.filter((entry) => entry.kind === kind).length;
}

function mentionsLoopback(value: unknown): string[] {
  const text = JSON.stringify(value ?? null).toLowerCase();
  return LOOPBACK_HOSTS.filter((host) => text.includes(host));
}

test("AI-47.8 / former AI-37: the owner procedure as written (benign copy stays silent, the mixed ClickFix trial warns; does not isolate #599, see #947)", async ({}, testInfo) => {
  const session = await AcceptanceSession.open(testInfo, "AI-47.8-former-AI-37-PR599");
  try {
    await session.step("1. tested head contains the PR #599 merge and has no product-source changes", async () => {
      execFileSync("git", ["merge-base", "--is-ancestor", PR_599_MERGE, "HEAD"], { cwd: repoRoot });
      expect(session.receipt.git.productSourceClean, "no uncommitted product source changes").toBe(true);
      session.note(`tested head ${session.receipt.git.head}; ui-guard ${session.guardRevision}; Chrome ${session.chromeVersion}`);
    });

    await session.step("2. Smart mode, and neither localhost nor 127.0.0.1 is trusted or allowlisted", async () => {
      await session.patchNavigation({ defaultMode: "smart" });
      const allowlist = await session.storageLocal(ALLOWLIST_KEY, "nav allowlist at start");
      const trusted = await session.storageLocal(TRUSTED_DOMAINS_KEY, "trusted domains at start");
      expect(mentionsLoopback(allowlist), "allowlist must not name a loopback host").toEqual([]);
      expect(mentionsLoopback(trusted), "trusted domains must not name a loopback host").toEqual([]);
      const origin = new URL(session.url("/")).origin;
      await session.context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
    });

    const logAtStart = await session.eventLog("event log at start");

    await session.step("3. benign page: Copy Code reports OTP copied, and no ClickFix or clipboard warning follows", async () => {
      const page = await session.newPage();
      const markers = await session.gotoReady(page, session.url("/clickfix-03-legit-captcha.html?ai37=benign"));
      expect(markers.capture).toBe("1");
      expect(markers.bridge).toBe("1");
      await trustedClick(page, "#copy-otp-btn");
      await expect(page.locator("#status")).toContainText("OTP copied", { timeout: 5000 });
      const copyToasts = await toastsDuring(page, 2000);
      session.note(`benign copy toasts: ${JSON.stringify(copyToasts)}`);
      expect(copyToasts.filter((text) => CLICKFIX_WARNING.test(text))).toEqual([]);

      await trustedClick(page, "#recaptcha-checkbox");
      const checkboxToasts = await toastsDuring(page, 2000);
      session.note(`benign checkbox toasts: ${JSON.stringify(checkboxToasts)}`);
      expect(checkboxToasts.filter((text) => CLICKFIX_WARNING.test(text))).toEqual([]);
      expect(await page.locator("#recaptcha-checkbox").textContent(), "the local checkbox stays usable").toContain("✓");
      await session.screenshot(page, "benign-after-copy-and-checkbox");
      await page.close();
    });

    const logAfterBenign = await session.eventLog("event log after the benign trial");
    await session.step("4. the benign trial recorded no clickfix_detected event", async () => {
      expect(kindCount(logAfterBenign, "clickfix_detected")).toBe(kindCount(logAtStart, "clickfix_detected"));
    }, { soft: true });

    await session.step("5. mixed page: after a benign prewrite and a physical verify click, the fake-verification warning is shown", async () => {
      const page = await session.newPage();
      const markers = await session.gotoReady(page, session.url("/clickfix-01-basic.html?ai37=mixed"));
      expect(markers.capture).toBe("1");
      expect(markers.bridge).toBe("1");
      await page.bringToFront();
      // Timing guard carried over from phase2-detections' mixed test: both
      // writes must complete inside one second, or the run is TEST_INVALID. It
      // keeps the guide's timing honest but, per #947, does not make the trial
      // a #599 oracle.
      await page.evaluate(() => {
        const status = document.getElementById("status");
        if (!status) throw new Error("TEST_INVALID: ClickFix status oracle is missing");
        const observer = new MutationObserver(() => {
          if (status.textContent?.includes("Clipboard write triggered")) {
            document.documentElement.dataset.clickfixAttackWriteCompletedAt = String(performance.now());
            observer.disconnect();
          }
        });
        observer.observe(status, { childList: true, characterData: true, subtree: true });
      });
      // The guide's DevTools-console prewrite: page-world code with no user gesture.
      const benignCompletedAt = await page.evaluate(async () => {
        await navigator.clipboard.writeText("847293");
        return performance.now();
      });
      // #947: record whether the prewrite alone already warned. On this fixture
      // it does, which is why the trial cannot isolate the attack write.
      const prewriteToast = (await toastState(page).catch(() => null))?.text ?? null;
      session.observe("prewrite alone warned (#947)", JSON.stringify(prewriteToast));
      await trustedClick(page, "#verify-btn");
      await expect(page.locator("#status")).toContainText("Clipboard write triggered", { timeout: 5000 });
      await page.waitForFunction(() => document.documentElement.dataset.clickfixAttackWriteCompletedAt !== undefined, null, { timeout: 5000 });
      const attackCompletedAt = await page.evaluate(() => Number(document.documentElement.dataset.clickfixAttackWriteCompletedAt));
      session.note(`benign-to-attack write gap: ${Math.round(attackCompletedAt - benignCompletedAt)} ms`);
      expect(
        attackCompletedAt - benignCompletedAt,
        "TEST_INVALID: benign and attack writes did not complete inside the one-second regression window",
      ).toBeLessThan(1000);
      const warning = await waitForWarning(page, 8000);
      session.note(`mixed trial warning: ${JSON.stringify(warning)}`);
      await session.screenshot(page, "mixed-after-verify-click");
      expect(warning, "a missing warning is a failure even if the page status changed").not.toBeNull();
      await page.close();
    });

    await session.step("6. the event log has the mixed trial's clickfix_detected, no bridge_buffer_overflow, and no raw clipboard value", async () => {
      await expect.poll(async () => kindCount(await session.eventLog(), "clickfix_detected"), { timeout: 5000 })
        .toBe(kindCount(logAfterBenign, "clickfix_detected") + 1);
      const log = await session.eventLog("event log after the mixed trial");
      expect(kindCount(log, "bridge_buffer_overflow")).toBe(0);
      const stored = JSON.stringify(log);
      expect(RAW_CLIPBOARD_VALUES.filter((value) => stored.includes(value)), "stored rows").toEqual([]);

      const options = await session.openExtensionPage(OPTIONS_PAGE);
      await showOptionsEventLog(options);
      await expect.poll(async () => (await optionsEventRows(options)).length, { timeout: 5000 }).toBeGreaterThan(0);
      const rows = await optionsEventRows(options);
      session.note(`Options event-log rows: ${JSON.stringify(rows.slice(0, 6))}`);
      expect(rows.some((row) => /clickfix/i.test(row)), "Options shows the ClickFix row").toBe(true);
      const rendered = rows.join("\n");
      expect(RAW_CLIPBOARD_VALUES.filter((value) => rendered.includes(value)), "rendered rows").toEqual([]);
      await session.screenshot(options, "options-event-log");
      await options.close();
    });

    await session.step("7. no new console errors on the pages, Options or service worker", async () => {
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
