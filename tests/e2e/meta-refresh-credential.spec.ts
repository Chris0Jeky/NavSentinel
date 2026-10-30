/**
 * Off-site meta refresh on a credential page (#1144), in real Chromium.
 * Contained: the gym serves the pages on loopback, the off-site destination is
 * a reserved name intercepted by the context, and only dummy credentials are
 * typed. The 300-second refresh never fires within the test.
 */
import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EVENT_LOG_KEY } from "../../extension/src/shared/storage";
import {
  evaluateInCredentialModal,
  getGymBaseUrl,
  getServiceWorker,
  waitForCredentialModal,
  waitForNavSentinelBridge,
} from "./extension_test_utils";

const root = path.resolve(import.meta.dirname, "../..");
const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.join(root, "extension/dist");
const gymRoot = path.join(root, "gym");

test.setTimeout(120_000);

async function promptReasons(context: BrowserContext): Promise<string[] | undefined> {
  const sw = await getServiceWorker(context);
  const log = (await sw.evaluate(async (key: string) => (await chrome.storage.local.get(key))[key], EVENT_LOG_KEY)) as
    Array<{ kind?: string; reasons?: string[] }> | undefined;
  return log?.find((entry) => entry.kind === "cred_submit_prompt")?.reasons;
}

for (const { fixture, offsite } of [
  { fixture: "meta-refresh-offsite.html", offsite: true },
  { fixture: "meta-refresh-samesite.html", offsite: false },
]) {
  test(`${fixture}: credential prompt ${offsite ? "names" : "omits"} the off-site refresh (#1144) @regression`, async () => {
    test.skip(!fs.existsSync(path.join(extensionPath, "manifest.json")), "Build the extension first.");
    const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ns-meta-refresh-"));
    let context: BrowserContext | undefined;
    try {
      context = await chromium.launchPersistentContext(profile, {
        headless: false,
        timeout: 60_000,
        args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
      });
      let offsiteHits = 0;
      await context.route("https://account-check.example/**", async (route) => {
        offsiteHits++;
        await route.abort();
      });
      if (offsite) {
        // Serve the gym page with an upper-case keyword: Chrome matches
        // http-equiv ASCII case-insensitively, and so must the analyzer.
        const html = fs.readFileSync(path.join(gymRoot, fixture), "utf8")
          .replace('http-equiv="refresh"', 'HTTP-EQUIV="REFRESH"');
        expect(html).toContain('HTTP-EQUIV="REFRESH"');
        await context.route(`${baseUrl}/${fixture}`, (route) => route.fulfill({ contentType: "text/html", body: html }));
      }
      const page = await context.newPage();
      await page.goto(`${baseUrl}/${fixture}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
      await waitForNavSentinelBridge(page);

      await page.fill("#email", "dummy@example.test");
      await page.fill("#password", "dummy-password");
      await page.click('button[type="submit"]');
      await waitForCredentialModal(page, 6000);

      const modalText = await evaluateInCredentialModal(page, function (this: ShadowRoot) {
        return this.textContent ?? "";
      });
      await expect.poll(() => promptReasons(context!), { timeout: 5000 }).toBeDefined();
      const reasons = await promptReasons(context);
      if (offsite) {
        expect(modalText).toContain("different site: account-check.example");
        expect(reasons).toContain("META_REFRESH_OFFSITE");
      } else {
        expect(modalText).not.toContain("different site");
        expect(reasons).not.toContain("META_REFRESH_OFFSITE");
      }
      expect(offsiteHits).toBe(0);
      expect(page.url()).toBe(`${baseUrl}/${fixture}`);
    } finally {
      await context?.close();
      await gym?.close();
      fs.rmSync(profile, { recursive: true, force: true });
    }
  });
}
