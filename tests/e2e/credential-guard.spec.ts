import { expect, test, chromium, type BrowserContext, type Worker } from "@playwright/test";
import fs from "fs";
import * as http from "node:http";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(__dirname, "..", "..", "extension", "dist");

async function getServiceWorker(context: BrowserContext): Promise<Worker> {
  const existing = context.serviceWorkers()[0];
  if (existing) return existing;
  return context.waitForEvent("serviceworker");
}

async function getExtensionId(context: BrowserContext): Promise<string> {
  const worker = await getServiceWorker(context);
  return new URL(worker.url()).host;
}

function isWithinRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function startGymServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const gymRoot = path.resolve(__dirname, "..", "..", "gym");

  const server = http.createServer((req, res) => {
    try {
      const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      const pathname = decodeURIComponent(reqUrl.pathname);
      const rel = pathname === "/" ? "/index.html" : pathname;
      const resolved = path.resolve(gymRoot, `.${rel}`);
      if (!isWithinRoot(gymRoot, resolved)) {
        res.statusCode = 400;
        res.end("Bad request");
        return;
      }

      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      const ext = path.extname(resolved).toLowerCase();
      if (ext === ".css") res.setHeader("content-type", "text/css; charset=utf-8");
      else if (ext === ".js") res.setHeader("content-type", "text/javascript; charset=utf-8");
      else res.setHeader("content-type", "text/html; charset=utf-8");

      res.statusCode = 200;
      res.end(fs.readFileSync(resolved));
    } catch {
      res.statusCode = 500;
      res.end("Server error");
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Failed to bind Gym server");

  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

test("credential guard prompts before risky password submit", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const gym = await startGymServer();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-cred-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${gym.baseUrl}/level11-credential-guard.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await page.click("#submitBtn");

      await expect(page.locator("text=Credential submit blocked")).toBeVisible({ timeout: 4000 });
      await expect(page).toHaveURL(/level11-credential-guard\.html/);
    } finally {
      await context.close();
    }
  } finally {
    await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("credential guard warns on password paste and trust action persists", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const gym = await startGymServer();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-cred-e2e-"));

  try {
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await context.newPage();
      await page.goto(`${gym.baseUrl}/level11-credential-guard.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await page.focus("#password");
      await page.evaluate(() => {
        const input = document.getElementById("password");
        if (!(input instanceof HTMLInputElement)) return;
        input.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, composed: true }));
      });

      await page.waitForFunction(() => {
        const host = document.querySelector("#__navsentinel_toast_host");
        const root = host?.shadowRoot;
        return !!root?.textContent?.includes("You pasted into a password field on an untrusted domain");
      });

      await page.evaluate(() => {
        const host = document.querySelector("#__navsentinel_toast_host");
        const root = host?.shadowRoot;
        const buttons = Array.from(root?.querySelectorAll("button") ?? []);
        const trust = buttons.find((button) => button.textContent?.includes("Trust 127.0.0.1"));
        if (trust instanceof HTMLButtonElement) {
          trust.click();
        }
      });

      const extensionId = await getExtensionId(context);
      const options = await context.newPage();
      await options.goto(`chrome-extension://${extensionId}/src/options/options.html`, {
        waitUntil: "domcontentloaded",
        timeout: 20_000
      });

      await expect(options.locator("#trustedList")).toContainText("127.0.0.1");
      await expect(options.locator("#eventLog")).toContainText("cred_paste_warn");
      await expect(options.locator("#eventLog")).toContainText("cred_trust_domain");
    } finally {
      await context.close();
    }
  } finally {
    await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
