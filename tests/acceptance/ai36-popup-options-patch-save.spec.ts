/**
 * AI-36 — #558 popup/Options patch-save synchronization (PR #589), encoding
 * docs/agentic/GATE3_GUIDES.md "AI-36" steps 3-8 on current main (the PR-branch
 * prechecks in steps 1-2 are superseded by the post-merge banner). Uses only
 * extension-owned surfaces: Options in a tab and the REAL toolbar popup opened
 * over that Options tab.
 *
 * Named deviation: the guide predates #643 Auto-save (on by default). Auto-save
 * is switched off first so "Paste warnings" can stay an unsaved dirty field,
 * which is what steps 4-7 require.
 *
 * Automated agent evidence only — never an owner Gate-3 result.
 */
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { AcceptanceSession, SETTINGS_KEY, repoRoot, trustedClick } from "./acceptance_harness";
import type { CdpPageClient } from "./cdp_page_client";
import { OPTIONS_PAGE } from "./extension_ui_helpers";

type Settings = { autoSave: boolean; nav: { defaultMode: string }; credential: { mode: string; warnOnPaste: boolean } };

async function optionsState(page: Page): Promise<{ nav: string | null; cred: string | null; paste: string | null; dirty: string | null }> {
  return {
    nav: await page.locator("#navModeSeg .seg-btn[aria-checked='true']").getAttribute("data-value"),
    cred: await page.locator("#credModeSeg .seg-btn[aria-checked='true']").getAttribute("data-value"),
    paste: await page.locator("#warnOnPaste").getAttribute("aria-checked"),
    dirty: await page.locator("#dirtyStatus").textContent(),
  };
}

async function popupModes(popup: CdpPageClient): Promise<string> {
  return popup.evaluate<string>(`["navSeg", "credSeg"].map((id) => document.querySelector("#" + id + " .seg-btn[aria-checked='true']")?.dataset.value).join("/")`);
}

test("AI-36: popup mode changes reach a dirty Options page live and survive its patch Save (#589)", async ({}, testInfo) => {
  test.setTimeout(300_000);
  const session = await AcceptanceSession.open(testInfo, "AI-36-popup-options-patch-save-589");
  const pageErrors: string[] = [];
  const settings = (label?: string) => session.storageLocal<Settings>(SETTINGS_KEY, label);
  try {
    await session.step("1-2. post-merge: record main head, Chrome and build (PR-branch prechecks superseded)", async () => {
      session.note(`head ${session.receipt.git.head}; Chrome ${session.chromeVersion}; ui-guard ${session.guardRevision}; dist ${session.receipt.build.distSha256}`);
      execGitAncestor(session);
      expect(session.receipt.git.productSourceClean).toBe(true);
    });

    let options!: Page;
    await session.step("3. baseline Navigation Smart, Credential Smart, Paste warnings checked; Save; reload confirms it", async () => {
      options = await session.openExtensionPage(OPTIONS_PAGE);
      options.on("pageerror", (error) => pageErrors.push(`options: ${error.message}`));
      await expect(options.locator("#dirtyStatus")).toHaveText("All changes saved");
      session.note("deviation: Auto-save (default on since #643) switched off so Paste warnings can remain an unsaved draft as steps 4-7 require");
      await trustedClick(options, "#autoSave");
      await expect.poll(async () => (await settings())?.autoSave).toBe(false);
      expect(await optionsState(options)).toMatchObject({ nav: "smart", cred: "smart", paste: "true" });
      await trustedClick(options, "#save");
      await expect(options.locator("#saveStatus")).toHaveText(/No changes\.|Saved\./);
      await options.reload({ waitUntil: "load" });
      await expect(options.locator("#dirtyStatus")).toHaveText("All changes saved");
      expect(await optionsState(options)).toMatchObject({ nav: "smart", cred: "smart", paste: "true" });
      await expect(options.locator("#autoSave")).not.toBeChecked();
      const stored = await settings("baseline");
      expect(`${stored.nav.defaultMode}/${stored.credential.mode}/${stored.credential.warnOnPaste}`).toBe("smart/smart/true");
    });

    await session.step("4. uncheck Paste warnings without saving (the unrelated dirty field)", async () => {
      await trustedClick(options, "#warnOnPaste");
      await expect(options.locator("#warnOnPaste")).toHaveAttribute("aria-checked", "false");
      await expect(options.locator("#dirtyStatus")).toHaveText("Unsaved changes");
      await options.evaluate(() => { (window as unknown as { __ai36NoReload?: string }).__ai36NoReload = "same-document"; });
      await options.waitForTimeout(600);
      expect((await settings())?.credential?.warnOnPaste, "dirty checkbox is not persisted").toBe(true);
    });

    await session.step("5. real popup: Navigation Strict, then Credential Strict; both selected states visible", async () => {
      const popup = await session.openPopup(options);
      expect(await popupModes(popup)).toBe("smart/smart");
      await popup.click("#navSeg .seg-btn[data-value='strict']");
      await popup.waitFor(`document.querySelector("#navSeg .seg-btn[data-value='strict']").getAttribute("aria-checked") === "true"`);
      await popup.click("#credSeg .seg-btn[data-value='strict']");
      await popup.waitFor(`document.querySelector("#credSeg .seg-btn[data-value='strict']").getAttribute("aria-checked") === "true"`);
      expect(await popupModes(popup)).toBe("strict/strict");
      await session.screenshotPopup("5-popup-both-strict");
      await session.closePopup();
    });

    await session.step("6. the already-open Options adopts both Strict modes live, keeps Paste warnings unchecked, was not reloaded; storage holds popup modes + old checkbox", async () => {
      await options.bringToFront();
      await expect(options.locator("#navModeSeg .seg-btn[data-value='strict']")).toHaveAttribute("aria-checked", "true");
      await expect(options.locator("#credModeSeg .seg-btn[data-value='strict']")).toHaveAttribute("aria-checked", "true");
      await expect(options.locator("#warnOnPaste"), "dirty checkbox not reverted").toHaveAttribute("aria-checked", "false");
      await expect(options.locator("#dirtyStatus")).toHaveText("Unsaved changes");
      await expect(options.locator("#settingsConflict")).toBeHidden();
      expect(await options.evaluate(() => (window as unknown as { __ai36NoReload?: string }).__ai36NoReload), "Options was not reloaded").toBe("same-document");
      const stored = await settings("after popup changes, before Options save");
      expect(stored.nav.defaultMode).toBe("strict");
      expect(stored.credential.mode).toBe("strict");
      expect(stored.credential.warnOnPaste).toBe(true);
      await session.screenshot(options, "6-options-adopted-popup-modes");
    });

    await session.step("7. Save in Options: modes stay strict, warnOnPaste becomes false; popup still Strict; reload keeps all three", async () => {
      await trustedClick(options, "#save");
      await expect.poll(async () => (await settings())?.credential?.warnOnPaste).toBe(false);
      const stored = await settings("after Options save");
      expect(`${stored.nav.defaultMode}/${stored.credential.mode}/${stored.credential.warnOnPaste}`).toBe("strict/strict/false");
      await expect(options.locator("#dirtyStatus")).toHaveText("All changes saved");
      const popup = await session.openPopup(options);
      expect(await popupModes(popup)).toBe("strict/strict");
      await session.screenshotPopup("7-popup-reopened-strict");
      await session.closePopup();
      await options.bringToFront();
      await options.reload({ waitUntil: "load" });
      await expect(options.locator("#dirtyStatus")).toHaveText("All changes saved");
      expect(await optionsState(options)).toMatchObject({ nav: "strict", cred: "strict", paste: "false" });
      const log = await session.eventLog("event log after AI-36");
      const configEvents = log.filter((entry) => entry.kind === "suite_config_update").map((entry) => entry.extra ?? null);
      session.note(`suite_config_update extras: ${JSON.stringify(configEvents)}`);
      const saves = configEvents.filter((extra) => extra && typeof extra === "object" && "patch" in (extra as object));
      if (saves.length) {
        expect((saves[saves.length - 1] as { patch: unknown }).patch, "Options saved only its dirty leaf").toEqual({ credential: { warnOnPaste: false } });
      } else {
        session.observe("Options save patch in event log", "no suite_config_update entry carried a patch (extra minimized); leaf-only save proven by storage values instead");
      }
    });

    await session.step("8. no rejected settings message, runtime messaging error or other console error on Options, popup or worker", async () => {
      const all = [...session.receipt.console, ...session.consoleErrors()];
      const settingsNoise = all.filter((entry) => /ns-suite-settings-update|Receiving end|settings save failed|Could not save/i.test(entry.text));
      const errors = session.consoleErrors([/favicon\.ico/]);
      session.note(`page errors: ${JSON.stringify(pageErrors)}; console errors: ${JSON.stringify(errors)}; settings-related console: ${JSON.stringify(settingsNoise)}`);
      expect(pageErrors).toEqual([]);
      expect(settingsNoise).toEqual([]);
      expect(errors).toEqual([]);
    }, { soft: true });

    const failedSteps = session.receipt.steps.filter((step) => step.status === "failed").map((step) => `${step.id} ${step.title}`);
    expect(failedSteps, "every procedure step passed").toEqual([]);
  } catch (error) {
    session.markFailed(error);
    throw error;
  } finally {
    await session.close();
  }
});

function execGitAncestor(session: AcceptanceSession): void {
  // PR #589 merge commit named in the guide's post-merge banner.
  execFileSync("git", ["merge-base", "--is-ancestor", "003905094982b9a772cc5f06fe504d372c99dd6b", session.receipt.git.head], { cwd: repoRoot });
}
