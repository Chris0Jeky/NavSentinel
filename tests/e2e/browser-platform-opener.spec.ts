import { test, expect, chromium } from "@playwright/test";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

test.setTimeout(120_000);

type OpenerCase = {
  id: string;
  target: "named" | "_blank";
  feature: "sized-popup" | "no-features" | "noopener";
  permitsDomOpener: boolean;
};

type BrowserReceipt = {
  caseId: string;
  target: OpenerCase["target"];
  feature: OpenerCase["feature"];
  sourceTabId: number;
  childTabId: number;
  createdNavigationTarget: {
    sourceTabId: number;
    sourceFrameId: number;
    tabId: number;
    url: string;
  };
  // Diagnostic only: Chromium may expose this again in a future release.
  tabsOpenerTabId: number | null;
  domOpenerNavigationReached: boolean;
};

const openerCases: OpenerCase[] = [
  { id: "named-sized", target: "named", feature: "sized-popup", permitsDomOpener: true },
  { id: "named-default", target: "named", feature: "no-features", permitsDomOpener: true },
  { id: "named-noopener", target: "named", feature: "noopener", permitsDomOpener: false },
  { id: "blank-sized", target: "_blank", feature: "sized-popup", permitsDomOpener: true },
  { id: "blank-default", target: "_blank", feature: "no-features", permitsDomOpener: true },
  { id: "blank-noopener", target: "_blank", feature: "noopener", permitsDomOpener: false },
];

/**
 * Chromium platform contract only: a deliberately tiny MV3 observer receives
 * navigation-target events. No NavSentinel artifact or source is loaded.
 */
test("webNavigation pairs local popup sources when tabs opener metadata is unavailable @regression", async ({}, testInfo) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-opener-contract-"));
  const extensionPath = path.join(root, "observer-extension");
  fs.mkdirSync(extensionPath);
  fs.writeFileSync(path.join(extensionPath, "manifest.json"), JSON.stringify({
    manifest_version: 3,
    name: "Local browser opener contract observer",
    version: "1.0",
    permissions: ["tabs", "webNavigation"],
    background: { service_worker: "worker.js" },
  }));
  fs.writeFileSync(path.join(extensionPath, "worker.js"), `
    globalThis.navigationTargets = [];
    chrome.webNavigation.onCreatedNavigationTarget.addListener((details) => {
      globalThis.navigationTargets.push({
        sourceTabId: details.sourceTabId,
        sourceFrameId: details.sourceFrameId,
        tabId: details.tabId,
        url: details.url,
      });
    });
  `);

  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    const caseId = requestUrl.searchParams.get("case") ?? "";

    if (requestUrl.pathname === "/child") {
      response.end(`<!doctype html><button id="navigate">Navigate local opener</button><script>
        document.querySelector("#navigate").addEventListener("click", () => {
          if (window.opener) window.opener.location = "/sink?case=${caseId}";
          else document.documentElement.dataset.domOpener = "null";
        });
      </script>`);
      return;
    }
    if (requestUrl.pathname === "/sink") {
      response.end(`<!doctype html><main data-local-sink="reached">Local target ${caseId}</main>`);
      return;
    }

    const target = requestUrl.searchParams.get("target") === "named" ? "opener-contract-child" : "_blank";
    const feature = requestUrl.searchParams.get("feature") ?? "no-features";
    const features = feature === "sized-popup"
      ? "width=400,height=300"
      : feature === "noopener"
        ? "width=400,height=300,noopener"
        : "";
    response.end(`<!doctype html><button id="open">Open local child</button><script>
      document.querySelector("#open").addEventListener("click", () => {
        window.open("/child?case=${caseId}", ${JSON.stringify(target)}, ${JSON.stringify(features)});
      });
    </script>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Local opener-contract server did not bind a TCP port");
  const origin = `http://127.0.0.1:${address.port}`;

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
      const parent = await context.newPage();
      const parentUrl = `${origin}/parent?case=${openerCase.id}&target=${openerCase.target === "named" ? "named" : "blank"}&feature=${openerCase.feature}`;
      const childUrl = `${origin}/child?case=${openerCase.id}`;
      await parent.goto(parentUrl, { waitUntil: "domcontentloaded" });

      const popupPromise = context.waitForEvent("page", { timeout: 10_000 });
      await parent.locator("#open").click();
      const child = await popupPromise;
      await child.waitForURL(childUrl, { timeout: 10_000 });

      let observation: {
        parentTab: chrome.tabs.Tab | undefined;
        childTab: chrome.tabs.Tab | undefined;
        target: { sourceTabId: number; sourceFrameId: number; tabId: number; url: string } | undefined;
      } | undefined;
      await expect.poll(async () => {
        observation = await worker.evaluate(async ({ parentUrl, childUrl }) => {
          const tabs = await chrome.tabs.query({});
          const navigationTargets = (globalThis as typeof globalThis & {
            navigationTargets?: Array<{ sourceTabId: number; sourceFrameId: number; tabId: number; url: string }>;
          }).navigationTargets ?? [];
          return {
            parentTab: tabs.find((tab) => tab.url === parentUrl),
            childTab: tabs.find((tab) => tab.url === childUrl),
            target: navigationTargets.find((target) => target.url === childUrl),
          };
        }, { parentUrl, childUrl });
        return observation?.parentTab?.id !== undefined && observation?.childTab?.id !== undefined &&
          observation.target?.sourceTabId === observation.parentTab.id &&
          observation.target.tabId === observation.childTab.id &&
          observation.target.sourceFrameId === 0;
      }, { timeout: 10_000 }).toBe(true);
      if (!observation?.parentTab?.id || !observation.childTab?.id || !observation.target) {
        throw new Error(`No complete navigation-target observation for ${openerCase.id}`);
      }

      await child.locator("#navigate").click();
      if (openerCase.permitsDomOpener) {
        await parent.waitForURL(`${origin}/sink?case=${openerCase.id}`, { timeout: 10_000 });
        await expect(parent.locator("[data-local-sink='reached']")).toBeVisible();
      } else {
        await expect(child.locator("html")).toHaveAttribute("data-dom-opener", "null");
        expect(parent.url()).toBe(parentUrl);
      }

      receipts.push({
        caseId: openerCase.id,
        target: openerCase.target,
        feature: openerCase.feature,
        sourceTabId: observation.parentTab.id,
        childTabId: observation.childTab.id,
        createdNavigationTarget: observation.target,
        tabsOpenerTabId: observation.childTab.openerTabId ?? null,
        domOpenerNavigationReached: openerCase.permitsDomOpener,
      });
      await child.close();
      await parent.close();
    }

    await testInfo.attach("browser-platform-opener-receipt", {
      body: Buffer.from(JSON.stringify({
        browser: context.browser()?.version(),
        scope: "Neutral local MV3 tabs/webNavigation observer; no NavSentinel artifact loaded.",
        tabsOpenerTabId: "Recorded only; not an authority assertion because Chromium may expose it in future releases.",
        cases: receipts,
      }, null, 2)),
      contentType: "application/json",
    });
  } finally {
    if (context) await context.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
