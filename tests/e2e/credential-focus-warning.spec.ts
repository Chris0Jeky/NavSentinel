import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { evaluateInToast, readToastText, waitForNavSentinelBridge, waitForToastMatch } from "./extension_test_utils";

// #1170: a fetch-only login never submits a form, so the only credential
// warning is the password-focus toast. The host resolver maps public-looking
// names onto the local fixture server, so the page really loads over http from
// a non-local host. No proxy fence: the fence resolves names itself and would
// bypass the mapping; foreign http(s) requests are aborted by the route below.
const RISKY = "risky-login.example";
const INTRANET = "mail.internal";

// The toast's shadow root is closed (#1142), so read it through the CDP helper.
async function toastButtons(page: Page): Promise<string[]> {
  return evaluateInToast(page, (roots) =>
    Array.from(roots[0]?.querySelectorAll("button") ?? []).map((b) => b.textContent ?? ""));
}

test("password focus warns on a risky http address and not on an intranet one (#1170) @regression", async () => {
  test.setTimeout(90_000);
  const extensionPath = path.resolve("extension/dist");
  test.skip(!fs.existsSync(extensionPath), "Build the extension first.");
  const gym = path.resolve("gym");
  const server = http.createServer((request, response) => {
    const name = path.basename(new URL(request.url ?? "/", "http://x").pathname);
    const file = path.join(gym, name);
    if (!/^fetch-login-(?:phish|benign)\.html$/.test(name) || !fs.existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(fs.readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing local fixture address");
  const allowed = new Set([`http://${RISKY}:${address.port}`, `http://${INTRANET}:${address.port}`]);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ns-focus-warning-"));
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: false,
      args: ["--disable-background-networking", "--disable-quic", "--no-first-run",
        `--host-resolver-rules=MAP ${RISKY} 127.0.0.1, MAP ${INTRANET} 127.0.0.1`,
        `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await context.route("**/*", (route) => {
      const target = new URL(route.request().url());
      return ["http:", "https:"].includes(target.protocol) && !allowed.has(target.origin)
        ? route.abort("blockedbyclient") : route.continue();
    });

    const risky = await context.newPage();
    await risky.goto(`http://${RISKY}:${address.port}/fetch-login-phish.html`);
    await waitForNavSentinelBridge(risky);
    await risky.bringToFront();
    await risky.click("#password");
    const text = await waitForToastMatch(risky, /looks risky for a password/, 8000);
    expect(text).toContain("the sign-in page was not using HTTPS");
    expect(await toastButtons(risky)).toEqual(["Dismiss"]);

    const intranet = await context.newPage();
    await intranet.goto(`http://${INTRANET}:${address.port}/fetch-login-benign.html`);
    await waitForNavSentinelBridge(intranet);
    await intranet.bringToFront();
    await intranet.click("#password");
    await intranet.waitForTimeout(2000);
    expect(await readToastText(intranet)).toBeNull();
  } finally {
    await context?.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
