import { test, chromium, type BrowserContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { assertNoToastFor, waitForNavSentinelBridge, waitForToastMatch } from "./extension_test_utils";

// #1247 end to end: Microsoft's sign-in password field (id i0118, name passwd) focused on a
// host that is not Microsoft's raises the warning; the same form on login.microsoftonline.com
// does not. #1199: a punycode homograph host (Cyrillic "a" in paypal) warns on its own.
// Served over HTTPS (throwaway certificate per run) so no insecure-transport signal fires first.
const RELAY = "secure-docs-share.com";
const MICROSOFT = "login.microsoftonline.com";
const HOMOGRAPH = "xn--pypal-4ve.com";
const HOSTS = [RELAY, MICROSOFT, HOMOGRAPH];
const FORM = '<!doctype html><title>Sign in to your account</title><form><input type="email" id="i0116" name="loginfmt">' +
  '<input type="password" id="i0118" name="passwd" aria-label="password"></form>';

function mintCertificate(dir: string): { key: Buffer; cert: Buffer } | null {
  try {
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
      "-keyout", path.join(dir, "k.pem"), "-out", path.join(dir, "c.pem"),
      "-subj", "/CN=localhost", "-addext", `subjectAltName=${HOSTS.map((h) => `DNS:${h}`).join(",")}`], { stdio: "ignore" });
    return { key: fs.readFileSync(path.join(dir, "k.pem")), cert: fs.readFileSync(path.join(dir, "c.pem")) };
  } catch {
    return null;
  }
}

test("password focus over HTTPS: a relayed Microsoft sign-in form and a homograph host warn; Microsoft does not (#1247, #1199) @regression", async () => {
  test.setTimeout(90_000);
  const extensionPath = path.resolve("extension/dist");
  test.skip(!fs.existsSync(extensionPath), "Build the extension first.");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ns-relay-"));
  const tls = mintCertificate(tmp);
  if (!tls) fs.rmSync(tmp, { recursive: true, force: true });
  test.skip(!tls, "openssl is needed to mint the throwaway certificate.");
  const server = https.createServer(tls!, (_request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(FORM);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(path.join(tmp, "profile"), {
      headless: false,
      ignoreHTTPSErrors: true,
      args: ["--disable-background-networking", "--disable-quic", "--no-first-run",
        `--host-resolver-rules=${HOSTS.map((h) => `MAP ${h} 127.0.0.1`).join(", ")}`,
        `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return ["http:", "https:"].includes(url.protocol) && !HOSTS.includes(url.hostname)
        ? route.abort("blockedbyclient") : route.continue();
    });

    const relay = await context.newPage();
    await relay.goto(`https://${RELAY}:${port}/`);
    await waitForNavSentinelBridge(relay);
    await relay.bringToFront();
    await relay.click("#i0118");
    await waitForToastMatch(relay, /Microsoft's sign-in form, but it is served by secure-docs-share\.com/, 8000);

    const microsoft = await context.newPage();
    await microsoft.goto(`https://${MICROSOFT}:${port}/`);
    await waitForNavSentinelBridge(microsoft);
    await microsoft.bringToFront();
    await microsoft.click("#i0118");
    await assertNoToastFor(microsoft, 2000);

    const homograph = await context.newPage();
    await homograph.goto(`https://${HOMOGRAPH}:${port}/`);
    await waitForNavSentinelBridge(homograph);
    await homograph.bringToFront();
    await homograph.click("#i0118");
    await waitForToastMatch(homograph, /address looks risky for a password \(the site name mixes alphabets/, 8000);
  } finally {
    await context?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
