/**
 * #936: an unrelated A-scoped click must not survive a child-only replay to B.
 * The authored page, not test-injected code, invokes both submissions. Requests
 * to the inert escape sink are recorded and aborted to contain the baseline;
 * reaching that sink is a failure even when the browser would later roll back.
 */
import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getGymBaseUrl, readBuiltUiGuardRevision, waitForNavSentinelBridge } from "./extension_test_utils";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.join(root, "extension/dist");
const fixture = "/form-submit-unmatched-replay.html";

test.setTimeout(60_000);

async function journey(options: {
  enabled: boolean;
  target: "top" | "blank";
  later: boolean;
  control: boolean;
}): Promise<{ receipts: string[]; formdataCount: number }> {
  const { baseUrl, gym } = await getGymBaseUrl(path.join(root, "gym"));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ns-unmatched-replay-"));
  let context: BrowserContext | undefined;
  const receipts: string[] = [];
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: false,
      args: options.enabled
        ? [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
        : [],
    });
    await context.route(`${baseUrl}/form-submit-landing.html*`, async (route) => {
      const request = route.request();
      if (!request.isNavigationRequest()) throw new Error("Expected an actual form navigation request");
      const receipt = new URL(request.url()).searchParams.get("receipt");
      if (receipt !== "child" && receipt !== "escape") throw new Error("Unrecognized form receipt");
      receipts.push(receipt);
      if (receipt === "escape") await route.abort();
      else await route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Child sink</title>" });
    });
    const page = await context.newPage();
    const query = new URLSearchParams({
      target: options.target,
      later: options.later ? "1" : "0",
      control: options.control ? "1" : "0",
    });
    await page.goto(`${baseUrl}${fixture}?${query}`);
    if (options.enabled) await waitForNavSentinelBridge(page);
    const source = await page.locator("#source").elementHandle();
    const frame = await source?.contentFrame();
    if (!frame) throw new Error("Authored source frame did not load");
    await frame.locator("#activate").waitFor();
    if (options.enabled) {
      await frame.waitForFunction((revision) =>
        document.documentElement.getAttribute("data-navsentinel-capture-ready") === "1" &&
        document.documentElement.getAttribute("data-navsentinel-bridge-ready") === "1" &&
        document.documentElement.getAttribute("data-navsentinel-ui-guard") === revision,
      readBuiltUiGuardRevision(), { timeout: 15_000 });
    }
    await frame.locator("#activate").click();
    await frame.waitForFunction(() => document.documentElement.dataset.outerReturned === "1");
    if (options.control) {
      await expect.poll(() => receipts.filter((value) => value === "escape").length).toBe(1);
    } else {
      await frame.waitForFunction(() => document.documentElement.dataset.nestedReturned === "1");
      await expect.poll(() => receipts.filter((value) => value === "child").length).toBe(1);
      if (!options.enabled) {
        await expect.poll(() => receipts.filter((value) => value === "escape").length).toBe(1);
      }
    }
    // Check throughout the remaining grant lifetime, rather than one immediate
    // empty read. No second trusted input or synthetic product grant is supplied.
    const until = Date.now() + 1_600;
    do {
      if (options.enabled && !options.control) expect(receipts).toEqual(["child"]);
      await new Promise((resolve) => setTimeout(resolve, 50));
    } while (Date.now() < until);
    return {
      receipts,
      formdataCount: await frame.evaluate(() => Number(document.documentElement.dataset.formdataCount)),
    };
  } finally {
    if (context) await context.close();
    if (gym) await gym.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

for (const target of ["top", "blank"] as const) {
  test(`unprotected unmatched replay reaches the ${target} escape sink (#936) @regression`, async () => {
    const result = await journey({ enabled: false, target, later: false, control: false });
    expect(result.receipts.filter((value) => value === "escape")).toHaveLength(1);
    expect(result.formdataCount).toBe(1);
  });

  test(`ordinary declared child-frame submit still reaches its ${target} destination (#936) @regression`, async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
    const result = await journey({ enabled: true, target, later: false, control: true });
    expect(result.receipts).toEqual(["escape"]);
    expect(result.formdataCount).toBe(0);
  });

  for (const later of [false, true]) {
    test(`child-only replay retires unmatched authority before ${later ? "deferred" : "synchronous"} ${target} escape (#936) @regression`, async () => {
      test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
      const result = await journey({ enabled: true, target, later, control: false });
      expect(result.receipts).toEqual(["child"]);
      expect(result.formdataCount).toBe(1);
    });
  }
}
