import { test, expect, chromium } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { getExtensionId, getServiceWorker } from "./extension_test_utils";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(__dirname, "..", "..", "extension", "dist");

test.setTimeout(120_000);

test("allowlist writes from two extension pages meet in one worker queue @regression", async () => {
  test.skip(!fs.existsSync(path.join(extensionPath, "manifest.json")), "Build the extension before the allowlist broker test.");
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-allowlist-broker-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  try {
    const extensionId = await getExtensionId(context);
    const url = `chrome-extension://${extensionId}/src/options/options.html`;
    const first = await context.newPage();
    const second = await context.newPage();
    await Promise.all([first.goto(url), second.goto(url)]);
    const add = (page: typeof first, destHost: string) => page.evaluate(async host =>
      chrome.runtime.sendMessage({ type: "ns-allowlist-mutate", op: "add", siteKey: "site.example", destHost: host }), destHost);
    // Keep this race: serializing the sends would stop testing cross-page
    // read/mutate/write atomicity. FIFO starts at worker admission, not CDP call order.
    const [one, two] = await Promise.all([add(first, "first.example"), add(second, "second.example")]);
    expect(one).toMatchObject({ ok: true });
    expect(two).toMatchObject({ ok: true });
    const worker = await getServiceWorker(context);
    await expect.poll(() => worker.evaluate(async () => {
      const stored = (await chrome.storage.local.get("sentinelsuite:nav_allowlist_v1"))["sentinelsuite:nav_allowlist_v1"];
      const destinations = stored?.["site.example"];
      // Sort a copy of this read receipt only. Preserve the complete map and
      // array multiplicity: lost writes, duplicates, extras, and malformed data
      // must still fail. A Set or arrayContaining alone would weaken this oracle.
      return Array.isArray(destinations)
        ? { ...stored, "site.example": [...destinations].sort() }
        : stored;
    })).toEqual({ "site.example": ["first.example", "second.example"] });
    expect(await second.evaluate(() => chrome.runtime.sendMessage({ type: "ns-allowlist-mutate", op: "clear" })))
      .toMatchObject({ ok: true });
    await expect.poll(() => worker.evaluate(async () =>
      (await chrome.storage.local.get("sentinelsuite:nav_allowlist_v1"))["sentinelsuite:nav_allowlist_v1"])).toEqual({});
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
