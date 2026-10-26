/** #1114: real extension injection and submit protection in inherited-origin frames.
 * Every HTTP request is fulfilled in-process; no credentials leave this fixture.
 * CDP observes the extension world without installing a replacement guard.
 */
import { chromium, expect, test, type BrowserContext, type CDPSession } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EVENT_LOG_KEY, SUITE_SETTINGS_KEY } from "../../extension/src/shared/storage";
import { CREDENTIAL_MODAL_HOST_ID, getServiceWorker } from "./extension_test_utils";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const extensionPath = path.join(root, "extension/dist");
const fixture = fs.readFileSync(path.join(root, "tests/acceptance/fixtures/credential-fallback-frames.html"), "utf8");
const loginForm = fixture.match(/<template id="login-template">([\s\S]*?)<\/template>/)?.[1];
if (!loginForm) throw new Error("Credential fallback fixture is missing its login form");

test.setTimeout(90_000);

async function observeCredentialGuard(cdp: CDPSession, extensionOrigin: string) {
  const worlds = new Map<number, { frameId?: string }>();
  const guardContexts = new Map<number, number>();
  cdp.on("Runtime.executionContextCreated", ({ context }) => {
    worlds.set(context.id, { frameId: context.auxData?.frameId as string });
  });
  cdp.on("Runtime.executionContextDestroyed", ({ executionContextId }) => worlds.delete(executionContextId));
  cdp.on("Runtime.executionContextsCleared", () => worlds.clear());
  cdp.on("Debugger.scriptParsed", ({ url, executionContextId }) => {
    if (url.startsWith(`${extensionOrigin}/`) && /credential_guard\.ts-[^/]*\.js$/.test(url) && !url.includes("-loader-")) {
      guardContexts.set(executionContextId, (guardContexts.get(executionContextId) ?? 0) + 1);
    }
  });
  await cdp.send("Runtime.enable");
  await cdp.send("Debugger.enable");
  return { worlds, guardContexts };
}

for (const kind of ["about:blank", "srcdoc", "blob", "sandboxed-srcdoc", "same-origin"] as const) {
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
          body: request.url().startsWith("https://victim.test/login") ? fixture
            : request.url() === "https://victim.test/same-origin-login"
              ? loginForm
              : "<p>intercepted sink</p>",
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
      let pageErrors = 0;
      page.on("pageerror", () => pageErrors++);
      // Observe ordinary children before navigation so document.open() cannot
      // discard script metadata before the debugger attaches.
      let cdp = await context.newCDPSession(page);
      let observed = await observeCredentialGuard(cdp, extensionOrigin);
      await page.goto(`https://victim.test/login?kind=${kind}`, { waitUntil: "load" });
      const iframe = await page.locator('iframe[name="credential-probe"]').elementHandle();
      const frame = await iframe!.contentFrame();
      expect(frame).not.toBeNull();
      await expect(frame!.getByRole("button", { name: "Sign in" })).toBeVisible();
      // Opaque sandbox frames have their own out-of-process CDP target.
      if (kind === "sandboxed-srcdoc") {
        await cdp.detach();
        cdp = await context.newCDPSession(frame!);
        observed = await observeCredentialGuard(cdp, extensionOrigin);
      }
      const { worlds, guardContexts } = observed;
      // Give the asynchronous CRXJS imports a bounded opportunity to execute.
      await page.waitForTimeout(1_000);
      const { frameTree } = await cdp.send("Page.getFrameTree");
      const frameId = frameTree.childFrames?.find((child) => child.frame.name === "credential-probe")?.frame.id
        ?? frameTree.frame.id;
      expect(frameId).toBeTruthy();
      const liveGuards = [...guardContexts.keys()].filter((id) => worlds.get(id)?.frameId === frameId);
      const guardContext = liveGuards[0];
      let submitListeners = 0;
      let securityOrigin: string | undefined;
      if (guardContext !== undefined) {
        const { result } = await cdp.send("Runtime.evaluate", {
          contextId: guardContext,
          expression: "({ listeners: (getEventListeners(window).submit || []).filter(x => x.useCapture).length, origin: self.origin })",
          includeCommandLineAPI: true,
          returnByValue: true,
        });
        submitListeners = result.value.listeners;
        securityOrigin = result.value.origin;
      }
      await frame!.getByRole("button", { name: "Sign in" }).click({ noWaitAfter: true });
      const modal = frame!.locator(`#${CREDENTIAL_MODAL_HOST_ID}`);
      await expect.poll(async () => posts > 0 || await modal.count() > 0, { timeout: 10_000 }).toBe(true);
      // A prompt must continue withholding the POST, rather than appearing
      // after a native submission has already escaped.
      await page.waitForTimeout(300);
      const modalVisible = await modal.isVisible();
      console.log(JSON.stringify({ kind, guardInstances: liveGuards.length, submitListeners, securityOrigin, modalVisible, posts, pageErrors }));
      expect.soft(guardContext, "credential_guard module ran in the child extension world").toBeDefined();
      expect.soft(liveGuards, "one live credential guard world after child navigation").toHaveLength(1);
      expect.soft(guardContexts.get(guardContext!), "one module instance in the live child world").toBe(1);
      expect.soft(submitListeners, "exactly one credential submit listener in the child").toBe(1);
      expect.soft(pageErrors, "no uncaught frame error").toBe(0);
      expect.soft(modalVisible, "cross-site credential prompt appeared inside the child").toBe(true);
      await expect(modal, "exactly one modal on submit").toHaveCount(1);
      expect(posts, "no password POST before an extension-origin decision").toBe(0);
      if (kind === "sandboxed-srcdoc") {
        expect(await frame!.evaluate(() => self.origin), "page has an opaque sandbox origin").toBe("null");
        expect(securityOrigin, "guard must not adopt the sandbox creator's trust").toBe("null");
      }
      const events = await worker.evaluate(async (key) => {
        const stored = await chrome.storage.local.get(key);
        return stored[key] as Array<{ kind: string; site: string; destHost: string; url: string }>;
      }, EVENT_LOG_KEY);
      const prompts = events.filter((event) => event.kind === "cred_submit_prompt");
      expect(prompts, "one prompt event, without duplicate injection").toHaveLength(1);
      expect(prompts[0]).toEqual(expect.objectContaining({
        kind: "cred_submit_prompt",
        site: kind === "sandboxed-srcdoc" ? "" : "victim.test",
        destHost: "attacker.test",
        // document.open() may copy its caller's URL into about:blank. Both
        // forms must retain the creator's identity, regardless of that path.
        // Event storage minimizes opaque document URLs to their scheme.
        url: kind === "sandboxed-srcdoc" ? "about:" : expect.stringMatching(/^https:\/\/victim\.test\//),
      }));
    } finally {
      await context?.close();
      fs.rmSync(profile, { recursive: true, force: true });
    }
  });
}
