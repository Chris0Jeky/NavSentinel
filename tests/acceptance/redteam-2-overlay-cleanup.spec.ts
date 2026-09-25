/**
 * Red-team acceptance (owner-sanctioned): can a hostile page defeat NavSentinel's
 * automatic overlay cleanup (#557 area) so a full-viewport clickjacking trap
 * survives with the feature enabled? Attacker controls all DOM/timing.
 * Automated agent evidence, never an owner Gate-3 result.
 */
import { expect, test, type Page } from "@playwright/test";
import { AcceptanceSession, toastState } from "./acceptance_harness";
import { type Attempt } from "./redteam_helpers";

const evn = <T = unknown>(page: Page, name: string, arg?: unknown) =>
  page.evaluate(({ n, a }) => (window as unknown as Record<string, (x?: unknown) => T>)[n]!(a), { n: name, a: arg });

async function visibleTraps(page: Page): Promise<number> {
  return (await evn<number>(page, "__visibleTraps")) ?? -1;
}

test("red-team: overlay auto-cleanup evasions (main)", async ({}, testInfo) => {
  const session = await AcceptanceSession.open(testInfo, "redteam-overlay-cleanup");
  const attempts: Attempt[] = [];
  try {
    await session.patchNavigation({ defaultMode: "smart", autoDismissOverlays: true });

    // ---- Baseline: a single full-viewport overlay should be auto-hidden ----
    await session.step("B0 baseline: one full-viewport overlay is auto-hidden with cleanup on", async () => {
      const page = await session.newPage();
      await session.gotoReady(page, session.url("/acceptance/redteam-overlay.html"));
      await evn(page, "__spawnOne");
      let hidden = false;
      await expect.poll(async () => {
        hidden = (await visibleTraps(page)) === 0;
        return hidden;
      }, { timeout: 5000 }).toBe(true).catch(() => undefined);
      session.note(`B0 overlay hidden by cleanup: ${hidden}`);
      attempts.push({
        id: "B0", technique: "single fixed full-viewport high-z overlay", fixture: "redteam-overlay.html",
        expected: "cleanup hides the classified overlay", observed: hidden ? "BLOCKED" : "REACHED-HARM",
        finding: "CONTROL", detail: hidden ? "overlay hidden (cleanup works)" : "overlay survived",
      });
      expect(hidden, "cleanup baseline: overlay hidden").toBe(true);
      if (!page.isClosed()) await page.close();
    }, { soft: true });

    // ---- Evasion 1: exhaust the bounded suppression ledger ----
    await session.step("B1 budget exhaustion: spawn > ledger cap distinct overlays; do live traps survive?", async () => {
      const page = await session.newPage();
      await session.gotoReady(page, session.url("/acceptance/redteam-overlay.html"));
      const spawned = await evn<number>(page, "__spawnMany", 200);
      session.note(`B1 spawned ${spawned} overlays`);
      await page.waitForTimeout(2500);
      const remaining = await visibleTraps(page);
      const toast = await toastState(page).catch(() => ({ text: null, buttons: [] as string[] }));
      session.note(`B1 visible traps remaining=${remaining}; toast=${JSON.stringify(toast)}`);
      await session.screenshot(page, "b1-budget-exhaustion");
      const survived = remaining > 0;
      attempts.push({
        id: "B1", technique: "spawn 200 distinct full-viewport overlays to exhaust the 128-entry cleanup ledger",
        fixture: "redteam-overlay.html", expected: "cleanup keeps hiding overlays or fails safe",
        observed: survived ? "REACHED-HARM" : "BLOCKED",
        finding: "KNOWN",
        detail: survived
          ? `${remaining} full-viewport traps remain visible after the ledger cap; user warned via toast=${JSON.stringify(toast.text)}`
          : "all overlays hidden",
      });
      session.note(`B1 survived=${survived}`);
      if (!page.isClosed()) await page.close();
    }, { soft: true });

    // ---- Evasion 2: rebuild the trap under a fresh element every frame ----
    await session.step("B2 rebuild-every-frame: a fresh full-viewport overlay each rAF", async () => {
      const page = await session.newPage();
      await session.gotoReady(page, session.url("/acceptance/redteam-overlay.html"));
      await evn(page, "__rebuildLoop", 2500);
      // Sample the live-trap count mid-loop several times.
      const samples: number[] = [];
      for (let i = 0; i < 8; i++) {
        await page.waitForTimeout(250);
        samples.push(await visibleTraps(page));
      }
      const maxLive = Math.max(...samples);
      session.note(`B2 live-trap samples: ${JSON.stringify(samples)}`);
      await session.screenshot(page, "b2-rebuild-loop");
      const survived = maxLive > 0;
      attempts.push({
        id: "B2", technique: "remove+recreate a fresh full-viewport overlay every animation frame",
        fixture: "redteam-overlay.html", expected: "no live full-viewport trap persists",
        observed: survived ? "REACHED-HARM" : "BLOCKED", finding: "KNOWN",
        detail: survived ? `a live full-viewport trap was present in ${samples.filter((s) => s > 0).length}/8 samples` : "no live trap observed",
      });
      session.note(`B2 survived=${survived} maxLive=${maxLive}`);
      if (!page.isClosed()) await page.close();
    }, { soft: true });

    session.note(`REDTEAM-2 attempts: ${JSON.stringify(attempts)}`);
    session.observe("summary", JSON.stringify(attempts));
  } finally {
    await session.close();
  }
});
