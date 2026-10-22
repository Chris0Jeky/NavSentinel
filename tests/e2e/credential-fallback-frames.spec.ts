/** #1114: real extension injection and submit protection in inherited-origin frames.
 * Every HTTP request is fulfilled in-process; no credentials leave this fixture.
 * CDP observes the extension world without installing a replacement guard.
 */
import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EVENT_LOG_KEY, SUITE_SETTINGS_KEY } from "../../extension/src/shared/storage";
import { CREDENTIAL_MODAL_HOST_ID, getServiceWorker } from "./extension_test_utils";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const extensionPath = path.join(root, "extension/dist");
const fixture = fs.readFileSync(path.join(root, "tests/acceptance/fixtures/credential-fallback-frames.html"), "utf8");

test.setTimeout(90_000);

for (const kind of ["about:blank", "srcdoc"] as const) {
  test(`${kind} frame loads the credential guard and stops a cross-site POST #1114 @regression`, async () => {
    // Missing build is a failure, never a silently skipped security probe.
    expect(fs.existsSync(path.join(extensionPath, "manifest.json"))).toBe(true);
    const profiles = path.join(root, "test-results/credential-fallback-profiles");
    fs.mkdirSync(profiles, { recursive: true });
    const profile = fs.mkdtempSync(path.join(profiles, "probe-"));
    let context: BrowserContext | undefined;
    try {
      context = await chromium.launchPersistentContext(profile, {
        headless: false,
        args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
      });
      let posts = 0;
      await context.route(/^https?:\/\//, async (route) => {
        const request = route.request();
        if (request.method() === "POST") posts++;
        await route.fulfill({
          contentType: "text/html",
          body: request.url().startsWith("https://victim.test/login") ? fixture : "<p>intercepted sink</p>",
        });
      });
      const worker = await getServiceWorker(context);
      const workerUrl = new URL(worker.url());
      const extensionOrigin = `${workerUrl.protocol}//${workerUrl.host}`;
      await worker.evaluate(async (key) => {
        await chrome.storage.local.set({
          [key]: {
            nav: { defaultMode: "off", debug: false },
            credential: {
              mode: "smart",
              // Exercise the cross-site decision, independently of blanket
              // untrusted-domain and HTTP warnings.
              promptOnUntrustedDomain: false,
              promptOnMediumRisk: false,
              mediumRiskThreshold: 100,
              blockHttpPasswordSubmit: false,
              warnOnPaste: true,
              similarity: { enabled: true, maxDistance: 2 },
            },
            logLimit: 300,
          },
        });
      }, SUITE_SETTINGS_KEY);
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      const worlds = new Map<number, { frameId?: string; origin: string }>();
      const guardContexts = new Set<number>();
      cdp.on("Runtime.executionContextCreated", ({ context }) => {
        worlds.set(context.id, { frameId: context.auxData?.frameId as string, origin: context.origin });
      });
      cdp.on("Debugger.scriptParsed", ({ url, executionContextId }) => {
        if (url.startsWith(`${extensionOrigin}/`) && /credential_guard\.ts-[^/]*\.js$/.test(url) && !url.includes("-loader-")) {
          guardContexts.add(executionContextId);
        }
      });
      await cdp.send("Runtime.enable");
      await cdp.send("Debugger.enable");
      await page.goto(`https://victim.test/login?kind=${kind}`, { waitUntil: "load" });
      const frame = page.frame({ name: "credential-probe" });
      expect(frame).not.toBeNull();
      await expect(frame!.getByRole("button", { name: "Sign in" })).toBeVisible();
      // Give the asynchronous CRXJS imports a bounded opportunity to execute.
      await page.waitForTimeout(1_000);
      const { frameTree } = await cdp.send("Page.getFrameTree");
      const frameId = frameTree.childFrames?.find((child) => child.frame.name === "credential-probe")?.frame.id;
      expect(frameId).toBeTruthy();
      const guardContext = [...guardContexts].find((id) => worlds.get(id)?.frameId === frameId);
      let submitListener = false;
      if (guardContext !== undefined) {
        const { result } = await cdp.send("Runtime.evaluate", {
          contextId: guardContext,
          expression: "(getEventListeners(window).submit || []).some(x => x.useCapture)",
          includeCommandLineAPI: true,
          returnByValue: true,
        });
        submitListener = result.value === true;
      }
      await frame!.getByRole("button", { name: "Sign in" }).click({ noWaitAfter: true });
      const modal = frame!.locator(`#${CREDENTIAL_MODAL_HOST_ID}`);
      await expect.poll(async () => posts > 0 || await modal.count() > 0, { timeout: 10_000 }).toBe(true);
      // A prompt must continue withholding the POST, rather than appearing
      // after a native submission has already escaped.
      await page.waitForTimeout(300);
      const modalVisible = await modal.isVisible();
      console.log(JSON.stringify({ kind, guardLoaded: guardContext !== undefined, submitListener, modalVisible, posts }));
      expect.soft(guardContext, "credential_guard module ran in the child extension world").toBeDefined();
      expect.soft(submitListener, "credential submit listener is active in the child").toBe(true);
      expect.soft(modalVisible, "cross-site credential prompt appeared inside the child").toBe(true);
      expect(posts, "no password POST before an extension-origin decision").toBe(0);
      const events = await worker.evaluate(async (key) => {
        const stored = await chrome.storage.local.get(key);
        return stored[key] as Array<{ kind: string; site: string; destHost: string; url: string }>;
      }, EVENT_LOG_KEY);
      expect(events).toEqual(expect.arrayContaining([expect.objectContaining({
        kind: "cred_submit_prompt",
        site: "victim.test",
        destHost: "attacker.test",
        // document.open() may copy its caller's URL into about:blank. Both
        // forms must retain the creator's identity, regardless of that path.
        url: expect.stringMatching(/^https:\/\/victim\.test\//),
      })]));
    } finally {
      await context?.close();
      fs.rmSync(profile, { recursive: true, force: true });
    }
  });
}
