/**
 * Regression for #891: MAIN-world history wrappers must preserve the native
 * single-coercion boundary for stateful URL objects.
 */
import { test, expect, chromium } from "@playwright/test";
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

test.setTimeout(120_000);

test("pushState and replaceState coerce a URL object exactly once @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-history-coercion-"));

  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
      ]
    });
  } catch (err) {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw err;
  }

  const page = await context.newPage();

  try {
    await page.goto(`${baseUrl}/level1-basic-opacity.html`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    });
    await waitForNavSentinelBridge(page);

    const results = await page.evaluate(() => {
      const run = (method: "pushState" | "replaceState", nextPath: string) => {
        let coercions = 0;
        const url = {
          toString(): string {
            coercions += 1;
            if (coercions > 1) throw new Error(`${method} URL coerced more than once`);
            return nextPath;
          }
        };

        let error = "";
        try {
          history[method]({}, "", url as unknown as string);
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        }

        return { coercions, error, pathname: location.pathname };
      };

      return {
        pushState: run("pushState", "/coercion-push"),
        replaceState: run("replaceState", "/coercion-replace")
      };
    });

    expect(results).toEqual({
      pushState: { coercions: 1, error: "", pathname: "/coercion-push" },
      replaceState: { coercions: 1, error: "", pathname: "/coercion-replace" }
    });
  } finally {
    await context.close();
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
