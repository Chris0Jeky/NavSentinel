import { chromium, expect, test, type BrowserContext, type Page } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import {
  getGymBaseUrl,
  getServiceWorker,
  readToastText,
  waitForNavSentinelBridge
} from "./extension_test_utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(__dirname, "..", "..", "extension", "dist");
const gymRoot = path.resolve(__dirname, "..", "..", "gym");
const fixture = "issue566-modifier-retry.html";

test.setTimeout(90_000);

type Gesture = "control-click" | "long-control-click" | "middle-click";
type Scenario = {
  id:
    | "native-control"
    | "assign-control"
    | "self-control"
    | "pointer-assign-control"
    | "mouse-assign-control"
    | "top-assign-control"
    | "parent-assign-control"
    | "named-assign-control"
    | "empty-assign-control";
  label: string;
  expectedQuery: string;
};

const scenarios: Scenario[] = [
  { id: "native-control", label: "plain native control", expectedQuery: "case=native" },
  { id: "assign-control", label: "location.assign timer", expectedQuery: "case=assign" },
  { id: "self-control", label: "window.open _self timer", expectedQuery: "case=self" },
  { id: "pointer-assign-control", label: "pointerdown location.assign timer", expectedQuery: "case=pointer-assign" },
  { id: "mouse-assign-control", label: "mousedown location.assign timer", expectedQuery: "case=mouse-assign" },
  { id: "top-assign-control", label: "_top location.assign timer", expectedQuery: "case=top-assign" },
  { id: "parent-assign-control", label: "_parent location.assign timer", expectedQuery: "case=parent-assign" },
  { id: "named-assign-control", label: "named-opener location.assign timer", expectedQuery: "case=named-assign" },
  { id: "empty-assign-control", label: "explicit-empty target location.assign timer", expectedQuery: "case=empty-assign" }
];

async function openFreshScenario(): Promise<{
  baseUrl: string;
  context: BrowserContext;
  opener: Page;
  cleanup: () => Promise<void>;
}> {
  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-issue566-"));
  let context: BrowserContext | undefined;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });
    const opener = await context.newPage();
    await opener.goto(`${baseUrl}/${fixture}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await waitForNavSentinelBridge(opener);

    return {
      baseUrl,
      context,
      opener,
      cleanup: async () => {
        await context?.close();
        if (gym) await gym.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      }
    };
  } catch (error) {
    if (context) await context.close();
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw error;
  }
}

async function waitForIssue566Child(
  context: BrowserContext,
  baseUrl: string,
  testCase: string,
): Promise<Page> {
  const expected = new URL("issue566-destination.html", `${baseUrl}/`);
  expected.hostname = expected.hostname === "127.0.0.1" ? "localhost" : "127.0.0.1";
  expected.searchParams.set("case", testCase);
  const expectedUrl = expected.toString();

  await expect.poll(
    () => context.pages().find((page) => page.url() === expectedUrl)?.url() ?? "",
    { timeout: 6_000, message: `Expected local child ${expectedUrl}` },
  ).toBe(expectedUrl);
  const child = context.pages().find((page) => page.url() === expectedUrl);
  if (!child) throw new Error(`Expected local child disappeared: ${expectedUrl}`);
  return child;
}

async function runScenario(scenario: Scenario, gesture: Gesture): Promise<void> {
  const { baseUrl, context, opener, cleanup } = await openFreshScenario();
  try {
    const existingPages = new Set(context.pages());
    const historyBefore = await opener.evaluate(() => history.length);
    const control = opener.locator(`#${scenario.id}`);

    if (gesture === "control-click") {
      await control.click({ modifiers: ["Control"], button: "left" });
    } else if (gesture === "long-control-click") {
      const box = await control.boundingBox();
      if (!box) throw new Error(`Control #${scenario.id} has no clickable box`);
      await opener.keyboard.down("Control");
      await opener.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await opener.mouse.down({ button: "left" });
      await opener.waitForTimeout(1700);
      await opener.mouse.up({ button: "left" });
      await opener.keyboard.up("Control");
    } else {
      await control.click({ button: "middle" });
    }

    const child = await waitForIssue566Child(context, baseUrl, scenario.expectedQuery.slice(5));
    await child.waitForLoadState("domcontentloaded", { timeout: 10_000 });
    // The fixture's timers and the browser's tab creation must both settle
    // before the opener/page-count assertions are evaluated.
    await opener.waitForTimeout(250);

    await expect(child).toHaveURL(new RegExp(`issue566-destination\\.html\\?${scenario.expectedQuery}`));
    await expect(opener).toHaveURL(new RegExp(`issue566-modifier-retry\\.html`));
    expect(await opener.evaluate(() => history.length), "Opener history must not advance").toBe(historyBefore);
    const addedPages = context.pages().filter((page) => !existingPages.has(page));
    expect(addedPages, "Modifier gesture must create exactly one child tab").toHaveLength(1);
    expect(addedPages[0]).toBe(child);

    const log = await opener.locator("#event-log").innerText();
    expect(log, "The isolated modifier event must not reach page handlers").not.toContain(`target=${scenario.id}`);
    const toast = await readToastText(opener);
    await child.close();
    await expect(opener).toHaveURL(new RegExp(`issue566-modifier-retry\\.html`));
    expect(await opener.evaluate(() => history.length), "Closing the child must not alter opener history").toBe(historyBefore);
    await expect.poll(
      () => context.pages().filter((page) => !existingPages.has(page)).length,
      { message: "Closing the requested child must restore the original page count" }
    ).toBe(0);
    console.log(
      `[issue566] ${scenario.id} / ${gesture}: child=${child.url()} opener=${opener.url()} ` +
      `pages=${context.pages().length} toast=${toast ?? "none"}`
    );
  } finally {
    await cleanup();
  }
}

for (const scenario of scenarios) {
  for (const gesture of ["control-click", "middle-click"] as const) {
    test(`${scenario.label} preserves opener for ${gesture} @regression`, async () => {
      test.skip(!fs.existsSync(extensionPath), "Build the extension before running modifier navigation E2E tests.");
      await runScenario(scenario, gesture);
    });
  }
}

test("location.assign timer preserves opener for a long-held Control-click @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running modifier navigation E2E tests.");
  await runScenario(scenarios[1]!, "long-control-click");
});

test("Navigation Off preserves the page's modified-click handler @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running modifier navigation E2E tests.");

  const { baseUrl, context, opener, cleanup } = await openFreshScenario();
  try {
    const serviceWorker = await getServiceWorker(context);
    await serviceWorker.evaluate(async () => {
      const key = "sentinelsuite:settings_v1";
      const stored = await chrome.storage.local.get(key);
      const current = (stored[key] ?? {}) as Record<string, unknown>;
      const nav = (current.nav ?? {}) as Record<string, unknown>;
      await chrome.storage.local.set({
        [key]: { ...current, nav: { ...nav, defaultMode: "off" } }
      });
    });

    await opener.reload({ waitUntil: "domcontentloaded", timeout: 20_000 });
    await waitForNavSentinelBridge(opener);

    await opener.locator("#pointer-assign-control").click({ modifiers: ["Control"], button: "left" });
    const child = await waitForIssue566Child(context, baseUrl, "pointer-assign");

    await child.waitForLoadState("domcontentloaded", { timeout: 10_000 });
    await opener.waitForURL(/issue566-destination\.html\?case=pointer-assign-timer/, { timeout: 10_000 });
    await expect(child).toHaveURL(/issue566-destination\.html\?case=pointer-assign$/);
  } finally {
    await cleanup();
  }
});

for (const compatibility of [
  {
    id: "base-blank-control",
    label: "base-target _blank",
    nativeCases: ["base"],
    logText: "base-target compatibility handler reached"
  },
  {
    id: "other-name-control",
    label: "other named-context anchor",
    nativeCases: ["other-name"],
    logText: "schedule named-context compatibility popup"
  },
  {
    id: "same-site-control",
    label: "same-site modified anchor",
    nativeCases: ["same-site"],
    logText: "schedule same-site compatibility popup"
  },
  {
    id: "non-http-control",
    label: "inert non-HTTP anchor",
    nativeCases: [],
    logText: "schedule inert non-HTTP compatibility popup"
  }
] as const) {
  test(`${compatibility.label} keeps its handler without opener allowance @regression`, async () => {
    test.skip(!fs.existsSync(extensionPath), "Build the extension before running modifier navigation E2E tests.");

    const { context, opener, cleanup } = await openFreshScenario();
    try {
      const existingPages = new Set(context.pages());
      await opener.locator(`#${compatibility.id}`).click({ modifiers: ["Control"], button: "left" });
      await opener.waitForTimeout(1000);
      console.log(
        `[issue566-compat] ${compatibility.id}: pages=${context.pages()
          .filter((page) => !existingPages.has(page))
          .map((page) => page.url())
          .join(",")} log=${await opener.locator("#event-log").innerText()} toast=${await readToastText(opener) ?? "none"}`
      );

      expect(
        context.pages().filter((page) => !existingPages.has(page)),
        "Only Chromium's native modified navigation may open a child"
      ).toHaveLength(compatibility.nativeCases.length);
      const newPages = context.pages().filter((page) => !existingPages.has(page));
      await Promise.all(newPages.map((page) => page.waitForLoadState("domcontentloaded", { timeout: 10_000 })));
      const cases = new Set(newPages.map((page) => new URL(page.url()).searchParams.get("case")));

      for (const testCase of compatibility.nativeCases) {
        expect(cases, `Missing ${testCase} child in ${[...cases].join(", ")}`).toContain(testCase);
      }
      await expect(opener).toHaveURL(/issue566-modifier-retry\.html/);
      await expect(opener.locator("#event-log")).toContainText(compatibility.logText);
    } finally {
      await cleanup();
    }
  });
}

test("base-target _blank middle-click reaches its auxclick handler @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running modifier navigation E2E tests.");

  const { baseUrl, context, opener, cleanup } = await openFreshScenario();
  try {
    const pagesBefore = context.pages().length;
    await opener.locator("#base-blank-control").click({ button: "middle" });
    const child = await waitForIssue566Child(context, baseUrl, "base");

    await child.waitForLoadState("domcontentloaded", { timeout: 10_000 });
    await expect(child).toHaveURL(/issue566-destination\.html\?case=base$/);
    await expect(opener.locator("#event-log")).toContainText("base-target compatibility handler reached");
    expect(context.pages()).toHaveLength(pagesBefore + 1);
    await expect(opener).toHaveURL(/issue566-modifier-retry\.html/);
  } finally {
    await cleanup();
  }
});

test("a non-current anchor handler gets no MAIN-world opener authority @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running modifier navigation E2E tests.");

  const { baseUrl, context, opener, cleanup } = await openFreshScenario();
  try {
    const pagesBefore = context.pages().length;
    const historyBefore = await opener.evaluate(() => history.length);
    await opener.locator("#base-self-open-control").click({ modifiers: ["Control"], button: "left" });
    const child = await waitForIssue566Child(context, baseUrl, "base-self-open");

    await child.waitForLoadState("domcontentloaded", { timeout: 10_000 });
    await expect(opener.locator("#event-log")).toContainText("timer fired: base-target window.open _self");
    await opener.waitForTimeout(250);
    await expect(child).toHaveURL(/issue566-destination\.html\?case=base-self-open$/);
    await expect(opener).toHaveURL(/issue566-modifier-retry\.html/);
    expect(await opener.evaluate(() => history.length)).toBe(historyBefore);
    expect(context.pages()).toHaveLength(pagesBefore + 1);
  } finally {
    await cleanup();
  }
});

test("a non-current anchor handler gets no service-worker opener authority @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running modifier navigation E2E tests.");

  const { baseUrl, context, opener, cleanup } = await openFreshScenario();
  try {
    // This control asserts service-worker rollback. The MAIN/content bridge can
    // be ready before the worker has registered its navigation listeners.
    await getServiceWorker(context);
    const pagesBefore = context.pages().length;
    const historyBefore = await opener.evaluate(() => history.length);
    await opener.locator("#base-replace-control").click({ modifiers: ["Control"], button: "left" });
    const child = await waitForIssue566Child(context, baseUrl, "base-replace");

    await child.waitForLoadState("domcontentloaded", { timeout: 10_000 });
    // Use a web-first locator assertion across the expected handler navigation
    // and rollback. A direct page.evaluate can bind to the document that is
    // being replaced and turn successful containment into a destroyed-context
    // harness failure.
    await expect(opener.locator("html")).toHaveAttribute("data-base-replace-fired", "1", {
      timeout: 10_000,
    });
    await expect(child).toHaveURL(/issue566-destination\.html\?case=base-replace$/);
    await expect(opener).toHaveURL(/issue566-modifier-retry\.html/);
    expect(await opener.evaluate(() => history.length)).toBe(historyBefore);
    expect(context.pages()).toHaveLength(pagesBefore + 1);
  } finally {
    await cleanup();
  }
});

test("a child-frame modified anchor keeps its handler without opener allowance @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running modifier navigation E2E tests.");

  const { context, opener, cleanup } = await openFreshScenario();
  try {
    const frame = opener.frameLocator("#child-frame");
    await expect(frame.locator("html")).toHaveAttribute("data-navsentinel-capture-ready", "1");
    await expect(frame.locator("html")).toHaveAttribute("data-navsentinel-bridge-ready", "1");
    const existingPages = new Set(context.pages());

    await frame.locator("#child-control").click({ modifiers: ["Control"], button: "left" });
    await opener.waitForTimeout(1000);
    console.log(
      `[issue566-compat] child-frame: pages=${context.pages()
        .filter((page) => !existingPages.has(page))
        .map((page) => page.url())
        .join(",")} handler=${await frame.locator("body").getAttribute("data-handler-clicks")}`
    );

    expect(
      context.pages().filter((page) => !existingPages.has(page)),
      "Only the child-frame anchor's native modified navigation may open a child"
    ).toHaveLength(1);
    const newPages = context.pages().filter((page) => !existingPages.has(page));
    await Promise.all(newPages.map((page) => page.waitForLoadState("domcontentloaded", { timeout: 10_000 })));
    const cases = new Set(newPages.map((page) => new URL(page.url()).searchParams.get("case")));

    expect(cases).toContain("child-native");
    await expect(frame.locator("body")).toHaveAttribute("data-handler-clicks", "1");
    await expect(opener).toHaveURL(/issue566-modifier-retry\.html/);
  } finally {
    await cleanup();
  }
});

test("an unrelated closed-shadow middle-click reaches its page control @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running modifier navigation E2E tests.");

  const { context, opener, cleanup } = await openFreshScenario();
  try {
    const pagesBefore = context.pages().length;
    const host = opener.locator("#shadow-host");
    await host.scrollIntoViewIfNeeded();
    await expect(host).toHaveAttribute("data-button-x", /\d/);
    const box = await host.boundingBox();
    if (!box) throw new Error("Closed-shadow compatibility host has no clickable box");
    const buttonX = Number(await host.getAttribute("data-button-x"));
    const buttonY = Number(await host.getAttribute("data-button-y"));

    await host.click({ position: { x: buttonX, y: buttonY }, button: "middle" });

    await expect(host).toHaveAttribute("data-button-downs", "1");
    await expect(host).toHaveAttribute("data-auxclicks", "1");
    expect(context.pages()).toHaveLength(pagesBefore);
    await expect(opener.locator("#event-log")).toContainText("closed-shadow unrelated pointerdown button=1 trusted=true");
    await expect(opener.locator("#event-log")).toContainText("closed-shadow unrelated mousedown button=1 trusted=true");
    await expect(opener.locator("#event-log")).toContainText("closed-shadow unrelated mouseup button=1 trusted=true");
    await expect(opener.locator("#event-log")).toContainText("closed-shadow unrelated auxclick button=1 trusted=true");
  } finally {
    await cleanup();
  }
});

test("the actual closed-shadow anchor remains isolated to its native child @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running modifier navigation E2E tests.");

  const { baseUrl, context, opener, cleanup } = await openFreshScenario();
  try {
    const pagesBefore = context.pages().length;
    const historyBefore = await opener.evaluate(() => history.length);
    const host = opener.locator("#shadow-host");
    await host.scrollIntoViewIfNeeded();
    await expect(host).toHaveAttribute("data-anchor-x", /\d/);
    const box = await host.boundingBox();
    if (!box) throw new Error("Closed-shadow compatibility host has no clickable box");
    const anchorX = Number(await host.getAttribute("data-anchor-x"));
    const anchorY = Number(await host.getAttribute("data-anchor-y"));
    await opener.mouse.click(box.x + anchorX, box.y + anchorY, { button: "middle" });
    const child = await waitForIssue566Child(context, baseUrl, "shadow-anchor");

    await child.waitForLoadState("domcontentloaded", { timeout: 10_000 });
    await expect(child).toHaveURL(/issue566-destination\.html\?case=shadow-anchor$/);
    await expect(host).toHaveAttribute("data-anchor-auxclicks", "0");
    await expect(opener).toHaveURL(/issue566-modifier-retry\.html/);
    expect(await opener.evaluate(() => history.length)).toBe(historyBefore);
    expect(context.pages()).toHaveLength(pagesBefore + 1);
  } finally {
    await cleanup();
  }
});
