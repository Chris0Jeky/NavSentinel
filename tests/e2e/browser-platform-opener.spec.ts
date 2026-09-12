import { test, expect, chromium } from "@playwright/test";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

test.setTimeout(120_000);

type OpenerTarget = "named" | "_blank";
type ChildOrigin = "same-origin" | "cross-origin";
type NavigationMethod = "location" | "href" | "assign" | "replace";
type ParentNavigationExpectation = "sink-commit" | "browser-dependent" | "no-opener";

type OpenerCase = {
  id: string;
  target: OpenerTarget;
  childOrigin: ChildOrigin;
  navigationMethod: NavigationMethod;
  noopener: boolean;
  parentNavigationExpectation: ParentNavigationExpectation;
};

type NavigationTarget = {
  sourceTabId: number;
  sourceFrameId: number;
  tabId: number;
  url: string;
};

type NavigationCommit = {
  tabId: number;
  frameId: number;
  url: string;
  transitionType: string;
  transitionQualifiers: string[];
};

type BrowserReceipt = {
  caseId: string;
  target: OpenerTarget;
  childOrigin: ChildOrigin;
  navigationMethod: NavigationMethod;
  noopener: boolean;
  source: { tabId: number; url: string };
  child: { tabId: number; url: string };
  createdNavigationTarget: NavigationTarget;
  // Diagnostic only: Chromium may expose this again in a future release.
  tabsOpenerTabId: number | null;
  childNavigation: {
    result: "attempted" | "rejected" | "no-opener";
    errorName: string | null;
  };
  parentSinkCommit: NavigationCommit | null;
};

const openerCases: OpenerCase[] = [
  { id: "same-origin-location-named", target: "named", childOrigin: "same-origin", navigationMethod: "location", noopener: false, parentNavigationExpectation: "sink-commit" },
  { id: "same-origin-href-blank", target: "_blank", childOrigin: "same-origin", navigationMethod: "href", noopener: false, parentNavigationExpectation: "sink-commit" },
  { id: "same-origin-assign-named", target: "named", childOrigin: "same-origin", navigationMethod: "assign", noopener: false, parentNavigationExpectation: "sink-commit" },
  { id: "same-origin-replace-blank", target: "_blank", childOrigin: "same-origin", navigationMethod: "replace", noopener: false, parentNavigationExpectation: "sink-commit" },
  { id: "cross-origin-location-named", target: "named", childOrigin: "cross-origin", navigationMethod: "location", noopener: false, parentNavigationExpectation: "sink-commit" },
  { id: "cross-origin-href-blank", target: "_blank", childOrigin: "cross-origin", navigationMethod: "href", noopener: false, parentNavigationExpectation: "sink-commit" },
  { id: "cross-origin-assign-named", target: "named", childOrigin: "cross-origin", navigationMethod: "assign", noopener: false, parentNavigationExpectation: "browser-dependent" },
  { id: "cross-origin-replace-blank", target: "_blank", childOrigin: "cross-origin", navigationMethod: "replace", noopener: false, parentNavigationExpectation: "browser-dependent" },
  { id: "noopener-location-named", target: "named", childOrigin: "same-origin", navigationMethod: "location", noopener: true, parentNavigationExpectation: "no-opener" },
  { id: "noopener-href-blank", target: "_blank", childOrigin: "same-origin", navigationMethod: "href", noopener: true, parentNavigationExpectation: "no-opener" },
];

/**
 * Chromium platform contract only: a deliberately tiny MV3 observer receives
 * navigation-target and commit events. No NavSentinel artifact or source is loaded.
 */
test("webNavigation attributes local opener navigation and parent sink commits @regression", async ({}, testInfo) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-opener-contract-"));
  const extensionPath = path.join(root, "observer-extension");
  fs.mkdirSync(extensionPath);
  fs.writeFileSync(path.join(extensionPath, "manifest.json"), JSON.stringify({
    manifest_version: 3,
    name: "Local browser opener contract observer",
    version: "1.0",
    permissions: ["tabs", "webNavigation"],
    host_permissions: ["http://127.0.0.1/*"],
    background: { service_worker: "worker.js" },
  }));
  fs.writeFileSync(path.join(extensionPath, "worker.js"), `
    globalThis.navigationTargets = [];
    globalThis.navigationCommits = [];
    chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
      globalThis.navigationTargets.push({
        sourceTabId: details.sourceTabId,
        sourceFrameId: details.sourceFrameId,
        tabId: details.tabId,
        url: details.url,
      });
    });
    chrome.webNavigation.onCommitted.addListener((details) => {
      globalThis.navigationCommits.push({
        tabId: details.tabId,
        frameId: details.frameId,
        url: details.url,
        transitionType: details.transitionType,
        transitionQualifiers: details.transitionQualifiers,
      });
    });
  `);

  const fixtureHandler = (request: http.IncomingMessage, response: http.ServerResponse) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    const caseId = requestUrl.searchParams.get("case") ?? "";
    if (requestUrl.pathname === "/child") {
      const navigationMethod = requestUrl.searchParams.get("method") ?? "";
      const sinkUrl = requestUrl.searchParams.get("sink") ?? "";
      response.end(`<!doctype html><button id="navigate">Navigate local opener</button><script>
        const navigationMethod = ${JSON.stringify(navigationMethod)};
        const sinkUrl = ${JSON.stringify(sinkUrl)};
        document.querySelector("#navigate").addEventListener("click", () => {
          if (!window.opener) {
            document.documentElement.dataset.openerNavigation = "no-opener";
            return;
          }
          try {
            switch (navigationMethod) {
              case "location": window.opener.location = sinkUrl; break;
              case "href": window.opener.location.href = sinkUrl; break;
              case "assign": window.opener.location.assign(sinkUrl); break;
              case "replace": window.opener.location.replace(sinkUrl); break;
              default: throw new Error("Unsupported opener navigation method: " + navigationMethod);
            }
            document.documentElement.dataset.openerNavigation = "attempted";
          } catch (error) {
            document.documentElement.dataset.openerNavigation = "rejected";
            document.documentElement.dataset.openerNavigationError =
              error instanceof Error ? error.name : "UnknownError";
          }
        });
      </script>`);
      return;
    }
    if (requestUrl.pathname === "/sink") {
      response.end(`<!doctype html><main data-local-sink="reached">Local target ${caseId}</main>`);
      return;
    }
    if (requestUrl.pathname !== "/parent") {
      response.statusCode = 404;
      response.end("Unknown local opener-contract fixture path");
      return;
    }

    const target = requestUrl.searchParams.get("target") === "named" ? "opener-contract-child" : "_blank";
    const childOrigin = requestUrl.searchParams.get("childOrigin") ?? "";
    const navigationMethod = requestUrl.searchParams.get("method") ?? "";
    const sinkUrl = requestUrl.searchParams.get("sink") ?? "";
    const noopener = requestUrl.searchParams.get("noopener") === "true";
    const childUrl = new URL("/child", childOrigin);
    childUrl.search = new URLSearchParams({ case: caseId, method: navigationMethod, sink: sinkUrl }).toString();
    const features = noopener ? "popup,width=400,height=300,noopener" : "popup,width=400,height=300";
    response.end(`<!doctype html><button id="open">Open local child</button><script>
      document.querySelector("#open").addEventListener("click", () => {
        window.open(${JSON.stringify(childUrl.toString())}, ${JSON.stringify(target)}, ${JSON.stringify(features)});
      });
    </script>`);
  };

  const parentServer = http.createServer(fixtureHandler);
  const childServer = http.createServer(fixtureHandler);
  await Promise.all([
    new Promise<void>((resolve) => parentServer.listen(0, "127.0.0.1", resolve)),
    new Promise<void>((resolve) => childServer.listen(0, "127.0.0.1", resolve)),
  ]);
  const parentAddress = parentServer.address();
  const childAddress = childServer.address();
  if (!parentAddress || typeof parentAddress === "string" || !childAddress || typeof childAddress === "string") {
    throw new Error("Local opener-contract servers did not bind TCP ports");
  }
  const parentOrigin = `http://127.0.0.1:${parentAddress.port}`;
  const crossOrigin = `http://127.0.0.1:${childAddress.port}`;

  let context: import("@playwright/test").BrowserContext | undefined;
  const receipts: BrowserReceipt[] = [];
  try {
    context = await chromium.launchPersistentContext(path.join(root, "profile"), {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");

    for (const openerCase of openerCases) {
      const childOrigin = openerCase.childOrigin === "same-origin" ? parentOrigin : crossOrigin;
      const sinkUrl = `${parentOrigin}/sink?case=${openerCase.id}`;
      const parentUrl = new URL("/parent", parentOrigin);
      parentUrl.search = new URLSearchParams({
        case: openerCase.id,
        target: openerCase.target === "named" ? "named" : "blank",
        childOrigin,
        method: openerCase.navigationMethod,
        sink: sinkUrl,
        noopener: String(openerCase.noopener),
      }).toString();
      const childUrl = new URL("/child", childOrigin);
      childUrl.search = new URLSearchParams({ case: openerCase.id, method: openerCase.navigationMethod, sink: sinkUrl }).toString();

      const parent = await context.newPage();
      await parent.goto(parentUrl.toString(), { waitUntil: "domcontentloaded" });
      const popupPromise = context.waitForEvent("page", { timeout: 10_000 });
      await parent.locator("#open").click();
      const child = await popupPromise;
      await child.waitForURL(childUrl.toString(), { timeout: 10_000 });

      let observation: {
        parentTab: chrome.tabs.Tab | undefined;
        childTab: chrome.tabs.Tab | undefined;
        target: NavigationTarget | undefined;
      } | undefined;
      await expect.poll(async () => {
        observation = await worker.evaluate(async ({ parentUrl, childUrl }) => {
          const tabs = await chrome.tabs.query({});
          const navigationTargets = (globalThis as typeof globalThis & { navigationTargets?: NavigationTarget[] }).navigationTargets ?? [];
          return {
            parentTab: tabs.find((tab) => tab.url === parentUrl),
            childTab: tabs.find((tab) => tab.url === childUrl),
            target: navigationTargets.find((target) => target.url === childUrl),
          };
        }, { parentUrl: parentUrl.toString(), childUrl: childUrl.toString() });
        return observation?.parentTab?.id !== undefined && observation?.childTab?.id !== undefined &&
          observation.target?.sourceTabId === observation.parentTab.id &&
          observation.target.tabId === observation.childTab.id &&
          observation.target.sourceFrameId === 0;
      }, { timeout: 10_000 }).toBe(true);
      if (observation?.parentTab?.id === undefined || observation.childTab?.id === undefined || !observation.target) {
        throw new Error(`No complete navigation-target observation for ${openerCase.id}`);
      }
      const parentTabId = observation.parentTab.id;

      const readParentSinkCommit = () => worker.evaluate(({ parentTabId, sinkUrl }) => {
        const navigationCommits = (globalThis as typeof globalThis & { navigationCommits?: NavigationCommit[] }).navigationCommits ?? [];
        return navigationCommits.find((commit) => commit.tabId === parentTabId && commit.frameId === 0 && commit.url === sinkUrl);
      }, { parentTabId, sinkUrl });
      const waitForParentSinkCommit = async () => {
        let parentSinkCommit: NavigationCommit | undefined;
        await expect.poll(async () => {
          parentSinkCommit = await readParentSinkCommit();
          return parentSinkCommit !== undefined;
        }, { timeout: 10_000 }).toBe(true);
        if (!parentSinkCommit) throw new Error(`No parent sink navigation commit for ${openerCase.id}`);
        return parentSinkCommit;
      };

      await child.locator("#navigate").click();
      await expect(child.locator("html")).toHaveAttribute("data-opener-navigation", /^(attempted|rejected|no-opener)$/);
      const childNavigationResult = await child.locator("html").getAttribute("data-opener-navigation");
      const childNavigationError = await child.locator("html").getAttribute("data-opener-navigation-error");
      if (childNavigationResult !== "attempted" && childNavigationResult !== "rejected" && childNavigationResult !== "no-opener") {
        throw new Error(`No deterministic opener-navigation result for ${openerCase.id}`);
      }

      let parentSinkCommit: NavigationCommit | null = null;
      if (openerCase.parentNavigationExpectation === "sink-commit") {
        expect(childNavigationResult).toBe("attempted");
        parentSinkCommit = await waitForParentSinkCommit();
        await expect(parent).toHaveURL(sinkUrl, { timeout: 10_000 });
        await expect(parent.locator("[data-local-sink='reached']")).toBeVisible();
      } else if (openerCase.parentNavigationExpectation === "browser-dependent" && childNavigationResult === "attempted") {
        parentSinkCommit = await waitForParentSinkCommit();
        await expect(parent).toHaveURL(sinkUrl, { timeout: 10_000 });
        await expect(parent.locator("[data-local-sink='reached']")).toBeVisible();
      } else {
        if (openerCase.parentNavigationExpectation === "no-opener") {
          expect(childNavigationResult).toBe("no-opener");
        } else {
          expect(childNavigationResult).toBe("rejected");
        }
        await child.waitForTimeout(100);
        await expect(parent).toHaveURL(parentUrl.toString());
        expect(await readParentSinkCommit()).toBeUndefined();
      }

      receipts.push({
        caseId: openerCase.id,
        target: openerCase.target,
        childOrigin: openerCase.childOrigin,
        navigationMethod: openerCase.navigationMethod,
        noopener: openerCase.noopener,
        source: { tabId: observation.parentTab.id, url: observation.parentTab.url ?? parentUrl.toString() },
        child: { tabId: observation.childTab.id, url: observation.childTab.url ?? childUrl.toString() },
        createdNavigationTarget: observation.target,
        tabsOpenerTabId: observation.childTab.openerTabId ?? null,
        childNavigation: { result: childNavigationResult, errorName: childNavigationError },
        parentSinkCommit,
      });
      await child.close();
      await parent.close();
    }

    await testInfo.attach("browser-platform-opener-receipt", {
      body: Buffer.from(JSON.stringify({
        browser: context.browser()?.version(),
        scope: "Neutral local MV3 tabs/webNavigation observer; no NavSentinel artifact loaded.",
        crossOriginAssignReplace: "A receipt records either a rejected child operation or the actual parent-tab sink commit; the test does not force one Chromium outcome.",
        tabsOpenerTabId: "Recorded only; not an authority assertion because Chromium may expose it in future releases.",
        cases: receipts,
      }, null, 2)),
      contentType: "application/json",
    });
  } finally {
    if (context) await context.close();
    await Promise.all([
      new Promise<void>((resolve, reject) => parentServer.close((error) => error ? reject(error) : resolve())),
      new Promise<void>((resolve, reject) => childServer.close((error) => error ? reject(error) : resolve())),
    ]);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
