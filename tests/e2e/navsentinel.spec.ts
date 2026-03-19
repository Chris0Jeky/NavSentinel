import { test, expect, chromium } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import {
  assertNoToastFor,
  getGymBaseUrl,
  waitForNavSentinelBridge,
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
            text.includes("NavSentinel blocked deceptive click")
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

      const patchInfo = await page.evaluate(() => (window as any).__navsentinelLocationPatch);
      expect(patchInfo, "Expected location patch info").toBeTruthy();
      expect(patchInfo.protoAssign, "Expected Location.prototype.assign to be patched").toBe(true);

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

      const beforePages = context.pages().length;
      const popupPromise = context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
      await page.click("#signin");

      const popup = await popupPromise;
      expect(popup, "Expected the legit OAuth popup to open").not.toBeNull();
      await popup?.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
      expect(popup?.url()).toContain("example.com");
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

test("Level 8 plain button-triggered new tab still blocks @regression", async () => {
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

      const popupPromise = context.waitForEvent("page", { timeout: 1500 }).catch(() => null);
      await page.click("#signin");

      const popup = await popupPromise;
      expect(popup, "Expected the plain button-triggered new tab to be blocked").toBeNull();
      await waitForToastText(page, "Blocked popup", 3000);
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

test("Level 10 delayed redirect shows rollback proceed affordance @rollback", async () => {
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
      await waitForNavSentinelBridge(page, 7000);
      await waitForToastText(page, "NavSentinel rolled back a redirect", 12000);
      await waitForToastText(page, "Proceed", 12000);
      await expect(page).toHaveURL(/level4-visual-mimicry\.html/);
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
      await expect(page.locator("text=Blocked new tab")).toHaveCount(0);
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
      await page.click("#real");
      await waitForToastText(page, "Blocked new tab", 3000);
    } finally {
      await context.close();
    }
  } finally {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
