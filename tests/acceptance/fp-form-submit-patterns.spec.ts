/**
 * False-positive characterization: script-driven form submissions that follow
 * a trusted user action on ordinary sites (found live on Stack Overflow's
 * "Log in with Google", 2026-09-24). Each case is a same-origin, declared form
 * submitted by the page's own handler for the user's click, key or selection.
 * The matrix records which patterns NavSentinel blocks in a real browser.
 *
 * #864 made every click-driven pattern pass by arming the submit allowance in
 * the click's own task. The keyboard-only selection cases stay blocked on
 * purpose: no trusted click happens, so not even the one-task-deferred submit
 * gets an allowance, and #864 does not widen the policy beyond that deferred
 * baseline. The deferred select control proves that blocking is not a timing
 * artefact. Allowing them needs a separate owner decision (see the #864 PR).
 */
import { expect, test, type Page } from "@playwright/test";
import { AcceptanceSession, toastState, trustedClick } from "./acceptance_harness";

type Trigger = (page: Page) => Promise<void>;

const clickGoogle: Trigger = (page) => trustedClick(page, "#openid-buttons [data-provider]");
const clickSearch: Trigger = (page) => trustedClick(page, "#validated-submit");
const pickWithKeyboard: Trigger = async (page) => {
  await page.focus("#auto-select");
  await page.keyboard.press("ArrowDown");
};
const KEYBOARD_ONLY = "keyboard-only selection: no trusted click, so no allowance even one task later (policy unchanged by #864)";
const CASES: Array<{ name: string; description: string; trigger: Trigger; blocked?: string }> = [
  { name: "native-submit", description: "plain submit button, no script (baseline)", trigger: clickSearch },
  { name: "outside-sync", description: "button outside the form; handler submits synchronously (Stack Overflow / jQuery .trigger('submit'))", trigger: clickGoogle },
  { name: "outside-request-submit", description: "button outside the form; handler calls requestSubmit() synchronously", trigger: clickGoogle },
  { name: "outside-microtask", description: "button outside the form; handler submits in a microtask", trigger: clickGoogle },
  { name: "outside-timeout-50", description: "button outside the form; handler submits after 50 ms", trigger: clickGoogle },
  { name: "validate-sync", description: "submit handler prevents default, validates, submits synchronously (validation libraries)", trigger: clickSearch },
  { name: "validate-timeout-0", description: "submit handler prevents default, submits on the next task", trigger: clickSearch },
  { name: "link-onclick-sync", description: "legacy <a href=# onclick=form.submit()>", trigger: (page) => trustedClick(page, "#link-submit") },
  { name: "select-onchange-sync", description: "sort picker auto-submits on change (keyboard selection)", trigger: pickWithKeyboard, blocked: KEYBOARD_ONLY },
  { name: "select-onchange-timeout-0", description: "control: the same keyboard selection, submit deferred one task", trigger: pickWithKeyboard, blocked: KEYBOARD_ONLY },
];

test("false-positive matrix: script-driven same-origin form submissions after trusted input", async ({}, testInfo) => {
  const session = await AcceptanceSession.open(testInfo, "fp-form-submit-patterns");
  const matrix: Array<{ case: string; navigated: boolean; toast: string | null }> = [];
  try {
    for (const entry of CASES) {
      await session.step(`${entry.name}: ${entry.description}`, async () => {
        const page = await session.newPage();
        await session.gotoReady(page, session.url(`/acceptance/fp-form-submit-patterns.html?case=${entry.name}`));
        await page.waitForTimeout(6500);
        const journalBefore = (await session.eventLog()).length;
        const toasts = new Set<string>();
        let navigated = false;
        const settled = page.waitForURL((url) => url.pathname.includes(`/submit-${entry.name}/`), { timeout: 4000 })
          .then(() => { navigated = true; }, () => undefined);
        await entry.trigger(page);
        const handler = await page.evaluate(() => document.documentElement.dataset.acceptanceHandler ?? null).catch(() => "navigated-away");
        for (let tick = 0; tick < 20 && !navigated; tick += 1) {
          const state = await toastState(page).catch(() => null);
          if (state?.text) toasts.add(state.text);
          await page.waitForTimeout(200);
        }
        await settled;
        const toast = toasts.size ? [...toasts].join(" | ") : null;
        const journal = (await session.eventLog()).slice(journalBefore).map((row) => `${String(row.kind)}:${String(row.destHost ?? "")}`);
        matrix.push({ case: entry.name, navigated, toast });
        session.note(`${entry.name}: handler=${JSON.stringify(handler)} navigated=${navigated} toast=${JSON.stringify(toast)} journal=${JSON.stringify(journal)}`);
        if (!navigated) await session.screenshot(page, `blocked-${entry.name}`);
        await page.close();
        if (entry.blocked) {
          expect(handler, `${entry.name}: the page handler must have run for the block to mean anything`).toMatch(/:/);
          expect(navigated, `${entry.name} stays blocked: ${entry.blocked}`).toBe(false);
        } else {
          expect(navigated, `${entry.name} should reach its declared same-origin destination`).toBe(true);
        }
      }, { soft: true });
    }
    session.note(`matrix: ${JSON.stringify(matrix)}`);
  } catch (error) {
    session.markFailed(error);
    throw error;
  } finally {
    await session.close();
  }
});
