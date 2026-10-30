import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  clickToastButton,
  getGymBaseUrl,
  waitForNavSentinelBridge,
  waitForToastText,
} from "./extension_test_utils";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.join(root, "extension", "dist");

test.setTimeout(120_000);

// Test instrument, not the attacker: the bridge posts through natives captured
// at document_start (#1141), so only a script that runs before that prelude can
// observe (or drop) its messages. The fixture's inline script controls the
// page clock and random source.
function installBlockedActionProbe(context: BrowserContext): Promise<void> {
  return context.addInitScript(() => {
    const probe = window as Window & {
      blockedActionIdProbe?: Array<{ id: string; url: string | undefined; kind: string | undefined }>;
      blockedActionIdDropSecond?: boolean;
    };
    probe.blockedActionIdProbe = [];
    probe.blockedActionIdDropSecond = false;
    const nativePostMessage = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function (this: MessagePort, message: unknown, ...rest: unknown[]) {
      const data = message as { source?: string; type?: string; id?: unknown; url?: string; kind?: string } | null;
      if (data?.source === "__navsentinel__" && data.type === "ns-nav-blocked" && typeof data.id === "string") {
        probe.blockedActionIdProbe?.push({ id: data.id, url: data.url, kind: data.kind });
        if (probe.blockedActionIdDropSecond && probe.blockedActionIdProbe?.length === 2) return;
      }
      return Reflect.apply(nativePostMessage, this, [message, ...rest]);
    } as typeof MessagePort.prototype.postMessage;
  });
}

test("blocked actions receive distinct authority IDs under a page-controlled clock and random source (#933) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  const { baseUrl, gym } = await getGymBaseUrl(path.join(root, "gym"));
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-action-id-"));
  let context: BrowserContext | null = null;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await installBlockedActionProbe(context);
    const page = await context.newPage();
    await page.goto(`${baseUrl}/main-world-blocked-action-id-collision.html`, {
      waitUntil: "domcontentloaded",
    });
    await waitForNavSentinelBridge(page);

    expect(await page.evaluate(() => Date.now())).toBe(7);
    expect(await page.evaluate(() => Math.random())).toBe(0);

    await page.evaluate(() => {
      window.open("https://first.example.invalid/benign", "_blank");
      window.open("https://second.example.invalid/adversarial", "_blank");
    });

    await expect.poll(
      () => page.evaluate(() => (window as Window & {
        blockedActionIdProbe?: Array<{ id: string; url?: string; kind?: string }>;
      }).blockedActionIdProbe?.length ?? 0),
      { timeout: 10_000 },
    ).toBeGreaterThanOrEqual(2);

    const messages = await page.evaluate(() => (window as Window & {
      blockedActionIdProbe?: Array<{ id: string; url?: string; kind?: string }>;
    }).blockedActionIdProbe?.slice(0, 2) ?? []);

    expect(messages.map((message) => message.url)).toEqual([
      "https://first.example.invalid/benign",
      "https://second.example.invalid/adversarial",
    ]);
    expect(new Set(messages.map((message) => message.id)).size).toBe(2);
  } finally {
    await context?.close();
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("approving the first prompt can execute only its original blocked closure (#933) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  const { baseUrl, gym } = await getGymBaseUrl(path.join(root, "gym"));
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-action-binding-"));
  let context: BrowserContext | null = null;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await installBlockedActionProbe(context);
    const page = await context.newPage();
    await page.goto(`${baseUrl}/main-world-blocked-action-id-collision.html`, {
      waitUntil: "domcontentloaded",
    });
    await waitForNavSentinelBridge(page);

    const firstUrl = `${baseUrl}/index.html?authority=first`;
    const secondUrl = `${baseUrl}/index.html?authority=second`;
    await page.evaluate(({ first, second }) => {
      const probeWindow = window as Window & { blockedActionIdDropSecond?: boolean };
      // Keep the first trusted prompt visible while still registering a second
      // closure. Before the fix, the colliding second Map.set replaced the first.
      probeWindow.blockedActionIdDropSecond = true;
      window.open(first, "_blank");
      window.open(second, "_blank");
    }, { first: firstUrl, second: secondUrl });

    await expect.poll(
      () => page.evaluate(() => (window as Window & {
        blockedActionIdProbe?: Array<{ id: string; url?: string }>;
      }).blockedActionIdProbe?.length ?? 0),
      { timeout: 10_000 },
    ).toBe(2);
    await waitForToastText(page, "Blocked popup", 10_000);

    const popupPromise = context.waitForEvent("page", { timeout: 10_000 });
    await clickToastButton(page, "Allow once");
    const popup = await popupPromise;
    await popup.waitForLoadState("domcontentloaded", { timeout: 10_000 });

    expect(new URL(popup.url()).searchParams.get("authority")).toBe("first");
    const authorityPages = context.pages()
      .filter((candidate) => !candidate.isClosed())
      .map((candidate) => new URL(candidate.url()).searchParams.get("authority"))
      .filter((authority): authority is string => authority !== null);
    expect(authorityPages).toEqual(["first"]);

    const messages = await page.evaluate(() => (window as Window & {
      blockedActionIdProbe?: Array<{ id: string; url?: string }>;
    }).blockedActionIdProbe?.slice(0, 2) ?? []);
    expect(messages.map((message) => message.url)).toEqual([firstUrl, secondUrl]);
    expect(new Set(messages.map((message) => message.id)).size).toBe(2);
  } finally {
    await context?.close();
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
