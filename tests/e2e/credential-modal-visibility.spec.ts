import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { SUITE_SETTINGS_KEY } from "../../extension/src/shared/storage";
import { DBLCLICK_WINDOW_MS } from "../../extension/src/shared/doubleclick_timing";
import { evaluateInCredentialModal, evaluateInToast, focusToastButton, getServiceWorker, toastButtonPoint, waitForCredentialModal, clickModalButton, waitForNavSentinelBridge, waitForToastText } from "./extension_test_utils";

for (const activation of ["pointer", "Enter", "Space"] as const) {
test(`page CSS cannot turn an invisible credential prompt into approval; visible ${activation} works (#1139) @regression`, async () => {
  test.setTimeout(90_000);
  const extensionPath = path.resolve("extension/dist");
  expect(fs.existsSync(extensionPath), "build required").toBe(true);
  fs.mkdirSync("test-results", { recursive: true });
  const profile = fs.mkdtempSync(path.resolve("test-results/credential-visible-profile-"));
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
    // All fixture requests are intercepted locally; credentials are dummy data.
    await context.route("http://victim.test/**", (route) => route.fulfill({ contentType: "text/html", body: `
      <form method="post" action="http://collector.test/collect">
        <input name="user" value="synthetic@example.invalid">
        <input name="password" type="password" value="dummy-1139">
        <button id="go">Sign in</button>
      </form>` }));
    await context.route("http://collector.test/**", async (route) => {
      if (route.request().method() === "POST") posts++;
      await route.fulfill({ contentType: "text/html", body: "<p>Fixture received</p>" });
    });
    const page = await context.newPage();
    await page.goto("http://victim.test/login");
    await page.waitForTimeout(300);
    await page.click("#go", { noWaitAfter: true });
    await waitForCredentialModal(page);
    await page.waitForTimeout(DBLCLICK_WINDOW_MS + 700);
    const point = await evaluateInCredentialModal(page, function (this: ShadowRoot) {
      const button = Array.from(this.querySelectorAll("button")).find((b) => b.textContent === "Proceed once")!;
      const rect = button.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    expect(point).not.toBeNull();
    await page.addStyleTag({ content: "#__sentinelsuite_cred_modal_host__ { opacity: 0 !important; }" });
    await page.mouse.click(point!.x, point!.y);
    await page.waitForTimeout(200);
    expect(posts, "trusted click through an opacity-zero prompt sends no POST").toBe(0);
    expect(await evaluateInCredentialModal(page, function (this: ShadowRoot) { return !!this.querySelector(".overlay"); })).toBe(true);
    await page.addStyleTag({ content: "#__sentinelsuite_cred_modal_host__ { opacity: 1 !important; }" });
    // Restoring visibility does not inherit the old exposure window.
    await page.mouse.click(point!.x, point!.y);
    expect(posts).toBe(0);
    await page.waitForTimeout(DBLCLICK_WINDOW_MS + 700);
    if (activation === "pointer") await clickModalButton(page, "Proceed once");
    else {
      // DevTools can focus the closed-root control; the key is real browser input.
      await evaluateInCredentialModal(page, function (this: ShadowRoot) {
        const button = Array.from(this.querySelectorAll("button")).find((b) => b.textContent === "Proceed once")!;
        button.focus();
      });
      await page.keyboard.press(activation);
    }
    await expect.poll(() => posts).toBe(1);
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
}

// #1142: constructions the hit test and CSS walk could not see. Each one is
// applied after the prompt armed, held past a fresh arming window, then clicked.
type Point = { x: number; y: number };
const paintedCovers = {
  // A later top-layer popover paints over Proceed once but lets hit tests through.
  "pointer-events:none top-layer cover": (point: Point) => {
    const cover = document.createElement("div");
    cover.id = "cover-1142";
    cover.popover = "manual";
    cover.textContent = "Continue";
    cover.style.cssText = "position:fixed;margin:0;border:0;padding:0;pointer-events:none;background:#fff;" +
      `left:${point.x - 120}px;top:${point.y - 40}px;width:240px;height:80px`;
    document.body.append(cover);
    cover.showPopover();
  },
  // Tiny but "visible": the button keeps a non-zero box and still hit-tests
  // (at scale(0.01) the sub-pixel button already misses the hit test).
  "host transform scale(0.15)": (point: Point) => {
    const style = document.createElement("style");
    style.id = "cover-1142";
    style.textContent = "#__sentinelsuite_cred_modal_host__{transform:scale(0.15)!important;" +
      `transform-origin:${point.x}px ${point.y}px!important}`;
    document.head.append(style);
  },
};

for (const [construction, apply] of Object.entries(paintedCovers)) {
test(`credential prompt refuses Proceed once under a ${construction} (#1142) @regression`, async () => {
  test.setTimeout(90_000);
  const extensionPath = path.resolve("extension/dist");
  expect(fs.existsSync(extensionPath), "build required").toBe(true);
  fs.mkdirSync("test-results", { recursive: true });
  const profile = fs.mkdtempSync(path.resolve("test-results/credential-painted-profile-"));
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
    // All fixture requests are intercepted locally; credentials are dummy data.
    await context.route("http://victim.test/**", (route) => route.fulfill({ contentType: "text/html", body: `
      <form method="post" action="http://collector.test/collect">
        <input name="user" value="synthetic@example.invalid">
        <input name="password" type="password" value="dummy-1142">
        <button id="go">Sign in</button>
      </form>` }));
    await context.route("http://collector.test/**", async (route) => {
      if (route.request().method() === "POST") posts++;
      await route.fulfill({ contentType: "text/html", body: "<p>Fixture received</p>" });
    });
    const page = await context.newPage();
    await page.goto("http://victim.test/login");
    await page.waitForTimeout(300);
    await page.click("#go", { noWaitAfter: true });
    await waitForCredentialModal(page);
    const proceedPoint = () => evaluateInCredentialModal(page, function (this: ShadowRoot) {
      const button = Array.from(this.querySelectorAll("button")).find((b) => b.textContent === "Proceed once")!;
      const rect = button.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    await page.waitForTimeout(DBLCLICK_WINDOW_MS + 700);
    const point = (await proceedPoint())!;
    await page.evaluate(apply, point);
    await page.waitForTimeout(DBLCLICK_WINDOW_MS + 500);
    // The construction still lets real input reach the button at this point.
    const covered = (await proceedPoint())!;
    expect(Math.abs(covered.x - point.x) + Math.abs(covered.y - point.y)).toBeLessThan(2);
    expect(await evaluateInCredentialModal(page, function (this: ShadowRoot, at: Point) {
      const hit = this.elementFromPoint(at.x, at.y);
      return { page: document.elementFromPoint(at.x, at.y) === this.host, button: hit?.textContent, size: hit?.getBoundingClientRect().height };
    }, covered)).toMatchObject({ page: true, button: "Proceed once" });
    await page.mouse.click(covered.x, covered.y);
    await page.waitForTimeout(300);
    expect(posts, `trusted click under a ${construction} sends no POST`).toBe(0);
    expect(await evaluateInCredentialModal(page, function (this: ShadowRoot) { return !!this.querySelector(".overlay"); })).toBe(true);
    // Removing the construction re-arms and approves normally.
    await page.evaluate(() => document.getElementById("cover-1142")?.remove());
    await clickModalButton(page, "Proceed once");
    await expect.poll(() => posts).toBe(1);
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
}

for (const activation of ["pointer", "Enter", "Space"] as const) {
test(`built toast fence refuses immediate approval and permits armed ${activation} (#1139) @regression`, async () => {
  test.setTimeout(60_000);
  const extensionPath = path.resolve("extension/dist");
  expect(fs.existsSync(extensionPath), "build required").toBe(true);
  fs.mkdirSync("test-results", { recursive: true });
  const profile = fs.mkdtempSync(path.resolve("test-results/toast-visible-profile-"));
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: false,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await context.route("http://toast.test/**", (route) => route.fulfill({
      contentType: "text/html", body: "<p>Local toast approval fixture</p>",
    }));
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("http://toast.test/start");
    await waitForNavSentinelBridge(page);
    const started = await page.evaluate(() => {
      const started = performance.now();
      window.open("http://toast.test/approved", "_blank");
      return started;
    });
    await waitForToastText(page, "Blocked popup");
    // The toast root is closed (#1142): resolve the button through CDP, then
    // drive real pointer or keyboard input at it.
    const activate = async () => {
      if (activation === "pointer") {
        const point = await toastButtonPoint(page, "Allow once");
        await page.mouse.click(point.x, point.y);
      } else {
        await focusToastButton(page, "Allow once");
        await page.keyboard.press(activation);
      }
    };
    await activate();
    expect(await page.evaluate(() => performance.now()) - started, "first trusted input must precede arming").toBeLessThan(DBLCLICK_WINDOW_MS);
    expect(context.pages().filter((candidate) => candidate !== page && candidate.url() !== "about:blank" && !candidate.url().startsWith("chrome-extension:"))).toHaveLength(0);
    expect(await toastButtonPoint(page, "Allow once", 1000), "refused approval keeps the original action pending").toBeTruthy();

    await page.waitForTimeout(DBLCLICK_WINDOW_MS + 700);
    // The extension's own onboarding tab can open late in a fresh profile; it is not the popup.
    const popupPromise = context.waitForEvent("page", { timeout: 5000, predicate: (p) => !p.url().startsWith("chrome-extension:") });
    await activate();
    const popup = await popupPromise;
    await expect(popup).toHaveURL("http://toast.test/approved");
    await expect.poll(() => evaluateInToast(page, (roots) => roots
      .flatMap((root) => Array.from(root.querySelectorAll("button")))
      .filter((button) => button.textContent?.trim() === "Allow once").length)).toBe(0);
    expect(context.pages().filter((candidate) => candidate !== page && candidate.url() !== "about:blank" && !candidate.url().startsWith("chrome-extension:"))).toEqual([popup]);
  } finally {
    await context?.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
}
