/**
 * Investigation-only, MODELLED reproduction probe for issue #593.
 *
 * The fixture is local/synthetic and its only consequence is a typed loopback
 * fake-sink receipt. A protected receipt or a usable sink-backed popup is a
 * deterministic reproduction, never a transient-pass/rollback success.
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

type Arm = {
  id: string;
  primitive: "child-assign" | "top-assign" | "window-open";
  delayMs: number;
};

const arms: readonly Arm[] = [
  { id: "child-assign-100", primitive: "child-assign", delayMs: 100 },
  { id: "child-assign-1600", primitive: "child-assign", delayMs: 1_600 },
  { id: "top-assign-100", primitive: "top-assign", delayMs: 100 },
  { id: "top-assign-1600", primitive: "top-assign", delayMs: 1_600 },
  { id: "window-open-100", primitive: "window-open", delayMs: 100 },
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
};

function localOrigins(baseUrl: string): Set<string> {
  const parsed = new URL(baseUrl);
  const isLoopback = parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "localhost" || parsed.hostname === "[::1]";
  if (parsed.protocol !== "http:" || !isLoopback) {
    throw new Error(`GYM_BASE_URL must be an HTTP loopback origin, got: ${baseUrl}`);
  }
  return new Set([parsed.origin]);
}

function physicalClickArm(diagnostics: readonly unknown[]): Record<string, unknown> | null {
  for (const entry of diagnostics) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    const modifiers = candidate.modifiers;
    if (candidate.frame === "child" && candidate.phase === "armed" &&
        candidate.input === "physical-click" && candidate.trusted === true &&
        candidate.detail === 1 && modifiers && typeof modifiers === "object") {
      return candidate;
    }
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
    allowedRoles: ["attack"],
    allowedConsequences: [CONSEQUENCE],
    targetAuthorities: [
      { id: `baseline-${arm.id}`, role: "attack", consequence: CONSEQUENCE, maxUses: 1 },
      { id: `protected-${arm.id}`, role: "attack", consequence: CONSEQUENCE, maxUses: 1 },
    ],
  });
  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const allowedOrigins = localOrigins(baseUrl);
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

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      proxy: { server: fence.proxyServer },
      args: [
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
    const fixtureUrl = new URL("/investigation-593-hidden-media-layer.html", baseUrl);
    fixtureUrl.searchParams.set("arm", arm.id);
    fixtureUrl.searchParams.set("primitive", arm.primitive);
    fixtureUrl.searchParams.set("delay", String(arm.delayMs));
    fixtureUrl.searchParams.set("sink", sink.urlFor("attack", CONSEQUENCE, targetId));
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
    popupObservationArmed = true;
    await frame.locator("#hidden-interactive-layer").click();
    await expect.poll(() => {
      const armed = physicalClickArm(diagnostics);
      if (!armed) return null;
      return {
        frame: armed.frame,
        phase: armed.phase,
        input: armed.input,
        trusted: armed.trusted,
        detail: armed.detail,
        modifiers: armed.modifiers,
      };
    }, { timeout: 2_000 }).toEqual({
      frame: "child",
      phase: "armed",
      input: "physical-click",
      trusted: true,
      detail: 1,
      modifiers: { alt: false, ctrl: false, meta: false, shift: false },
    });

    if (mode === "baseline") {
      await expect.poll(() => sink.snapshot().receipts.length, { timeout: arm.delayMs + 5_000 })
        .toBe(sinkReceiptsBefore + 1);
    } else {
      await waitForSafeWindow(
        () => sink.snapshot().receipts.length,
        sinkReceiptsBefore,
        Math.max(OBSERVATION_MS, arm.delayMs + 1_900),
        newlyOpenedPopupUrls,
        sink.origin,
      );
    }

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

test.setTimeout(180_000);

for (const arm of arms) {
  test(`issue #593 MODELLED ${arm.id}: baseline reaches local sink; protected run sustains pre-harm block @regression`, async ({}, testInfo) => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension before running issue #593 investigation.");
    const baseline = await runArm(arm, "baseline", testInfo);
    expect(baseline.sinkReceiptsAfter, "baseline must prove this armed consequence is reachable").toBe(
      baseline.sinkReceiptsBefore + 1,
    );
    const protectedObservation = await runArm(arm, "protected", testInfo);
    expect(
      protectedObservation.sinkReceiptsAfter,
      "HARM_REACHED: a protected sink receipt is a deterministic issue #593 reproduction",
    ).toBe(protectedObservation.sinkReceiptsBefore);
  });
}
