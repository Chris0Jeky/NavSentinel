/**
 * False-positive regression: a click on an element INSIDE an ordinary visible
 * link (text in a <span>, an icon <svg>) must score like a click on the link.
 * `firstUnderlyingCandidate` returns the leaf's own ancestor link as the
 * "underlying" element, so `intent_mismatch_under_interactive` (+35) fires for
 * the child (found live on GitHub's repository tabs, 2026-09-24).
 */
import { expect, test } from "@playwright/test";
import { AcceptanceSession, toastState } from "./acceptance_harness";

const CASES = ["text-same-tab", "span-same-tab", "icon-same-tab", "text-blank", "span-blank", "icon-blank"] as const;

test("link-child matrix: clicks on a link's own child element are treated like clicks on the link", async ({}, testInfo) => {
  const session = await AcceptanceSession.open(testInfo, "fp-link-child");
  try {
    for (const which of CASES) {
      await session.step(`${which}: one human click on an ordinary cross-site link reaches it`, async () => {
        const page = await session.newPage();
        await session.gotoReady(page, session.url(`/acceptance/fp-link-child.html?case=${which}`));
        await page.waitForTimeout(6500);
        const box = await page.locator("#link").boundingBox();
        if (!box) throw new Error("link not rendered");
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        const leaf = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName.toLowerCase() ?? null, { x, y });
        const journalBefore = (await session.eventLog()).length;
        const newTab = session.context.waitForEvent("page", { timeout: 5000 }).catch(() => null);
        await page.mouse.move(x - 90, y + 30);
        await page.mouse.move(x, y, { steps: 10 });
        await page.waitForTimeout(400);
        await page.mouse.down();
        await page.waitForTimeout(80);
        await page.mouse.up();
        let reached: boolean;
        if (which.endsWith("blank")) {
          const tab = await newTab;
          reached = Boolean(tab);
          if (tab) await tab.close();
        } else {
          reached = await page.waitForURL(/\/dest\/link-/, { timeout: 5000 }).then(() => true, () => false);
        }
        const toast = reached ? null : (await toastState(page).catch(() => ({ text: null }))).text;
        const rows = (await session.eventLog()).slice(journalBefore)
          .filter((row) => row.kind !== "nav_silent_allow")
          .map((row) => ({ kind: row.kind, score: row.score, reasons: row.reasons }));
        session.note(`${which}: leaf=${leaf} reached=${reached} toast=${JSON.stringify(toast)} rows=${JSON.stringify(rows)}`);
        await page.close();
        expect(reached, `${which}: the user's click must reach the link destination`).toBe(true);
      }, { soft: true });
    }
  } finally {
    await session.close();
  }
});
