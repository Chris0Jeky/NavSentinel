/**
 * Regression: SPA routers that reassign history.pushState must not break.
 *
 * Background: main_guard.ts patches History.prototype.pushState/replaceState in
 * the MAIN world at document_start. It used to harden them to non-writable +
 * non-configurable, so strict-mode SPA routers (claude.ai / TanStack Router,
 * React Router, etc.) doing `history.pushState = wrapper` threw
 * "Cannot assign to read only property 'pushState'", aborting router init and
 * leaving a grey screen. They are now installed writable + configurable
 * (softPatchProto) — observational hooks only, so non-writability bought no real
 * defense while breaking legitimate pages.
 *
 * Verified on CI (the agent sandbox cannot launch Chromium).
 */
import { test, expect, chromium } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { getGymBaseUrl, waitForNavSentinelBridge } from "./extension_test_utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(__dirname, "..", "..", "extension", "dist");
const gymRoot = path.resolve(__dirname, "..", "..", "gym");

test.setTimeout(120_000);

test("SPA router can wrap history.pushState without a grey screen @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-pushstate-"));

  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
      ]
    });
  } catch (err) {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw err;
  }

  const pageErrors: string[] = [];
  const page = await context.newPage();
  page.on("pageerror", (err) => pageErrors.push(err.message));

  try {
    await page.goto(`${baseUrl}/pushstate-04-router-wrap.html`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    });
    await waitForNavSentinelBridge(page);

    const historyDescriptors = await page.evaluate(() => ({
      pushStateEnumerable:
        Object.getOwnPropertyDescriptor(History.prototype, "pushState")?.enumerable,
      replaceStateEnumerable:
        Object.getOwnPropertyDescriptor(History.prototype, "replaceState")?.enumerable,
    }));
    expect(historyDescriptors, "history wrappers must preserve native enumerability").toEqual({
      pushStateEnumerable: true,
      replaceStateEnumerable: true,
    });

    // The reassignment must not have thrown — i.e. pushState stayed writable.
    const writable = await page.evaluate(() => document.body.dataset.pushstateWritable);
    expect(writable, "history.pushState must remain writable for SPA routers").toBe("true");

    // The router module rendered the app after wrapping pushState (no grey screen).
    const booted = await page.evaluate(() => document.body.dataset.appBooted);
    expect(booted, "router module must finish after wrapping pushState").toBe("true");

    const appText = await page.locator("#app").textContent();
    expect(appText, "the app must render its routed content").toContain("Dashboard");

    // No uncaught "read only property 'pushState'" TypeError from the wrap.
    const frozenError = pageErrors.find(
      (m) => /read only/i.test(m) && /pushState|replaceState/i.test(m)
    );
    expect(frozenError, `unexpected pushState freeze error: ${frozenError ?? ""}`).toBeUndefined();
  } finally {
    await context.close();
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("a page can wrap and invoke guarded form / location / open methods @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-protowrap-"));

  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
      ]
    });
  } catch (err) {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw err;
  }

  const pageErrors: string[] = [];
  const page = await context.newPage();
  page.on("pageerror", (err) => pageErrors.push(err.message));

  try {
    await page.goto(`${baseUrl}/proto-wrap-05.html`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    });
    await waitForNavSentinelBridge(page);

    // Every changed method stayed writable, so the page's strict wrappers installed.
    await expect.poll(
      () => page.evaluate(() => document.body.dataset.protoWrap),
      { timeout: 2_000 }
    ).toBeTruthy();
    const wrapped = await page.evaluate(() => document.body.dataset.protoWrap);
    expect(wrapped, "guarded methods must remain wrappable").toBeTruthy();
    const parsed = JSON.parse(wrapped ?? "{}") as Record<string, string>;
    expect(parsed.formSubmit).toBe("ok");
    expect(parsed.formRequestSubmit).toBe("ok");
    // Compatibility only: Chromium's own window.location methods bypass any
    // Location.prototype wrapper, so NavSentinel installs none (#458). What
    // must still hold is that a strict-mode page can create/assign the slot
    // without throwing.
    expect(parsed.locationAssign).toBe("ok");
    expect(parsed.locationReplace).toBe("ok");
    expect(parsed.windowOpen).toBe("ok");
    expect(parsed.windowProtoOpen).toBe("ok");

    const descriptors = await page.evaluate(() => ({
      windowOpen: Object.getOwnPropertyDescriptor(window, "open")?.enumerable,
      windowProtoOpen: Object.getOwnPropertyDescriptor(Window.prototype, "open")?.enumerable,
      formSubmit:
        Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, "submit")?.enumerable,
      formRequestSubmit:
        Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, "requestSubmit")?.enumerable,
      locationAssign:
        Object.getOwnPropertyDescriptor(Location.prototype, "assign")?.enumerable,
      locationReplace:
        Object.getOwnPropertyDescriptor(Location.prototype, "replace")?.enumerable,
    }));
    // The four real prototype slots keep the enumerability Chromium shipped.
    // The Location entries are `true` because NOTHING but the page's own plain
    // assignment created them (#458): NavSentinel no longer defines a
    // Location.prototype slot, so the fixture's `Location.prototype.assign = fn`
    // creates a fresh enumerable data property. A `false` here would mean an
    // extension-installed slot came back.
    expect(descriptors, "wrappers must preserve existing native descriptor visibility").toEqual({
      windowOpen: true,
      windowProtoOpen: false,
      formSubmit: true,
      formRequestSubmit: true,
      locationAssign: true,
      locationReplace: true,
    });

    // The module finished (no uncaught throw aborted the app render).
    expect(await page.locator("#app").textContent()).toContain("Booted");

    const wrapperCalls = () =>
      page.evaluate(() =>
        JSON.parse(document.body.dataset.wrapperCalls ?? "{}") as Record<string, number>
      );

    // The page wrapper must stay at the top of the form.submit chain and reach
    // the native target exactly once through js_behavior + main_guard.
    await page.click("#testFormSubmit");
    await expect.poll(
      () => page.evaluate(() => document.body.dataset.formSubmitCall),
      { timeout: 2_000 }
    ).toBe("called");
    await expect.poll(async () => (await wrapperCalls()).formSubmit, { timeout: 2_000 }).toBe(1);
    await expect.poll(
      () => page.evaluate(() => {
        const frame = document.getElementById("submitFrame") as HTMLIFrameElement | null;
        return frame?.contentWindow?.location.href ?? "";
      }),
      { timeout: 2_000 }
    ).toContain("via=submit");

    // requestSubmit has its own guard wrapper. Its native call must dispatch one
    // submit event; the fixture prevents navigation after observing that event.
    await page.click("#testFormRequestSubmit");
    await expect.poll(
      () => page.evaluate(() => document.body.dataset.formRequestSubmitCall),
      { timeout: 2_000 }
    ).toBe("called");
    await expect.poll(async () => (await wrapperCalls()).formRequestSubmit, { timeout: 2_000 }).toBe(1);
    await expect.poll(
      () => page.evaluate(() => document.body.dataset.requestSubmitEvents),
      { timeout: 2_000 }
    ).toBe("1");

    // Chromium has no Location.prototype.assign native, so the fixture's own
    // wrapper is the only thing in that slot and it must be able to reach the
    // browser's own window.location method (#458).
    await page.click("#testLocation");
    await expect.poll(
      () => page.evaluate(() => document.body.dataset.locationCall),
      { timeout: 2_000 }
    ).toBe("called");
    await expect(page).toHaveURL(/#proto-wrap-location$/);
    await expect.poll(async () => (await wrapperCalls()).locationAssign, { timeout: 2_000 }).toBe(1);

    await page.click("#testLocationReplace");
    await expect.poll(
      () => page.evaluate(() => document.body.dataset.locationReplaceCall),
      { timeout: 2_000 }
    ).toBe("called");
    await expect(page).toHaveURL(/#proto-wrap-replace$/);
    await expect.poll(async () => (await wrapperCalls()).locationReplace, { timeout: 2_000 }).toBe(1);

    // The page's arrow wrapper invokes its captured open function unbound.
    // NavSentinel must restore the Window receiver before calling the native.
    await page.click("#testOpen");
    await expect.poll(
      () => page.evaluate(() => document.body.dataset.unboundOpenCall),
      { timeout: 2_000 }
    ).toBe("opened");
    await expect.poll(async () => (await wrapperCalls()).windowOpen, { timeout: 2_000 }).toBe(1);

    await page.click("#testProtoOpen");
    await expect.poll(
      () => page.evaluate(() => document.body.dataset.protoOpenCall),
      { timeout: 2_000 }
    ).toBe("opened");
    await expect.poll(async () => (await wrapperCalls()).windowProtoOpen, { timeout: 2_000 }).toBe(1);

    // Same-origin child windows fail the parent realm's instanceof Window.
    // Preserve the child receiver so the native popup opener remains the child.
    await page.click("#testCrossRealmOpen");
    await expect.poll(
      () => page.evaluate(() => document.body.dataset.crossRealmOpen),
      { timeout: 2_000 }
    ).toBe("child");

    // Only nullish/unbound calls get a default receiver. An arbitrary object
    // must still reach the native brand check and throw Illegal invocation.
    await page.click("#testInvalidOpenReceiver");
    await expect.poll(
      () => page.evaluate(() => document.body.dataset.invalidOpenReceiver),
      { timeout: 2_000 }
    ).toBe("error:TypeError");

    expect(await wrapperCalls(), "each page wrapper should run exactly once").toEqual({
      formSubmit: 1,
      formRequestSubmit: 1,
      locationAssign: 1,
      locationReplace: 1,
      windowOpen: 1,
      windowProtoOpen: 1,
    });

    const frozenError = pageErrors.find(
      (m) => /read only/i.test(m) && /(submit|assign|open)/i.test(m)
    );
    expect(frozenError, `unexpected freeze error: ${frozenError ?? ""}`).toBeUndefined();
  } finally {
    await context.close();
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

/**
 * #458 boundary regression.
 *
 * Chromium implements `Location.assign` / `Location.replace` as
 * `[LegacyUnforgeable]` members: they are OWN properties of every `Location`
 * instance (`writable: false`, `configurable: false`) and the corresponding
 * `Location.prototype` slots do not exist. A MAIN-world script therefore cannot
 * interpose on an ordinary `location.assign(...)` call — ordinary property
 * lookup finds the own method and never consults the prototype — and it cannot
 * replace the own method either.
 *
 * NavSentinel used to install wrappers on `Location.prototype` anyway. That
 * intercepted nothing a real page can produce (an explicit
 * `Location.prototype.assign.call(...)` throws `TypeError` in stock Chromium)
 * while ADDING two prototype properties Chromium does not have — a
 * deterministic extension fingerprint. This test pins the post-#458 state:
 * NavSentinel leaves the Location surface exactly as the browser shipped it.
 *
 * The positive guarantee for script-driven `location` navigation lives in the
 * service worker and is covered by the existing @rollback lane
 * ("Level 10 delayed redirect rolls back to the prior page"), whose gym fixture
 * navigates with a plain `location.assign(...)`.
 */
test("NavSentinel leaves Chromium's own Location methods native (#458) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");

  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-locbound-"));

  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`
      ]
    });
  } catch (err) {
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw err;
  }

  const page = await context.newPage();

  try {
    await page.goto(`${baseUrl}/level1-basic-opacity.html`, {
      waitUntil: "domcontentloaded",
      timeout: 20_000
    });
    await waitForNavSentinelBridge(page);

    const boundary = await page.evaluate(() => {
      // Measured BEFORE anything in this probe touches Location.prototype, so
      // any prototype slot found here was installed by NavSentinel.
      const protoAssign = Object.getOwnPropertyDescriptor(Location.prototype, "assign");
      const protoReplace = Object.getOwnPropertyDescriptor(Location.prototype, "replace");
      const ownAssign = Object.getOwnPropertyDescriptor(window.location, "assign");
      const ownReplace = Object.getOwnPropertyDescriptor(window.location, "replace");

      // A library-style prototype wrap must still be possible without throwing
      // (the #349/#356 compatibility property), and must still not capture an
      // ordinary call.
      let protoWrapAccepted: boolean;
      try {
        (Location.prototype as unknown as Record<string, unknown>).assign =
          function pageWrapper(): void { /* never reached by an ordinary call */ };
        protoWrapAccepted = true;
      } catch {
        protoWrapAccepted = false;
      }

      return {
        navSentinelAddedProtoAssign: protoAssign !== undefined,
        navSentinelAddedProtoReplace: protoReplace !== undefined,
        ownAssignPresent: ownAssign !== undefined,
        ownAssignWritable: ownAssign?.writable,
        ownAssignConfigurable: ownAssign?.configurable,
        ownReplacePresent: ownReplace !== undefined,
        ownReplaceWritable: ownReplace?.writable,
        ownReplaceConfigurable: ownReplace?.configurable,
        // Identity, not navigation: because `assign` is an own property of this
        // Location, `location.assign(...)` provably resolves this function and
        // never the (now page-installed) prototype one.
        ordinaryCallResolvesOwnMethod:
          window.location.assign !== Location.prototype.assign,
        protoWrapAccepted,
      };
    });

    expect(
      boundary,
      "MAIN world must not add Location.prototype slots Chromium does not ship (#458)"
    ).toEqual({
      navSentinelAddedProtoAssign: false,
      navSentinelAddedProtoReplace: false,
      ownAssignPresent: true,
      ownAssignWritable: false,
      ownAssignConfigurable: false,
      ownReplacePresent: true,
      ownReplaceWritable: false,
      ownReplaceConfigurable: false,
      ordinaryCallResolvesOwnMethod: true,
      protoWrapAccepted: true,
    });
  } finally {
    await context.close();
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
