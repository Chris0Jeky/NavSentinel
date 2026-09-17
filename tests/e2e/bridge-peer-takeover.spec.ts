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
import {
  getGymBaseUrl,
  readBuiltUiGuardRevision,
  waitForNavSentinelBridge,
} from "./extension_test_utils";
import {
  startProvingGroundEgressFence,
  type ProvingGroundEgressAttempt,
} from "./proving_ground_fake_sink";

const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(process.cwd(), "extension", "dist");
const gymRoot = path.resolve(process.cwd(), "gym");

test.setTimeout(90_000);

type FixtureCase = "attack" | "benign" | "mixed";
type FixtureHarness = {
  context: BrowserContext;
  page: Page;
  browserVersion: string;
  networkViolations: ProvingGroundEgressAttempt[];
  blockedExternalAttempts: ProvingGroundEgressAttempt[];
  cleanup: () => Promise<void>;
};

type PeerObservation = {
  profile: number;
  browserVersion: string;
  peerInits: number;
  challengesReceived: number;
  peerVerified: boolean;
  configAcknowledged: boolean;
  harmReached: boolean;
  productReady: boolean;
};
type PeerReceipt = PeerObservation & {
  networkViolations: ProvingGroundEgressAttempt[];
  blockedExternalAttempts: ProvingGroundEgressAttempt[];
};

function requireLoopbackBaseUrl(baseUrl: string): void {
  const parsed = new URL(baseUrl);
  const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);
  if (parsed.protocol !== "http:" || !loopbackHosts.has(parsed.hostname)) {
    throw new Error(`Issue #186 fixture requires a loopback HTTP origin, received ${parsed.origin}`);
  }
}

async function openFixture(fixtureCase: FixtureCase): Promise<FixtureHarness> {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running issue #186 E2E tests.");
  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  requireLoopbackBaseUrl(baseUrl);
  const allowedOrigins = new Set([new URL(baseUrl).origin]);
  const networkViolations: ProvingGroundEgressAttempt[] = [];
  const blockedExternalAttempts: ProvingGroundEgressAttempt[] = [];
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `navsentinel-186-${fixtureCase}-`));
  let context: BrowserContext | undefined;
  let egressFence: Awaited<ReturnType<typeof startProvingGroundEgressFence>> | undefined;
  try {
    egressFence = await startProvingGroundEgressFence(blockedExternalAttempts, allowedOrigins);
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      proxy: {
        server: egressFence.proxyServer,
      },
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
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
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
    await page.goto(`${baseUrl}/issue186-bridge-peer.html?case=${fixtureCase}`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    await expect(page.locator("html")).toHaveAttribute("data-fixture-ready", "1");
    await expect(page.locator("html")).toHaveAttribute(
      "data-navsentinel-ui-guard",
      readBuiltUiGuardRevision(),
    );
    await expect(page.locator("html")).toHaveAttribute("data-navsentinel-capture-ready", "1");

    return {
      context,
      page,
      browserVersion: context.browser()?.version() ?? "unknown",
      networkViolations,
      blockedExternalAttempts,
      cleanup: async () => {
        await context?.close();
        await egressFence?.close();
        if (gym) await gym.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await context?.close();
    await egressFence?.close();
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw error;
  }
}

async function readPeerReceipt(page: Page, profile: number, browserVersion: string): Promise<PeerObservation> {
  return page.evaluate(({ receiptProfile, version }) => ({
    profile: receiptProfile,
    browserVersion: version,
    peerInits: Number(document.documentElement.dataset.peerInitSent ?? "0"),
    challengesReceived: Number(document.documentElement.dataset.challengesReceived ?? "0"),
    peerVerified: document.documentElement.dataset.peerVerified === "1",
    configAcknowledged: document.documentElement.dataset.configAcknowledged === "1",
    harmReached: document.documentElement.dataset.harmReached === "1",
    productReady: document.documentElement.getAttribute("data-navsentinel-bridge-ready") === "1",
  }), { receiptProfile: profile, version: browserVersion });
}

async function attachOrderingReceipt(testInfo: TestInfo, profiles: PeerReceipt[]): Promise<void> {
  const receipt = {
    scenarioId: "NS-ADV-SELF-004",
    fixtureCase: "earliest-authored-page-peer",
    freshProfiles: profiles.length,
    totals: {
      peerInits: profiles.reduce((sum, profile) => sum + profile.peerInits, 0),
      challengesReceived: profiles.reduce((sum, profile) => sum + profile.challengesReceived, 0),
      configAcknowledgements: profiles.filter((profile) => profile.configAcknowledged).length,
      harmReceipts: profiles.filter((profile) => profile.harmReached).length,
      productReady: profiles.filter((profile) => profile.productReady).length,
      networkViolations: profiles.reduce(
        (sum, profile) => sum + profile.networkViolations.reduce((count, attempt) => count + attempt.count, 0),
        0,
      ),
      blockedExternalAttempts: profiles.reduce(
        (sum, profile) => sum + profile.blockedExternalAttempts.reduce((count, attempt) => count + attempt.count, 0),
        0,
      ),
    },
    safety: {
      preLaunchDenyLayer: true,
      externalEgressObserved: false,
      unexpectedEgressAttempted: profiles.some((profile) => profile.networkViolations.length > 0),
    },
    profiles,
  };
  const receiptPath = path.resolve(process.cwd(), "test-results", "issue186-ordering-receipt.json");
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await testInfo.attach("issue186-ordering-receipt.json", {
    path: receiptPath,
    contentType: "application/json",
  });
}

async function attachNetworkDiagnostics(
  testInfo: TestInfo,
  label: string,
  harness: FixtureHarness,
): Promise<void> {
  const diagnosticsPath = path.resolve(
    process.cwd(),
    "test-results",
    `issue186-${label}-network-diagnostics.json`,
  );
  fs.mkdirSync(path.dirname(diagnosticsPath), { recursive: true });
  fs.writeFileSync(diagnosticsPath, `${JSON.stringify({
    networkViolations: harness.networkViolations,
    blockedExternalAttempts: harness.blockedExternalAttempts,
  }, null, 2)}\n`, "utf8");
  await testInfo.attach(`${label}-network-diagnostics.json`, {
    path: diagnosticsPath,
    contentType: "application/json",
  });
}

test("issue #186 ten earliest authored-page peers stay outside the verified bridge @regression", async ({}, testInfo) => {
  const receipts: PeerReceipt[] = [];
  for (let profile = 1; profile <= 10; profile += 1) {
    const harness = await openFixture("attack");
    let observation: PeerObservation | undefined;
    try {
      await waitForNavSentinelBridge(harness.page);
      await expect(harness.page.locator("html")).toHaveAttribute("data-peer-init-sent", "1");
      // Cover the production 3-second half-open handshake timeout before
      // treating the absence of a challenge or acknowledgement as stable.
      await harness.page.waitForTimeout(3_250);
      await expect(harness.page.locator("html")).toHaveAttribute("data-challenges-received", "0");
      await expect(harness.page.locator("html")).toHaveAttribute("data-peer-verified", "0");
      await expect(harness.page.locator("html")).toHaveAttribute("data-config-acknowledged", "0");
      await expect(harness.page.locator("html")).toHaveAttribute("data-harm-reached", "0");
      await expect(harness.page.locator("html")).toHaveAttribute("data-navsentinel-bridge-ready", "1");
      observation = await readPeerReceipt(harness.page, profile, harness.browserVersion);
    } finally {
      await harness.cleanup();
    }
    expect(harness.networkViolations, `profile ${profile} fixture network violations`).toEqual([]);
    expect(observation).toBeDefined();
    receipts.push({
      ...observation!,
      networkViolations: harness.networkViolations.map((attempt) => ({ ...attempt })),
      blockedExternalAttempts: harness.blockedExternalAttempts.map((attempt) => ({ ...attempt })),
    });
  }
  expect(receipts).toHaveLength(10);
  await attachOrderingReceipt(testInfo, receipts);
});

test("issue #186 benign journey keeps product readiness and the local sink clear @regression", async ({}, testInfo) => {
  const harness = await openFixture("benign");
  try {
    await waitForNavSentinelBridge(harness.page);
    await harness.page.locator("#benign-control").click();
    await expect(harness.page.locator("html")).toHaveAttribute("data-benign-clicks", "1");
    await expect(harness.page.locator("html")).toHaveAttribute("data-peer-init-sent", "0");
    await expect(harness.page.locator("html")).toHaveAttribute("data-harm-reached", "0");
  } finally {
    await harness.cleanup();
  }
  expect(harness.networkViolations).toEqual([]);
  await attachNetworkDiagnostics(testInfo, "benign", harness);
});

test("issue #186 mixed journey rejects a page peer after verified readiness @regression", async ({}, testInfo) => {
  const harness = await openFixture("mixed");
  try {
    await waitForNavSentinelBridge(harness.page);
    await harness.page.locator("#mixed-control").click();
    await expect(harness.page.locator("html")).toHaveAttribute("data-benign-clicks", "1");
    await expect(harness.page.locator("html")).toHaveAttribute("data-peer-init-sent", "1");
    await harness.page.waitForTimeout(3_250);
    await expect(harness.page.locator("html")).toHaveAttribute("data-challenges-received", "0");
    await expect(harness.page.locator("html")).toHaveAttribute("data-peer-verified", "0");
    await expect(harness.page.locator("html")).toHaveAttribute("data-config-acknowledged", "0");
    await expect(harness.page.locator("html")).toHaveAttribute("data-harm-reached", "0");
    await expect(harness.page.locator("html")).toHaveAttribute("data-navsentinel-bridge-ready", "1");
  } finally {
    await harness.cleanup();
  }
  expect(harness.networkViolations).toEqual([]);
  await attachNetworkDiagnostics(testInfo, "mixed", harness);
});
