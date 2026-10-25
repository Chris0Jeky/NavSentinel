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
import { waitForNavSentinelBridge } from "./extension_test_utils";

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
      await frame.waitForFunction(
        () => !!document.querySelector("#__navsentinel_toast_host")?.shadowRoot
          ?.querySelector(".body")?.textContent?.includes("Blocked form submit"),
        undefined,
        { timeout: 5_000 },
      );
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
