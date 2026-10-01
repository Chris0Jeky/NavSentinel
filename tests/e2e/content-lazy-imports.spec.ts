import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getGymBaseUrl, waitForNavSentinelBridge, waitForToastText } from "./extension_test_utils";

const root = path.resolve(import.meta.dirname, "../..");
const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.join(root, "extension/dist");

test.setTimeout(90_000);

for (const removeHead of [false, true]) {
  test(`blocked blank navigation keeps its lazy review UI with head ${removeHead ? "removed" : "present"} (#972) @regression`, async () => {
    test.skip(!fs.existsSync(path.join(extensionPath, "manifest.json")), "Build the extension first.");
    const { baseUrl, gym } = await getGymBaseUrl(path.join(root, "gym"));
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ns-lazy-content-"));
    let context: BrowserContext | undefined;
    try {
      context = await chromium.launchPersistentContext(profile, {
        headless: false,
        args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
      });
      let sinkHits = 0;
      const destination = new URL("/lazy-import-sink", baseUrl);
      destination.hostname = destination.hostname === "localhost" ? "127.0.0.1" : "localhost";
      await context.route("**/lazy-import-sink", async (route) => {
        sinkHits++;
        await route.fulfill({ contentType: "text/html", body: "<p>Inert local destination</p>" });
      });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/lazy-import-fixture", (route) => route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><head><title>Lazy import fixture</title></head><body>
<button style="position:fixed;left:20px;top:20px">Play</button>
<a id="trap" target="_blank" rel="noreferrer" href="${destination.href}" style="position:fixed;inset:0;opacity:0.01;z-index:999999"></a>
</body></html>`,
      }));
      await page.goto(`${baseUrl}/lazy-import-fixture`);
      await waitForNavSentinelBridge(page);
      // The fixture's styles are inline, so deleting head cannot weaken the
      // transparent-overlay stimulus. Observe the shared DOM from page world.
      await page.evaluate((remove) => {
        const scope = window as Window & { observedExtensionLinks?: string[] };
        scope.observedExtensionLinks = [];
        new MutationObserver((records) => {
          for (const record of records) {
            for (const node of Array.from(record.addedNodes)) {
              if (!(node instanceof Element)) continue;
              const links = [node, ...Array.from(node.querySelectorAll("link"))];
              for (const link of links) {
                if (link instanceof HTMLLinkElement && link.href.startsWith("chrome-extension://")) {
                  scope.observedExtensionLinks!.push(link.href);
                }
              }
            }
          }
        }).observe(document.documentElement, { childList: true, subtree: true });
        if (remove) document.head?.remove();
      }, removeHead);
      expect(await page.evaluate(() => document.head === null)).toBe(removeHead);
      await page.mouse.click(40, 40);
      await waitForToastText(page, "Open Heedline to review.", 10_000);
      // Allow a task for any MutationObserver delivery triggered by loading.
      await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
      expect(await page.evaluate(() => (window as Window & { observedExtensionLinks?: string[] }).observedExtensionLinks)).toEqual([]);
      expect(errors).toEqual([]);
      expect(sinkHits).toBe(0);
      expect(page.url()).toBe(`${baseUrl}/lazy-import-fixture`);
    } finally {
      await context?.close();
      await gym?.close();
      fs.rmSync(profile, { recursive: true, force: true });
    }
  });
}
