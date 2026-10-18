/**
 * False-positive regression: a form the page posts into its OWN named iframe
 * (hidden-iframe uploads, SSO keep-alive, 3-D Secure challenge frames,
 * analytics) never navigates the tab, yet the top-frame form.submit() guard
 * treats it as a top-level navigation, blocks it with a "Blocked form submit"
 * notice and the post never reaches the iframe (seen live on Reddit while only
 * scrolling, 2026-09-24).
 *
 * Known red: https://github.com/Chris0Jeky/NavSentinel/issues/865. The target
 * is resolved after page-mutable submit/formdata callbacks, so a call-time
 * exemption is a gesture-less navigation bypass; the sound fix is #936. A step
 * that fails with exactly that symptom (the tab stays on the fixture, the sink
 * iframe stays at about:blank, the only notice is "Blocked form submit" and the
 * only journal rows are nav_blank_prompt) marks the test as expected to fail, so
 * the scheduled advisory lane can flag a NEW failure. Any other failure (launch,
 * load, a different symptom) stays red, and once #936 fixes both steps the test
 * passes on its own.
 */
import { expect, test } from "@playwright/test";
import { AcceptanceSession, toastState } from "./acceptance_harness";

test("a background form post into the page's own named iframe is neither blocked nor announced", async ({}, testInfo) => {
  const session = await AcceptanceSession.open(testInfo, "fp-iframe-target-form");
  const outcomes: Array<"pass" | "known-865"> = [];
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
        const sinkFrame = page.frames().find((frame) => frame.name() === "sink");
        const sinkUrl = sinkFrame?.url() ?? "";
        const topPath = new URL(page.url()).pathname;
        const rows = (await session.eventLog()).slice(before).map((row) => String(row.kind));
        session.note(`cross=${cross}: top=${topPath} sink=${sinkUrl} toasts=${JSON.stringify([...seen])} rows=${JSON.stringify(rows)}`);
        await page.close();
        const reached = sinkUrl.includes("/acceptance/dest/iframe-post/");
        // The #865 shape exactly: the tab stays on the fixture, the sink iframe
        // still exists at about:blank (post held), the only notice is "Blocked
        // form submit" and the only rows are nav_blank_prompt. Anything else is
        // a new failure.
        const known865 = !reached && sinkUrl === "about:blank" &&
          topPath === "/acceptance/fp-iframe-target-form.html" &&
          [...seen].every((text) => text.startsWith("Blocked form submit")) &&
          rows.length > 0 && rows.every((kind) => kind === "nav_blank_prompt");
        if (known865) outcomes.push("known-865");
        else if (reached && seen.size === 0 && !rows.includes("nav_blank_prompt")) outcomes.push("pass");
        expect(sinkUrl, "the post reached its iframe").toContain("/acceptance/dest/iframe-post/");
        expect([...seen], "no NavSentinel notice for a navigation that never leaves the page").toEqual([]);
        expect(rows).not.toContain("nav_blank_prompt");
      }, { soft: true });
    }
    // Expected-fail only when both steps ran and every failure is the #865 one.
    // Accepted limit: this runs before session.close(), so a failure inside
    // close() (receipt write, teardown) is absorbed by the same expectation.
    // Remove this block and `outcomes` when #936 fixes both steps.
    if (outcomes.length === 2 && outcomes.includes("known-865")) {
      test.fail(true, "known false positive #865 (https://github.com/Chris0Jeky/NavSentinel/issues/865); fixed by #936");
    }
  } catch (error) {
    session.markFailed(error);
    throw error;
  } finally {
    await session.close();
  }
});
