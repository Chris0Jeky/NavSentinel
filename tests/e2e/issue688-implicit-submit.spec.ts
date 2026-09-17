/** #688 regression: a trusted Enter key may implicitly submit a child-frame
 * form even when the form has no submit button. The extension must preserve
 * that exact form intent without creating generic child-frame navigation authority.
 */
import { chromium, expect, test, type Frame } from "@playwright/test";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startProvingGroundEgressFence, type ProvingGroundEgressAttempt } from "./proving_ground_fake_sink";
import { getServiceWorker, readBuiltUiGuardRevision, updateNavigationSettings } from "./extension_test_utils";

const extensionPath = path.resolve(process.env.EXTENSION_PATH ?? "extension/dist");

async function ready(frame: Frame): Promise<void> {
  await frame.waitForFunction(expected =>
    document.documentElement.getAttribute("data-navsentinel-capture-ready") === "1" &&
    document.documentElement.getAttribute("data-navsentinel-bridge-ready") === "1" &&
    document.documentElement.getAttribute("data-navsentinel-ui-guard") === expected,
  readBuiltUiGuardRevision());
}

async function runArm(protectedArm: boolean): Promise<{ attempts: string[]; topUrl: string; sinkOrigin: string }> {
  if (!fs.existsSync(path.join(extensionPath, "manifest.json"))) {
    throw new Error("Build the extension before the #688 keyboard regression; missing builds must not skip.");
  }

  const attempts: string[] = [];
  let sinkOrigin = "";
  const server = http.createServer((request, response) => {
    request.resume();
    const url = new URL(request.url ?? "/", "http://fixture.invalid");
    response.setHeader("cache-control", "no-store");
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.setHeader("x-content-type-options", "nosniff");

    if (url.pathname === "/sink") {
      attempts.push(request.method ?? "");
      response.end("<h1>Implicit keyboard submission received</h1>");
      return;
    }
    if (url.pathname === "/parent") {
      response.end('<!doctype html><meta charset="utf-8"><iframe title="Keyboard form" src="/child"></iframe>');
      return;
    }
    if (url.pathname === "/child") {
      response.end(`<!doctype html><meta charset="utf-8"><title>Keyboard child form</title>
        <form id="f" action="${sinkOrigin}/sink" method="post" target="_top">
          <label>Search locally <input id="q" name="q" autocomplete="off"></label>
        </form>
        <script>document.body.dataset.fixtureReady = "1";</script>`);
      return;
    }
    response.writeHead(404);
    response.end("Missing fixture");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Keyboard fixture did not bind");
  const fixtureOrigin = `http://localhost:${address.port}`;
  sinkOrigin = `http://127.0.0.1:${address.port}`;

  const denied: ProvingGroundEgressAttempt[] = [];
  const fence = await startProvingGroundEgressFence(denied, new Set([fixtureOrigin, sinkOrigin]));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ns-form-keyboard-"));
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    channel: "chromium",
    ...(process.env.NAVSENTINEL_TEST_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.NAVSENTINEL_TEST_CHROMIUM_EXECUTABLE }
      : {}),
    proxy: { server: fence.proxyServer },
    args: [
      "--host-resolver-rules=MAP localhost 127.0.0.1",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-domain-reliability",
      "--disable-quic",
      "--disable-sync",
      "--no-first-run",
      "--metrics-recording-only",
      ...(protectedArm
        ? [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
        : ["--disable-extensions"]),
    ],
  });

  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    if (protectedArm) {
      await getServiceWorker(context);
      await updateNavigationSettings(context, { defaultMode: "smart", debug: true });
    }
    await page.goto(fixtureOrigin + "/parent");
    const frame = page.frames().find(candidate => candidate.url() === fixtureOrigin + "/child");
    if (!frame) throw new Error("Exact keyboard child fixture missing");
    await frame.waitForFunction(() => document.body.dataset.fixtureReady === "1");
    if (protectedArm) {
      await ready(page.mainFrame());
      await ready(frame);
    }

    const input = frame.locator("#q");
    await input.fill("bounded synthetic value");
    await input.press("Enter");

    await expect.poll(() => attempts.length, { timeout: 5000 }).toBe(1);
    await expect.poll(() => page.url(), { timeout: 5000 }).toBe(sinkOrigin + "/sink");
    expect(attempts).toEqual(["POST"]);
    expect(errors).toEqual([]);
    return { attempts: [...attempts], topUrl: page.url(), sinkOrigin };
  } finally {
    await context.close();
    await fence.close();
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

test("@regression #688 preserves a trusted implicit Enter submission without a submit button", async () => {
  test.setTimeout(45000);
  const baseline = await runArm(false);
  expect(baseline.attempts).toEqual(["POST"]);

  const protectedResult = await runArm(true);
  expect(protectedResult.attempts).toEqual(["POST"]);
  expect(protectedResult.topUrl).toBe(protectedResult.sinkOrigin + "/sink");
});
