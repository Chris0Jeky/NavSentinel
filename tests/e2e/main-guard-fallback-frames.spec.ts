/** #1134: main_guard, and the capture_isolated bridge that arms it, must run in
 * inherited-origin (about:blank, srcdoc, blob) frames. Without them a
 * gesture-less form.submit() aimed at _top inside such a frame fires no submit
 * event and meets no MAIN-world patch, so it navigates the tab ungated.
 * Every HTTP request is fulfilled in-process; nothing leaves this fixture.
 */
import { chromium, expect, test, type BrowserContext, type Frame, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getServiceWorker, waitForNavSentinelBridge, waitForToastText } from "./extension_test_utils";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.join(root, "extension/dist");

// The child is built by a parse-time script, so manifest injection (not a later
// DOM observer) is what has to cover it.
const fixture = `<!doctype html><title>victim</title>
<form id="top-form" action="https://attacker.test/top-form" method="get"><input name="q" value="1"></form>
<script>
  const kind = new URLSearchParams(location.search).get("kind");
  const frame = document.createElement("iframe");
  frame.name = "probe";
  const body = "<p>child</p>";
  if (kind === "srcdoc") frame.srcdoc = body;
  else if (kind === "blob") frame.src = URL.createObjectURL(new Blob([body], { type: "text/html" }));
  else if (kind === "same-origin") frame.src = "/child";
  document.documentElement.appendChild(frame);
</script>`;

test.setTimeout(120_000);

async function withProbe(kind: string, run: (page: Page, frame: Frame, hits: string[]) => Promise<void>): Promise<void> {
  // Missing build is a failure, never a silently skipped security probe.
  expect(fs.existsSync(path.join(extensionPath, "manifest.json")), "build the extension first").toBe(true);
  const profiles = path.join(root, "test-results/main-guard-fallback-profiles");
  fs.mkdirSync(profiles, { recursive: true });
  const profile = fs.mkdtempSync(path.join(profiles, "probe-"));
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: false,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    const worker = await getServiceWorker(context);
    // Rollback needs the initial top-level commit, so do not race navigation
    // against the fresh worker installing its browser-navigation listeners.
    await expect.poll(() => worker.evaluate(() => chrome.webNavigation.onCommitted.hasListeners()), {
      timeout: 30_000,
    }).toBe(true);
    const hits: string[] = [];
    await context.route(/^https?:\/\//, async (route) => {
      const url = route.request().url();
      if (url.startsWith("https://attacker.test/")) hits.push(url);
      await route.fulfill({
        contentType: "text/html",
        body: url.startsWith("https://victim.test/page") ? fixture : "<p>sink</p>",
      });
    });
    const page = await context.newPage();
    await page.goto(`https://victim.test/page?kind=${kind}`, { waitUntil: "load" });
    await waitForNavSentinelBridge(page);
    const frame = page.frames().find((f) => f.name() === "probe");
    expect(frame, "probe child frame exists").toBeDefined();
    await run(page, frame!, hits);
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

for (const kind of ["about:blank", "srcdoc", "blob", "same-origin"] as const) {
  test(`${kind} child: main_guard gates a gesture-less form.submit() to _top #1134 @regression`, async () => {
    await withProbe(kind, async (page, frame, hits) => {
      // The bridge marker is set only once main_guard answered capture_isolated
      // in this frame, so it proves MAIN-world injection and an armed mode.
      await frame.waitForFunction(
        () => document.documentElement.getAttribute("data-navsentinel-bridge-ready") === "1",
        undefined,
        { timeout: 15_000 },
      );
      expect(
        await frame.evaluate(() => Function.prototype.toString.call(HTMLFormElement.prototype.submit).includes("[native code]")),
        "the child realm's form.submit is main_guard's wrapper",
      ).toBe(false);

      await frame.evaluate(() => {
        const form = document.createElement("form");
        form.action = "https://attacker.test/child-top";
        form.target = "_top";
        document.body.appendChild(form);
        form.submit();
      });
      await waitForToastText(frame, "Blocked form submit", 5_000);
      // Give a wrongly-allowed native submission time to commit.
      await page.waitForTimeout(1_000);
      expect(hits, "no request reached the attacker").toEqual([]);
      expect(page.url()).toBe(`https://victim.test/page?kind=${kind}`);

      // Benign control: the frame may still navigate itself.
      await frame.evaluate(() => {
        const form = document.createElement("form");
        form.action = "https://victim.test/child-ok";
        document.body.appendChild(form);
        form.submit();
      });
      await expect.poll(() => frame.url(), { timeout: 5_000 }).toBe("https://victim.test/child-ok?");
      expect(page.url()).toBe(`https://victim.test/page?kind=${kind}`);
    });
  });
}

for (const request of [false, true]) {
  test(`about:blank child ${request ? "requestSubmit" : "submit"} to self grants no top-tab authority #1155 @regression`, async () => {
    await withProbe("about:blank", async (page, frame, hits) => {
      await frame.waitForFunction(
        () => document.documentElement.getAttribute("data-navsentinel-bridge-ready") === "1",
      );
      // Let the initial page.goto's typed-origin context expire. No trusted
      // input, cross-realm call, or test-created allowance precedes the attack.
      await page.waitForTimeout(5_200);
      const originalUrl = page.url();
      const destination = "https://attacker.test/sink?";
      const worker = await getServiceWorker(page.context());
      const tabId = await worker.evaluate(async (url) => {
        const tab = (await chrome.tabs.query({})).find((candidate) => candidate.url === url);
        if (typeof tab?.id !== "number") throw new Error("Probe tab not found");
        return tab.id;
      }, originalUrl);
      await expect.poll(() => worker.evaluate(async (id) => {
        const stored = await chrome.storage.session.get("ns_sw:lastUrl");
        return (stored["ns_sw:lastUrl"] as Record<string, unknown> | undefined)?.[String(id)];
      }, tabId), { message: "the worker observed the source commit before the attack" }).toBe(originalUrl);

      await frame.evaluate((request) => {
        const form = document.createElement("form");
        form.action = "https://attacker.test/sink";
        document.body.appendChild(form);
        if (request) form.requestSubmit();
        else form.submit();
      }, request);
      await expect.poll(() => frame.url(), { timeout: 5_000 }).toBe(destination);
      expect(hits, "the benign child-only submission actually reached its sink").toContain(destination);
      expect(page.url()).toBe(originalUrl);
      // Allow the capture bridge's asynchronous grant message to reach the SW.
      await page.waitForTimeout(250);
      const childGrant = await worker.evaluate(async (id) => {
        const stored = await chrome.storage.session.get("ns_sw:allowTarget");
        return (stored["ns_sw:allowTarget"] as Record<string, unknown> | undefined)?.[String(id)] ?? null;
      }, tabId);

      const commits: string[] = [];
      page.on("framenavigated", (candidate) => {
        if (candidate === page.mainFrame()) commits.push(candidate.url());
      });
      await page.evaluate((url) => {
        window.setTimeout(() => location.assign(url), 0);
      }, destination);
      // Require the attack to commit before checking rollback, so an assertion
      // on the original URL cannot pass merely because navigation is pending.
      await expect.poll(() => commits, { timeout: 5_000 }).toContain(destination);
      expect.soft(childGrant, "child self-submission minted no tab-wide target grant").toBeNull();
      await expect(page).toHaveURL(originalUrl, { timeout: 5_000 });
    });
  });
}

// Remaining #1134 shape, not fixed by manifest injection: a child realm's
// guard self-exempts subframe self-targets, but a top-level form "self" is the
// tab. It reproduces in a plain same-origin child too, and needs a main_guard
// ownerDocument check that the main_guard perf budget cannot absorb yet.
test.fixme("child realm's submit called on a top-level form stays gated #1134 @regression", async () => {
  await withProbe("same-origin", async (page, frame, hits) => {
    await frame.waitForFunction(() => document.documentElement.getAttribute("data-navsentinel-bridge-ready") === "1");
    await page.evaluate(() => {
      const child = (document.querySelector('iframe[name="probe"]') as HTMLIFrameElement).contentWindow as Window & typeof globalThis;
      child.HTMLFormElement.prototype.submit.call(document.getElementById("top-form"));
    });
    await page.waitForTimeout(1_500);
    expect(hits).toEqual([]);
  });
});
