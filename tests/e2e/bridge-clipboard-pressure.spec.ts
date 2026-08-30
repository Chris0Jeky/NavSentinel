import { chromium, expect, test } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
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
};

test.setTimeout(120_000);

test("NS-ADV-SELF-005 keeps a critical receipt after a trusted clipboard burst @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-bridge-pressure-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    timeout: 60_000,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
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

    const page = await context.newPage();
    await page.goto(`${baseUrl}/clickfix-03-legit-captcha.html`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    await waitForNavSentinelBridge(page);

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

    await page.evaluate(() => {
      const copySource = document.createElement("textarea");
      copySource.id = "bridge-pressure-copy-source";
      copySource.value = "NAVSENTINEL_SENTINEL_DO_NOT_RUN";
      document.body.append(copySource);

      const trigger = document.createElement("button");
      trigger.id = "bridge-pressure-trigger";
      trigger.textContent = "Run local bridge pressure control";
      trigger.addEventListener("click", () => {
        copySource.focus();
        copySource.select();
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

    const messages = await page.evaluate(() =>
      (window as typeof window & {
        __nsBridgePressure?: { messages: BridgeMessage[] };
      }).__nsBridgePressure?.messages ?? [],
    );
    const clipboardReceipts = messages.filter((message) => message.type === "ns-clipboard-write");
    const criticalReceiptDelivered = messages.some((message) => message.type === "ns-nav-blocked");
    const receipt = {
      outcome: criticalReceiptDelivered ? "BLOCKED_PRE_HARM" : "HARM_REACHED",
      successfulCopies,
      legitimateTaskComplete: true,
      clipboardReceiptCount: clipboardReceipts.length,
      criticalReceiptDelivered,
      coalesced: successfulCopies - clipboardReceipts.length,
      overflowReported: messages.some((message) => message.type === "ns-bridge-overflow"),
    } as const;

    expect(receipt).toEqual({
      outcome: "BLOCKED_PRE_HARM",
      successfulCopies: 64,
      legitimateTaskComplete: true,
      clipboardReceiptCount: 1,
      criticalReceiptDelivered: true,
      coalesced: 63,
      overflowReported: false,
    });
  } finally {
    await context.close();
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
