/**
 * False-positive regression: a form the page posts into its OWN named iframe
 * (hidden-iframe uploads, SSO keep-alive, 3-D Secure challenge frames,
 * analytics) never navigates the tab, yet the top-frame form.submit() guard
 * treats it as a top-level navigation, blocks it with a "Blocked form submit"
 * notice and the post never reaches the iframe (seen live on Reddit while only
 * scrolling, 2026-09-24).
 */
import { expect, test } from "@playwright/test";
import { AcceptanceSession, toastState } from "./acceptance_harness";

test("a background form post into the page's own named iframe is neither blocked nor announced", async ({}, testInfo) => {
  const session = await AcceptanceSession.open(testInfo, "fp-iframe-target-form");
  try {
    for (const cross of [false, true]) {
      await session.step(`${cross ? "cross-site" : "same-origin"} post into a named iframe reaches the iframe silently`, async () => {
        const page = await session.newPage();
        const before = (await session.eventLog()).length;
        await session.gotoReady(page, session.url(`/acceptance/fp-iframe-target-form.html?cross=${cross ? 1 : 0}`));
        const seen = new Set<string>();
        for (let tick = 0; tick < 20; tick += 1) {
          const state = await toastState(page).catch(() => null);
          if (state?.text) seen.add(state.text);
          await page.waitForTimeout(250);
        }
        const sinkUrl = page.frames().find((frame) => frame.name() === "sink")?.url() ?? "";
        const rows = (await session.eventLog()).slice(before).map((row) => String(row.kind));
        session.note(`cross=${cross}: top=${new URL(page.url()).pathname} sink=${sinkUrl} toasts=${JSON.stringify([...seen])} rows=${JSON.stringify(rows)}`);
        await page.close();
        expect(sinkUrl, "the post reached its iframe").toContain("/acceptance/dest/iframe-post/");
        expect([...seen], "no NavSentinel notice for a navigation that never leaves the page").toEqual([]);
        expect(rows).not.toContain("nav_blank_prompt");
      }, { soft: true });
    }
  } catch (error) {
    session.markFailed(error);
    throw error;
  } finally {
    await session.close();
  }
});
