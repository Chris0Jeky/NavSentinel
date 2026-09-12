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
} from "@playwright/test";
import {
  getGymBaseUrl,
  waitForNavSentinelBridge,
} from "./extension_test_utils";
import {
  startProvingGroundEgressFence,
  startProvingGroundFakeSinkForHost,
  type ProvingGroundEgressAttempt,
  type ProvingGroundFakeSink,
} from "./proving_ground_fake_sink";
import { installFixtureTargetBootstrap } from "./local_fixture_target_bootstrap";

const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(process.cwd(), "extension", "dist");
const gymRoot = path.resolve(process.cwd(), "gym");
const SCENARIO_ID = "NS-ADV-SELF-004";
const BENIGN_CONSEQUENCE = "benign-navigation";

test.setTimeout(90_000);

type ReloadHarness = {
  context: BrowserContext;
  page: Page;
  fixtureUrl: URL;
  sink: ProvingGroundFakeSink;
  networkViolations: ProvingGroundEgressAttempt[];
  blockedExternalAttempts: ProvingGroundEgressAttempt[];
  cleanup: () => Promise<void>;
};

function chromiumArgs(extension: string): string[] {
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
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
  ];
}

async function openHarness(maxBenignUses: number): Promise<ReloadHarness> {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running issue #175 E2E tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const fixtureUrl = new URL("/issue175-bridge-reload.html", baseUrl);
  const sink = await startProvingGroundFakeSinkForHost("127.0.0.1", {
    runId: randomUUID(),
    scenarioId: SCENARIO_ID,
    allowedRoles: ["benign"],
    allowedConsequences: [BENIGN_CONSEQUENCE],
    targetAuthorities: [{
      id: "issue175-benign",
      role: "benign",
      consequence: BENIGN_CONSEQUENCE,
      maxUses: maxBenignUses,
    }],
  });
  const allowedOrigins = new Set([fixtureUrl.origin, sink.origin]);
  const networkViolations: ProvingGroundEgressAttempt[] = [];
  const blockedExternalAttempts: ProvingGroundEgressAttempt[] = [];
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-175-"));
  let context: BrowserContext | undefined;
  let egressFence: Awaited<ReturnType<typeof startProvingGroundEgressFence>> | undefined;

  try {
    egressFence = await startProvingGroundEgressFence(blockedExternalAttempts, allowedOrigins);
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      proxy: { server: egressFence.proxyServer },
      args: chromiumArgs(extensionPath),
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
      bindings: [{
        targetRole: "benign",
        scenarioId: SCENARIO_ID,
        source: {
          kind: "armed-sink",
          sinkRole: "benign",
          consequence: BENIGN_CONSEQUENCE,
          targetId: "issue175-benign",
        },
      }],
    }));
    await page.goto(fixtureUrl.href, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await expect(page.locator("html")).toHaveAttribute("data-fixture-ready", "1");
    await waitForNavSentinelBridge(page);

    return {
      context,
      page,
      fixtureUrl,
      sink,
      networkViolations,
      blockedExternalAttempts,
      cleanup: async () => {
        await context?.close();
        await egressFence?.close();
        await sink.close();
        if (gym) await gym.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await context?.close();
    await egressFence?.close();
    await sink.close();
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw error;
  }
}

async function activateBenignControl(harness: ReloadHarness): Promise<void> {
  const popupPromise = harness.context.waitForEvent("page", { timeout: 5_000 });
  await harness.page.locator("#benign-control").click();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded", { timeout: 5_000 });
  const sinkUrl = new URL(popup.url());
  expect(sinkUrl.origin).toBe(harness.sink.origin);
  expect(sinkUrl.pathname).toBe("/__navsentinel_fake_sink");
  expect(sinkUrl.searchParams.get("role")).toBe("benign");
  expect(sinkUrl.searchParams.get("scenario_id")).toBe(SCENARIO_ID);
  expect(sinkUrl.searchParams.get("consequence")).toBe(BENIGN_CONSEQUENCE);
  expect(sinkUrl.searchParams.get("target_id")).toBe("issue175-benign");
  await expect(popup.locator("body")).toContainText("Synthetic consequence received");
  await popup.close();
}

function assertSafeSink(harness: ReloadHarness, expectedReceipts: number): void {
  const snapshot = harness.sink.snapshot();
  expect(snapshot.receipts).toHaveLength(expectedReceipts);
  expect(snapshot.receipts.every((receipt) =>
    receipt.role === "benign" &&
    receipt.consequence === BENIGN_CONSEQUENCE &&
    receipt.targetId === "issue175-benign",
  )).toBe(true);
  expect(snapshot.invalidAttempts).toEqual([]);
  expect(harness.networkViolations).toEqual([]);
}

test("issue #175 no-reload native benign control reaches only the typed sink @regression", async () => {
  const harness = await openHarness(1);
  try {
    await activateBenignControl(harness);
    assertSafeSink(harness, 1);
  } finally {
    await harness.cleanup();
  }
});

test("issue #175 page reload re-establishes the bridge for one fresh benign control @regression", async () => {
  const harness = await openHarness(2);
  try {
    const firstDocument = await harness.page.locator("html").getAttribute("data-fixture-document");
    expect(firstDocument).toMatch(/^[0-9a-f-]{36}$/u);
    await activateBenignControl(harness);
    expect(harness.sink.snapshot().receipts).toHaveLength(1);

    await harness.page.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
    await expect(harness.page.locator("html")).toHaveAttribute("data-fixture-ready", "1");
    await waitForNavSentinelBridge(harness.page);
    const secondDocument = await harness.page.locator("html").getAttribute("data-fixture-document");
    expect(secondDocument).toMatch(/^[0-9a-f-]{36}$/u);
    expect(secondDocument).not.toBe(firstDocument);

    await activateBenignControl(harness);
    assertSafeSink(harness, 2);
  } finally {
    await harness.cleanup();
  }
});
