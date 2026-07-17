import { test, expect, chromium } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import {
  assertNoToastFor,
  clickToastButton,
  dismissOnboarding,
  getGymBaseUrl,
  getServiceWorker,
  waitForNavSentinelBridge,
  waitForToastMatch,
  waitForToastText
} from "./extension_test_utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(__dirname, "..", "..", "extension", "dist");
const gymRoot = path.resolve(__dirname, "..", "..", "gym");

test.setTimeout(120_000);

test("Level 1 blocks new tabs @smoke", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/level1-basic-opacity.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);

      const play = page.locator("#play");
      const box = await play.boundingBox();
      expect(box, "#play button should be visible").toBeTruthy();
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

      await waitForToastText(page, "Blocked new tab", 3000);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("Level 2 moving target overlay blocks the hidden new tab @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/level2-moving-target.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);

      const realBtn = page.locator("#realBtn");
      const box = await realBtn.boundingBox();
      expect(box, "#realBtn should be visible").toBeTruthy();

      const popupPromise = context.waitForEvent("page", { timeout: 1500 }).catch(() => null);
      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await page.waitForTimeout(100);
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

      const popup = await popupPromise;
      expect(popup, "Expected the hidden overlay new tab to be blocked").toBeNull();
      await waitForToastText(page, "Blocked new tab", 3000);
      await expect(page).toHaveURL(/level2-moving-target\.html/);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("Level 3 instant injection blocks the injected trap path @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/level3-instant-injection.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);

      const popupPromise = context.waitForEvent("page", { timeout: 1500 }).catch(() => null);
      await page.click("#target");

      const popup = await popupPromise;
      expect(popup, "Expected the injected trap new tab to be blocked").toBeNull();
      await page.waitForFunction(
        () => {
          const host = document.querySelector("#__navsentinel_toast_host");
          const text = host?.shadowRoot?.querySelector(".body")?.textContent ?? "";
          return (
            text.includes("Blocked new tab") ||
            text.includes("blocked a suspicious new tab") ||
            text.includes("blocked a deceptive click")
          );
        },
        null,
        { timeout: 3000 }
      );
      await expect(page).toHaveURL(/level3-instant-injection\.html/);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("Level 4 visual mimicry blocks the disguised download new tab @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/level4-visual-mimicry.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);

      const popupPromise = context.waitForEvent("page", { timeout: 1500 }).catch(() => null);
      await page.click(".download");

      const popup = await popupPromise;
      expect(popup, "Expected the disguised download new tab to be blocked").toBeNull();
      await waitForToastText(page, "Blocked new tab", 3000);
      await expect(page).toHaveURL(/level4-visual-mimicry\.html/);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("Level 10 delayed form submit prompts @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/level10-redirects-and-forms.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);

      const bridgeReady = await page.evaluate(
        () => document.documentElement.getAttribute("data-navsentinel-bridge-ready") === "1"
      );
      expect(bridgeReady, "Expected bridge to be ready (patches applied)").toBe(true);

      const patchHardened = await page.evaluate(() => {
        const desc = Object.getOwnPropertyDescriptor(window, "open");
        return desc ? !desc.writable : false;
      });
      expect(patchHardened, "Expected window.open to be non-writable").toBe(true);

      const protoHardened = await page.evaluate(() => {
        const desc = Object.getOwnPropertyDescriptor(Window.prototype, "open");
        return desc ? !desc.writable && !desc.configurable : false;
      });
      expect(protoHardened, "Expected Window.prototype.open to be non-writable and non-configurable").toBe(true);

      await page.click("#submitDelayed");
      await page.waitForTimeout(2600);
      await waitForToastText(page, "Blocked form submit", 4000);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("Level 12 delayed same-tab navigation does not roll back a legitimate click @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/level12-slow-same-tab-link.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);

      await page.click("#slowLink");
      await page.waitForURL(/level4-visual-mimicry\.html\?delayMs=2500/, { timeout: 10_000 });
      await assertNoToastFor(page, 1200);
      await expect(page).toHaveURL(/level4-visual-mimicry\.html\?delayMs=2500/);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("RW-01 search result overlay swap blocks deceptive new tab @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/rw01-search-result-overlay-swap.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);

      const card = page.locator(".result").first();
      const box = await card.boundingBox();
      expect(box, "Expected the sponsored result card to be visible").toBeTruthy();

      const popupPromise = context.waitForEvent("page", { timeout: 1500 }).catch(() => null);
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

      const popup = await popupPromise;
      expect(popup, "Expected the deceptive sponsored-result new tab to be blocked").toBeNull();
      await waitForToastText(page, "Blocked new tab", 3000);
      await expect(page).toHaveURL(/rw01-search-result-overlay-swap\.html/);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("RW-03 delayed redirect landing prompts before final navigation @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/rw03-delayed-redirect-landing.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);

      await page.click("#rw03Watch");
      const rw03Toast = await waitForToastMatch(
        page,
        /Blocked redirect|rolled back a.*redirect/i,
        7000
      );
      await clickToastButton(page, /Blocked redirect/i.test(rw03Toast) ? "Allow once" : "Proceed");
      await page.waitForURL(/rw03-final-report\.html\?from=briefing/, { timeout: 5000 });
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("RW-04 open redirect laundering prompts on the intermediary page @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/rw04-open-redirect-landing.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);

      await page.click("#rw04Invoice");
      await page.waitForURL(/rw04-local-redirector\.html/, { timeout: 5000 });
      const blockedPopup = context.waitForEvent("page", { timeout: 3000 }).catch(() => null);
      await page.waitForTimeout(2500);
      const blockedAttempt = await blockedPopup;
      expect(blockedAttempt, "Expected the laundering popup to be blocked").toBeNull();
      await waitForToastText(page, "Blocked popup", 4000);
      await expect(page).toHaveURL(/rw04-local-redirector\.html/);

      const allowPopup = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
      await clickToastButton(page, "Allow once");
      const finalPopup = await allowPopup;
      expect(finalPopup, "Expected the allow-once laundering popup to open").not.toBeNull();
      await finalPopup?.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
      expect(finalPopup?.url()).toContain("rw04-final-offer.html?from=redirector");
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("RW-06 legit auth popup allows the first window and blocks the second @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/rw06-legit-auth-second-popup.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);
      await dismissOnboarding(context);

      const beforePages = context.pages().length;
      const popupPromise = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
      await page.click("#rw06Signin");

      const popup = await popupPromise;
      expect(popup, "Expected the first auth popup to open").not.toBeNull();
      await popup?.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
      expect(popup?.url()).toContain("oauth=workspace-auth");

      await expect.poll(() => context.pages().length, { timeout: 5000 }).toBe(beforePages + 1);
      await waitForToastText(page, "Blocked popup", 3000);
      await page.waitForTimeout(300);
      expect(context.pages().length).toBe(beforePages + 1);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("Synthetic pointer and click events cannot mint navigation allowances @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/level1-basic-opacity.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });
      await waitForNavSentinelBridge(page);

      const serviceWorker = await getServiceWorker(context);
      const originalUrl = page.url();
      const beforePages = context.pages().length;
      const allowanceMonitor = serviceWorker.evaluate(async ({ currentUrl, durationMs }) => {
        const tabs = await chrome.tabs.query({});
        const tab = tabs.find((candidate) => candidate.url === currentUrl);
        if (typeof tab?.id !== "number") throw new Error("Test tab not found");
        const key = String(tab.id);
        const deadline = Date.now() + durationMs;
        while (Date.now() < deadline) {
          const stored = await chrome.storage.session.get([
            "ns_sw:gestureUntil",
            "ns_sw:allowUntil",
            "ns_sw:allowTarget"
          ]);
          const gesture = !!(stored["ns_sw:gestureUntil"] as Record<string, unknown> | undefined)?.[key];
          const broad = !!(stored["ns_sw:allowUntil"] as Record<string, unknown> | undefined)?.[key];
          const target = !!(stored["ns_sw:allowTarget"] as Record<string, unknown> | undefined)?.[key];
          if (gesture || broad || target) return true;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        return false;
      }, { currentUrl: page.url(), durationMs: 1500 });

      const trust = await page.evaluate(() => {
        const button = document.createElement("button");
        button.textContent = "Synthetic navigation trigger";
        document.body.appendChild(button);

        const pointer = new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          ctrlKey: true
        });
        const click = new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          button: 0,
          ctrlKey: true
        });
        button.dispatchEvent(pointer);
        button.dispatchEvent(click);

        // A same-tab anchor is the exact-target path. Prevent its default action
        // after the extension's capture listener so a vulnerable allowance stays
        // observable in session state instead of being consumed by a commit.
        const anchor = document.createElement("a");
        anchor.href = `${location.origin}/synthetic-target?token=fixture#fragment`;
        anchor.textContent = "Synthetic exact target";
        anchor.addEventListener("click", (event) => event.preventDefault());
        document.body.appendChild(anchor);
        anchor.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        return { pointer: pointer.isTrusted, click: click.isTrusted };
      });
      expect(trust).toEqual({ pointer: false, click: false });

      // Probe across the whole allowance window instead of assuming MessagePort
      // delivery completes within one fixed delay. On vulnerable code, any probe
      // can spend the synthetic broad MAIN-world allowance.
      const anyOpenSucceeded = await page.evaluate(async () => {
        const deadline = Date.now() + 1000;
        while (Date.now() < deadline) {
          const opened = window.open("https://synthetic-popup.test/", "_blank");
          if (opened !== null) {
            opened.close();
            return true;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return false;
      });
      expect(anyOpenSucceeded).toBe(false);
      expect(context.pages()).toHaveLength(beforePages);
      expect(await allowanceMonitor).toBe(false);

      // Native anchor activation is a separate path from window.open. An
      // off-screen synthetic _blank click must not enter the benign-anchor
      // exemption and escape before the service worker can roll it back.
      const syntheticAnchorPopup = context.waitForEvent("page", { timeout: 1500 }).catch(() => null);
      await page.evaluate(() => {
        const anchor = document.createElement("a");
        anchor.href = `${location.origin}/synthetic-blank?token=fixture`;
        anchor.target = "_blank";
        anchor.textContent = "Synthetic hidden anchor";
        anchor.style.cssText = "position:fixed;left:-9999px;top:-9999px";
        document.body.appendChild(anchor);
        anchor.click();
      });
      expect(await syntheticAnchorPopup, "Expected the synthetic anchor new tab to be blocked").toBeNull();
      expect(context.pages()).toHaveLength(beforePages);

      // A plain synthetic click previously minted the MAIN-world redirect
      // window even without opening a popup. Give a vulnerable bridge message
      // time to arrive, then prove Location.assign remains blocked.
      await page.evaluate(() => {
        const button = document.createElement("button");
        button.textContent = "Synthetic redirect trigger";
        document.body.appendChild(button);
        button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      await page.waitForTimeout(100);
      const redirectTarget = `${baseUrl}/level2-moving-target.html?synthetic=1`;
      const redirectObserved = page
        .waitForURL(redirectTarget, { timeout: 1000 })
        .then(() => true)
        .catch(() => false);
      // Exercise the hardened prototype path directly. Normal Location
      // instance-method coverage is the separate, tracked #458 seam.
      await page.evaluate((url) => Location.prototype.assign.call(location, url), redirectTarget);
      expect(await redirectObserved).toBe(false);
      await expect(page).toHaveURL(originalUrl);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("Level 7 legit modal backdrop closes without a false positive @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/level7-legit-modal-backdrop.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);

      await page.click("#open");
      await expect(page.locator("#modal")).toBeVisible();
      await page.mouse.click(20, 20);
      await expect(page.locator("#modal")).toBeHidden();
      await assertNoToastFor(page);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("Level 8 legit OAuth popup opens without prompting @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/level8-legit-oauth-popup.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);
      await dismissOnboarding(context);

      const beforePages = context.pages().length;
      const popupPromise = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
      await page.click("#signin");

      const popup = await popupPromise;
      expect(popup, "Expected the legit OAuth popup to open").not.toBeNull();
      await popup?.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
      expect(popup?.url()).toContain("level8-oauth-consent.html?oauth=1");
      expect(context.pages().length).toBeGreaterThan(beforePages);
      await assertNoToastFor(page);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("Level 8 keyboard-triggered legit OAuth popup opens without prompting @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/level8-legit-oauth-popup.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);
      await dismissOnboarding(context);

      const beforePages = context.pages().length;
      const popupPromise = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
      await page.focus("#signin");
      await page.keyboard.press("Enter");

      const popup = await popupPromise;
      expect(popup, "Expected the legit OAuth popup to open from keyboard activation").not.toBeNull();
      await popup?.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
      expect(popup?.url()).toContain("level8-oauth-consent.html?oauth=1");
      expect(context.pages().length).toBeGreaterThan(beforePages);
      await assertNoToastFor(page);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("Level 8 input-triggered legit OAuth popup opens without prompting @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/level8-legit-oauth-popup.html?input=1`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);
      await dismissOnboarding(context);

      const beforePages = context.pages().length;
      const popupPromise = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
      await page.click("#signin");

      const popup = await popupPromise;
      expect(popup, "Expected the legit OAuth popup from an input control to open").not.toBeNull();
      await popup?.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
      expect(popup?.url()).toContain("oauth=1");
      expect(context.pages().length).toBeGreaterThan(beforePages);
      await assertNoToastFor(page);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("Delayed button-triggered popup still blocks in smart mode @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/level8-legit-oauth-popup.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);

      await page.evaluate(() => {
        const current = document.getElementById("signin");
        if (!(current instanceof HTMLButtonElement)) {
          throw new Error("Missing #signin button");
        }

        const delayed = current.cloneNode(true) as HTMLButtonElement;
        current.replaceWith(delayed);
        delayed.addEventListener("click", () => {
          window.setTimeout(() => {
            window.open("https://example.com/?oauth=late", "oauth", "popup,width=520,height=640");
          }, 50);
        });
      });

      const popupPromise = context.waitForEvent("page", { timeout: 1500 }).catch(() => null);
      await page.click("#signin");
      await page.waitForTimeout(200);

      const popup = await popupPromise;
      expect(popup, "Expected delayed popup to stay blocked").toBeNull();
      await waitForToastText(page, "Blocked popup", 3000);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("Level 8 plain button-triggered new tab opens without prompting @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/level8-legit-oauth-popup.html?plain=1`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);
      await dismissOnboarding(context);

      const beforePages = context.pages().length;
      const popupPromise = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
      await page.click("#signin");

      const popup = await popupPromise;
      expect(popup, "Expected the plain button-triggered new tab to open").not.toBeNull();
      await popup?.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
      expect(popup?.url()).toContain("oauth=1");
      expect(context.pages().length).toBeGreaterThan(beforePages);
      await assertNoToastFor(page);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("Level 8 legit OAuth popup does not spill into a second popup @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/level8-legit-oauth-popup.html?burst=1`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);
      await dismissOnboarding(context);

      const beforePages = context.pages().length;
      const popupPromise = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
      await page.click("#signin");

      const popup = await popupPromise;
      expect(popup, "Expected the initial legit OAuth popup to open").not.toBeNull();
      await popup?.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
      expect(popup?.url()).toContain("oauth=1");

      await expect.poll(() => context.pages().length, { timeout: 5000 }).toBe(beforePages + 1);
      await waitForToastText(page, "Blocked popup", 3000);
      await page.waitForTimeout(300);
      expect(context.pages().length).toBe(beforePages + 1);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("Level 9 legit overlay controls and visible docs link stay allowed @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/level9-legit-video-overlay.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);

      await page.click("#overlayBtn");
      await expect(page.locator("#status")).toHaveText("Status: playing");
      await assertNoToastFor(page);

      const beforePages = context.pages().length;
      const popupPromise = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
      await page.getByRole("link", { name: "Open docs" }).click();

      const popup = await popupPromise;
      expect(popup, "Expected the visible docs link to open").not.toBeNull();
      await popup?.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
      expect(popup?.url()).toContain("example.org");
      expect(context.pages().length).toBeGreaterThan(beforePages);
      await assertNoToastFor(page);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("Level 10 delayed redirect rolls back to the prior page @rollback", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/level10-redirects-and-forms.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);
      await page.click("#delayed");
      await page.waitForURL(/level4-visual-mimicry\.html/, { timeout: 7000 });
      await page.waitForURL(/level10-redirects-and-forms\.html/, {
        timeout: 20000,
        waitUntil: "commit"
      });
      await page.waitForTimeout(1000);
      await expect(page).toHaveURL(/level10-redirects-and-forms\.html/);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("Live: Google first result opens with no prompt @live", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto("https://www.google.com/search?q=google", {
        waitUntil: "domcontentloaded",
        timeout: 30_000
      });

      if (page.url().includes("/sorry/")) {
        test.skip(true, "Google anti-bot challenge blocked the live sanity check.");
      }

      const consent = page.getByRole("button", { name: /I agree|Accept all|Accept/i });
      if (await consent.count()) {
        await consent.first().click().catch(() => {});
      }

      const firstResult = page.locator("a h3").first();
      await expect(firstResult).toBeVisible({ timeout: 10_000 });

      const popupPromise = context.waitForEvent("page", { timeout: 10_000 }).catch(() => null);
      await page.keyboard.down("Control");
      await firstResult.click();
      await page.keyboard.up("Control");

      const popup = await popupPromise;
      expect(popup, "Expected a new tab from ctrl+click").not.toBeNull();
      await assertNoToastFor(page, 1500);
    } finally {
      await context.close();
    }
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("Level 5 blocks window.open popunder @smoke", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/level5-window-open-popunder.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);
      await page.click("#area");
      await waitForToastText(page, "Blocked popup", 3000);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("Level 6 blocks programmatic click new tab @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/level6-programmatic-click.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);
      const beforePages = context.pages().length;
      const popupPromise = context.waitForEvent("page", { timeout: 1500 }).catch(() => null);
      await page.click("#real");
      const popup = await popupPromise;
      expect(popup, "Expected the programmatic new tab to be blocked").toBeNull();
      expect(context.pages()).toHaveLength(beforePages);
      await waitForToastText(page, "Blocked new tab", 3000);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

/** Click a button, assert the resulting new-tab attempt is blocked, and verify the page URL. */
async function assertClickBlocked(
  page: import("@playwright/test").Page,
  context: import("@playwright/test").BrowserContext,
  selector: string,
  expectedToast: string,
  urlPattern: RegExp
) {
  const btn = page.locator(selector);
  const box = await btn.boundingBox();
  expect(box, `${selector} should be visible`).toBeTruthy();

  const popupPromise = context.waitForEvent("page", { timeout: 1500 }).catch(() => null);
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

  const popup = await popupPromise;
  expect(popup, "Expected the trap new tab to be blocked").toBeNull();
  await waitForToastText(page, expectedToast, 3000);
  await expect(page).toHaveURL(urlPattern);
}

test("RW-08 popup window reuse laundering keeps the original consent popup @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      await dismissOnboarding(context);
      const page = await context.newPage();
      const beforePages = context.pages().length;

      await page.goto(`${baseUrl}/rw08-window-reuse-laundering.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);

      const popupPromise = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
      await page.click("#rw08Launch");

      const popup = await popupPromise;
      expect(popup, "Expected the consent popup to open").not.toBeNull();
      await popup?.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
      expect(popup?.url()).toContain("rw08-consent-popup.html?step=consent");

      await expect.poll(() => context.pages().length, { timeout: 5000 }).toBe(beforePages + 1);
      await waitForToastText(page, "Blocked popup", 3000);
      expect(popup?.url()).toContain("rw08-consent-popup.html");
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("RW-09 mixed empty-target and named-target auth launches with delayed reuse blocking @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/rw09-target-ambiguity.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);
      await dismissOnboarding(context);

      const firstPopupPromise = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
      await page.click("#rw09Start");
      const firstPopup = await firstPopupPromise;
      expect(firstPopup, "Expected the first auth popup to open").not.toBeNull();
      await firstPopup?.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
      expect(firstPopup?.url()).toContain("rw09-consent-step1.html");

      await assertNoToastFor(page, 800);
      await page.waitForSelector("#rw09Resume:not([hidden])", { timeout: 3000 });

      const secondPopupPromise = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
      await page.click("#rw09Resume");
      const secondPopup = await secondPopupPromise;
      expect(secondPopup, "Expected the second auth popup to open").not.toBeNull();
      await secondPopup?.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
      expect(secondPopup?.url()).toContain("rw09-consent-step2.html");

      await waitForToastText(page, "Blocked popup", 3000);

      expect(secondPopup?.url()).toContain("rw09-consent-step2.html");
      expect(secondPopup?.url()).not.toContain("rw09-phish-target.html");
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("RW-10 Space-triggered auth button opens without prompting @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/rw10-keyboard-auth-launch.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);

      await page.focus("#rw10Button");
      const popupPromise = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
      await page.keyboard.press("Space");
      const popup = await popupPromise;
      expect(popup, "Expected Space-activated popup to open").not.toBeNull();
      await popup?.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
      expect(popup?.url()).toContain("rw10-consent-popup.html?launcher=button");
      await assertNoToastFor(page);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("RW-10 Enter-triggered submit input opens without prompting @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/rw10-keyboard-auth-launch.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);

      await page.focus("#rw10Submit");
      const popupPromise = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
      await page.keyboard.press("Enter");
      const popup = await popupPromise;
      expect(popup, "Expected Enter-activated popup to open").not.toBeNull();
      await popup?.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
      expect(popup?.url()).toContain("rw10-consent-popup.html?launcher=input");
      await assertNoToastFor(page);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("RW-11 invoice approval payout trap blocks the deceptive new tab @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/rw11-fake-invoice-approval.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);
      await assertClickBlocked(page, context, "#rw11Review", "Blocked new tab", /rw11-fake-invoice-approval\.html/);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("RW-12 wallet connect first popup allowed with blocked burst follow-up @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/rw12-wallet-connect-burst.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);

      const beforePages = context.pages().length;
      const popupPromise = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
      await page.click("#rw12Connect");

      const popup = await popupPromise;
      expect(popup, "Expected the first wallet popup to open").not.toBeNull();
      await popup?.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
      expect(popup?.url()).toContain("rw12-wallet-connect-popup.html?step=connect");

      await expect.poll(() => context.pages().length, { timeout: 5000 }).toBe(beforePages + 1);
      await waitForToastText(page, "Blocked popup", 3000);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("RW-14 checkout express-pay overlay blocks the hidden trap @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/rw14-checkout-express-pay-overlay.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);
      await assertClickBlocked(page, context, "#rw14Pay", "Blocked new tab", /rw14-checkout-express-pay-overlay\.html/);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("RW-15 bank security alert delayed redirect triggers rollback @rollback", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/rw15-bank-security-alert.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);

      await page.click("#rw15Verify");
      await page.waitForURL(/rw15-bank-verify-transaction\.html/, { timeout: 8000 });
      await page.waitForURL(/rw15-bank-security-alert\.html/, {
        timeout: 20000,
        waitUntil: "commit"
      });
      await expect(page).toHaveURL(/rw15-bank-security-alert\.html/);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("RW-16 fake document preview overlay blocks the hidden trap @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/rw16-fake-document-preview-overlay.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);
      await assertClickBlocked(page, context, "#rw16Open", "Blocked new tab", /rw16-fake-document-preview-overlay\.html/);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("RW-17 media overlay hijack blocks the hidden ad trap @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/rw17-media-overlay-hijack.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);

      const playBtn = page.locator("#rw17Play");
      const box = await playBtn.boundingBox();
      expect(box, "#rw17Play should be visible").toBeTruthy();

      await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await page.waitForFunction(
        () => document.getElementById("status")?.textContent?.includes("active"),
        null,
        { timeout: 3000 }
      );

      const popupPromise = context.waitForEvent("page", { timeout: 1500 }).catch(() => null);
      await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

      const popup = await popupPromise;
      expect(popup, "Expected the trap new tab to be blocked").toBeNull();
      await waitForToastText(page, "Blocked new tab", 3000);
      await expect(page).toHaveURL(/rw17-media-overlay-hijack\.html/);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("RW-18 fake codec warning blocks the hidden installer trap @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/rw18-browser-update-warning.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);
      await assertClickBlocked(page, context, "#rw18Install", "Blocked new tab", /rw18-browser-update-warning\.html/);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("RW-19 repeated tech-support popup burst is blocked @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      await dismissOnboarding(context);
      const page = await context.newPage();
      const beforePages = context.pages().length;

      await page.goto(`${baseUrl}/rw19-tech-support-scare.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);

      await page.waitForFunction(
        () => document.getElementById("attempts")?.textContent?.includes("4"),
        null,
        { timeout: 5000 }
      );

      // A burst of blocked popups coalesces: the first one or two show the full
      // "Blocked popup" prompt, then NavSentinel collapses the rest into a single
      // count pill instead of nagging once per popup. Accept either surface.
      await page.waitForFunction(
        () => {
          const root = document.querySelector("#__navsentinel_toast_host")?.shadowRoot;
          if (!root) return false;
          const pill = root.querySelector(".pill");
          if (pill?.textContent && /blocked/i.test(pill.textContent)) return true;
          const body = root.querySelector(".wrap .body");
          return !!body?.textContent && /blocked popup/i.test(body.textContent);
        },
        null,
        { timeout: 4000 }
      );
      // Security property unchanged: not one of the burst popups actually opened.
      await expect.poll(() => context.pages().length, { timeout: 3000 }).toBe(beforePages);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("RW-20 support widget first popup allowed with blocked follow-up abuse @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/rw20-chat-widget-abuse.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await waitForNavSentinelBridge(page);

      const beforePages = context.pages().length;
      const popupPromise = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
      await page.click("#rw20Chat");

      const popup = await popupPromise;
      expect(popup, "Expected the first chat popup to open").not.toBeNull();
      await popup?.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
      expect(popup?.url()).toContain("rw20-chat-popup.html?step=chat");

      await expect.poll(() => context.pages().length, { timeout: 5000 }).toBe(beforePages + 1);
      await waitForToastText(page, "Blocked popup", 3000);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
