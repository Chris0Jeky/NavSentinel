/**
 * AI-47 row 8 / former AI-37 — #599 clipboard pressure on a release build.
 * Mirrors docs/agentic/GATE3_GUIDES.md "AI-47 row 8" in a fresh branded Chrome
 * profile: a benign copy-code page and its local verification checkbox stay
 * silent, then gym/clickfix-06-clipboard-pressure.html floods the clipboard
 * inside NavSentinel's pre-handshake window (#947).
 *
 * Why this can fail on a #599 regression. The fixture fires its burst as soon
 * as the MAIN-world clipboard hook is installed and before the public
 * bridge-ready marker appears, so the receipts wait in the unverified
 * OutboundQueue that #599 coalesces. Its overlay carries no verification or
 * paste wording, so a benign write alone scores nothing; only the command-like
 * receipt (written after 40 benign ones) can raise the warning. With #599 the
 * queue keeps the latest other receipt and the latest command-like one: the
 * benign arm is silent, the attack arm warns, and no bridge_buffer_overflow row
 * appears. Without it the flood fills the 32-slot queue, the command-like
 * receipt is dropped, the attack arm stays silent, and both arms log an
 * overflow row. Proof: `node tests/acceptance/pr599-regressed-bundle.ts` builds
 * that regression (the NS-ADV-SELF-005 baseline patch); run this spec with
 * EXTENSION_PATH pointing at it and it must fail.
 *
 * Chrome only lets a page write the clipboard without a click when the site's
 * Clipboard permission is Allow, so step 5 sets it through Chrome's own Site
 * settings page, exactly as the owner does. The hostile same-session bridge
 * retry stays automated-only in NS-ADV-SELF-005 (#186).
 * Automated agent evidence, not the owner Gate-3 result.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { AcceptanceSession, extensionPath, repoRoot, toastState, trustedClick } from "./acceptance_harness";
import { OPTIONS_PAGE, TRUSTED_DOMAINS_KEY } from "./extension_ui_helpers";
import { optionsEventRows, showOptionsEventLog } from "./attribution_helpers";
import { REGRESSED_BUNDLE_MARKER } from "./pr599-regressed-bundle";

const PR_599_MERGE = "d4b1acf5843605f519ffe1732050a2c1bb501ee1";
const ALLOWLIST_KEY = "sentinelsuite:nav_allowlist_v1";
const CLICKFIX_WARNING = /ClickFix|clipboard|fake.*verification|Do NOT paste/i;
const RAW_CLIPBOARD_VALUES = ["847293", "NAVSENTINEL_SENTINEL_DO_NOT_RUN", "CF06-FLOOD-"];
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1"];
const CONSOLE_NOISE = [/favicon\.ico/];
const PRESSURE_FIXTURE = "/clickfix-06-clipboard-pressure.html";
const PRESSURE_ATTEMPTS = 3;
const PRESSURE_TIMING_SAMPLES = 10;
const FLOOD_WRITES = 40;

test.setTimeout(240_000);

type SelfCheck = {
  state: string;
  reason: string;
  attempted: number;
  resolved: number;
  refused: number;
  beforeReady: number;
  burstSpreadMs: number | null;
  readyGapMs: number | null;
};

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

async function waitForEventLogQuiescence(
  session: AcceptanceSession,
  timeoutMs = 6_000,
): Promise<Array<Record<string, unknown>>> {
  const deadline = Date.now() + timeoutMs;
  let previous = await session.eventLog();
  let stableSamples = 0;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const current = await session.eventLog();
    if (JSON.stringify(current) === JSON.stringify(previous)) {
      stableSamples += 1;
      if (stableSamples >= 3) return current;
    } else {
      previous = current;
      stableSamples = 0;
    }
  }
  throw new Error("TEST_INVALID: event log did not quiesce after a discarded pressure load");
}

async function readSelfCheck(page: Page): Promise<SelfCheck> {
  return page.evaluate(() => {
    const data = document.documentElement.dataset;
    return {
      state: data.pressureState ?? "",
      reason: data.pressureReason ?? "",
      attempted: Number(data.pressureAttempted ?? "0"),
      resolved: Number(data.pressureResolved ?? "0"),
      refused: Number(data.pressureRefused ?? "0"),
      beforeReady: Number(data.pressureBeforeReady ?? "0"),
      burstSpreadMs: data.pressureBurstSpreadMs ? Number(data.pressureBurstSpreadMs) : null,
      readyGapMs: data.pressureReadyGapMs ? Number(data.pressureReadyGapMs) : null,
    };
  });
}

/**
 * Set Chrome's per-site Clipboard permission to Allow through the real Site
 * settings page, as the owner does. If Chrome's settings UI has moved, fall back
 * to the equivalent permission override and say so in the receipt.
 */
async function allowClipboardForSite(session: AcceptanceSession, origin: string): Promise<string> {
  const settings = await session.newPage();
  try {
    await settings.goto(`chrome://settings/content/siteDetails?site=${encodeURIComponent(origin)}`);
    const select = settings.locator("site-details-permission").filter({ hasText: "Clipboard" }).locator("select").first();
    await select.selectOption("allow", { timeout: 10_000 });
    await expect(select).toHaveValue("allow");
    await session.screenshot(settings, "site-settings-clipboard-allow");
    return "chrome://settings site details";
  } catch (error) {
    session.note(`Site settings UI path failed (${error instanceof Error ? error.message.split("\n")[0] : String(error)}); used the equivalent clipboard-read permission override`);
    await session.context.grantPermissions(["clipboard-read"], { origin });
    return "permission override (Site settings UI unavailable)";
  } finally {
    await settings.close();
  }
}

/**
 * Load one fixture arm until its self-check reads VALID (the whole burst
 * finished before the bridge-ready marker), reloading like the owner's F5 on a
 * RETRY. Returns the page and the event log captured just before the valid load.
 */
async function loadValidPressureArm(
  session: AcceptanceSession,
  arm: "benign" | "attack",
): Promise<{ page: Page; check: SelfCheck; logBefore: Array<Record<string, unknown>> }> {
  const url = session.url(`${PRESSURE_FIXTURE}?mode=${arm}`, "localhost");
  let page: Page | null = null;
  let check: SelfCheck | null = null;
  let logBefore: Array<Record<string, unknown>> = [];
  for (let attempt = 1; attempt <= PRESSURE_ATTEMPTS; attempt++) {
    if (page) {
      await page.close();
      page = null;
      await waitForEventLogQuiescence(session);
    }
    logBefore = await session.eventLog();
    page = await session.newPage();
    await page.bringToFront();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForFunction(
      () => ["valid", "retry", "failed", "idle"].includes(document.documentElement.dataset.pressureState ?? ""),
      null,
      { timeout: 20_000 },
    );
    check = await readSelfCheck(page);
    session.observe(`${arm} arm load ${attempt} self-check`, JSON.stringify(check));
    if (check.state !== "retry") break;
  }
  if (!check || !page) throw new Error("TEST_INVALID: the pressure fixture never reported a self-check");
  const expectedWrites = FLOOD_WRITES + (arm === "attack" ? 1 : 0);
  // "retry" after every attempt means the window was never exercised (TEST_INVALID);
  // "failed" means the bridge never reported ready, which is a product failure.
  const label = check.state === "failed" ? "FAIL: the bridge-ready marker never appeared" : "TEST_INVALID: the pre-handshake window was not exercised";
  expect(check, `${label} (${arm} arm: ${check.state}, ${check.reason})`).toMatchObject({
    state: "valid",
    attempted: expectedWrites,
    resolved: expectedWrites,
    refused: 0,
    beforeReady: expectedWrites,
  });
  expect(check.readyGapMs, "the self-check requires a measured post-write ready gap").not.toBeNull();
  const markers = await session.requireReady(page);
  expect(markers.capture).toBe("1");
  expect(markers.bridge).toBe("1");
  return { page, check, logBefore };
}

async function collectPressureTimingSamples(session: AcceptanceSession): Promise<SelfCheck[]> {
  const samples: SelfCheck[] = [];
  const url = session.url(`${PRESSURE_FIXTURE}?mode=benign`, "localhost");
  for (let index = 1; index <= PRESSURE_TIMING_SAMPLES; index++) {
    const page = await session.newPage();
    await page.bringToFront();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
      await page.waitForFunction(
        () => ["valid", "retry", "failed"].includes(document.documentElement.dataset.pressureState ?? ""),
        null,
        { timeout: 20_000 },
      );
      const check = await readSelfCheck(page);
      samples.push(check);
      session.observe(`clipboard-pressure timing sample ${index}`, JSON.stringify({
        state: check.state,
        burstSpreadMs: check.burstSpreadMs,
        readyGapMs: check.readyGapMs,
        reason: check.reason,
      }));
    } finally {
      await page.close();
      await waitForEventLogQuiescence(session);
    }
  }
  expect(samples).toHaveLength(PRESSURE_TIMING_SAMPLES);
  expect(
    samples.every((sample) => sample.burstSpreadMs !== null && sample.readyGapMs !== null),
    "every timing sample records burst spread and the marker gap",
  ).toBe(true);
  return samples;
}


test("AI-47.8 / former AI-37: benign copy stays silent; a pre-handshake clipboard flood keeps the command-like receipt (#599, #947)", async ({}, testInfo) => {
  const session = await AcceptanceSession.open(testInfo, "AI-47.8-former-AI-37-PR599");
  try {
    await session.step("1. tested head contains the PR #599 merge and has no product-source changes", async () => {
      execFileSync("git", ["merge-base", "--is-ancestor", PR_599_MERGE, "HEAD"], { cwd: repoRoot });
      expect(session.receipt.git.productSourceClean, "no uncommitted product source changes").toBe(true);
      const regressedMarker = path.join(extensionPath, REGRESSED_BUNDLE_MARKER);
      session.observe(
        "bundle under test",
        fs.existsSync(regressedMarker)
          ? `REGRESSED COPY (#599 coalescing removed; this run must fail): ${fs.readFileSync(regressedMarker, "utf8").trim()}`
          : `as built: ${extensionPath}`,
      );
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

    const logAfterBenign = await session.eventLog("event log after the benign copy trial");
    await session.step("4. the benign copy trial recorded no clickfix_detected event", async () => {
      expect(kindCount(logAfterBenign, "clickfix_detected")).toBe(kindCount(logAtStart, "clickfix_detected"));
    }, { soft: true });

    const pressureOrigin = new URL(session.url("/", "localhost")).origin;
    await session.step("5. Site settings: Clipboard is Allow for the pressure page's origin (localhost)", async () => {
      const route = await allowClipboardForSite(session, pressureOrigin);
      session.observe("clipboard permission set through", `${route} for ${pressureOrigin}`);
    });

    await session.step("6. collect ten branded-browser samples of burst spread and the bridge-marker gap", async () => {
      const samples = await collectPressureTimingSamples(session);
      const readyGaps = samples.map((sample) => sample.readyGapMs).filter((value): value is number => value !== null);
      const burstSpreads = samples.map((sample) => sample.burstSpreadMs).filter((value): value is number => value !== null);
      session.observe("clipboard-pressure timing summary", JSON.stringify({
        samples: samples.length,
        readyGapMs: { min: Math.min(...readyGaps), max: Math.max(...readyGaps) },
        burstSpreadMs: { min: Math.min(...burstSpreads), max: Math.max(...burstSpreads) },
      }));
    });

    const benign = await session.step("7. pressure page, benign arm: the self-check reads VALID with a bounded ready gap", async () =>
      loadValidPressureArm(session, "benign"));
    if (!benign) throw new Error("TEST_INVALID: the benign arm did not load");

    await session.step("8. benign arm: no ClickFix or clipboard warning, no clickfix_detected, no bridge_buffer_overflow", async () => {
      const toasts = await toastsDuring(benign.page, 3000);
      session.note(`benign-arm toasts: ${JSON.stringify(toasts)}`);
      await session.screenshot(benign.page, "pressure-benign-arm");
      const log = await session.eventLog("event log after the benign arm");
      session.observe("benign arm log delta", JSON.stringify({
        clickfix_detected: kindCount(log, "clickfix_detected") - kindCount(benign.logBefore, "clickfix_detected"),
        bridge_buffer_overflow: kindCount(log, "bridge_buffer_overflow"),
      }));
      expect(toasts.filter((text) => CLICKFIX_WARNING.test(text)), "a benign flood alone must not warn").toEqual([]);
      expect(kindCount(log, "clickfix_detected")).toBe(kindCount(benign.logBefore, "clickfix_detected"));
      expect(kindCount(log, "bridge_buffer_overflow"), "the benign flood must not overflow the pre-handshake queue").toBe(0);
    }, { soft: true });
    await benign.page.close();

    const attack = await session.step("9. pressure page, attack arm: the self-check reads VALID with a bounded ready gap", async () =>
      loadValidPressureArm(session, "attack"));
    if (!attack) throw new Error("TEST_INVALID: the attack arm did not load");

    await session.step("10. attack arm: the fake-verification clipboard warning is shown without any click", async () => {
      const warning = await waitForWarning(attack.page, 8000);
      session.note(`attack-arm warning: ${JSON.stringify(warning)}`);
      await session.screenshot(attack.page, "pressure-attack-arm");
      expect(warning, "the command-like receipt must survive the flood and raise the warning").not.toBeNull();
    }, { soft: true });

    await session.step("11. the event log has the attack arm's clickfix_detected, no bridge_buffer_overflow, and no raw clipboard value", async () => {
      await expect.poll(async () => kindCount(await session.eventLog(), "clickfix_detected"), { timeout: 5000 })
        .toBe(kindCount(attack.logBefore, "clickfix_detected") + 1);
      const log = await session.eventLog("event log after the attack arm");
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
    }, { soft: true });
    await attack.page.close();

    await session.step("12. no new console errors on the pages, Options or service worker", async () => {
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
