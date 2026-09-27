/**
 * #890: an approved blocked form submit must go only to the destination that
 * was approved.
 *
 * The MAIN-world gate resolves a blocked `form.submit()` / `requestSubmit()`
 * action once, shows or checks that URL, and later runs the stored action when
 * the isolated world approves it. For an allowlisted destination that approval
 * is automatic (no click), so page script that swaps `action` or `formaction`
 * right after the blocked call used to send the approved submit to a URL nobody
 * saw or allowlisted.
 *
 * The approved destination is `localhost` (allowlisted for the 127.0.0.1 gym
 * site). The swapped destination is `127.0.0.2`, which nothing serves, so the
 * test watches outgoing requests rather than page content.
 */
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getGymBaseUrl, waitForNavSentinelBridge, waitForToastMatch } from "./extension_test_utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(__dirname, "..", "..", "extension", "dist");
const gymRoot = path.resolve(__dirname, "..", "..", "gym");
const ALLOWLIST_KEY = "sentinelsuite:nav_allowlist_v1";

test.setTimeout(120_000);

async function withAllowlistedPage(
  run: (page: Page, approvedBase: string, serviceWorker: Worker) => Promise<void>,
): Promise<void> {
  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-submit-swap-"));
  let context: BrowserContext | null = null;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) serviceWorker = await context.waitForEvent("serviceworker");

    const site = new URL(baseUrl).hostname;
    await serviceWorker.evaluate(
      async ({ key, site }) => {
        await chrome.storage.local.set({ [key]: { [site]: ["localhost"] } });
      },
      { key: ALLOWLIST_KEY, site },
    );

    const page = await context.newPage();
    await page.goto(`${baseUrl}/level1-basic-opacity.html`, { waitUntil: "domcontentloaded" });
    await waitForNavSentinelBridge(page);
    const approvedBase = `http://localhost:${new URL(baseUrl).port}`;
    await run(page, approvedBase, serviceWorker);
  } finally {
    await context?.close();
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

function recordNavigations(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (request) => {
    if (request.isNavigationRequest()) seen.push(request.url());
  });
  return seen;
}

test("an allowlisted blocked form.submit() still reaches its approved destination (control) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  await withAllowlistedPage(async (page, approvedBase) => {
    const seen = recordNavigations(page);
    const approved = `${approvedBase}/level1-basic-opacity.html?submit=approved`;
    await page.evaluate((action) => {
      const form = document.createElement("form");
      form.method = "get";
      form.action = action;
      document.body.appendChild(form);
      form.submit();
    }, approved);

    await expect
      .poll(() => seen.some((url) => url.startsWith(`${approvedBase}/level1-basic-opacity.html`)), {
        message: "TEST_INVALID: the allowlisted submit never ran, so the swap arm below proves nothing",
        timeout: 10_000,
      })
      .toBe(true);
  });
});

test("automatic form approval grants only its destination to the rollback worker (#900) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  await withAllowlistedPage(async (page, approvedBase, serviceWorker) => {
    await serviceWorker.evaluate(() => {
      const scope = globalThis as typeof globalThis & { __formGrantMessages?: Array<{ type: string; url?: string }> };
      scope.__formGrantMessages = [];
      chrome.runtime.onMessage.addListener((message: unknown) => {
        const grant = message as { type?: unknown; url?: unknown };
        if (grant?.type === "ns-allow-nav" || grant?.type === "ns-allow-target-nav") {
          scope.__formGrantMessages?.push({
            type: grant.type,
            ...(typeof grant.url === "string" ? { url: grant.url } : {}),
          });
        }
      });
    });
    const approved = `${approvedBase}/level1-basic-opacity.html?submit=approved`;
    await page.evaluate((action) => {
      const form = document.createElement("form");
      form.method = "get";
      form.action = action;
      document.body.appendChild(form);
      form.submit();
    }, approved);

    await expect.poll(() => serviceWorker.evaluate(() => {
      const scope = globalThis as typeof globalThis & { __formGrantMessages?: Array<{ type: string; url?: string }> };
      return scope.__formGrantMessages ?? [];
    })).toContainEqual({ type: "ns-allow-target-nav", url: approved });
    const grants = await serviceWorker.evaluate(() => {
      const scope = globalThis as typeof globalThis & { __formGrantMessages?: Array<{ type: string; url?: string }> };
      return scope.__formGrantMessages ?? [];
    });
    expect(grants.filter((grant) => grant.type === "ns-allow-nav")).toEqual([]);
  });
});

test("an approved blocked form.submit() does not follow an action swapped after the block (#890) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  await withAllowlistedPage(async (page, approvedBase) => {
    const seen = recordNavigations(page);
    const originalUrl = page.url();
    await page.evaluate((action) => {
      const form = document.createElement("form");
      form.method = "get";
      form.action = action;
      document.body.appendChild(form);
      form.submit(); // blocked, then auto-approved for the allowlisted host
      form.action = "http://127.0.0.2:9/swapped-after-approval";
    }, `${approvedBase}/level1-basic-opacity.html?submit=approved`);

    await page.waitForTimeout(3_000);
    expect(seen.filter((url) => url.includes("127.0.0.2"))).toEqual([]);
    expect(page.url()).toBe(originalUrl);
  });
});

test("an approved blocked requestSubmit() does not follow a formaction swapped after the block (#890) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  await withAllowlistedPage(async (page, approvedBase) => {
    const seen = recordNavigations(page);
    const originalUrl = page.url();
    await page.evaluate((action) => {
      const form = document.createElement("form");
      form.method = "get";
      const submitter = document.createElement("button");
      submitter.type = "submit";
      submitter.formAction = action;
      form.appendChild(submitter);
      document.body.appendChild(form);
      form.requestSubmit(submitter); // blocked, then auto-approved
      submitter.formAction = "http://127.0.0.2:9/swapped-after-approval";
    }, `${approvedBase}/level1-basic-opacity.html?submit=approved`);

    await page.waitForTimeout(3_000);
    expect(seen.filter((url) => url.includes("127.0.0.2"))).toEqual([]);
    expect(page.url()).toBe(originalUrl);
  });
});

// #900: the browser resolves a relative action or window.open URL against the
// document's base URL. These pages point `<base href>` at another origin.
function setBase(page: Page, href: string): Promise<void> {
  return page.evaluate((value) => {
    let base = document.querySelector("base");
    if (!base) {
      base = document.createElement("base");
      document.head.appendChild(base);
    }
    base.href = value;
  }, href);
}

test("a base-relative blocked form.submit() is judged by the URL the browser submits to (#900) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  await withAllowlistedPage(async (page, approvedBase) => {
    const seen = recordNavigations(page);
    // Resolved against location.href this is a 127.0.0.1 URL, which is not
    // allowlisted; the browser sends it to the allowlisted localhost base.
    await setBase(page, `${approvedBase}/`);
    await page.evaluate(() => {
      const form = document.createElement("form");
      form.method = "get";
      form.setAttribute("action", "level1-basic-opacity.html?submit=base-relative");
      document.body.appendChild(form);
      form.submit();
    });

    // A GET submit replaces the action's query with the form data, so match the path.
    await expect
      .poll(() => seen.some((url) => url.startsWith(`${approvedBase}/level1-basic-opacity.html`)), {
        timeout: 10_000,
      })
      .toBe(true);
  });
});

test("the blocked-submit prompt names the base-resolved destination, not the page's own origin (#900) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  await withAllowlistedPage(async (page) => {
    const seen = recordNavigations(page);
    const originalUrl = page.url();
    await setBase(page, "http://127.0.0.2:9/");
    await page.evaluate(() => {
      const form = document.createElement("form");
      form.method = "get";
      form.setAttribute("action", "login");
      document.body.appendChild(form);
      form.submit();
    });

    const text = await waitForToastMatch(page, /Blocked form submit/, 6_000);
    expect(text).toContain("127.0.0.2");
    expect(seen.filter((url) => url.includes("127.0.0.2"))).toEqual([]);
    expect(page.url()).toBe(originalUrl);
  });
});

test("an approved blocked form.submit() does not follow a <base href> moved after the block (#900) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  await withAllowlistedPage(async (page, approvedBase, serviceWorker) => {
    await serviceWorker.evaluate(() => {
      const scope = globalThis as typeof globalThis & { __baseGrants?: string[] };
      scope.__baseGrants = [];
      chrome.runtime.onMessage.addListener((message: unknown) => {
        const grant = message as { type?: unknown; url?: unknown };
        if (grant?.type === "ns-allow-target-nav" && typeof grant.url === "string") scope.__baseGrants?.push(grant.url);
      });
    });
    const seen = recordNavigations(page);
    const originalUrl = page.url();
    await setBase(page, `${approvedBase}/`);
    await page.evaluate(() => {
      const form = document.createElement("form");
      form.method = "get";
      form.setAttribute("action", "level1-basic-opacity.html?submit=approved");
      document.body.appendChild(form);
      form.submit(); // blocked, then auto-approved for the allowlisted host
      document.querySelector("base")!.href = "http://127.0.0.2:9/";
    });

    // Control: the approval did happen, for the URL resolved at block time.
    // Without it, the checks below would pass because nothing was approved.
    await expect.poll(() => serviceWorker.evaluate(() =>
      (globalThis as typeof globalThis & { __baseGrants?: string[] }).__baseGrants ?? [],
    )).toContain(`${approvedBase}/level1-basic-opacity.html?submit=approved`);
    await page.waitForTimeout(3_000);
    expect(seen.filter((url) => url.includes("127.0.0.2"))).toEqual([]);
    expect(page.url()).toBe(originalUrl);
  });
});

test("an approved blocked window.open() opens the URL resolved when it was blocked (#900) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  await withAllowlistedPage(async (page, approvedBase) => {
    const context = page.context();
    const popups: Page[] = [];
    context.on("page", (opened) => popups.push(opened));
    await setBase(page, `${approvedBase}/`);
    await page.evaluate(() => {
      // No user gesture: blocked, then auto-approved for the allowlisted host.
      window.open("level1-basic-opacity.html?open=approved", "_blank");
      document.querySelector("base")!.href = "http://127.0.0.2:9/";
    });

    await expect.poll(() => popups.map((opened) => opened.url()), { timeout: 10_000 }).toContainEqual(
      `${approvedBase}/level1-basic-opacity.html?open=approved`,
    );
    expect(popups.map((opened) => opened.url()).filter((url) => url.includes("127.0.0.2"))).toEqual([]);
  });
});

test("an early page script that fakes Node.prototype.baseURI cannot steer a relative submit (#900) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  await withAllowlistedPage(async (page, approvedBase) => {
    // The fixture's inline <head> script runs while the guard is still being
    // imported: its getter claims the allowlisted localhost base, while the
    // real <base> points relative URLs at 127.0.0.2.
    await page.goto(`${new URL(page.url()).origin}/base-uri-tamper.html`, { waitUntil: "domcontentloaded" });
    await waitForNavSentinelBridge(page);
    expect(await page.evaluate(() => document.baseURI), "TEST_INVALID: the page's getter must lie").toBe(`${approvedBase}/`);
    const seen = recordNavigations(page);
    const originalUrl = page.url();
    await page.evaluate(() => {
      const form = document.createElement("form");
      form.method = "get";
      form.setAttribute("action", "level1-basic-opacity.html?submit=tampered");
      document.body.appendChild(form);
      form.submit();
    });

    // The guard used the platform getter the loader captured first, so it
    // names 127.0.0.2 and does not auto-approve the "allowlisted" base.
    const text = await waitForToastMatch(page, /Blocked form submit/, 6_000);
    expect(text).toContain("127.0.0.2");
    await page.waitForTimeout(1_500);
    expect(seen.filter((url) => url.includes("submit=tampered"))).toEqual([]);
    expect(page.url()).toBe(originalUrl);
  });
});

test("a blocked popup whose relative URL cannot be resolved stays blocked with nothing to approve (#900) @regression", async () => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  await withAllowlistedPage(async (page, approvedBase) => {
    const popups: Page[] = [];
    page.context().on("page", (opened) => popups.push(opened));
    await setBase(page, "data:text/plain,base");
    expect(await page.evaluate(() => document.baseURI), "TEST_INVALID: Chrome must accept the data: base").toMatch(/^data:/);
    await page.evaluate((allowlisted) => {
      // No gesture: blocked. A relative URL cannot resolve against a data: base.
      window.open("level1-basic-opacity.html?open=unresolvable", "_blank");
      // Moving the base to the allowlisted host must not revive it.
      document.querySelector("base")!.href = allowlisted;
    }, `${approvedBase}/`);

    await page.waitForTimeout(3_000);
    expect(popups.map((opened) => opened.url()).filter((url) => url.includes("open=unresolvable"))).toEqual([]);
  });
});
