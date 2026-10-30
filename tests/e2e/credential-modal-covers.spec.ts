import { chromium, expect, test, type BrowserContext, type CDPSession, type Frame, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { SUITE_SETTINGS_KEY } from "../../extension/src/shared/storage";
import { DBLCLICK_WINDOW_MS } from "../../extension/src/shared/doubleclick_timing";
import { evaluateInCredentialModal, frameViewportOffset, getServiceWorker } from "./extension_test_utils";

// #1236: surfaces that cover an approval without our observers seeing them.
// All fixture requests are intercepted locally; credentials are dummy data.
const LOGIN = `
  <form method="post" action="http://collector.test/collect">
    <input id="user" name="user" value="synthetic@example.invalid">
    <input name="password" type="password" value="dummy-covers">
    <button id="go">Sign in</button>
  </form>`;
const ARMED_MS = DBLCLICK_WINDOW_MS + 700;

async function withExtension(name: string, run: (context: BrowserContext, posts: () => number) => Promise<void>) {
  const extensionPath = path.resolve("extension/dist");
  expect(fs.existsSync(extensionPath), "build required").toBe(true);
  fs.mkdirSync("test-results", { recursive: true });
  const profile = fs.mkdtempSync(path.resolve(`test-results/credential-${name}-profile-`));
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: false,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    const worker = await getServiceWorker(context);
    await worker.evaluate(async (key) => {
      await chrome.storage.local.set({ [key]: {
        credential: { mode: "smart", promptOnUntrustedDomain: true, blockHttpPasswordSubmit: false },
        nav: { defaultMode: "smart", debug: false },
      } });
    }, SUITE_SETTINGS_KEY);
    let posts = 0;
    await context.route("http://collector.test/**", async (route) => {
      if (route.request().method() === "POST") posts++;
      await route.fulfill({ contentType: "text/html", body: "<p>Fixture received</p>" });
    });
    await run(context, () => posts);
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

/** Playwright emulates focus for every page; these tests need real window focus. */
async function realFocus(context: BrowserContext, page: Page): Promise<CDPSession> {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: false });
  return cdp;
}

/** Another browser window, offset so ours stays partly uncovered, takes focus. */
async function openCoveringWindow(context: BrowserContext, cdp: CDPSession): Promise<Page> {
  const main = await cdp.send("Browser.getWindowForTarget");
  const opened = context.waitForEvent("page");
  await cdp.send("Target.createTarget", {
    url: "about:blank", newWindow: true,
    left: (main.bounds.left ?? 0) + 40, top: (main.bounds.top ?? 0) + 40,
  });
  const popup = await opened;
  await popup.bringToFront();
  return popup;
}

async function proceedPoint(target: Page | Frame): Promise<{ x: number; y: number }> {
  const point = await evaluateInCredentialModal(target, function (this: ShadowRoot) {
    const button = Array.from(this.querySelectorAll("button")).find((b) => b.textContent === "Proceed once");
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  expect(point, "Proceed once rendered").not.toBeNull();
  const offset = "parentFrame" in target && target.parentFrame() ? await frameViewportOffset(target) : { x: 0, y: 0 };
  return { x: point!.x + offset.x, y: point!.y + offset.y };
}

test("Proceed once does not arm while a video Picture-in-Picture window is open (#1236) @regression", async () => {
  test.setTimeout(90_000);
  await withExtension("pip", async (context, posts) => {
    // The page opens PiP from the same click that submits, so it is up before the prompt.
    await context.route("http://victim.test/**", (route) => route.fulfill({ contentType: "text/html", body: `
      ${LOGIN}
      <video id="v" muted playsinline width="160" height="90"></video>
      <script>
        const v = document.getElementById("v");
        const c = document.createElement("canvas"); c.width = 160; c.height = 90;
        c.getContext("2d").fillRect(0, 0, 160, 90);
        v.srcObject = c.captureStream(); v.play();
        document.getElementById("go").addEventListener("click", () => { v.requestPictureInPicture(); });
      </script>` }));
    const page = await context.newPage();
    await realFocus(context, page);
    await page.goto("http://victim.test/login");
    await page.bringToFront();
    await page.waitForFunction(() => (document.getElementById("v") as HTMLVideoElement).readyState >= 1);
    await page.click("#go", { noWaitAfter: true });
    await expect.poll(() => page.evaluate(() => !!document.pictureInPictureElement)).toBe(true);
    await expect.poll(() => proceedPoint(page).then(() => true).catch(() => false)).toBe(true);

    await page.waitForTimeout(ARMED_MS);
    const point = await proceedPoint(page);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(1000);
    expect(posts(), "an approval under an open PiP window must be refused").toBe(0);

    await page.evaluate(() => document.exitPictureInPicture());
    await page.waitForTimeout(ARMED_MS);
    await page.mouse.click(point.x, point.y);
    await expect.poll(posts, { timeout: 5000 }).toBe(1);
  });
});

test("Proceed once is refused right after a short blur, then approves once re-armed (#1236) @regression", async () => {
  test.setTimeout(90_000);
  await withExtension("blur", async (context, posts) => {
    await context.route("http://victim.test/**", (route) => route.fulfill({ contentType: "text/html", body: LOGIN }));
    const page = await context.newPage();
    const cdp = await realFocus(context, page);
    await page.goto("http://victim.test/login");
    await page.bringToFront();
    await page.waitForTimeout(300);
    await page.click("#go", { noWaitAfter: true });
    await expect.poll(() => proceedPoint(page).then(() => true).catch(() => false)).toBe(true);
    const popup = await openCoveringWindow(context, cdp);
    await page.bringToFront();
    await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
    await page.evaluate(() => {
      const probe = window as unknown as { focusLog: string[] };
      probe.focusLog = [];
      for (const type of ["blur", "focus"]) addEventListener(type, (e) => {
        if (e.target === window) probe.focusLog.push(`${type}@${Math.round(performance.now())}`);
      });
    });
    await page.waitForTimeout(ARMED_MS);
    const point = await proceedPoint(page);

    // The other window holds focus only while the page runs one long task, so no
    // animation frame samples hasFocus() false; only the blur event can see it.
    await page.evaluate(() => setTimeout(() => {
      const probe = window as unknown as { focusLog: string[] };
      const start = performance.now();
      while (performance.now() - start < 60);
      probe.focusLog.push(`task@${Math.round(start)}-${Math.round(performance.now())}`);
    }, 0));
    await popup.bringToFront();
    await page.bringToFront();
    await page.mouse.click(point.x, point.y);
    // Both events queue behind the task and dispatch back to back, after it.
    const log = await page.evaluate(() => (window as unknown as { focusLog: string[] }).focusLog);
    expect(log.map((entry) => entry.split("@")[0]), "the blur happened during the long task").toEqual(["task", "blur", "focus"]);
    await page.waitForTimeout(1000);
    expect(posts(), "the click right after a short blur must be refused").toBe(0);

    await page.waitForTimeout(ARMED_MS);
    await page.mouse.click(point.x, point.y);
    await expect.poll(posts, { timeout: 5000 }).toBe(1);
  });
});

test("an iframe that had focus does not arm a later prompt behind a covering window (#1236) @regression", async () => {
  test.setTimeout(90_000);
  await withExtension("frame-latch", async (context, posts) => {
    await context.route("http://parent.test/**", (route) => route.fulfill({ contentType: "text/html", body: `
      <body style="margin:0"><iframe src="http://victim.test/login"
        style="position:absolute;left:20px;top:20px;width:900px;height:640px;border:0"></iframe></body>` }));
    await context.route("http://victim.test/**", (route) => route.fulfill({ contentType: "text/html", body: LOGIN }));
    const page = await context.newPage();
    const cdp = await realFocus(context, page);
    await page.goto("http://parent.test/");
    await page.bringToFront();
    const frame = page.frames().find((candidate) => candidate.url().startsWith("http://victim.test"))!;
    await frame.waitForSelector("#user");
    // The user types into the embedded login, so the frame has had focus.
    await frame.click("#user");
    await expect.poll(() => frame.evaluate(() => document.hasFocus())).toBe(true);

    // A covering window takes focus, then the frame raises its prompt behind it.
    const popup = await openCoveringWindow(context, cdp);
    await expect.poll(() => frame.evaluate(() => document.hasFocus())).toBe(false);
    await frame.evaluate(() => (document.querySelector("form") as HTMLFormElement).requestSubmit());
    await expect.poll(() => proceedPoint(frame).then(() => true).catch(() => false)).toBe(true);
    await popup.waitForTimeout(ARMED_MS);
    await popup.close();
    await page.bringToFront();
    const point = await proceedPoint(frame);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(1000);
    expect(posts(), "the prompt armed behind the covering window must refuse").toBe(0);

    await page.waitForTimeout(ARMED_MS);
    await page.mouse.click(point.x, point.y);
    await expect.poll(posts, { timeout: 5000 }).toBe(1);
  });
});

test("a short blur stays refused when an early page listener stops blur and focus (#1242) @regression", async () => {
  test.setTimeout(90_000);
  await withExtension("stopped-blur", async (context, posts) => {
    // The page registers window capture listeners from its first script, during the
    // content module's import gap, and hides blur/focus from every later listener.
    await context.route("http://victim.test/**", (route) => route.fulfill({ contentType: "text/html", body: `
      <head><script>
        window.focusLog = [];
        for (const type of ["blur", "focus"]) addEventListener(type, (e) => {
          if (e.target !== window) return;
          window.focusLog.push(type + "@" + Math.round(performance.now()));
          e.stopImmediatePropagation();
        }, true);
      </script></head><body>${LOGIN}</body>` }));
    const page = await context.newPage();
    const cdp = await realFocus(context, page);
    await page.goto("http://victim.test/login");
    await page.bringToFront();
    await page.waitForTimeout(300);
    await page.click("#go", { noWaitAfter: true });
    await expect.poll(() => proceedPoint(page).then(() => true).catch(() => false)).toBe(true);
    const popup = await openCoveringWindow(context, cdp);
    await page.bringToFront();
    await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
    await page.evaluate(() => { (window as unknown as { focusLog: string[] }).focusLog = []; });
    await page.waitForTimeout(ARMED_MS);
    const point = await proceedPoint(page);

    // As in the short-blur test: only the blur event can see this focus loss.
    await page.evaluate(() => setTimeout(() => {
      const probe = window as unknown as { focusLog: string[] };
      const start = performance.now();
      while (performance.now() - start < 60);
      probe.focusLog.push(`task@${Math.round(start)}-${Math.round(performance.now())}`);
    }, 0));
    await popup.bringToFront();
    await page.bringToFront();
    await page.mouse.click(point.x, point.y);
    const log = await page.evaluate(() => (window as unknown as { focusLog: string[] }).focusLog);
    expect(log.map((entry) => entry.split("@")[0]), "the blur happened during the long task").toEqual(["task", "blur", "focus"]);
    await page.waitForTimeout(1000);
    expect(posts(), "a blur the page hid from later listeners must still refuse").toBe(0);

    await page.waitForTimeout(ARMED_MS);
    await page.mouse.click(point.x, point.y);
    await expect.poll(posts, { timeout: 5000 }).toBe(1);
  });
});

test("Proceed once in the top frame refuses while a child frame's video PiP is open (#1242) @regression", async () => {
  test.setTimeout(90_000);
  await withExtension("frame-pip", async (context, posts) => {
    await context.route("http://victim.test/**", (route) => route.fulfill({ contentType: "text/html",
      body: route.request().url().endsWith("/player") ? `
        <button id="pip">Watch in PiP</button>
        <video id="v" muted playsinline width="160" height="90"></video>
        <script>
          const v = document.getElementById("v");
          const c = document.createElement("canvas"); c.width = 160; c.height = 90;
          c.getContext("2d").fillRect(0, 0, 160, 90);
          v.srcObject = c.captureStream(); v.play();
          document.getElementById("pip").addEventListener("click", () => { v.requestPictureInPicture(); });
        </script>` : `${LOGIN}<iframe src="/player" width="300" height="200"></iframe>` }));
    const page = await context.newPage();
    await realFocus(context, page);
    await page.goto("http://victim.test/login");
    await page.bringToFront();
    const player = page.frames().find((frame) => frame.url().endsWith("/player"))!;
    await player.waitForFunction(() => (document.getElementById("v") as HTMLVideoElement).readyState >= 1);
    await player.click("#pip");
    await expect.poll(() => player.evaluate(() => !!document.pictureInPictureElement)).toBe(true);
    expect(await page.evaluate(() => !!document.pictureInPictureElement), "PiP belongs to the child frame").toBe(false);

    await page.click("#go", { noWaitAfter: true });
    await expect.poll(() => proceedPoint(page).then(() => true).catch(() => false)).toBe(true);
    await page.waitForTimeout(ARMED_MS);
    const point = await proceedPoint(page);
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(1000);
    expect(posts(), "an approval under another frame's PiP window must be refused").toBe(0);
    const hint = await evaluateInCredentialModal(page, function (this: ShadowRoot) {
      return this.querySelector("[role=status]")?.textContent ?? null;
    });
    expect(hint, "the refusal says why").toBe("Close Picture-in-Picture to continue");

    await player.evaluate(() => document.exitPictureInPicture());
    await page.waitForTimeout(ARMED_MS);
    await page.mouse.click(point.x, point.y);
    await expect.poll(posts, { timeout: 5000 }).toBe(1);
  });
});
