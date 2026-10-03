import { test, expect, chromium, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { getServiceWorker, updateNavigationSettings, waitForNavSentinelBridge } from "./extension_test_utils";
import { startProvingGroundEgressFence, type ProvingGroundEgressAttempt } from "./proving_ground_fake_sink";

type Method = "href" | "direct" | "assign" | "replace";
type ChildEntry = { openerTabId: number; openerNavObserved: boolean };

async function childState(context: BrowserContext) {
  return (await getServiceWorker(context)).evaluate(async () => ({
    children: (await chrome.storage.session.get("ns_sw:childWindow"))["ns_sw:childWindow"] as Record<string, ChildEntry>,
    tabs: await chrome.tabs.query({}),
  }));
}

for (const crossOrigin of [false, true]) {
  for (const method of ["href", "direct", "assign", "replace"] as const satisfies readonly Method[]) {
    test(`native opener Location ${method}, crossOrigin=${crossOrigin} @regression`, async ({}, info) => {
      test.setTimeout(75_000);
      const extensionPath = path.resolve(process.env.EXTENSION_PATH ?? "extension/dist");
      test.skip(!fs.existsSync(extensionPath), "Build the extension first.");
      const profileRoot = path.resolve("artifacts/opener-native-profiles");
      fs.mkdirSync(profileRoot, { recursive: true });
      info.annotations.push({ type: "setup", description: "starting local fixture servers" });
      let parentOrigin = "";
      let childOrigin = "";
      const handler: http.RequestListener = (request, response) => {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        if (request.url?.startsWith("/child")) {
          response.end(`<!doctype html><body><button id="navigate">Navigate opener</button><script>
            document.querySelector('#navigate').addEventListener('click', event => {
              document.body.dataset.trusted = String(event.isTrusted);
              try {
                const target = ${JSON.stringify(`${parentOrigin}/parent#observed`)};
                if (${JSON.stringify(method)} === 'href') window.opener.location.href = target;
                else if (${JSON.stringify(method)} === 'direct') window.opener.location = target;
                else window.opener.location[${JSON.stringify(method)}](target);
                document.body.dataset.result = 'returned';
              } catch (error) {
                document.body.dataset.result = 'threw';
                document.body.dataset.errorName = error.name;
                document.body.dataset.error = String(error);
              }
            });</script>`);
        } else {
          response.end(`<!doctype html><body><button id="open-child">Open child</button><script>
            document.querySelector('#open-child').addEventListener('click', () => {
              window.open(${JSON.stringify(`${crossOrigin ? childOrigin : parentOrigin}/child`)}, '_blank', 'width=400,height=300');
            });</script>`);
        }
      };
      const servers = [http.createServer(handler), http.createServer(handler)];
      for (const server of servers) await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      parentOrigin = `http://127.0.0.1:${(servers[0]!.address() as { port: number }).port}`;
      childOrigin = `http://127.0.0.1:${(servers[1]!.address() as { port: number }).port}`;
      const denied: ProvingGroundEgressAttempt[] = [];
      const fence = await startProvingGroundEgressFence(denied, new Set([parentOrigin, childOrigin]));
      const arms: Record<string, unknown>[] = [];
      try {
        for (const protectedArm of [false, true]) {
          // Keep disposable Chrome profile paths short on Windows; trace output
          // paths include the full test title and can exceed native path limits.
          const profile = fs.mkdtempSync(path.join(profileRoot, "case-"));
          if (!path.resolve(profile).startsWith(profileRoot + path.sep)) throw new Error("Profile escaped owned test artifact root");
          let context: BrowserContext | undefined;
          try {
            info.annotations.push({ type: "setup", description: `launching protected=${protectedArm}, profile=${profile}` });
            context = await chromium.launchPersistentContext(profile, {
              headless: false,
              ...(protectedArm ? {} : process.env.NAVSENTINEL_BRANDED_CHROME ? { channel: "chrome" as const } : {}),
              proxy: { server: fence.proxyServer },
              args: ["--disable-background-networking", "--disable-quic", "--no-first-run",
                ...(protectedArm ? [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] : [])],
            });
            info.annotations.push({ type: "setup", description: `launched protected=${protectedArm}` });
            await context.route("**/*", route => {
              const url = new URL(route.request().url());
              return ["http:", "https:"].includes(url.protocol) && ![parentOrigin, childOrigin].includes(url.origin)
                ? route.abort("blockedbyclient") : route.continue();
            });
            if (protectedArm) await updateNavigationSettings(context, { defaultMode: "smart" });
            const parent = await context.newPage();
            await parent.goto(`${parentOrigin}/parent`);
            if (protectedArm) await waitForNavSentinelBridge(parent);
            await parent.waitForTimeout(6_000);
            const popupPromise = context.waitForEvent("page", { timeout: 5_000 });
            await parent.locator("#open-child").click();
            const child = await popupPromise;
            await child.waitForLoadState("domcontentloaded");
            if (protectedArm) await waitForNavSentinelBridge(child);
            expect(await child.evaluate(() => Boolean(window.opener))).toBe(true);
            const stringify = await child.evaluate(() => {
              try { return { value: String(window.opener.location), stableAssign: window.opener.location.assign === window.opener.location.assign }; }
              catch (error) { return { errorName: (error as Error).name }; }
            });
            if (!crossOrigin) {
              expect(stringify).toEqual({ value: `${parentOrigin}/parent`, stableAssign: true });
            } else {
              expect(stringify.errorName).toBe("SecurityError");
            }
            let childId: string | undefined;
            if (protectedArm) {
              const initial = await childState(context);
              childId = String(initial.tabs.find(tab => tab.url === child.url())?.id);
              expect(childId).not.toBe("undefined");
              await expect.poll(async () => (await childState(context!)).children[childId!]?.openerNavObserved).toBe(false);
            }
            await child.locator("#navigate").click();
            const attempt = await child.locator("body").evaluate(body => ({ ...body.dataset }));
            expect(attempt.trusted).toBe("true");
            const nativeRejected = crossOrigin && method === "assign";
            expect(attempt.result, attempt.error).toBe(nativeRejected ? "threw" : "returned");
            if (nativeRejected) {
              expect(attempt.errorName).toBe("SecurityError");
              await expect(parent).toHaveURL(`${parentOrigin}/parent`);
            } else {
              await expect(parent).toHaveURL(`${parentOrigin}/parent#observed`);
            }
            if (protectedArm) {
              await expect.poll(async () => (await childState(context!)).children[childId!]?.openerNavObserved).toBe(!nativeRejected);
            }
            arms.push({ protectedArm, browser: context.browser()?.version(), stringify, attempt, parentUrl: parent.url(),
              session: protectedArm ? await childState(context) : undefined });
          } finally {
            await context?.close();
            if (fs.existsSync(profile)) fs.rmSync(profile, { recursive: true });
          }
        }
      } finally {
        await info.attach("opener-location-native", { body: Buffer.from(JSON.stringify({ method, crossOrigin, arms, denied,
          scope: "Local trusted-input native method compatibility and observation; no document replacement or pre-harm prevention claim." }, null, 2)), contentType: "application/json" });
        await fence.close();
        for (const server of servers) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }
    });
  }
}
