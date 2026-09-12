import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { inspectBuiltReleaseProfile } from "../../scripts/check-release-profile.mjs";
import {
  assertNoToastFor,
  startGymServer,
  waitForNavSentinelBridge,
  waitForToastMatch,
} from "./extension_test_utils";
import { installFixtureTargetBootstrap } from "./local_fixture_target_bootstrap";
import {
  PROVING_GROUND_SENTINEL,
  PROVING_GROUND_SINK_PATH,
  startProvingGroundEgressFence,
  startProvingGroundFakeSink,
  type ProvingGroundEgressAttempt,
  type ProvingGroundFakeSink,
  type ProvingGroundRole,
} from "./proving_ground_fake_sink";

const SCENARIO_ID = "NS-ADV-CLIP-005";
const FIXTURE_NAME = "clickfix-05-delayed-rewrite.html";
const HARM_CONSEQUENCE = "inert-shell-paste";
const BENIGN_CONSEQUENCE = "benign-navigation";
const MANUAL_TOKEN = "CASE-48-DELTA";
const OTP_TOKEN = "847293";
const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(process.cwd(), "extension", "dist");
const gymRoot = path.resolve(process.cwd(), "gym");
const copyShortcut = process.platform === "darwin" ? "Meta+C" : "Control+C";
const pasteShortcut = process.platform === "darwin" ? "Meta+V" : "Control+V";

test.setTimeout(120_000);
test.describe.configure({ mode: "serial" });

type ArmId = "baseline" | "protected" | "benign" | "mixed";
type FixtureMode = "attack" | "benign" | "mixed";

type ClipboardArm = {
  id: ArmId;
  page: Page;
  context: BrowserContext;
  sink: ProvingGroundFakeSink;
  browserVersion: string;
  productReady: boolean;
  networkViolations: ProvingGroundEgressAttempt[];
  blockedExternalAttempts: ProvingGroundEgressAttempt[];
  cleanup: () => Promise<void>;
};

function removeTempProfile(userDataDir: string): void {
  const resolved = path.resolve(userDataDir);
  const tempRoot = path.resolve(os.tmpdir());
  if (!resolved.startsWith(`${tempRoot}${path.sep}`) ||
      !path.basename(resolved).startsWith("navsentinel-clipboard-timebomb-")) {
    throw new Error(`Refusing to remove unexpected profile path: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function requireReleaseBuild(): void {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running clipboard evidence.");
  inspectBuiltReleaseProfile(extensionPath, {
    expectedProfile: "interaction-only",
    requireReleaseEligible: true,
  });
}

function fixtureOrigins(baseUrl: string, sinkOrigin: string): Set<string> {
  const fixture = new URL(baseUrl);
  const sink = new URL(sinkOrigin);
  const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (fixture.protocol !== "http:" || sink.protocol !== "http:" ||
      !loopback.has(fixture.hostname) || !loopback.has(sink.hostname)) {
    throw new Error("Clipboard evidence requires loopback HTTP fixture and sink origins");
  }
  return new Set([fixture.origin, sink.origin]);
}

function chromiumArgs(withExtension: boolean): string[] {
  return [
    "--disable-background-networking",
    "--disable-client-side-phishing-detection",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-domain-reliability",
    "--disable-quic",
    "--disable-sync",
    "--metrics-recording-only",
    "--no-default-browser-check",
    "--no-first-run",
    "--safebrowsing-disable-auto-update",
    "--disable-features=AccountConsistency,AutofillServerCommunication,CertificateTransparencyComponentUpdater,MediaRouter,NetworkTimeServiceQuerying,OptimizationHints,Signin",
    ...(withExtension
      ? [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
      : ["--disable-extensions"]),
  ];
}

function assertTargetAuthority(
  href: string,
  expected: {
    role: ProvingGroundRole;
    consequence: string;
    targetId: string;
    sinkOrigin: string;
  },
): void {
  const target = new URL(href);
  expect(target.origin).toBe(expected.sinkOrigin);
  expect(target.pathname).toBe(PROVING_GROUND_SINK_PATH);
  expect(target.username).toBe("");
  expect(target.password).toBe("");
  expect(target.hash).toBe("");
  expect(target.searchParams.get("scenario_id")).toBe(SCENARIO_ID);
  expect(target.searchParams.get("role")).toBe(expected.role);
  expect(target.searchParams.get("consequence")).toBe(expected.consequence);
  expect(target.searchParams.get("target_id")).toBe(expected.targetId);
  expect(target.searchParams.get("sentinel")).toBe(PROVING_GROUND_SENTINEL);
}

async function openArm(
  id: ArmId,
  mode: FixtureMode,
  withExtension: boolean,
): Promise<ClipboardArm> {
  const harmRole: ProvingGroundRole = mode === "mixed" ? "mixed" : "attack";
  const benignRole: ProvingGroundRole = mode === "mixed" ? "mixed" : "benign";
  const sink = await startProvingGroundFakeSink({
    runId: randomUUID(),
    scenarioId: SCENARIO_ID,
    allowedRoles: [...new Set([harmRole, benignRole])],
    allowedConsequences: [HARM_CONSEQUENCE, BENIGN_CONSEQUENCE],
    targetAuthorities: [
      { id: `${id}-harm`, role: harmRole, consequence: HARM_CONSEQUENCE, maxUses: 1 },
      { id: `${id}-benign`, role: benignRole, consequence: BENIGN_CONSEQUENCE, maxUses: 1 },
    ],
  });
  const gym = await startGymServer(gymRoot);
  const fixtureUrl = new URL(`/${FIXTURE_NAME}`, gym.baseUrl);
  fixtureUrl.searchParams.set("mode", mode);
  const allowedOrigins = fixtureOrigins(gym.baseUrl, sink.origin);
  const networkViolations: ProvingGroundEgressAttempt[] = [];
  const blockedExternalAttempts: ProvingGroundEgressAttempt[] = [];
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-clipboard-timebomb-"));
  let context: BrowserContext | null = null;
  let egressFence: Awaited<ReturnType<typeof startProvingGroundEgressFence>> | null = null;
  let closed = false;

  const cleanup = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await context?.close();
    await egressFence?.close();
    await gym.close();
    await sink.close();
    removeTempProfile(userDataDir);
  };

  try {
    // The deny layer starts before the tested browser profile and forwards only
    // this run's declared loopback fixture and sink origins.
    egressFence = await startProvingGroundEgressFence(blockedExternalAttempts, allowedOrigins);
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      proxy: { server: egressFence.proxyServer },
      args: chromiumArgs(withExtension),
    });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: fixtureUrl.origin,
    });
    await context.route("**/*", async (route) => {
      const request = route.request();
      const target = new URL(request.url());
      if ((target.protocol === "http:" || target.protocol === "https:") &&
          !allowedOrigins.has(target.origin)) {
        networkViolations.push({
          method: request.method(),
          target: `${target.origin}${target.pathname}`,
          count: 1,
        });
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });

    const page = await context.newPage();
    await installFixtureTargetBootstrap(page, sink.createFixtureBootstrap({
      fixtureOrigin: fixtureUrl.origin,
      fixturePath: fixtureUrl.pathname,
      bindings: [
        {
          targetRole: "harm",
          scenarioId: SCENARIO_ID,
          source: {
            kind: "armed-sink",
            sinkRole: harmRole,
            consequence: HARM_CONSEQUENCE,
            targetId: `${id}-harm`,
          },
        },
        {
          targetRole: "benign",
          scenarioId: SCENARIO_ID,
          source: {
            kind: "armed-sink",
            sinkRole: benignRole,
            consequence: BENIGN_CONSEQUENCE,
            targetId: `${id}-benign`,
          },
        },
      ],
    }));
    await page.goto(fixtureUrl.href, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await expect(page.locator("html")).toHaveAttribute("data-navsentinel-local-targets-ready", "1");
    await expect(page.locator("html")).not.toHaveAttribute("data-navsentinel-fixture-invalid", /.+/u);
    if (withExtension) await waitForNavSentinelBridge(page);

    const targets = await page.evaluate(() => ({
      harm: document.querySelector<HTMLAnchorElement>("#harm-target")?.href ?? "",
      benign: document.querySelector<HTMLAnchorElement>("#benign-target")?.href ?? "",
    }));
    assertTargetAuthority(targets.harm, {
      role: harmRole,
      consequence: HARM_CONSEQUENCE,
      targetId: `${id}-harm`,
      sinkOrigin: sink.origin,
    });
    assertTargetAuthority(targets.benign, {
      role: benignRole,
      consequence: BENIGN_CONSEQUENCE,
      targetId: `${id}-benign`,
      sinkOrigin: sink.origin,
    });

    return {
      id,
      page,
      context,
      sink,
      browserVersion: context.browser()?.version() ?? "unknown",
      productReady: withExtension,
      networkViolations,
      blockedExternalAttempts,
      cleanup,
    };
  } catch (error) {
    await cleanup().catch(() => {});
    throw error;
  }
}

async function copySelected(page: Page, selector: string, expectedValue: string): Promise<void> {
  await page.locator(selector).selectText();
  await page.keyboard.press(copyShortcut);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(expectedValue);
}

async function runDelayedRewrite(page: Page): Promise<void> {
  await copySelected(page, "#manual-copy-source", MANUAL_TOKEN);
  await expect(page.locator("#attack-status")).toHaveAttribute("data-state", "manual-copy-observed");
  await expect(page.locator("#activity-log li")).toHaveCount(3, { timeout: 3_000 });
  await expect(page.locator("#rewrite-overlay")).toHaveAttribute("data-active", "1");
  await expect(page.locator("#attack-status")).toHaveAttribute("data-state", "rewrite-complete");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(PROVING_GROUND_SENTINEL);
}

async function pasteInto(page: Page, selector: string, expectedValue: string): Promise<void> {
  await page.locator(selector).focus();
  await page.keyboard.press(pasteShortcut);
  await expect(page.locator(selector)).toHaveValue(expectedValue);
}

async function completeOtp(page: Page): Promise<void> {
  await copySelected(page, "#otp-source", OTP_TOKEN);
  await pasteInto(page, "#otp-input", OTP_TOKEN);
  await page.locator("#verify-otp").click();
  await expect(page.locator("#otp-status")).toHaveAttribute("data-state", "verified");
}

function assertNoHarnessViolation(arm: ClipboardArm): void {
  expect(arm.networkViolations, `${arm.id} fixture must not request an undeclared origin`).toEqual([]);
  expect(arm.sink.snapshot().invalidAttempts, `${arm.id} sink must reject no attempted consequence`).toEqual([]);
}

async function attachEvidence(
  testInfo: TestInfo,
  arm: ClipboardArm,
  outcome: "HARM_REACHED" | "WARNED" | "OBSERVED",
  productSignal: string | null,
): Promise<void> {
  await testInfo.attach(`${SCENARIO_ID}-${arm.id}.json`, {
    body: Buffer.from(JSON.stringify({
      scenarioId: SCENARIO_ID,
      arm: arm.id,
      outcome,
      profile: arm.productReady ? "release_extension" : "extension_disabled",
      browserVersion: arm.browserVersion,
      fixture: `gym/${FIXTURE_NAME}`,
      nativeInput: "Playwright keyboard copy/paste and trusted button activation",
      harmOracle: "one-use typed loopback sink receipt",
      productSignal,
      sinkSnapshot: arm.sink.snapshot(),
      fixtureNetworkViolations: arm.networkViolations,
      blockedExternalAttempts: arm.blockedExternalAttempts,
      limitations: [
        "The release extension warns but does not block or restore the rewritten clipboard value.",
        "The simulated terminal is a browser-only local fixture; no native or OS execution occurs.",
        "Bundled Chromium regression is not branded-Chrome, open-web, or efficacy evidence.",
      ],
    }, null, 2)),
    contentType: "application/json",
  });
}

test.describe("NS-ADV-CLIP-005 delayed clipboard rewrite", () => {
  test("extension-disabled baseline reaches the typed inert shell-paste sink @regression", async ({}, testInfo) => {
    requireReleaseBuild();
    const arm = await openArm("baseline", "attack", false);
    try {
      await runDelayedRewrite(arm.page);
      await pasteInto(arm.page, "#simulated-shell-input", PROVING_GROUND_SENTINEL);
      await arm.page.locator("#simulate-shell-submit").click();
      await expect(arm.page.locator("#shell-status")).toHaveAttribute("data-state", "harm-dispatched");
      await expect.poll(() => arm.sink.snapshot().receipts).toHaveLength(1);
      expect(arm.sink.snapshot().receipts[0]).toMatchObject({
        scenarioId: SCENARIO_ID,
        role: "attack",
        consequence: HARM_CONSEQUENCE,
        targetId: "baseline-harm",
      });
      assertNoHarnessViolation(arm);
      await attachEvidence(testInfo, arm, "HARM_REACHED", null);
    } finally {
      await arm.cleanup();
    }
  });

  test("release extension warns before paste and the typed harm sink remains empty @regression", async ({}, testInfo) => {
    requireReleaseBuild();
    const arm = await openArm("protected", "attack", true);
    try {
      await runDelayedRewrite(arm.page);
      const warning = await waitForToastMatch(
        arm.page,
        /ClickFix|clipboard|fake.*verification|Do NOT paste/i,
        8_000,
      );
      await arm.page.waitForTimeout(1_200);
      expect(arm.sink.snapshot().receipts).toEqual([]);
      await expect(arm.page.locator("#shell-status")).toHaveAttribute("data-state", "ready");
      // This is intentionally a warning result, not a clipboard-block claim.
      expect(await arm.page.evaluate(() => navigator.clipboard.readText())).toBe(PROVING_GROUND_SENTINEL);
      assertNoHarnessViolation(arm);
      await attachEvidence(testInfo, arm, "WARNED", warning);
    } finally {
      await arm.cleanup();
    }
  });

  test("benign manual OTP copy and paste succeeds without a ClickFix alert @regression", async ({}, testInfo) => {
    requireReleaseBuild();
    const arm = await openArm("benign", "benign", true);
    try {
      await completeOtp(arm.page);
      await expect.poll(() => arm.sink.snapshot().receipts).toHaveLength(1);
      expect(arm.sink.snapshot().receipts[0]).toMatchObject({
        scenarioId: SCENARIO_ID,
        role: "benign",
        consequence: BENIGN_CONSEQUENCE,
        targetId: "benign-benign",
      });
      await assertNoToastFor(arm.page, 1_500);
      assertNoHarnessViolation(arm);
      await attachEvidence(testInfo, arm, "OBSERVED", null);
    } finally {
      await arm.cleanup();
    }
  });

  test("mixed journey preserves the benign OTP while the harm sink stays empty @regression", async ({}, testInfo) => {
    requireReleaseBuild();
    const arm = await openArm("mixed", "mixed", true);
    try {
      await runDelayedRewrite(arm.page);
      const warning = await waitForToastMatch(
        arm.page,
        /ClickFix|clipboard|fake.*verification|Do NOT paste/i,
        8_000,
      );
      await completeOtp(arm.page);
      await expect.poll(() => arm.sink.snapshot().receipts).toHaveLength(1);
      expect(arm.sink.snapshot().receipts).toEqual([
        expect.objectContaining({
          scenarioId: SCENARIO_ID,
          role: "mixed",
          consequence: BENIGN_CONSEQUENCE,
          targetId: "mixed-benign",
        }),
      ]);
      await expect(arm.page.locator("#shell-status")).toHaveAttribute("data-state", "ready");
      assertNoHarnessViolation(arm);
      await attachEvidence(testInfo, arm, "WARNED", warning);
    } finally {
      await arm.cleanup();
    }
  });
});
