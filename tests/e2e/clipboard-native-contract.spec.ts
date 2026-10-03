import { test, expect, chromium, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { waitForNavSentinelBridge } from "./extension_test_utils";
import { startProvingGroundEgressFence, type ProvingGroundEgressAttempt } from "./proving_ground_fake_sink";

// Native-method controls share the exact browser, document, permissions and
// profile with the guarded method. This is a WebIDL compatibility comparison,
// not an extension-disabled attack arm or a clipboard-prevention claim.
test("clipboard writeText preserves native conversion, copied contents and Promise errors (#1024) @regression", async ({}, testInfo) => {
  test.setTimeout(60_000);
  const extensionPath = path.resolve("extension/dist");
  test.skip(!fs.existsSync(extensionPath), "Build the extension first.");
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<!doctype html><html lang=en><title>Local clipboard contract</title><body>Clipboard compatibility fixture</body></html>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing local fixture address");
  const origin = `http://127.0.0.1:${address.port}`;
  const denied: ProvingGroundEgressAttempt[] = [];
  const fence = await startProvingGroundEgressFence(denied, new Set([origin]));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ns-clipboard-native-"));
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: false,
      proxy: { server: fence.proxyServer },
      args: ["--disable-background-networking", "--disable-quic", "--no-first-run",
        `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    await context.route("**/*", (route) => {
      const target = new URL(route.request().url());
      return ["http:", "https:"].includes(target.protocol) && target.origin !== origin
        ? route.abort("blockedbyclient") : route.continue();
    });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
    const page = await context.newPage();
    await page.goto(`${origin}/clipboard`);
    await waitForNavSentinelBridge(page);
    await page.bringToFront();
    const result = await page.evaluate(async () => {
      const clipboard = navigator.clipboard;
      const prototype = Object.getPrototypeOf(clipboard) as Clipboard;
      const native = prototype.writeText;
      const guarded = clipboard.writeText;
      const rows: Array<{
        arm: string; name: string; syncError: string | null; promise: boolean;
        error: string | null; conversionsAtReturn: number; conversions: number;
        copied: string | null; expected: string | null;
      }> = [];
      for (const [arm, write] of [["native", native], ["guarded", guarded]] as const) {
        for (const name of ["string", "number", "null", "undefined", "boolean", "BigInt", "URL", "stateful", "Symbol", "missing", "throwing"]) {
          // Establish a known fixture value before any clipboard read. Nothing
          // samples pre-existing clipboard contents, even on a rejected write.
          await Reflect.apply(native, clipboard, ["NS_FIXTURE_SENTINEL"]);
          let conversions = 0;
          let expected: string | null = null;
          const args: unknown[] = [];
          if (name === "string") { args.push("NS_BENIGN_COPY"); expected = "NS_BENIGN_COPY"; }
          if (name === "number") { args.push(847293); expected = "847293"; }
          if (name === "null") { args.push(null); expected = "null"; }
          if (name === "undefined") { args.push(undefined); expected = "undefined"; }
          if (name === "boolean") { args.push(true); expected = "true"; }
          if (name === "BigInt") { args.push(847293n); expected = "847293"; }
          if (name === "URL") { args.push(new URL("https://clipboard.example.invalid/receipt")); expected = "https://clipboard.example.invalid/receipt"; }
          if (name === "stateful") {
            expected = "NS_STATEFUL_COPY";
            args.push({ [Symbol.toPrimitive](hint: string) {
              conversions++;
              if (hint !== "string" || conversions !== 1) throw new Error("incorrect conversion");
              return "NS_STATEFUL_COPY";
            } });
          }
          if (name === "Symbol") args.push(Symbol("fixture"));
          if (name === "throwing") args.push({ toString() { conversions++; throw new RangeError("fixture conversion"); } });
          let syncError: string | null = null;
          let error: string | null = null;
          let returned: unknown;
          try { returned = Reflect.apply(write, clipboard, args); }
          catch (failure) { syncError = failure instanceof Error ? failure.name : String(failure); }
          const conversionsAtReturn = conversions;
          const promise = returned instanceof Promise;
          try { await returned; }
          catch (failure) { error = failure instanceof Error ? failure.name : String(failure); }
          // Accepted writes must expose the actual fixture text. Rejected calls
          // are inspected only for their Promise/error contract, never read.
          const copied = expected !== null && syncError === null && error === null
            ? await clipboard.readText() : null;
          rows.push({ arm, name, syncError, promise, error, conversionsAtReturn, conversions, copied, expected });
        }
      }
      await Reflect.apply(native, clipboard, [""]);
      return {
        rows, nativeLength: native.length, guardedLength: guarded.length,
        distinct: native !== guarded,
        prototypeUnchanged: prototype.writeText === native,
      };
    });
    await testInfo.attach("clipboard-native-contract", {
      body: Buffer.from(JSON.stringify({ browser: context.browser()?.version(), ...result, denied }, null, 2)),
      contentType: "application/json",
    });
    expect(result.distinct, "the control must bypass the installed instance wrapper").toBe(true);
    expect(result.prototypeUnchanged).toBe(true);
    expect(result.nativeLength).toBe(1);
    expect(result.guardedLength).toBe(1);
    expect(result.rows).toHaveLength(22);
    for (const row of result.rows) {
      expect(row.syncError, `${row.arm}/${row.name} must return rather than throw`).toBeNull();
      expect(row.promise, `${row.arm}/${row.name}`).toBe(true);
      const expectedError = row.name === "Symbol" || row.name === "missing" ? "TypeError"
        : row.name === "throwing" ? "RangeError" : null;
      expect(row.error, `${row.arm}/${row.name}`).toBe(expectedError);
      expect(row.copied, `${row.arm}/${row.name} copied contents`).toBe(row.expected);
      const expectedConversions = row.name === "stateful" || row.name === "throwing" ? 1 : 0;
      expect(row.conversionsAtReturn, `${row.arm}/${row.name} synchronous conversion`).toBe(expectedConversions);
      expect(row.conversions, `${row.arm}/${row.name} once-only conversion`).toBe(expectedConversions);
    }
  } finally {
    await context?.close();
    await fence.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    fs.rmSync(profile, { recursive: true, force: true });
  }
});
