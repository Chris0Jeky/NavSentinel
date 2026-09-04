/**
 * MODELLED regression for issue #593 — inherited click authority.
 *
 * The fixture is local/synthetic and its only consequence is a typed loopback
 * fake-sink receipt.
 *
 * Measured mechanism (base a440e35): the content script runs in every frame, so
 * a trusted click on a bare element inside a hidden child frame minted the
 * TAB-WIDE `ns-nav-gesture` / `ns-allow-nav` windows. The child then called
 * `top.location.assign(...)`; Chrome committed that as `transitionType: "link"`
 * with no qualifiers, the worker saw the inherited allowance, and the delayed
 * page-initiated redirect rollback never ran. The identical navigation 1600 ms
 * later — after the 1500 ms window expires — DID roll back, which is what
 * isolates the allowance as the cause.
 *
 * Outcome vocabulary, deliberately distinct because the product cannot do the
 * same thing to every primitive:
 *   - BLOCKED_PRE_HARM: no request ever reaches the sink (window.open, which the
 *     MAIN-world guard can intercept).
 *   - ROLLED_BACK: the request reaches the sink, but the tab does not stay
 *     there — the existing rollback returns the top frame to the source page and
 *     prompts. `Location` members are [LegacyUnforgeable] own properties
 *     (issue #458), so no in-page patch can stop a `location.assign` before the
 *     request leaves; post-commit rollback is the strongest available answer.
 *   - OUT_OF_MODEL: a hidden child frame navigating ITSELF. A frame can already
 *     load any URL through its own `src` with no user input, which the no-input
 *     control arm proves, so the click adds nothing and this is not a
 *     click-deception bypass.
 *   - BENIGN_ALLOWED: a false-positive control that must reach the sink AND stay
 *     there.
 *
 * The fixture is served from `localhost` and the sink from `127.0.0.1` so the
 * navigation is genuinely cross-site: the worker deliberately skips same-site
 * page-initiated navigations, and a same-host probe would prove nothing.
 */
import { chromium, expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  getGymBaseUrl,
  readBuiltMainUiGuardRevision,
  readToastText,
  updateNavigationSettings,
  waitForNavSentinelBridge,
} from "./extension_test_utils";
import {
  startProvingGroundEgressFence,
  startProvingGroundFakeSink,
  type ProvingGroundEgressAttempt,
  type ProvingGroundRole,
  type ProvingGroundSinkReceipt,
} from "./proving_ground_fake_sink";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(__dirname, "..", "..", "extension", "dist");
const gymRoot = path.resolve(__dirname, "..", "..", "gym");
const SCENARIO_ID = "issue-593-hidden-media-layer-modelled";
const CONSEQUENCE = "modelled-hidden-media-navigation";
const OBSERVATION_MS = 3_500;
/**
 * The worker treats every page-initiated navigation within
 * TYPED_ORIGIN_TTL_MS (5 s) of a typed/address-bar commit as part of that
 * user-requested navigation and skips it. Every protected arm therefore waits
 * past that window before arming, so an arm can never "pass" for the unrelated
 * reason that the fixture had only just been typed into the address bar.
 */
const TYPED_ORIGIN_SETTLE_MS = 6_000;

type Expectation = "blocked-pre-harm" | "rolled-back" | "out-of-model" | "benign-allowed";

type Arm = {
  id: string;
  primitive: "child-assign" | "top-assign" | "window-open" | "anchor-top" | "top-script" | "forged-anchor-top";
  delayMs: number;
  /** Which input the harness delivers. */
  input: "physical-click" | "keyboard" | "top-physical-click" | "none";
  layer: "hidden" | "visible";
  role: ProvingGroundRole;
  expectation: Expectation;
};

const arms: readonly Arm[] = [
  // --- attack arms ---
  { id: "top-assign-100", primitive: "top-assign", delayMs: 100, input: "physical-click", layer: "hidden", role: "attack", expectation: "rolled-back" },
  { id: "top-assign-1600", primitive: "top-assign", delayMs: 1_600, input: "physical-click", layer: "hidden", role: "attack", expectation: "rolled-back" },
  // Review finding: the intent signal is page-declared markup, so a deceptive
  // layer can wrap itself in an anchor. A fragment-only or `javascript:` href is
  // not a cross-document destination and must not buy tab-wide authority.
  { id: "forged-anchor-top-100", primitive: "forged-anchor-top", delayMs: 100, input: "physical-click", layer: "hidden", role: "attack", expectation: "rolled-back" },
  { id: "window-open-100", primitive: "window-open", delayMs: 100, input: "physical-click", layer: "hidden", role: "attack", expectation: "blocked-pre-harm" },
  { id: "child-assign-100", primitive: "child-assign", delayMs: 100, input: "physical-click", layer: "hidden", role: "attack", expectation: "out-of-model" },
  { id: "child-assign-1600", primitive: "child-assign", delayMs: 1_600, input: "physical-click", layer: "hidden", role: "attack", expectation: "out-of-model" },
  { id: "child-assign-no-input", primitive: "child-assign", delayMs: 100, input: "none", layer: "hidden", role: "attack", expectation: "out-of-model" },
  // --- benign / false-positive controls ---
  { id: "benign-anchor-top-keyboard", primitive: "anchor-top", delayMs: 0, input: "keyboard", layer: "visible", role: "benign", expectation: "benign-allowed" },
  { id: "benign-top-script-100", primitive: "top-script", delayMs: 100, input: "top-physical-click", layer: "visible", role: "benign", expectation: "benign-allowed" },
];

type Observation = {
  mode: "baseline" | "protected";
  arm: Arm;
  diagnostics: unknown[];
  pageErrors: string[];
  contextPageUrls: string[];
  newlyOpenedPopupUrls: string[];
  sinkReceiptsBefore: number;
  sinkReceiptsAfter: number;
  sinkReceipts: ProvingGroundSinkReceipt[];
  invalidSinkAttempts: unknown[];
  fixtureEgressViolations: ProvingGroundEgressAttempt[];
  blockedExternalAttempts: ProvingGroundEgressAttempt[];
  readiness: Record<string, string | null>;
  toastText: string | null;
  reasonCode: string | null;
  reasonCodeAvailability: string;
  fixtureUrl: string;
  finalTopUrl: string | null;
  topReturnedToFixture: boolean | null;
};

/**
 * The Gym binds 127.0.0.1. Addressing it as `localhost` (pinned to 127.0.0.1 by
 * a host-resolver rule below, so no ::1 surprise) keeps every request on the
 * loopback interface while making fixture and sink different registrable
 * domains.
 */
function crossSiteFixtureBase(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  const isLoopback = parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "localhost" || parsed.hostname === "[::1]";
  if (parsed.protocol !== "http:" || !isLoopback) {
    throw new Error(`GYM_BASE_URL must be an HTTP loopback origin, got: ${baseUrl}`);
  }
  const rewritten = new URL(parsed.href);
  rewritten.hostname = "localhost";
  return rewritten.origin;
}

function localOrigins(baseUrl: string, fixtureBase: string): Set<string> {
  const parsed = new URL(baseUrl);
  const isLoopback = parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "localhost" || parsed.hostname === "[::1]";
  if (parsed.protocol !== "http:" || !isLoopback) {
    throw new Error(`GYM_BASE_URL must be an HTTP loopback origin, got: ${baseUrl}`);
  }
  return new Set([parsed.origin, new URL(fixtureBase).origin]);
}

function armedDiagnostic(
  diagnostics: readonly unknown[],
  frame: "child" | "parent",
  input: string,
): Record<string, unknown> | null {
  for (const entry of diagnostics) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    if (candidate.phase !== "armed") continue;
    const observedFrame = (candidate.frameOverride as string | undefined) ?? candidate.frame;
    if (observedFrame !== frame) continue;
    if (candidate.input !== input) continue;
    return candidate;
  }
  return null;
}

async function childFrame(page: Page, arm: Arm) {
  await expect.poll(() => page.frames().some((frame) => {
    const url = new URL(frame.url());
    return url.pathname.endsWith("/investigation-593-hidden-media-child.html") &&
      url.searchParams.get("arm") === arm.id;
  }), { timeout: 10_000 }).toBe(true);
  const frame = page.frames().find((candidate) => {
    const url = new URL(candidate.url());
    return url.pathname.endsWith("/investigation-593-hidden-media-child.html") &&
      url.searchParams.get("arm") === arm.id;
  });
  if (!frame) throw new Error(`Issue #593 child frame did not load for ${arm.id}`);
  return frame;
}

async function waitForSafeWindow(
  sinkCount: () => number,
  expected: number,
  durationMs: number,
  newlyOpenedPopupUrls: readonly string[],
  sinkOrigin: string,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < durationMs) {
    const actual = sinkCount();
    if (actual !== expected) {
      throw new Error(`HARM_REACHED: protected sink receipt count changed from ${expected} to ${actual}`);
    }
    if (newlyOpenedPopupUrls.some((url) => url.startsWith(sinkOrigin))) {
      throw new Error("HARM_REACHED: protected run opened a usable sink-backed popup");
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function attachDiagnostics(testInfo: TestInfo, observation: Observation): Promise<void> {
  const output = testInfo.outputPath(`${observation.mode}-${observation.arm.id}-diagnostics.json`);
  fs.writeFileSync(output, `${JSON.stringify(observation, null, 2)}\n`, "utf8");
  await testInfo.attach(`${observation.mode}-${observation.arm.id}-diagnostics`, {
    path: output,
    contentType: "application/json",
  });
}

async function runArm(
  arm: Arm,
  mode: Observation["mode"],
  testInfo: TestInfo,
): Promise<Observation> {
  const sink = await startProvingGroundFakeSink({
    runId: `${SCENARIO_ID}-${arm.id}`,
    scenarioId: SCENARIO_ID,
    allowedRoles: [arm.role],
    allowedConsequences: [CONSEQUENCE],
    targetAuthorities: [
      { id: `baseline-${arm.id}`, role: arm.role, consequence: CONSEQUENCE, maxUses: 1 },
      { id: `protected-${arm.id}`, role: arm.role, consequence: CONSEQUENCE, maxUses: 1 },
    ],
  });
  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const fixtureBase = crossSiteFixtureBase(baseUrl);
  const allowedOrigins = localOrigins(baseUrl, fixtureBase);
  allowedOrigins.add(sink.origin);
  const fixtureEgressViolations: ProvingGroundEgressAttempt[] = [];
  const blockedExternalAttempts: ProvingGroundEgressAttempt[] = [];
  const fence = await startProvingGroundEgressFence(blockedExternalAttempts, allowedOrigins);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-issue593-"));
  const diagnostics: unknown[] = [];
  const pageErrors: string[] = [];
  const contextPageUrls: string[] = [];
  const newlyOpenedPopupUrls: string[] = [];
  let context: BrowserContext | null = null;
  let observation: Observation | null = null;
  let sinkReceiptsBefore = 0;
  let readiness: Record<string, string | null> = {};
  let toastText: string | null = null;
  let reasonCode: string | null = null;
  let reasonCodeAvailability = mode === "protected"
    ? "unavailable: protected run did not reach a stable post-action page sample"
    : "not applicable: baseline has no product decision surface";
  let primaryPage: Page | null = null;
  let popupObservationArmed = false;
  let fixtureHref = "";
  let finalTopUrl: string | null = null;
  let topReturnedToFixture: boolean | null = null;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      proxy: { server: fence.proxyServer },
      args: [
        // Pin `localhost` to the same loopback address the Gym binds, so the
        // cross-site fixture origin can never resolve off-box or to ::1.
        "--host-resolver-rules=MAP localhost 127.0.0.1",
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
        ...(mode === "protected"
          ? [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
          : []),
      ],
    });
    await context.route("**/*", async (route) => {
      const target = new URL(route.request().url());
      if ((target.protocol === "http:" || target.protocol === "https:") &&
          !allowedOrigins.has(target.origin)) {
        fixtureEgressViolations.push({ method: route.request().method(), target: `${target.origin}${target.pathname}`, count: 1 });
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });
    context.on("page", (candidate) => {
      const recordUrl = () => {
        const url = candidate.url();
        contextPageUrls.push(url);
        if (popupObservationArmed && candidate !== primaryPage) {
          newlyOpenedPopupUrls.push(url);
        }
      };
      recordUrl();
      candidate.on("framenavigated", recordUrl);
    });
    const page = await context.newPage();
    primaryPage = page;
    page.on("console", (message) => {
      const text = message.text();
      if (!text.startsWith("NAVSENTINEL_ISSUE593:")) return;
      try {
        diagnostics.push(JSON.parse(text.slice("NAVSENTINEL_ISSUE593:".length)));
      } catch {
        diagnostics.push({ phase: "diagnostic-parse-failed", text });
      }
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const targetId = `${mode}-${arm.id}`;
    const fixtureUrl = new URL("/investigation-593-hidden-media-layer.html", fixtureBase);
    fixtureUrl.searchParams.set("arm", arm.id);
    fixtureUrl.searchParams.set("primitive", arm.primitive);
    fixtureUrl.searchParams.set("delay", String(arm.delayMs));
    fixtureUrl.searchParams.set("layer", arm.layer);
    fixtureUrl.searchParams.set("input", arm.input);
    fixtureUrl.searchParams.set("role", arm.role);
    fixtureUrl.searchParams.set("sink", sink.urlFor(arm.role, CONSEQUENCE, targetId));
    fixtureHref = fixtureUrl.href;
    await page.goto(fixtureUrl.href, { waitUntil: "domcontentloaded", timeout: 20_000 });

    if (mode === "protected") {
      await waitForNavSentinelBridge(page);
      await updateNavigationSettings(context, { defaultMode: "smart", autoDismissOverlays: false });
      await page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
      await waitForNavSentinelBridge(page);
    }

    const frame = await childFrame(page, arm);
    await frame.waitForFunction((expectedGuard) => {
      const root = document.documentElement;
      const fixtureReady = root.dataset.fixtureReady === "1";
      if (!expectedGuard) return fixtureReady;
      return fixtureReady &&
        root.getAttribute("data-navsentinel-capture-ready") === "1" &&
        root.getAttribute("data-navsentinel-bridge-ready") === "1" &&
        root.getAttribute("data-navsentinel-ui-guard") === expectedGuard;
    }, mode === "protected" ? readBuiltMainUiGuardRevision() : "", { timeout: 15_000 });

    readiness = await frame.evaluate(() => ({
      fixtureReady: document.documentElement.dataset.fixtureReady ?? null,
      captureReady: document.documentElement.getAttribute("data-navsentinel-capture-ready"),
      bridgeReady: document.documentElement.getAttribute("data-navsentinel-bridge-ready"),
      uiGuard: document.documentElement.getAttribute("data-navsentinel-ui-guard"),
    }));
    sinkReceiptsBefore = sink.snapshot().receipts.length;
    expect(sinkReceiptsBefore, "a fresh per-run local sink must have no receipts before input")
      .toBe(0);

    if (mode === "protected" && arm.input !== "none") {
      // Leave the worker's typed-origin window before arming; see the constant.
      await page.waitForTimeout(TYPED_ORIGIN_SETTLE_MS);
    }
    popupObservationArmed = true;

    if (arm.input === "physical-click") {
      await frame.locator(
        arm.primitive === "forged-anchor-top" ? "#forged-intent-layer" : "#hidden-interactive-layer",
      ).click();
      await expect.poll(() => {
        const armedEntry = armedDiagnostic(diagnostics, "child", "physical-click");
        if (!armedEntry) return null;
        return {
          frame: armedEntry.frame,
          phase: armedEntry.phase,
          input: armedEntry.input,
          trusted: armedEntry.trusted,
          detail: armedEntry.detail,
          modifiers: armedEntry.modifiers,
        };
      }, { timeout: 2_000 }).toEqual({
        frame: "child",
        phase: "armed",
        input: "physical-click",
        trusted: true,
        detail: 1,
        modifiers: { alt: false, ctrl: false, meta: false, shift: false },
      });
    } else if (arm.input === "keyboard") {
      const link = frame.locator("#declared-top-link");
      await link.focus();
      await link.press("Enter");
      await expect.poll(() => {
        const armedEntry = armedDiagnostic(diagnostics, "child", "keyboard");
        if (!armedEntry) return null;
        return { trusted: armedEntry.trusted, detail: armedEntry.detail };
      }, { timeout: 5_000 }).toEqual({ trusted: true, detail: 0 });
    } else if (arm.input === "top-physical-click") {
      await page.locator("#visible-player-control").click();
      await expect.poll(() => {
        const armedEntry = armedDiagnostic(diagnostics, "parent", "top-physical-click");
        if (!armedEntry) return null;
        return { trusted: armedEntry.trusted, detail: armedEntry.detail };
      }, { timeout: 5_000 }).toEqual({ trusted: true, detail: 1 });
    }

    if (arm.expectation === "blocked-pre-harm" && mode === "protected") {
      await waitForSafeWindow(
        () => sink.snapshot().receipts.length,
        sinkReceiptsBefore,
        Math.max(OBSERVATION_MS, arm.delayMs + 1_900),
        newlyOpenedPopupUrls,
        sink.origin,
      );
    } else {
      await expect.poll(() => sink.snapshot().receipts.length, { timeout: arm.delayMs + 15_000 })
        .toBe(sinkReceiptsBefore + 1);
      // Let any product reaction (rollback / prompt) settle before sampling.
      await page.waitForTimeout(OBSERVATION_MS);
    }

    finalTopUrl = page.url();
    topReturnedToFixture = finalTopUrl.split("#")[0] === fixtureHref.split("#")[0];

    toastText = await readToastText(page).catch(() => null);
    reasonCode = await page.evaluate(() => {
      const host = document.querySelector("#__navsentinel_toast_host");
      return host?.getAttribute("data-reason") ?? host?.shadowRoot
        ?.querySelector<HTMLElement>("[data-reason]")?.dataset.reason ?? null;
    }).catch(() => null);
    if (mode === "protected") {
      reasonCodeAvailability = reasonCode
        ? "available: product toast DOM exposed data-reason"
        : "unavailable: product toast DOM exposes no stable reason code in this modelled probe";
    }

    const snapshot = sink.snapshot();
    observation = {
      mode,
      arm,
      diagnostics,
      pageErrors,
      contextPageUrls,
      newlyOpenedPopupUrls,
      sinkReceiptsBefore,
      sinkReceiptsAfter: snapshot.receipts.length,
      sinkReceipts: snapshot.receipts,
      invalidSinkAttempts: snapshot.invalidAttempts,
      fixtureEgressViolations,
      blockedExternalAttempts,
      readiness,
      toastText,
      reasonCode,
      reasonCodeAvailability,
      fixtureUrl: fixtureHref,
      finalTopUrl,
      topReturnedToFixture,
    };
    expect(snapshot.invalidAttempts, "fixture must use only an armed local sink target").toEqual([]);
    expect(fixtureEgressViolations, "the fixture must not request any non-local origin").toEqual([]);
    return observation;
  } finally {
    if (!observation) {
      observation = {
        mode,
        arm,
        diagnostics,
        pageErrors,
        contextPageUrls,
        newlyOpenedPopupUrls,
        sinkReceiptsBefore,
        sinkReceiptsAfter: sink.snapshot().receipts.length,
        sinkReceipts: sink.snapshot().receipts,
        invalidSinkAttempts: sink.snapshot().invalidAttempts,
        fixtureEgressViolations,
        blockedExternalAttempts,
        readiness,
        toastText,
        reasonCode,
        reasonCodeAvailability,
        fixtureUrl: fixtureHref,
        finalTopUrl,
        topReturnedToFixture,
      };
    }
    await attachDiagnostics(testInfo, observation);
    await context?.close();
    await fence.close();
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    await sink.close();
  }
}

test.setTimeout(240_000);

for (const arm of arms) {
  test(`issue #593 MODELLED ${arm.id} (${arm.expectation}) @regression`, async ({}, testInfo) => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension before running issue #593 investigation.");

    const baseline = await runArm(arm, "baseline", testInfo);
    expect(baseline.sinkReceiptsAfter, "baseline must prove this armed consequence is reachable").toBe(
      baseline.sinkReceiptsBefore + 1,
    );
    if (arm.primitive === "top-assign" || arm.primitive === "top-script" ||
        arm.primitive === "anchor-top" || arm.primitive === "forged-anchor-top") {
      expect(baseline.topReturnedToFixture, "an unprotected browser must leave the tab on the destination").toBe(false);
    }

    const observed = await runArm(arm, "protected", testInfo);

    switch (arm.expectation) {
      case "blocked-pre-harm":
        expect(
          observed.sinkReceiptsAfter,
          "BLOCKED_PRE_HARM: no request may reach the sink at all",
        ).toBe(observed.sinkReceiptsBefore);
        break;
      case "rolled-back":
        // `Location` members are unforgeable (#458), so the request itself
        // cannot be stopped in-page; what the boundary restores is that the tab
        // does not silently STAY on the destination.
        expect(
          observed.topReturnedToFixture,
          "ROLLED_BACK: the tab must not stay on a destination a gesture-less child frame chose",
        ).toBe(true);
        break;
      case "out-of-model":
        // The child frame navigates ITSELF. The top context must be untouched;
        // the sink receipt here is the same one a frame gets from its own `src`,
        // which `child-assign-no-input` demonstrates with no user input at all.
        expect(
          observed.topReturnedToFixture,
          "OUT_OF_MODEL: a child frame navigating itself must not move the top frame",
        ).toBe(true);
        expect(
          observed.sinkReceiptsAfter,
          "OUT_OF_MODEL: recorded as reachable, with or without a click",
        ).toBe(observed.sinkReceiptsBefore + 1);
        break;
      case "benign-allowed":
        expect(
          observed.sinkReceiptsAfter,
          "BENIGN_ALLOWED: a legitimate declared navigation must still happen",
        ).toBe(observed.sinkReceiptsBefore + 1);
        expect(
          observed.topReturnedToFixture,
          "BENIGN_ALLOWED: a legitimate navigation must not be rolled back",
        ).toBe(false);
        break;
    }
  });
}
