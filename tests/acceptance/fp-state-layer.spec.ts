/**
 * False-positive regression for Material-style state layers (found live on
 * YouTube's "Watch on YouTube" embed link, 2026-09-24). A translucent,
 * hit-testable state-layer child inside a visible, labelled `_blank` link must
 * not make the user's own click look like a hidden overlay.
 */
import { expect, test, type Frame, type Page } from "@playwright/test";
import { AcceptanceSession } from "./acceptance_harness";

async function humanClick(page: Page, box: { x: number; y: number; width: number; height: number }): Promise<void> {
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x - 100, y - 40);
  await page.mouse.move(x, y, { steps: 12 });
  await page.waitForTimeout(500);
  await page.mouse.down();
  await page.waitForTimeout(90);
  await page.mouse.up();
}

test("state-layer link: a labelled new-tab link opens in the top frame and inside a cross-site embed", async ({}, testInfo) => {
  const session = await AcceptanceSession.open(testInfo, "fp-state-layer");
  try {
    for (const variant of ["top-frame", "cross-site-embed"] as const) {
      await session.step(`${variant}: one human click on the labelled link opens its destination`, async () => {
        const page = await session.newPage();
        await session.gotoReady(page, session.url(`/acceptance/fp-state-layer.html${variant === "cross-site-embed" ? "?embed=1" : ""}`));
        await page.waitForTimeout(6500);
        let frame: Frame | Page = page;
        if (variant === "cross-site-embed") {
          const handle = page.frames().find((candidate) => candidate.url().includes("embedded=1"));
          if (!handle) throw new Error("embed frame missing");
          frame = handle;
        }
        // Playwright reports boxes of framed elements in main-page coordinates.
        const box = await frame.locator("#pill").boundingBox();
        if (!box) throw new Error("link not rendered");
        const journalBefore = (await session.eventLog()).length;
        const opened = session.context.waitForEvent("page", { timeout: 6000 }).catch(() => null);
        await humanClick(page, box);
        const seenToasts = new Set<string>();
        for (let tick = 0; tick < 15; tick += 1) {
          for (const candidate of page.frames()) {
            const text = await candidate.evaluate(() =>
              document.querySelector("#__navsentinel_toast_host")?.shadowRoot?.querySelector(".body")?.textContent?.trim() ?? null).catch(() => null);
            if (text) seenToasts.add(`${new URL(candidate.url()).hostname}: ${text}`);
          }
          await page.waitForTimeout(200);
        }
        session.note(`${variant}: toasts seen in the first 3 s=${JSON.stringify([...seenToasts])}`);
        const tab = await opened;
        const journal = (await session.eventLog()).slice(journalBefore).map((row) => String(row.kind));
        const profile = await session.storageLocal<Record<string, { factors?: Record<string, number> }>>("sentinelsuite:domain_profiles_v1");
        session.note(`${variant}: newTab=${tab ? new URL(tab.url() || "about:blank").pathname : "none"} journal=${JSON.stringify(journal)} factors=${JSON.stringify(Object.fromEntries(Object.entries(profile ?? {}).map(([host, value]) => [host, value.factors])))}`);
        const frameToasts = await Promise.all(page.frames().map((candidate) => candidate.evaluate(() =>
          document.querySelector("#__navsentinel_toast_host")?.shadowRoot?.querySelector(".body")?.textContent?.trim() ?? null).catch(() => null)));
        session.note(`${variant}: toasts by frame=${JSON.stringify(frameToasts)}`);
        await session.screenshot(page, `${variant}-after-click`);
        if (tab) await tab.close();
        await page.close();
        expect(tab, `${variant}: the user's click must open the labelled destination`).not.toBeNull();
        expect(journal).not.toContain("nav_blank_prompt");
      }, { soft: true });
    }
  } finally {
    await session.close();
  }
});
