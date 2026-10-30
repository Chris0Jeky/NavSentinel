import { test, expect, chromium, type BrowserContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { assertNoToastFor, waitForNavSentinelBridge, waitForToastMatch } from "./extension_test_utils";

// #1222 end to end in real Chrome: the service worker's onCommitted decision (source page,
// transition type, device-page match) and the delivery to the device page's content script.
// microsoft.com and a lure host are mapped onto a local HTTPS server with a throwaway
// self-signed certificate minted per run (certificate errors ignored for this context).
const LURE = "lure-docs.com";
const DEVICE = "/devicelogin";

function mintCertificate(dir: string): { key: Buffer; cert: Buffer } | null {
  try {
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
      "-keyout", path.join(dir, "k.pem"), "-out", path.join(dir, "c.pem"),
      "-subj", "/CN=localhost", "-addext", `subjectAltName=DNS:microsoft.com,DNS:${LURE}`], { stdio: "ignore" });
    return { key: fs.readFileSync(path.join(dir, "k.pem")), cert: fs.readFileSync(path.join(dir, "c.pem")) };
  } catch {
    return null;
  }
}

test("a lure link to microsoft.com/devicelogin warns on the device page; a typed visit does not (#1222) @regression", async () => {
  test.setTimeout(90_000);
  const extensionPath = path.resolve("extension/dist");
  test.skip(!fs.existsSync(extensionPath), "Build the extension first.");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ns-devicecode-"));
  const tls = mintCertificate(tmp);
  test.skip(!tls, "openssl is needed to mint the throwaway certificate.");
  const server = https.createServer(tls!, (request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    if ((request.url ?? "").startsWith(DEVICE)) {
      response.end("<!doctype html><title>Enter code</title><p>Enter the code displayed on your app or device.</p><input aria-label=code>");
    } else {
      response.end(`<!doctype html><title>Shared document</title><p>Enter code QX7-PL2 to open the document.</p><a id="go" href="https://microsoft.com:${(server.address() as { port: number }).port}${DEVICE}">Open</a>`);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const profile = path.join(tmp, "profile");
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: false,
      ignoreHTTPSErrors: true,
      args: ["--disable-background-networking", "--disable-quic", "--no-first-run",
        `--host-resolver-rules=MAP microsoft.com 127.0.0.1, MAP ${LURE} 127.0.0.1`,
        `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await context.route("**/*", (route) => {
      const host = new URL(route.request().url()).hostname;
      return ["http:", "https:"].includes(new URL(route.request().url()).protocol) && host !== "microsoft.com" && host !== LURE
        ? route.abort("blockedbyclient") : route.continue();
    });

    const page = await context.newPage();
    await page.goto(`https://${LURE}:${port}/doc`);
    await waitForNavSentinelBridge(page);
    await Promise.all([page.waitForURL(`**${DEVICE}`), page.click("#go")]);
    await waitForNavSentinelBridge(page);
    await waitForToastMatch(page, /lure-docs\.com sent you to this device sign-in page/i, 10_000);

    // Typed into the address bar (no source page): stays silent by design.
    const typed = await context.newPage();
    await typed.goto(`https://microsoft.com:${port}${DEVICE}`);
    await waitForNavSentinelBridge(typed);
    await assertNoToastFor(typed, 2_000);
    expect(typed.url()).toContain(DEVICE);
  } finally {
    await context?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
