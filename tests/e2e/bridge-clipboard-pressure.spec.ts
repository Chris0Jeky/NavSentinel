import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import {
  startProvingGroundEgressFence,
  startProvingGroundFakeSink,
  type ProvingGroundEgressAttempt,
} from "./proving_ground_fake_sink";
import { getGymBaseUrl, waitForNavSentinelBridge } from "./extension_test_utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(__dirname, "..", "..", "extension", "dist");
const gymRoot = path.resolve(__dirname, "..", "..", "gym");

type BridgeMessage = {
  type?: string;
  challenge?: string;
  id?: string;
  contentLength?: number;
  looksLikeCommand?: boolean;
};

type MutantExtension = {
  extensionPath: string;
  root: string;
  patchedAsset: string;
};

function createVulnerableExtensionCopy(): MutantExtension {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-bridge-mutant-"));
  try {
    const mutantExtensionPath = path.join(root, "extension");
    fs.cpSync(extensionPath, mutantExtensionPath, { recursive: true });

    const assetDirectory = path.join(mutantExtensionPath, "assets");
    const bridgeAssets = fs.readdirSync(assetDirectory).filter((name) =>
      /^bridge_outbound-.*\.js$/u.test(name),
    );
    if (bridgeAssets.length !== 1 || !bridgeAssets[0]) {
      throw new Error(
        `TEST_INVALID: expected exactly one built bridge_outbound asset, found ${bridgeAssets.length}`,
      );
    }

    const patchedAsset = path.join(assetDirectory, bridgeAssets[0]);
    const source = fs.readFileSync(patchedAsset, "utf8");
    const coalescingFunction = /function ([A-Za-z_$][\w$]*)\(e\)\{if\(e\.type===`ns-clipboard-write`\)return e\.payload\?\.looksLikeCommand===!0\?`ns-clipboard-write:command-like`:`ns-clipboard-write:other`\}/gu;
    const matches = [...source.matchAll(coalescingFunction)];
    if (matches.length !== 1) {
      throw new Error(
        `TEST_INVALID: expected one coalescing function in the built asset, found ${matches.length}`,
      );
    }
    const patched = source.replace(coalescingFunction, "function $1(e){return}");
    if (patched === source || patched.includes("ns-clipboard-write:command-like")) {
      throw new Error("TEST_INVALID: the temporary vulnerable extension was not patched exactly");
    }
    fs.writeFileSync(patchedAsset, patched, "utf8");

    return { extensionPath: mutantExtensionPath, root, patchedAsset: bridgeAssets[0] };
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function requireLoopbackHttpOrigin(url: string, label: string): string {
  const origin = new URL(url);
  if (origin.protocol !== "http:" ||
      (origin.hostname !== "127.0.0.1" && origin.hostname !== "localhost")) {
    throw new Error(`TEST_INVALID: expected a loopback HTTP ${label} origin, received ${origin.origin}`);
  }
  return origin.origin;
}

async function installBridgeSessionCapture(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const state = {
      session: "",
      challenge: "",
      messages: [] as Array<Record<string, unknown>>,
      port: null as MessagePort | null,
    };
    (window as typeof window & { __nsBridgePressure?: typeof state }).__nsBridgePressure = state;
    window.addEventListener("message", (event) => {
      const data = event.data as { source?: string; type?: string; v?: number; session?: string };
      if (
        event.source === window &&
        data?.source === "__navsentinel__" &&
        data.type === "ns-port-init" &&
        data.v === 1 &&
        typeof data.session === "string"
      ) {
        state.session = data.session;
      }
    }, true);
  });
}

async function beginControlledRetry(page: Page): Promise<string> {
  const session = await page.evaluate(() =>
    (window as typeof window & {
      __nsBridgePressure?: { session: string };
    }).__nsBridgePressure?.session ?? "",
  );
  expect(session, "TEST_INVALID: the page listener did not observe bridge readiness").toMatch(
    /^[a-f0-9]{32}$/,
  );

  await page.evaluate((capturedSession) => {
    const state = (window as typeof window & {
      __nsBridgePressure?: {
        session: string;
        challenge: string;
        messages: Array<Record<string, unknown>>;
        port: MessagePort | null;
      };
    }).__nsBridgePressure;
    if (!state) throw new Error("TEST_INVALID: bridge-pressure state is missing");

    const channel = new MessageChannel();
    state.port?.close();
    state.port = channel.port1;
    state.messages = [];
    state.challenge = "";
    channel.port1.onmessage = (event) => {
      const message = event.data as { type?: string; challenge?: string };
      state.messages.push(message as Record<string, unknown>);
      if (message.type === "ns-challenge" && typeof message.challenge === "string") {
        state.challenge = message.challenge;
      }
    };
    channel.port1.start();
    window.postMessage(
      {
        source: "__navsentinel__",
        type: "ns-port-init",
        v: 1,
        session: capturedSession,
      },
      "*",
      [channel.port2],
    );
  }, session);

  await expect.poll(async () => page.evaluate(() =>
    (window as typeof window & {
      __nsBridgePressure?: { challenge: string };
    }).__nsBridgePressure?.challenge ?? "",
  ), {
    message: "TEST_INVALID: the controlled retry did not receive a bridge challenge",
  }).toMatch(/^[a-f0-9]{32}$/);
  return session;
}

async function completeControlledRetry(page: Page): Promise<BridgeMessage[]> {
  await page.evaluate(() => {
    const state = (window as typeof window & {
      __nsBridgePressure?: { challenge: string; port: MessagePort | null };
    }).__nsBridgePressure;
    if (!state?.port || !state.challenge) {
      throw new Error("TEST_INVALID: the controlled bridge cannot be completed");
    }
    state.port.postMessage({
      source: "__navsentinel__",
      type: "ns-challenge-response",
      challenge: state.challenge,
    });
  });

  await expect.poll(async () => page.evaluate(() => {
    const state = (window as typeof window & {
      __nsBridgePressure?: { messages: BridgeMessage[] };
    }).__nsBridgePressure;
    return state?.messages.some((message) => message.type === "ns-bridge-ready") ?? false;
  }), {
    message: "TEST_INVALID: the controlled bridge never became ready",
  }).toBe(true);

  return page.evaluate(() =>
    (window as typeof window & {
      __nsBridgePressure?: { messages: BridgeMessage[] };
    }).__nsBridgePressure?.messages ?? [],
  );
}

async function writeReceipt(
  testInfo: TestInfo,
  name: string,
  receipt: unknown,
): Promise<void> {
  const outputPath = testInfo.outputPath(name);
  fs.writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await testInfo.attach(name, {
    path: outputPath,
    contentType: "application/json",
  });
}

test.setTimeout(120_000);

test("NS-ADV-SELF-005 malicious browser baseline reaches the vulnerable bridge sink @regression", async ({}, testInfo) => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  const mutant = createVulnerableExtensionCopy();
  let sink: Awaited<ReturnType<typeof startProvingGroundFakeSink>> | null = null;
  let gym: Awaited<ReturnType<typeof getGymBaseUrl>>["gym"] = null;
  let egressFence: Awaited<ReturnType<typeof startProvingGroundEgressFence>> | null = null;
  let context: BrowserContext | null = null;
  let userDataDir = "";
  const networkViolations: string[] = [];
  const blockedExternalAttempts: ProvingGroundEgressAttempt[] = [];

  try {
    sink = await startProvingGroundFakeSink({
      runId: "ns-adv-self-005-browser-baseline",
      scenarioId: "NS-ADV-SELF-005",
      allowedRoles: ["attack"],
      allowedConsequences: ["critical-signal-starvation"],
    });
    const baselineSink = sink;
    const gymHarness = await getGymBaseUrl(gymRoot);
    const baseUrl = gymHarness.baseUrl;
    gym = gymHarness.gym;
    const allowedOrigins = new Set([
      requireLoopbackHttpOrigin(baseUrl, "Gym"),
      requireLoopbackHttpOrigin(baselineSink.origin, "fake sink"),
    ]);
    egressFence = await startProvingGroundEgressFence(blockedExternalAttempts, allowedOrigins);
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-bridge-baseline-"));
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
        `--disable-extensions-except=${mutant.extensionPath}`,
        `--load-extension=${mutant.extensionPath}`,
      ],
    });
    await installBridgeSessionCapture(context);
    await context.route("**/*", async (route) => {
      const target = new URL(route.request().url());
      if ((target.protocol === "http:" || target.protocol === "https:") &&
          !allowedOrigins.has(target.origin)) {
        networkViolations.push(`${route.request().method()} ${target.origin}${target.pathname}`);
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });

    const page = await context.newPage();
    await page.goto(`${baseUrl}/clickfix-03-legit-captcha.html`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    await waitForNavSentinelBridge(page);
    expect(await page.evaluate(() => ({
      capture: document.documentElement.getAttribute("data-navsentinel-capture-ready"),
      bridge: document.documentElement.getAttribute("data-navsentinel-bridge-ready"),
    })), "TEST_INVALID: the extension was not ready for the browser baseline").toEqual({
      capture: "1",
      bridge: "1",
    });
    await beginControlledRetry(page);

    await page.evaluate(() => {
      const copySource = document.createElement("span");
      copySource.id = "bridge-baseline-copy-source";
      copySource.textContent = "NAVSENTINEL_SENTINEL_DO_NOT_RUN";
      document.body.append(copySource);

      const trigger = document.createElement("button");
      trigger.id = "bridge-baseline-trigger";
      trigger.textContent = "Run local vulnerable bridge baseline";
      trigger.addEventListener("click", () => {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(copySource);
        selection?.removeAllRanges();
        selection?.addRange(range);
        let successfulCopies = 0;
        for (let index = 0; index < 64; index++) {
          if (document.execCommand("copy")) successfulCopies++;
        }
        const popupResults = [
          window.open("about:blank", "_blank"),
          window.open("about:blank", "_blank"),
          window.open("about:blank", "_blank"),
        ];
        document.documentElement.dataset.bridgeBaselineSuccessfulCopies = String(successfulCopies);
        document.documentElement.dataset.bridgeBaselineBlockedPopups = String(
          popupResults.filter((result) => result === null).length,
        );
        document.documentElement.dataset.bridgeBaselineLegitimateTaskComplete = "1";
      });
      document.body.append(trigger);
    });

    await page.click("#bridge-baseline-trigger");
    const browserResult = await page.evaluate(() => ({
      successfulCopies: Number(
        document.documentElement.dataset.bridgeBaselineSuccessfulCopies ?? "0",
      ),
      blockedPopups: Number(
        document.documentElement.dataset.bridgeBaselineBlockedPopups ?? "0",
      ),
      legitimateTaskComplete:
        document.documentElement.dataset.bridgeBaselineLegitimateTaskComplete === "1",
    }));
    expect(
      browserResult.successfulCopies,
      "TEST_INVALID: trusted input produced no successful native copy",
    ).toBe(64);
    expect(browserResult.blockedPopups).toBeGreaterThan(0);
    expect(browserResult.legitimateTaskComplete).toBe(true);

    const messages = await completeControlledRetry(page);
    const clipboardReceipts = messages.filter((message) => message.type === "ns-clipboard-write");
    const criticalReceiptDelivered = messages.some((message) => message.type === "ns-nav-blocked");
    const overflowReported = messages.some((message) => message.type === "ns-bridge-overflow");

    await page.evaluate(({ sinkUrl }) => {
      const trigger = document.createElement("button");
      trigger.id = "bridge-baseline-continue";
      trigger.textContent = "Continue local synthetic consequence";
      trigger.addEventListener("click", () => {
        const messages = (window as typeof window & {
          __nsBridgePressure?: { messages: BridgeMessage[] };
        }).__nsBridgePressure?.messages ?? [];
        if (messages.some((message) => message.type === "ns-nav-blocked")) {
          document.documentElement.dataset.bridgeBaselineHarmHeld = "1";
          return;
        }
        void fetch(sinkUrl, { mode: "no-cors", cache: "no-store" });
      });
      document.body.append(trigger);
    }, { sinkUrl: baselineSink.urlFor("attack", "critical-signal-starvation") });
    await page.click("#bridge-baseline-continue");
    await expect.poll(() => baselineSink.snapshot().receipts.length, {
      message: "The vulnerable bridge did not reach the armed local harm sink",
    }).toBe(1);
    const sinkSnapshot = baselineSink.snapshot();

    const receipt = {
      schemaVersion: "1.0.0",
      scenarioId: "NS-ADV-SELF-005",
      role: "attack",
      browser: {
        name: "chromium",
        version: context.browser()?.version() ?? "unknown",
        channel: "playwright-bundled",
      },
      readiness: { capture: true, bridge: true, trustedInput: true },
      outcome: criticalReceiptDelivered ? "BLOCKED_PRE_HARM" : "HARM_REACHED",
      successfulCopies: browserResult.successfulCopies,
      legitimateTaskComplete: browserResult.legitimateTaskComplete,
      deliveredClipboardReceipts: clipboardReceipts.length,
      criticalReceiptDelivered,
      overflowReported,
      harmSinkReceipts: sinkSnapshot.receipts.length,
      invalidSinkAttempts: sinkSnapshot.invalidAttempts.length,
      mutantPatchedAsset: mutant.patchedAsset,
      networkViolations,
      blockedExternalAttempts,
      syntheticOnly: true,
      rawClipboardRetained: false,
    } as const;
    await writeReceipt(testInfo, "ns-adv-self-005-malicious-baseline-receipt.json", receipt);
    expect(receipt).toMatchObject({
      outcome: "HARM_REACHED",
      successfulCopies: 64,
      legitimateTaskComplete: true,
      deliveredClipboardReceipts: 32,
      criticalReceiptDelivered: false,
      overflowReported: true,
      harmSinkReceipts: 1,
      invalidSinkAttempts: 0,
      networkViolations: [],
      syntheticOnly: true,
      rawClipboardRetained: false,
    });
  } finally {
    await context?.close();
    await egressFence?.close();
    await sink?.close();
    if (gym) await gym.close();
    if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(mutant.root, { recursive: true, force: true });
  }
});

test("NS-ADV-SELF-005 keeps a critical receipt after a trusted clipboard burst @regression", async ({}, testInfo) => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  let sink: Awaited<ReturnType<typeof startProvingGroundFakeSink>> | null = null;
  let gym: Awaited<ReturnType<typeof getGymBaseUrl>>["gym"] = null;
  let egressFence: Awaited<ReturnType<typeof startProvingGroundEgressFence>> | null = null;
  let context: BrowserContext | null = null;
  let userDataDir = "";
  const networkViolations: string[] = [];
  const blockedExternalAttempts: ProvingGroundEgressAttempt[] = [];

  try {
    sink = await startProvingGroundFakeSink({
      runId: "ns-adv-self-005-protected",
      scenarioId: "NS-ADV-SELF-005",
      allowedRoles: ["mixed"],
      allowedConsequences: ["critical-signal-starvation"],
    });
    const protectedSink = sink;
    const gymHarness = await getGymBaseUrl(gymRoot);
    const baseUrl = gymHarness.baseUrl;
    gym = gymHarness.gym;
    const allowedOrigins = new Set([
      requireLoopbackHttpOrigin(baseUrl, "Gym"),
      requireLoopbackHttpOrigin(protectedSink.origin, "fake sink"),
    ]);
    egressFence = await startProvingGroundEgressFence(blockedExternalAttempts, allowedOrigins);
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-bridge-pressure-"));
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
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    await installBridgeSessionCapture(context);
    await context.route("**/*", async (route) => {
      const target = new URL(route.request().url());
      if ((target.protocol === "http:" || target.protocol === "https:") &&
          !allowedOrigins.has(target.origin)) {
        networkViolations.push(`${route.request().method()} ${target.origin}${target.pathname}`);
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });

    const page = await context.newPage();
    await page.goto(`${baseUrl}/clickfix-03-legit-captcha.html`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    await waitForNavSentinelBridge(page);
    await beginControlledRetry(page);

    await page.evaluate(() => {
      const copySource = document.createElement("span");
      copySource.id = "bridge-pressure-copy-source";
      copySource.textContent = "NAVSENTINEL_SENTINEL_DO_NOT_RUN";
      document.body.append(copySource);

      const trigger = document.createElement("button");
      trigger.id = "bridge-pressure-trigger";
      trigger.textContent = "Run local bridge pressure control";
      trigger.addEventListener("click", () => {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(copySource);
        selection?.removeAllRanges();
        selection?.addRange(range);
        let successfulCopies = 0;
        for (let index = 0; index < 64; index++) {
          if (document.execCommand("copy")) successfulCopies++;
        }
        const popupResults = [
          window.open("about:blank", "_blank"),
          window.open("about:blank", "_blank"),
          window.open("about:blank", "_blank"),
        ];
        document.documentElement.dataset.bridgePressureSuccessfulCopies = String(successfulCopies);
        document.documentElement.dataset.bridgePressureBlockedPopups = String(
          popupResults.filter((result) => result === null).length,
        );
        document.documentElement.dataset.bridgePressureLegitimateTaskComplete = "1";
      });
      document.body.append(trigger);
    });

    await page.click("#bridge-pressure-trigger");
    const successfulCopies = await page.evaluate(() =>
      Number(document.documentElement.dataset.bridgePressureSuccessfulCopies ?? "0"),
    );
    expect(successfulCopies, "TEST_INVALID: trusted input produced no successful native copy").toBe(64);
    expect(await page.evaluate(() =>
      document.documentElement.dataset.bridgePressureLegitimateTaskComplete,
    )).toBe("1");
    expect(await page.evaluate(() =>
      Number(document.documentElement.dataset.bridgePressureBlockedPopups ?? "0"),
    )).toBeGreaterThan(0);

    const messages = await completeControlledRetry(page);
    const clipboardReceipts = messages.filter((message) => message.type === "ns-clipboard-write");
    const criticalReceiptDelivered = messages.some((message) => message.type === "ns-nav-blocked");
    const firstWindowContentLength = clipboardReceipts[0]?.contentLength;

    await page.evaluate(({ sinkUrl }) => {
      const trigger = document.createElement("button");
      trigger.id = "bridge-protected-continue";
      trigger.textContent = "Continue local synthetic consequence";
      trigger.addEventListener("click", () => {
        const messages = (window as typeof window & {
          __nsBridgePressure?: { messages: BridgeMessage[] };
        }).__nsBridgePressure?.messages ?? [];
        if (messages.some((message) => message.type === "ns-nav-blocked")) {
          document.documentElement.dataset.bridgeProtectedHarmHeld = "1";
          return;
        }
        void fetch(sinkUrl, { mode: "no-cors", cache: "no-store" });
      });
      document.body.append(trigger);
    }, { sinkUrl: protectedSink.urlFor("mixed", "critical-signal-starvation") });
    await page.click("#bridge-protected-continue");
    expect(await page.evaluate(() =>
      document.documentElement.dataset.bridgeProtectedHarmHeld,
    )).toBe("1");
    expect(protectedSink.snapshot()).toEqual({ receipts: [], invalidAttempts: [] });

    const reconnectText = "SECOND_BRIDGE_WINDOW_SYNTHETIC_SENTINEL_847293";
    await beginControlledRetry(page);
    await page.evaluate((text) => {
      const copySource = document.createElement("span");
      copySource.id = "bridge-reconnect-copy-source";
      copySource.textContent = text;
      document.body.append(copySource);

      const trigger = document.createElement("button");
      trigger.id = "bridge-reconnect-trigger";
      trigger.textContent = "Run second bridge lifecycle window";
      trigger.addEventListener("click", () => {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(copySource);
        selection?.removeAllRanges();
        selection?.addRange(range);
        const copySucceeded = document.execCommand("copy");
        const popupResults = [
          window.open("about:blank", "_blank"),
          window.open("about:blank", "_blank"),
          window.open("about:blank", "_blank"),
        ];
        document.documentElement.dataset.bridgeReconnectCopySucceeded = String(copySucceeded);
        document.documentElement.dataset.bridgeReconnectBlockedPopups = String(
          popupResults.filter((result) => result === null).length,
        );
      });
      document.body.append(trigger);
    }, reconnectText);
    await page.click("#bridge-reconnect-trigger");
    expect(await page.evaluate(() =>
      document.documentElement.dataset.bridgeReconnectCopySucceeded,
    )).toBe("true");
    expect(await page.evaluate(() =>
      Number(document.documentElement.dataset.bridgeReconnectBlockedPopups ?? "0"),
    )).toBeGreaterThan(0);

    const reconnectMessages = await completeControlledRetry(page);
    const reconnectClipboardReceipts = reconnectMessages.filter(
      (message) => message.type === "ns-clipboard-write",
    );
    const reconnectCriticalReceiptDelivered = reconnectMessages.some(
      (message) => message.type === "ns-nav-blocked",
    );
    expect(firstWindowContentLength).not.toBe(reconnectText.length);
    expect(reconnectClipboardReceipts).toHaveLength(1);
    expect(reconnectClipboardReceipts[0]?.contentLength).toBe(reconnectText.length);
    expect(reconnectMessages.some(
      (message) => message.type === "ns-clipboard-write" &&
        message.contentLength === firstWindowContentLength,
    )).toBe(false);
    expect(reconnectCriticalReceiptDelivered).toBe(true);
    expect(reconnectMessages.some((message) => message.type === "ns-bridge-overflow")).toBe(false);

    const receipt = {
      schemaVersion: "1.0.0",
      scenarioId: "NS-ADV-SELF-005",
      role: "protected",
      outcome: criticalReceiptDelivered ? "BLOCKED_PRE_HARM" : "HARM_REACHED",
      successfulCopies,
      legitimateTaskComplete: true,
      clipboardReceiptCount: clipboardReceipts.length,
      criticalReceiptDelivered,
      coalesced: successfulCopies - clipboardReceipts.length,
      overflowReported: messages.some((message) => message.type === "ns-bridge-overflow"),
      harmSinkReceipts: protectedSink.snapshot().receipts.length,
      reconnect: {
        clipboardReceiptCount: reconnectClipboardReceipts.length,
        clipboardContentLength: reconnectClipboardReceipts[0]?.contentLength,
        criticalReceiptDelivered: reconnectCriticalReceiptDelivered,
        staleFirstWindowReceiptPresent: reconnectMessages.some(
          (message) => message.type === "ns-clipboard-write" &&
            message.contentLength === firstWindowContentLength,
        ),
        overflowReported: reconnectMessages.some(
          (message) => message.type === "ns-bridge-overflow",
        ),
      },
      networkViolations,
      blockedExternalAttempts,
    } as const;

    await writeReceipt(testInfo, "ns-adv-self-005-protected-receipt.json", receipt);

    expect(receipt).toEqual({
      schemaVersion: "1.0.0",
      scenarioId: "NS-ADV-SELF-005",
      role: "protected",
      outcome: "BLOCKED_PRE_HARM",
      successfulCopies: 64,
      legitimateTaskComplete: true,
      clipboardReceiptCount: 1,
      criticalReceiptDelivered: true,
      coalesced: 63,
      overflowReported: false,
      harmSinkReceipts: 0,
      reconnect: {
        clipboardReceiptCount: 1,
        clipboardContentLength: reconnectText.length,
        criticalReceiptDelivered: true,
        staleFirstWindowReceiptPresent: false,
        overflowReported: false,
      },
      networkViolations: [],
      blockedExternalAttempts,
    });
  } finally {
    await context?.close();
    await egressFence?.close();
    await sink?.close();
    if (gym) await gym.close();
    if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
