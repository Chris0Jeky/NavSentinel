/**
 * AI-47 step 3 / former AI-40 — #609 stale redirect-chain boundary.
 * Mirrors docs/agentic/GATE3_GUIDES.md "AI-47 subprocedure: former AI-40"
 * steps 2-7 in a fresh branded-Chrome profile with the back/forward cache ON.
 * A real BFCache restore is proven twice (the fixture's own pageshow text and
 * an independent pageshow probe); when Chrome refuses the cache, the CDP
 * `Page.backForwardCacheNotUsed` reasons are recorded instead.
 * Automated agent evidence, not the owner result.
 */
import { expect, test, type Page } from "@playwright/test";
import { AcceptanceSession, SETTINGS_KEY, installBfcacheProbe, lastPageshowPersisted, toastState, trustedClick } from "./acceptance_harness";
import { TabObserver, assertSmartModeNoLoopbackTrust, eventKindsSince, expectStable } from "./history_helpers";

test.setTimeout(420_000);

const FACTORS = ["nrs_redirect_chain_depth", "nrs_redirect_via_known_redirector"] as const;

function landingOf(page: Page): number | null {
  const url = new URL(page.url());
  if (!url.pathname.endsWith("/redirect-chain-boundary.html")) return null;
  if (url.searchParams.has("redirect")) return null;
  const step = Number(url.searchParams.get("step") ?? "0");
  return Number.isInteger(step) ? step : null;
}

async function rawChain(session: AcceptanceSession): Promise<string> {
  const all = await session.storageSessionAll();
  const chains = all["ns_sw:redirectChains"] as Record<string, { hops?: Array<{ url?: string; ts?: number }> }> | undefined;
  if (!chains) return "no ns_sw:redirectChains key";
  return Object.entries(chains)
    .map(([tab, chain]) => `tab ${tab}: ${(chain.hops ?? []).map((hop) => {
      try { const u = new URL(hop.url ?? ""); return `${u.search || "(start)"}`; } catch { return "?"; }
    }).join(" > ")}`)
    .join(" | ") || "empty";
}

/**
 * Physically click "Check current NRS factors" and return the debug panel text.
 * The panel is blanked first (test instrumentation only) so a stale reading
 * from an earlier click in the same or a BFCache-restored document cannot be
 * mistaken for the fresh evaluation.
 */
async function checkFactors(page: Page): Promise<string> {
  await page.evaluate(() => {
    const pre = document.querySelector("#__navsentinel_debug_host")?.shadowRoot?.querySelector("pre");
    if (pre) pre.textContent = "";
  });
  await trustedClick(page, "#factor-probe");
  const handle = await page.waitForFunction(() => {
    const text = document.querySelector("#__navsentinel_debug_host")?.shadowRoot?.querySelector("pre")?.textContent?.trim();
    return text && text.includes("NRS factors:") ? text : null;
  }, null, { timeout: 5000 });
  return (await handle.jsonValue()) as string;
}

function factorLine(text: string): string {
  return text.split("\n").find((line) => line.startsWith("NRS factors:")) ?? "(no NRS factors line)";
}

async function lifecycleText(page: Page): Promise<string> {
  return (await page.locator("#bfcache-status").innerText()).trim();
}

/** Start page -> Start redirect journey -> Continue x2, each within 5 s of the prior landing. */
async function buildJourney(session: AcceptanceSession, page: Page): Promise<void> {
  await session.gotoReady(page, session.url("/redirect-chain-boundary.html", "localhost"));
  expect(landingOf(page)).toBe(0);
  for (const target of [1, 2, 3]) {
    const landedAt = Date.now();
    await page.locator("#next-redirect").waitFor({ state: "visible", timeout: 5000 });
    await trustedClick(page, "#next-redirect");
    await expect.poll(() => landingOf(page), { timeout: 8000 }).toBe(target);
    await session.requireReady(page);
    await installBfcacheProbe(page);
    session.note(`landing ${target} reached ${Date.now() - landedAt} ms after the prior landing`);
    expect(Date.now() - landedAt, "each Continue within five seconds of the prior landing").toBeLessThan(5000);
  }
}

test("AI-47 step 3 / former AI-40: BFCache Back/Forward never reuses a stale redirect chain; the chain expires after 16 s", async ({}, testInfo) => {
  const session = await AcceptanceSession.open(testInfo, "AI-47.3-former-AI-40-PR609");
  const failures: string[] = [];
  const soft = async (title: string, body: () => Promise<void>): Promise<boolean> => {
    const ok = (await session.step(title, async () => { await body(); return true; }, { soft: true })) === true;
    if (!ok) failures.push(title);
    return ok;
  };
  try {
    session.note(`tested head ${session.receipt.git.head}; Chrome ${session.chromeVersion}; ui-guard ${session.guardRevision}`);

    await soft("2. MV3 worker registered; Smart mode; debug overlay enabled in Options; no loopback allowlist/trust", async () => {
      expect(session.worker.url()).toMatch(/\/service-worker-loader\.js$/);
      expect(await session.worker.evaluate(() => chrome.runtime.getManifest().manifest_version)).toBe(3);
      const options = await session.openExtensionPage("src/options/options.html");
      await options.waitForSelector("#navDebug", { timeout: 8000 });
      if ((await options.getAttribute("#navDebug", "aria-checked")) !== "true") await trustedClick(options, "#navDebug");
      const viaUi = await expect.poll(async () => (await session.storageLocal<{ nav?: { debug?: boolean } }>(SETTINGS_KEY))?.nav?.debug, { timeout: 4000 })
        .toBe(true).then(() => true, () => false);
      if (!viaUi) {
        session.note("Options debug toggle did not persist within 4 s; falling back to patchNavigation({debug:true})");
        await session.patchNavigation({ debug: true });
      }
      await options.close();
      await assertSmartModeNoLoopbackTrust(session, "AI-47.3 precondition");
      const settings = await session.storageLocal<{ nav?: { debug?: boolean } }>(SETTINGS_KEY, "settings after enabling debug");
      expect(settings?.nav?.debug).toBe(true);
    });

    const page = await session.newPage();
    const observer = await TabObserver.attach(page);
    let bfcacheBranchProven = false;
    let traversalsStartedAt = 0;

    const preconditionOk = await soft("3. build three landings within 5 s each; on landing 3 both redirect-chain factors are listed", async () => {
      await buildJourney(session, page);
      session.note(`raw SW chain on landing 3: ${await rawChain(session)}`);
      const text = await checkFactors(page);
      session.note(`landing 3 factors: ${factorLine(text)}`);
      await session.screenshot(page, "ai47-3-landing3-factors");
      for (const factor of FACTORS) expect(text, `precondition: ${factor} listed on landing 3`).toContain(factor);
    });

    if (preconditionOk) {
      let retryForBfcache = false;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        if (attempt === 2) {
          if (!retryForBfcache) break;
          session.note("Chrome did not BFCache-restore landing 2 on attempt 1; retrying the branch once in the same disposable profile (guide step 4)");
          const rebuilt = await soft("4-retry. rebuild the three landings for the single permitted BFCache retry", async () => {
            await buildJourney(session, page);
            const text = await checkFactors(page);
            session.note(`retry landing 3 factors: ${factorLine(text)}`);
            for (const factor of FACTORS) expect(text).toContain(factor);
          });
          if (!rebuilt) break;
        }
        retryForBfcache = false;
        const title = `4. (attempt ${attempt}) physical Back: landing 2 visible, "BFCache restored: yes", neither chain factor`;
        const ok = await soft(title, async () => {
          const before = Date.now();
          traversalsStartedAt = before;
          await page.goBack({ waitUntil: "commit", timeout: 10_000 });
          await expect.poll(() => landingOf(page), { timeout: 8000 }).toBe(2);
          await session.requireReady(page);
          await page.waitForTimeout(500);
          const lifecycle = await lifecycleText(page);
          const persisted = await lastPageshowPersisted(page);
          const notUsed = observer.bfcacheNotUsed.filter((event) => event.at >= before);
          session.note(`Back #${attempt}: lifecycle="${lifecycle}", probe persisted=${persisted}, commits ${observer.describeCommits(before)}, bfcacheNotUsed=${JSON.stringify(notUsed)}`);
          session.note(`raw SW chain after Back: ${await rawChain(session)}`);
          await session.screenshot(page, `ai47-3-back-landing2-attempt${attempt}`);
          if (attempt === 1 && lifecycle !== "BFCache restored: yes") {
            // Not a product result: the guide allows exactly one retry when Chrome does not retain the page.
            session.observe("4 attempt 1 BFCache not retained", `lifecycle="${lifecycle}"; reasons=${JSON.stringify(notUsed)}`);
            retryForBfcache = true;
            return;
          }
          expect(lifecycle, "fixture must report a real BFCache restore (gate unproven otherwise)").toBe("BFCache restored: yes");
          expect(persisted, "independent pageshow probe must see persisted=true").toBe(true);
          const text = await checkFactors(page);
          session.note(`landing 2 after Back factors: ${factorLine(text)}`);
          for (const factor of FACTORS) expect(text, `${factor} must not survive Back`).not.toContain(factor);
          expect((await toastState(page)).text, "no stale-chain warning, rollback or prompt after Back").toBeNull();
        });
        if (ok && !retryForBfcache) {
          bfcacheBranchProven = true;
          break;
        }
        if (!ok) break;
      }

      if (bfcacheBranchProven) {
        await soft("5. physical Forward: landing 3 \"BFCache restored: yes\", stable, neither chain factor; no warning/rollback/prompt", async () => {
          const before = Date.now();
          await page.goForward({ waitUntil: "commit", timeout: 10_000 });
          await expect.poll(() => landingOf(page), { timeout: 8000 }).toBe(3);
          await session.requireReady(page);
          await page.waitForTimeout(500);
          const lifecycle = await lifecycleText(page);
          const persisted = await lastPageshowPersisted(page);
          session.note(`Forward: lifecycle="${lifecycle}", probe persisted=${persisted}, commits ${observer.describeCommits(before)}, bfcacheNotUsed=${JSON.stringify(observer.bfcacheNotUsed.filter((event) => event.at >= before))}`);
          expect(lifecycle).toBe("BFCache restored: yes");
          expect(persisted).toBe(true);
          await expectStable(page, observer, () => landingOf(page) === 3, 2000, "Forward to landing 3");
          const text = await checkFactors(page);
          session.note(`landing 3 after Forward factors: ${factorLine(text)}`);
          await session.screenshot(page, "ai47-3-forward-landing3");
          for (const factor of FACTORS) expect(text, `${factor} must not survive Forward`).not.toContain(factor);
          expect((await toastState(page)).text).toBeNull();
          const events = await eventKindsSince(session, traversalsStartedAt);
          session.note(`events since the Back traversal: ${JSON.stringify(events)}`);
          expect(events.filter((event) => /rollback|prompt|redirect|blocked/.test(event.kind)), "no rollback/prompt events after either traversal").toEqual([]);
        });
      } else {
        session.note("guide step 4: Chrome did not retain the page in BFCache after one retry -> the BFCache branch is UNPROVEN; step 5 not run");
      }
    }

    await soft("6. rebuild from the start URL: factors present, then absent after 16 s without navigating", async () => {
      await buildJourney(session, page);
      const landedAt = Date.now();
      const initial = await checkFactors(page);
      session.note(`rebuilt landing 3 factors: ${factorLine(initial)}`);
      for (const factor of FACTORS) expect(initial, `${factor} initially present`).toContain(factor);
      const commitsBefore = observer.commits.length;
      await page.waitForTimeout(Math.max(0, 16_500 - (Date.now() - landedAt)));
      expect(observer.commits.length, "no navigation during the 16 s wait").toBe(commitsBefore);
      const later = await checkFactors(page);
      session.note(`landing 3 factors after ${Date.now() - landedAt} ms without navigating: ${factorLine(later)}; raw SW chain: ${await rawChain(session)}`);
      await session.screenshot(page, "ai47-3-after-16s");
      for (const factor of FACTORS) expect(later, `${factor} expired after 16 s`).not.toContain(factor);
    });

    await soft("7. no new errors on the fixture or service-worker consoles", async () => {
      const errors = session.consoleErrors([/favicon\.ico/]);
      session.note(`console errors: ${JSON.stringify(errors)}`);
      expect(errors).toEqual([]);
    });

    session.note(`full commit timeline: ${observer.describeCommits(0)}`);
    await observer.detach();
    session.note(`AI-47.3 soft-step failures: ${JSON.stringify(failures)}`);
    expect(failures, "every AI-47 step-3 step passes").toEqual([]);
  } finally {
    await session.close();
  }
});
