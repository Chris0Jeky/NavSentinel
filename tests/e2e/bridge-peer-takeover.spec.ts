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
  cleanup: () => Promise<void>;
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

test("issue #186 earliest authored-page peer stays outside the verified bridge @regression", async () => {
  const { page, cleanup } = await openFixture("attack");
  try {
    await waitForNavSentinelBridge(page);
    await expect(page.locator("html")).toHaveAttribute("data-peer-init-sent", "1");
    await page.waitForTimeout(750);
    await expect(page.locator("html")).toHaveAttribute("data-challenges-received", "0");
    await expect(page.locator("html")).toHaveAttribute("data-peer-verified", "0");
    await expect(page.locator("html")).toHaveAttribute("data-config-acknowledged", "0");
    await expect(page.locator("html")).toHaveAttribute("data-harm-reached", "0");
    await expect(page.locator("html")).toHaveAttribute("data-navsentinel-bridge-ready", "1");
  } finally {
    await cleanup();
  }
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
    await page.waitForTimeout(750);
    await expect(page.locator("html")).toHaveAttribute("data-challenges-received", "0");
    await expect(page.locator("html")).toHaveAttribute("data-harm-reached", "0");
    await expect(page.locator("html")).toHaveAttribute("data-navsentinel-bridge-ready", "1");
  } finally {
    await cleanup();
  }
});
