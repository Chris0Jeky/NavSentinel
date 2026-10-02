import { test, expect, chromium, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  getServiceWorker,
  readBuiltUiGuardRevision,
  updateNavigationSettings,
  waitForNavSentinelBridge,
} from "./extension_test_utils";
import { startProvingGroundEgressFence, type ProvingGroundEgressAttempt } from "./proving_ground_fake_sink";

type ChildEntry = { openerTabId: number; createdAt: number; openerNavObserved: boolean };
type LoggedEvent = { kind?: string; reasons?: string[] };

async function snapshot(context: BrowserContext) {
  const worker = await getServiceWorker(context);
  return worker.evaluate(async () => {
    const session = await chrome.storage.session.get("ns_sw:childWindow");
    const local = await chrome.storage.local.get("sentinelsuite:event_log_v1");
    return {
      children: (session["ns_sw:childWindow"] ?? {}) as Record<string, ChildEntry>,
      events: (local["sentinelsuite:event_log_v1"] ?? []) as LoggedEvent[],
      tabs: await chrome.tabs.query({}),
    };
  });
}

const hasDoubleClickSignal = (events: LoggedEvent[]) => events.some(
  event => event.kind === "dblclickjack_detected" && event.reasons?.includes("nrs_double_click_hijack"),
);

// A subfeature contract, not a cross-document or pre-harm protection claim.
for (const arm of ["opener-write", "benign-close", "noopener"] as const) {
  test(`HTTP popup child registration: ${arm} @regression`, async ({}, testInfo) => {
    test.setTimeout(60_000);
    const extensionPath = path.resolve("extension/dist");
    test.skip(!fs.existsSync(extensionPath), "Build the extension first.");
    const server = http.createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      if (url.pathname === "/child") {
        response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Local HTTP child</title>
          <body><button id="write">Change local opener fragment</button><button id="close">Close child</button>
          <script>
            document.querySelector('#write').addEventListener('click', event => {
              document.body.dataset.writeTrusted = String(event.isTrusted);
              if (!window.opener) { document.body.dataset.writeResult = 'no-opener'; return; }
              window.opener.location.href = new URL('/parent?arm=${arm}#stage2', location.href).href;
              document.body.dataset.writeResult = 'attempted';
            });
            document.querySelector('#close').addEventListener('click', () => window.close());
          </script></body></html>`);
        return;
      }
      response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Local parent</title>
        <body><button id="open-child">Open HTTP child</button><button id="second" hidden>Second local control</button>
        <script>
          document.querySelector('#open-child').addEventListener('click', event => {
            document.body.dataset.firstTrusted = String(event.isTrusted);
            document.body.dataset.firstAt = String(Date.now());
            window.open('/child', '_blank', 'width=400,height=300${arm === "noopener" ? ",noopener" : ""}');
            document.querySelector('#open-child').hidden = true;
            document.querySelector('#second').hidden = false;
          });
          document.querySelector('#second').addEventListener('click', event => {
            document.body.dataset.secondTrusted = String(event.isTrusted);
            document.body.dataset.secondAt = String(Date.now());
          });
        </script></body></html>`);
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing HTTP fixture address");
    const origin = `http://127.0.0.1:${address.port}`;
    const denied: ProvingGroundEgressAttempt[] = [];
    const fence = await startProvingGroundEgressFence(denied, new Set([origin]));
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ns-child-registration-"));
    let context: BrowserContext | undefined;
    const receipt: Record<string, unknown> = { arm, guard: readBuiltUiGuardRevision(), denied };
    try {
      context = await chromium.launchPersistentContext(profile, {
        headless: false,
        proxy: { server: fence.proxyServer },
        args: ["--disable-background-networking", "--disable-quic", "--no-first-run",
          `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
      });
      await context.route("**/*", route => {
        const target = new URL(route.request().url());
        return ["http:", "https:"].includes(target.protocol) && target.origin !== origin
          ? route.abort("blockedbyclient") : route.continue();
      });
      await updateNavigationSettings(context, { defaultMode: "smart" });
      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on("pageerror", error => pageErrors.push(error.stack ?? error.message));
      receipt.pageErrors = pageErrors;
      await page.goto(`${origin}/parent?arm=${arm}`);
      await waitForNavSentinelBridge(page);
      await page.waitForTimeout(6_000); // Typed-origin navigation freshness expires before the first input.
      const childPromise = context.waitForEvent("page", { timeout: 5_000 });
      await page.locator("#open-child").click();
      expect(pageErrors, "opening the local popup must not throw").toEqual([]);
      const child = await childPromise;
      await child.waitForLoadState("domcontentloaded");
      await waitForNavSentinelBridge(child);
      expect(await page.getAttribute("body", "data-first-trusted")).toBe("true");
      const before = await snapshot(context);
      const parentTab = before.tabs.find(tab => tab.url === page.url());
      const childTab = before.tabs.find(tab => tab.url === child.url());
      expect(parentTab?.id).toBeDefined();
      expect(childTab?.id).toBeDefined();
      const childId = String(childTab!.id);
      await expect.poll(async () => (await snapshot(context!)).children[childId]?.openerTabId).toBe(parentTab!.id);
      expect((await snapshot(context)).children[childId]?.openerNavObserved).toBe(false);
      receipt.creation = { parentTab, childTab, children: (await snapshot(context)).children };
      expect(await child.evaluate(() => Boolean(window.opener))).toBe(arm !== "noopener");
      if (arm !== "benign-close") {
        await child.locator("#write").click();
        expect(await child.getAttribute("body", "data-write-trusted")).toBe("true");
        expect(await child.getAttribute("body", "data-write-result")).toBe(arm === "noopener" ? "no-opener" : "attempted");
      }
      if (arm === "opener-write") {
        await expect.poll(async () => (await snapshot(context!)).children[childId]?.openerNavObserved).toBe(true);
        await expect(page).toHaveURL(/#stage2$/);
      } else {
        expect((await snapshot(context)).children[childId]?.openerNavObserved).toBe(false);
        await expect(page).toHaveURL(`${origin}/parent?arm=${arm}`);
      }
      receipt.beforeClose = await snapshot(context);
      const closed = child.waitForEvent("close");
      await child.locator("#close").click();
      await closed;
      await expect.poll(async () => (await snapshot(context!)).children[childId]).toBeUndefined();
      expect(hasDoubleClickSignal((await snapshot(context)).events), "creation, write and close have not yet attributed a click").toBe(false);
      await page.locator("#second").click();
      expect(await page.evaluate(() => Date.now() - Number(document.body.dataset.firstAt)),
        "the later input must occur inside the five-second correlation window").toBeLessThan(5_000);
      if (arm === "opener-write") {
        await expect.poll(async () => hasDoubleClickSignal((await snapshot(context!)).events)).toBe(true);
      } else {
        expect(await page.getAttribute("body", "data-second-trusted")).toBe("true");
        await page.waitForTimeout(300);
        expect(hasDoubleClickSignal((await snapshot(context)).events)).toBe(false);
      }
      receipt.final = await snapshot(context);
    } finally {
      if (context) receipt.last = await snapshot(context).catch(error => ({ error: String(error) }));
      await testInfo.attach("child-registration", { body: Buffer.from(JSON.stringify(receipt, null, 2)), contentType: "application/json" });
      await context?.close();
      await fence.close();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      fs.rmSync(profile, { recursive: true, force: true });
    }
  });
}
