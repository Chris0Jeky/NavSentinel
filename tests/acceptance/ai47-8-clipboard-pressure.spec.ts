/**
 * AI-47 row 8 / former AI-37 — #599 clipboard pressure on a release build.
 * Mirrors docs/agentic/GATE3_GUIDES.md "AI-47 row 8" (historical AI-37 steps
 * 4-7) in a fresh branded Chrome profile. A benign copy-code page and its local
 * verification checkbox stay silent. A benign clipboard prewrite cannot
 * suppress the fake-verification warning on the ClickFix page that follows. The
 * event log records the mixed trial only, gains no bridge_buffer_overflow row,
 * and never shows a raw clipboard value. The hostile unverified retry stays
 * automated-only in tests/e2e/bridge-clipboard-pressure.spec.ts (#186).
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

test("AI-47.8 / former AI-37: a benign clipboard write cannot suppress the fake-verification warning, and benign copy stays silent", async ({}, testInfo) => {
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

    await session.step("5. mixed page: a benign prewrite, then a physical verify click, still shows the fake-verification warning", async () => {
      const page = await session.newPage();
      const markers = await session.gotoReady(page, session.url("/clickfix-01-basic.html?ai37=mixed"));
      expect(markers.capture).toBe("1");
      expect(markers.bridge).toBe("1");
      // The guide's DevTools-console prewrite: page-world code with no user gesture.
      await page.evaluate(async () => navigator.clipboard.writeText("847293"));
      await page.bringToFront();
      await trustedClick(page, "#verify-btn");
      await expect(page.locator("#status")).toContainText("Clipboard write triggered", { timeout: 5000 });
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
