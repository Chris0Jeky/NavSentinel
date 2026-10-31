/**
 * AI-47 row 8 / former AI-37 — #599 clipboard pressure on an observed test copy.
 * Mirrors docs/agentic/GATE3_GUIDES.md "AI-47 row 8" in a fresh branded Chrome
 * profile: a benign copy-code page and its local verification checkbox stay
 * silent, then gym/clickfix-06-clipboard-pressure.html floods the clipboard
 * inside NavSentinel's pre-handshake window (#947).
 *
 * Why this can fail on a #599 regression. The fixture fires its burst as soon
 * as the MAIN-world clipboard hook is installed and before the public
 * bridge-ready marker appears. A builder-controlled observer in a copied
 * bundle must separately prove that the actual receipts reached the unverified
 * OutboundQueue before its first accepted handshake. Marker gaps cannot prove
 * this ordering. Its overlay carries no verification or
 * paste wording, so a benign write alone scores nothing; only the command-like
 * receipt (written after 40 benign ones) can raise the warning. With #599 the
 * queue keeps the latest other receipt and the latest command-like one: the
 * benign arm is silent, the attack arm warns, and no bridge_buffer_overflow row
 * appears. Without it the flood fills the 32-slot queue, the command-like
 * receipt is dropped, the attack arm stays silent, and both arms log an
 * overflow row if the command's successful receipt arrives after the queue
 * fills. Invocation order alone does not prove receipt order: paired
 * qualification requires the first actual drain to contain zero command-like
 * receipts. `node tests/acceptance/pr599-regressed-bundle.ts` builds
 * that regression (the NS-ADV-SELF-005 baseline patch). This spec automatically
 * creates an observed copy of its source EXTENSION_PATH (default extension/dist),
 * scoped to this session. Run it again with EXTENSION_PATH pointing at the
 * regressed source copy. With valid direct queue evidence, the regression must
 * fail the unchanged behavior assertions. Use scripts/clipboard-pressure-pair.mjs
 * for strict paired qualification; two exit codes alone do not establish it.
 *
 * Chrome only lets a page write the clipboard without a click when the site's
 * Clipboard permission is Allow, so step 5 sets it through Chrome's own Site
 * settings page, exactly as the owner does. The hostile same-session bridge
 * retry stays automated-only in NS-ADV-SELF-005 (#186).
 * This proves only the explicitly instrumented diagnostic artifact. It is
 * neither unchanged release-artifact evidence nor an owner Gate-3 result.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { AcceptanceSession, extensionPath, repoRoot, toastState, trustedClick } from "./acceptance_harness";
import { OPTIONS_PAGE, TRUSTED_DOMAINS_KEY } from "./extension_ui_helpers";
import { optionsEventRows, showOptionsEventLog } from "./attribution_helpers";
import { REGRESSED_BUNDLE_MARKER } from "./pr599-regressed-bundle";
import { readClipboardPressureObserverMarker, withClipboardPressureObservedBundle, type ClipboardQueueEvidence } from "./clipboard-pressure-observed-bundle";
import { PRESSURE_OUTCOMES_TITLE, PressurePhase, type PressureOutcomes } from "./clipboard-pressure-qualification";
import { attributedCount, pressureLoadPath } from "./pressure_load_attribution";

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
  queueEvidence: ClipboardQueueEvidence | null;
};

/** Every distinct toast text seen on the page during the window. */
async function toastsDuring(page: Page, ms: number, onRead?: (failed: boolean) => void): Promise<string[]> {
  const seen = new Set<string>();
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const state = await toastState(page).then((value) => { onRead?.(false); return value; }, () => { onRead?.(true); return null; });
    if (state?.text) seen.add(state.text);
    await page.waitForTimeout(100);
  }
  return [...seen];
}

async function waitForWarning(page: Page, ms: number, onRead?: (failed: boolean) => void): Promise<string | null> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const state = await toastState(page).then((value) => { onRead?.(false); return value; }, () => { onRead?.(true); return null; });
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

/**
 * Every pressure-fixture load gets its own path label, and clickfix_detected
 * rows are counted per label. A late row from a discarded RETRY load is then
 * attributed to that load, not to the next arm; a row no issued label explains
 * is TEST_INVALID (#954).
 */
class PressureLoads {
  readonly issued = new Set<string>();
  readonly benign = new Set<string>();
  private readonly origin: string;

  constructor(private readonly session: AcceptanceSession, private readonly preexisting: ReadonlySet<string>) {
    this.origin = new URL(session.url("/", "localhost")).origin;
  }

  next(arm: "benign" | "attack"): { label: string; url: string } {
    const label = `load-${this.issued.size + 1}`;
    this.issued.add(label);
    if (arm === "benign") this.benign.add(label);
    return { label, url: this.session.url(`${pressureLoadPath(label, PRESSURE_FIXTURE)}?mode=${arm}`, "localhost") };
  }

  clickfix(log: Array<Record<string, unknown>>, labels: ReadonlySet<string>): number {
    return attributedCount(log, "clickfix_detected", labels, {
      origin: this.origin, host: "localhost", gymPath: PRESSURE_FIXTURE, issued: this.issued, preexisting: this.preexisting,
    });
  }
}

async function readSelfCheck(page: Page): Promise<SelfCheck> {
  return page.evaluate(() => {
    const data = document.documentElement.dataset;
    // Read the builder's non-configurable getter directly. The DOM copy is
    // presentation only and cannot authorize an acceptance verdict.
    const descriptor = Object.getOwnPropertyDescriptor(window, "__navsentinelClipboardQueueTestEvidence");
    const queueEvidence = descriptor?.get && descriptor.configurable === false
      ? (window as typeof window & { __navsentinelClipboardQueueTestEvidence?: ClipboardQueueEvidence }).__navsentinelClipboardQueueTestEvidence ?? null
      : null;
    return {
      state: data.pressureState ?? "",
      reason: data.pressureReason ?? "",
      attempted: Number(data.pressureAttempted ?? "0"),
      resolved: Number(data.pressureResolved ?? "0"),
      refused: Number(data.pressureRefused ?? "0"),
      beforeReady: Number(data.pressureBeforeReady ?? "0"),
      burstSpreadMs: data.pressureBurstSpreadMs ? Number(data.pressureBurstSpreadMs) : null,
      readyGapMs: data.pressureReadyGapMs ? Number(data.pressureReadyGapMs) : null,
      queueEvidence,
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
 * Load one fixture arm until the whole burst has a direct queue witness from
 * the intended diagnostic artifact. Returns the page, the existing log and the
 * load labels whose clickfix_detected rows this arm counts: the selected attack
 * load alone, or every benign-mode load (a discarded load's late row stays its own).
 */
async function loadValidPressureArm(
  session: AcceptanceSession,
  arm: "benign" | "attack",
  artifactId: string,
  outcomes: PressureOutcomes,
  loads: PressureLoads,
): Promise<{ page: Page; check: SelfCheck; logBefore: Array<Record<string, unknown>>; documentToken: string; labels: ReadonlySet<string> }> {
  let page: Page | null = null;
  let check: SelfCheck | null = null;
  let logBefore: Array<Record<string, unknown>> = [];
  let documentToken = "";
  let labels: ReadonlySet<string> = new Set();
  for (let attempt = 1; attempt <= PRESSURE_ATTEMPTS; attempt++) {
    if (page) await page.close();
    const load = loads.next(arm);
    labels = arm === "attack" ? new Set([load.label]) : loads.benign;
    logBefore = await session.eventLog();
    documentToken = randomUUID();
    page = await session.newPage();
    await page.bringToFront();
    await page.goto(load.url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await page.waitForFunction(
      () => ["valid", "retry", "failed", "idle"].includes(document.documentElement.dataset.pressureState ?? ""),
      null,
      { timeout: 20_000 },
    );
    check = await readSelfCheck(page);
    session.observe(`${arm} arm load ${attempt} self-check (${load.label})`, JSON.stringify(check));
    outcomes.arms[arm].push({ attempt, documentToken,
      baseline: { clickfix: loads.clickfix(logBefore, labels), overflow: kindCount(logBefore, "bridge_buffer_overflow") }, check });
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
  expect(check.queueEvidence, "the actual queue witness must belong to this diagnostic copy").toMatchObject({
    schema: "navsentinel-clipboard-queue-test/v2", artifactId,
    verificationCount: 1, queuedAfterVerification: 0,
    firstVerification: { clipboardEnqueueCalls: expectedWrites, other: FLOOD_WRITES, commandLike: arm === "attack" ? 1 : 0 },
  });
  const markers = await session.requireReady(page);
  expect(markers.capture).toBe("1");
  expect(markers.bridge).toBe("1");
  return { page, check, logBefore, documentToken, labels };
}

async function collectPressureTimingSamples(session: AcceptanceSession, artifactId: string, loads: PressureLoads): Promise<SelfCheck[]> {
  const samples: SelfCheck[] = [];
  for (let index = 1; index <= PRESSURE_TIMING_SAMPLES; index++) {
    const { url } = loads.next("benign");
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
      expect(check.queueEvidence?.artifactId, "sample observer belongs to the selected test artifact").toBe(artifactId);
      samples.push(check);
      session.observe(`clipboard-pressure timing sample ${index}`, JSON.stringify({
        state: check.state,
        burstSpreadMs: check.burstSpreadMs,
        readyGapMs: check.readyGapMs,
        queueEvidence: check.queueEvidence,
        reason: check.reason,
      }));
    } finally {
      await page.close();
    }
  }
  expect(samples).toHaveLength(PRESSURE_TIMING_SAMPLES);
  expect(
    samples.every((sample) => sample.burstSpreadMs !== null && sample.readyGapMs !== null),
    "every timing sample records burst spread and the marker gap",
  ).toBe(true);
  return samples;
}


async function runObservedPressureAcceptance(testInfo: TestInfo, observedExtensionPath: string): Promise<void> {
  const observer = readClipboardPressureObserverMarker(observedExtensionPath);
  const session = await AcceptanceSession.open(testInfo, "AI-47.8-former-AI-37-PR599-diagnostic-queue", {
    extensionPath: observedExtensionPath, classification: observer.classification,
  });
  const outcomes: PressureOutcomes = {
    schema: "navsentinel-clipboard-pressure-outcomes/v1",
    pairId: process.env.NAVSENTINEL_PRESSURE_PAIR_ID ?? null,
    variant: process.env.NAVSENTINEL_PRESSURE_PAIR_VARIANT ?? null,
    testId: testInfo.testId,
    config: { workers: testInfo.config.workers, retries: testInfo.project.retries, retry: testInfo.retry,
      timeout: testInfo.timeout, pressureAttempts: PRESSURE_ATTEMPTS, timingSamples: PRESSURE_TIMING_SAMPLES },
    observer, timingSampleCount: 0, toastReadErrors: 0, arms: { benign: [], attack: [] }, phases: [],
  };
  const toastRead = (phase?: PressurePhase) => (failed: boolean): void => {
    if (failed) outcomes.toastReadErrors++;
    if (phase) { phase.record.readCount++; if (failed) phase.record.readErrors++; }
  };
  try {
    await session.step("1. tested head contains the PR #599 merge and has no product-source changes", async () => {
      execFileSync("git", ["merge-base", "--is-ancestor", PR_599_MERGE, "HEAD"], { cwd: repoRoot });
      expect(session.receipt.git.productSourceClean, "no uncommitted product source changes").toBe(true);
      const regressedMarker = path.join(observedExtensionPath, REGRESSED_BUNDLE_MARKER);
      session.observe(
        "bundle under test",
        fs.existsSync(regressedMarker)
          ? `REGRESSED COPY (#599 coalescing removed; this run must fail): ${fs.readFileSync(regressedMarker, "utf8").trim()}`
          : `fixed queue policy in an instrumented test copy: ${observedExtensionPath}`,
      );
      session.observe("direct queue observer artifact", JSON.stringify(observer));
      session.note("TEST_ONLY_INSTRUMENTED_COPY_NOT_RELEASE_EVIDENCE: synchronous queue counters; no bridge delays; clickfix_detected rows are counted per load path label (#954).");
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
      const copyToasts = await toastsDuring(page, 2000, toastRead());
      session.note(`benign copy toasts: ${JSON.stringify(copyToasts)}`);
      expect(copyToasts.filter((text) => CLICKFIX_WARNING.test(text))).toEqual([]);

      await trustedClick(page, "#recaptcha-checkbox");
      const checkboxToasts = await toastsDuring(page, 2000, toastRead());
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
    // Rows already present predate the pressure fixture; every later clickfix_detected row must carry an issued load label.
    const loads = new PressureLoads(session, new Set((await session.eventLog()).map((row) => String(row.id))));
    await session.step("5. Site settings: Clipboard is Allow for the pressure page's origin (localhost)", async () => {
      const route = await allowClipboardForSite(session, pressureOrigin);
      session.observe("clipboard permission set through", `${route} for ${pressureOrigin}`);
    });

    await session.step("6. collect ten diagnostic timing samples and direct queue witnesses", async () => {
      const samples = await collectPressureTimingSamples(session, observer.artifactId, loads);
      outcomes.timingSampleCount = samples.length;
      const readyGaps = samples.map((sample) => sample.readyGapMs).filter((value): value is number => value !== null);
      const burstSpreads = samples.map((sample) => sample.burstSpreadMs).filter((value): value is number => value !== null);
      session.observe("clipboard-pressure timing summary", JSON.stringify({
        samples: samples.length,
        readyGapMs: { min: Math.min(...readyGaps), max: Math.max(...readyGaps) },
        burstSpreadMs: { min: Math.min(...burstSpreads), max: Math.max(...burstSpreads) },
      }));
    });

    const benign = await session.step("7. pressure page, benign arm: VALID requires the direct pre-verification queue witness", async () =>
      loadValidPressureArm(session, "benign", observer.artifactId, outcomes, loads));
    if (!benign) throw new Error("TEST_INVALID: the benign arm did not load");

    await session.step("8. benign arm: no ClickFix or clipboard warning, no clickfix_detected, no bridge_buffer_overflow", async () => {
      const phase = new PressurePhase(outcomes, "benign", benign.documentToken);
      const toasts = await toastsDuring(benign.page, 3000, toastRead(phase));
      session.note(`benign-arm toasts: ${JSON.stringify(toasts)}`);
      await session.screenshot(benign.page, "pressure-benign-arm");
      const log = await phase.read(() => session.eventLog("event log after the benign arm"));
      session.observe("benign arm log delta", JSON.stringify({
        clickfix_detected: loads.clickfix(log, benign.labels) - loads.clickfix(benign.logBefore, benign.labels),
        bridge_buffer_overflow: kindCount(log, "bridge_buffer_overflow"),
      }));
      phase.record.observations = { warningCount: toasts.filter((text) => CLICKFIX_WARNING.test(text)).length,
        baselineClickfix: loads.clickfix(benign.logBefore, benign.labels), clickfix: loads.clickfix(log, benign.labels),
        overflow: kindCount(log, "bridge_buffer_overflow") };
      await phase.check("benign.no-warning", () =>
        expect(toasts.filter((text) => CLICKFIX_WARNING.test(text)), "a benign flood alone must not warn").toEqual([]),
      () => toasts.filter((text) => CLICKFIX_WARNING.test(text)).length === 0);
      await phase.check("benign.no-clickfix", () =>
        expect(loads.clickfix(log, benign.labels)).toBe(loads.clickfix(benign.logBefore, benign.labels)),
      () => loads.clickfix(log, benign.labels) === loads.clickfix(benign.logBefore, benign.labels));
      await phase.check("benign.no-overflow", () =>
        expect(kindCount(log, "bridge_buffer_overflow"), "the benign flood must not overflow the pre-handshake queue").toBe(0),
      () => kindCount(log, "bridge_buffer_overflow") === 0);
      phase.finish();
    }, { soft: true });
    await benign.page.close();

    const attack = await session.step("9. pressure page, attack arm: VALID requires the direct pre-verification queue witness", async () =>
      loadValidPressureArm(session, "attack", observer.artifactId, outcomes, loads));
    if (!attack) throw new Error("TEST_INVALID: the attack arm did not load");

    await session.step("10. attack arm: the fake-verification clipboard warning is shown without any click", async () => {
      const phase = new PressurePhase(outcomes, "attack-warning", attack.documentToken);
      const warning = await waitForWarning(attack.page, 8000, toastRead(phase));
      session.note(`attack-arm warning: ${JSON.stringify(warning)}`);
      await session.screenshot(attack.page, "pressure-attack-arm");
      phase.record.observations = { warningPresent: warning !== null };
      await phase.check("attack.warning", () =>
        expect(warning, "the command-like receipt must survive the flood and raise the warning").not.toBeNull(), () => warning !== null);
      phase.finish();
    }, { soft: true });

    await session.step("11. the event log has the attack arm's clickfix_detected, no bridge_buffer_overflow, and no raw clipboard value", async () => {
      const phase = new PressurePhase(outcomes, "attack-log", attack.documentToken);
      const observations = phase.record.observations;
      const baselineClickfix = loads.clickfix(attack.logBefore, attack.labels);
      observations.baselineClickfix = baselineClickfix;
      observations.lastPolledClickfix = null;
      await phase.check("attack.clickfix", async () => {
        await expect.poll(async () => {
          const count = loads.clickfix(await phase.read(() => session.eventLog()), attack.labels);
          observations.lastPolledClickfix = count;
          return count;
        }, { timeout: 5000 }).toBe(baselineClickfix + 1);
      }, () => observations.lastPolledClickfix === baselineClickfix + 1, 5000);
      // Persist and check the remaining original observations even when the
      // preceding matcher fails. Its failure is rethrown at the group boundary.
      const log = await phase.read(() => session.eventLog("event log after the attack arm"));
      observations.clickfix = loads.clickfix(log, attack.labels);
      observations.overflow = kindCount(log, "bridge_buffer_overflow");
      await phase.check("attack.no-overflow", () => expect(kindCount(log, "bridge_buffer_overflow")).toBe(0),
        () => kindCount(log, "bridge_buffer_overflow") === 0);
      const stored = JSON.stringify(log);
      observations.storedRawMatches = RAW_CLIPBOARD_VALUES.filter((value) => stored.includes(value)).length;
      await phase.check("stored.private", () => expect(RAW_CLIPBOARD_VALUES.filter((value) => stored.includes(value)), "stored rows").toEqual([]),
        () => RAW_CLIPBOARD_VALUES.filter((value) => stored.includes(value)).length === 0);

      const options = await session.openExtensionPage(OPTIONS_PAGE);
      await showOptionsEventLog(options);
      observations.lastPolledOptionsRows = null;
      await phase.check("options.populated", async () => {
        await expect.poll(async () => {
          const count = (await phase.read(() => optionsEventRows(options))).length;
          observations.lastPolledOptionsRows = count;
          return count;
        }, { timeout: 5000 }).toBeGreaterThan(0);
      }, () => typeof observations.lastPolledOptionsRows === "number" && observations.lastPolledOptionsRows > 0, 5000);
      const rows = await phase.read(() => optionsEventRows(options));
      observations.optionsRows = rows.length;
      const badges = await phase.read(() => options.locator("#eventLog .event-badge").allTextContents());
      observations.optionsClickfix = badges.filter((kind) => kind === "clickfix_detected").length;
      session.note(`Options event-log rows: ${JSON.stringify(rows.slice(0, 6))}`);
      // Options shows all loads; the selected-load assertion above still proves the attack outcome.
      await phase.check("options.clickfix", () => expect(observations.optionsClickfix, "Options matches the native ClickFix history").toBe(kindCount(log, "clickfix_detected")),
        () => observations.optionsClickfix === kindCount(log, "clickfix_detected"));
      const rendered = rows.join("\n");
      observations.renderedRawMatches = RAW_CLIPBOARD_VALUES.filter((value) => rendered.includes(value)).length;
      await phase.check("rendered.private", () => expect(RAW_CLIPBOARD_VALUES.filter((value) => rendered.includes(value)), "rendered rows").toEqual([]),
        () => RAW_CLIPBOARD_VALUES.filter((value) => rendered.includes(value)).length === 0);
      await session.screenshot(options, "options-event-log");
      await options.close();
      phase.finish();
    }, { soft: true });
    await attack.page.close();

    await session.step("12. no new console errors on the pages, Options or service worker", async () => {
      const phase = new PressurePhase(outcomes, "console", null);
      const errors = session.consoleErrors(CONSOLE_NOISE);
      session.note(`console errors: ${JSON.stringify(errors)}`);
      phase.record.observations = { errors: errors.length };
      await phase.check("console.clean", () => expect(errors).toEqual([]), () => errors.length === 0);
      phase.finish();
    }, { soft: true });
  } catch (error) {
    session.markFailed(error);
    throw error;
  } finally {
    session.observe(PRESSURE_OUTCOMES_TITLE, JSON.stringify(outcomes));
    await session.close();
  }
}

test("AI-47.8 / former AI-37: benign copy stays silent; a pre-handshake clipboard flood keeps the command-like receipt (#599, #947)", async ({}, testInfo) => {
  test.skip(!fs.existsSync(path.join(extensionPath, "manifest.json")), "Build extension/dist before the acceptance lane.");
  await withClipboardPressureObservedBundle(extensionPath, ({ extensionPath: observedExtensionPath }) =>
    runObservedPressureAcceptance(testInfo, observedExtensionPath));
});
