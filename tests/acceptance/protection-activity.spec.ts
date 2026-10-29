import { expect, test } from "@playwright/test";
import { AcceptanceSession, EVENT_LOG_KEY, trustedClick } from "./acceptance_harness";
import { EVIDENCE_PAGE, OPTIONS_PAGE, contrastRatio, parseCssColor, readDownload } from "./extension_ui_helpers";

test("Protection activity: categories, recovery, import/reset and accessible layouts", async ({}, testInfo) => {
  const session = await AcceptanceSession.open(testInfo, "protection-activity-592");
  try {
    const now = Date.now();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const row = (id: string, kind: string, extra = {}, reasons: string[] = []) => ({
      id, ts: now - 1000, kind, site: "fictional.test", reasons, extra,
    });
    const records = [
      row("overlay", "nav_click_block", { overlayAutoDismissed: true }),
      row("overlay", "nav_blank_prompt", { overlayAutoDismissed: true }),
      row("click", "nav_click_block"), row("redirect", "nav_rollback"),
      row("warn", "cred_paste_warn"),
      row("undo", "mutation_alert", { overlayCleanupOutcome: "restored", restored: false }, ["overlay_cleanup_undo"]),
      { ...row("yesterday", "nav_click_block"), ts: yesterday.getTime() },
    ];
    await session.setStorageLocal({ [EVENT_LOG_KEY]: records });
    const center = await session.openExtensionPage(EVIDENCE_PAGE);
    const errors: string[] = [];
    center.on("pageerror", error => errors.push(error.message));

    await session.step("one category per action, keyboard drill-down and truthful correction context", async () => {
      await expect(center.locator("#total")).toHaveText("6");
      for (const [id, count] of Object.entries({ overlays: 1, clicks: 2, redirects: 1, warnings: 1, corrections: 1 })) {
        await expect(center.locator(`#${id}Count`)).toHaveText(String(count));
        await center.locator(`#${id}Filter`).focus();
        await center.keyboard.press("Enter");
        await expect(center.locator("#journal")).toBeFocused();
        await expect(center.locator("details.event")).toHaveCount(count);
      }
      await center.locator("details.event summary").first().focus();
      await center.keyboard.press("Enter");
      await expect(center.locator("details[open]")).toContainText("Restoration was not confirmed");
      await expect(center.locator("details[open]")).not.toContainText("You restored an overlay");
      await expect(center.locator('#events a[href="../options/options.html"]')).toBeVisible();
      await center.locator("#resetFilters").click();
      await center.locator("#today").click();
      await expect(center.locator("#clicksCount")).toHaveText("1");
      await expect(center.locator("details.event")).toHaveCount(5);
      await center.locator("#history").click();
      await expect(center.locator("#retention")).toContainText("imports");
    });

    await session.step("three themes, narrow layout, readable category controls and reduced-motion parity", async () => {
      for (const width of [1280, 390]) {
        await center.setViewportSize({ width, height: 900 });
        for (const theme of ["forest", "paper", "midnight"]) {
          await center.locator("#theme").selectOption(theme);
          await center.locator("#overview").scrollIntoViewIfNeeded();
          expect(await center.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
          const colours = await center.locator("#overlaysFilter").evaluate(node => ({
            fg: getComputedStyle(node).color,
            bg: getComputedStyle(document.getElementById("activity")!).backgroundColor,
          }));
          expect(contrastRatio(parseCssColor(colours.fg).rgb, parseCssColor(colours.bg).rgb)).toBeGreaterThanOrEqual(4.5);
          await session.screenshot(center, `activity-${theme}-${width}`);
        }
      }
      await center.emulateMedia({ reducedMotion: "reduce" });
      await center.reload();
      await expect(center.locator("#overlaysCount")).toHaveText("1");
      expect(await center.locator("#activityShield").evaluate(node => getComputedStyle(node).animationName)).toBe("none");
      await session.screenshot(center, "activity-reduced-motion");
    });

    await session.step("legacy and corrupt records stay honest; unsupported clocks never count as Today", async () => {
      await session.setStorageLocal({ [EVENT_LOG_KEY]: [
        row("legacy", "mutation_alert", {}, ["overlay_detected"]),
        row("repeat", "mutation_alert", { overlayAutoDismissed: true, overlayCleanupOutcome: "reasserted" }, ["overlay_detected"]),
        { ...row("future", "nav_click_block"), ts: now + 86_400_000 },
        { ...row("invalid", "nav_click_block"), ts: 1e30 },
        { ...row("missing-id", "nav_click_block"), id: "" },
      ] });
      await expect(center.locator("#total")).toHaveText("3");
      await expect(center.locator("#overlaysCount")).toHaveText("0");
      await expect(center.locator("#clicksCount")).toHaveText("0");
      await expect(center.locator("#historyQuality")).toContainText("future");
      await expect(center.locator("#events")).toContainText("reasserted");
      await session.screenshot(center, "activity-legacy-corrupt");
      await session.setStorageLocal({ [EVENT_LOG_KEY]: [{ ...row("future", "nav_click_block"), ts: now + 86_400_000 }] });
      await expect(center.locator("#today")).toBeHidden();
    });

    await session.step("Options import and Clear behavioural data update the open dashboard and preserve the existing export", async () => {
      const options = await session.openExtensionPage(OPTIONS_PAGE);
      await options.locator("#importFile").setInputFiles({ name: "fictional-backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ eventLog: records })) });
      await expect(options.locator("#status")).toContainText("Imported.");
      await expect(center.locator("#overlaysCount")).toHaveText("1");
      await center.bringToFront();
      await center.locator("#correctionsFilter").click();
      await center.locator("#export").click();
      const payload = JSON.parse(await center.locator("#exportPreview").inputValue());
      expect(payload).toMatchObject({ format: "navsentinel-evidence", schema: 1 });
      expect(payload.events).toHaveLength(1);
      expect(Object.keys(payload.events[0]).sort()).toEqual(["destinationSite", "id", "kind", "outcome", "reasons", "sourceSite", "timestamp"]);
      await center.locator("#cancelExport").click();
      await options.bringToFront();
      const download = options.waitForEvent("download");
      await options.locator("#exportBtn").click();
      const backup = (await readDownload(await download)).toString("utf8");
      expect(JSON.parse(backup).eventLog).toEqual(records);
      options.once("dialog", dialog => void dialog.accept());
      await trustedClick(options, '.nav-btn[data-section="analytics"]');
      await trustedClick(options, "#clearBehavioural");
      await expect(options.locator("#status")).toContainText("Behavioural data cleared");
      await center.bringToFront();
      await expect(center.locator("#total")).toHaveText("0");
      await expect(center.locator("#milestone")).toHaveText("No retained activity yet");
      await expect(center.locator("#events")).toContainText("No retained events");
      await session.screenshot(center, "activity-empty-after-clear");
      await options.locator("#importFile").setInputFiles({ name: "restored-backup.json", mimeType: "application/json", buffer: Buffer.from(backup) });
      await expect(center.locator("#correctionsCount")).toHaveText("1");
      expect(errors).toEqual([]);
      expect(session.consoleErrors([/favicon\.ico/, /net::ERR_/])).toEqual([]);
    });
  } catch (error) {
    session.markFailed(error);
    throw error;
  } finally {
    await session.close();
  }
});
