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
  readBuiltMainUiGuardRevision,
  waitForNavSentinelBridge,
} from "./extension_test_utils";

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
  cleanup: () => Promise<void>;
};

type PeerReceipt = {
  profile: number;
  browserVersion: string;
  peerInits: number;
  challengesReceived: number;
  peerVerified: boolean;
  configAcknowledged: boolean;
  harmReached: boolean;
  productReady: boolean;
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `navsentinel-186-${fixtureCase}-`));
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    const page = await context.newPage();
    await page.goto(`${baseUrl}/issue186-bridge-peer.html?case=${fixtureCase}`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    await expect(page.locator("html")).toHaveAttribute("data-fixture-ready", "1");
    await expect(page.locator("html")).toHaveAttribute(
      "data-navsentinel-ui-guard",
      readBuiltMainUiGuardRevision(),
    );
    await expect(page.locator("html")).toHaveAttribute("data-navsentinel-capture-ready", "1");

    return {
      context,
      page,
      browserVersion: context.browser()?.version() ?? "unknown",
      cleanup: async () => {
        await context?.close();
        if (gym) await gym.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await context?.close();
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw error;
  }
}

async function readPeerReceipt(page: Page, profile: number, browserVersion: string): Promise<PeerReceipt> {
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

test("issue #186 ten earliest authored-page peers stay outside the verified bridge @regression", async ({}, testInfo) => {
  const receipts: PeerReceipt[] = [];
  for (let profile = 1; profile <= 10; profile += 1) {
    const { page, browserVersion, cleanup } = await openFixture("attack");
    try {
      await waitForNavSentinelBridge(page);
      await expect(page.locator("html")).toHaveAttribute("data-peer-init-sent", "1");
      // Cover the production 3-second half-open handshake timeout before
      // treating the absence of a challenge or acknowledgement as stable.
      await page.waitForTimeout(3_250);
      await expect(page.locator("html")).toHaveAttribute("data-challenges-received", "0");
      await expect(page.locator("html")).toHaveAttribute("data-peer-verified", "0");
      await expect(page.locator("html")).toHaveAttribute("data-config-acknowledged", "0");
      await expect(page.locator("html")).toHaveAttribute("data-harm-reached", "0");
      await expect(page.locator("html")).toHaveAttribute("data-navsentinel-bridge-ready", "1");
      receipts.push(await readPeerReceipt(page, profile, browserVersion));
    } finally {
      await cleanup();
    }
  }
  expect(receipts).toHaveLength(10);
  await attachOrderingReceipt(testInfo, receipts);
});

test("issue #186 benign journey keeps product readiness and the local sink clear @regression", async () => {
  const { page, cleanup } = await openFixture("benign");
  try {
    await waitForNavSentinelBridge(page);
    await page.locator("#benign-control").click();
    await expect(page.locator("html")).toHaveAttribute("data-benign-clicks", "1");
    await expect(page.locator("html")).toHaveAttribute("data-peer-init-sent", "0");
    await expect(page.locator("html")).toHaveAttribute("data-harm-reached", "0");
  } finally {
    await cleanup();
  }
});

test("issue #186 mixed journey rejects a page peer after verified readiness @regression", async () => {
  const { page, cleanup } = await openFixture("mixed");
  try {
    await waitForNavSentinelBridge(page);
    await page.locator("#mixed-control").click();
    await expect(page.locator("html")).toHaveAttribute("data-benign-clicks", "1");
    await expect(page.locator("html")).toHaveAttribute("data-peer-init-sent", "1");
    await page.waitForTimeout(3_250);
    await expect(page.locator("html")).toHaveAttribute("data-challenges-received", "0");
    await expect(page.locator("html")).toHaveAttribute("data-peer-verified", "0");
    await expect(page.locator("html")).toHaveAttribute("data-config-acknowledged", "0");
    await expect(page.locator("html")).toHaveAttribute("data-harm-reached", "0");
    await expect(page.locator("html")).toHaveAttribute("data-navsentinel-bridge-ready", "1");
  } finally {
    await cleanup();
  }
});
