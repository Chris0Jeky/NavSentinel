import { expect, test } from "@playwright/test";
import { AcceptanceSession, EVENT_LOG_KEY, trustedClick } from "./acceptance_harness";
import { EVIDENCE_PAGE, OPTIONS_PAGE, contrastRatio, parseCssColor, readDownload } from "./extension_ui_helpers";

test("Journal continuity: arrivals preserve reading; replacement, eviction and clear forget it", async ({}, testInfo) => {
  const session = await AcceptanceSession.open(testInfo, "journal-continuity-1162");
  try {
    const now = Date.now();
    const records = Array.from({ length: 57 }, (_, i) => ({
      id: `private-entry-${i}`, ts: now - (100 - i) * 1000, kind: "nav_click_block",
      site: `record-${i}.test`, url: `https://record-${i}.test/private?token=fictional`,
    }));
    await session.setStorageLocal({ [EVENT_LOG_KEY]: records.slice(0, 25) });
    const center = await session.openExtensionPage(EVIDENCE_PAGE);
    const errors: string[] = [];
    center.on("pageerror", error => errors.push(error.message));
    const row = (site: string) => center.locator("details.event").filter({ has: center.locator(".event-route", { hasText: site }) });
    await center.setViewportSize({ width: 1280, height: 900 });
    await expect(center.locator("#total")).toHaveText("25");
    const reading = row("record-0.test");
    const original = await reading.elementHandle();

    await session.step("append and prepend retain the actual row, keyboard focus and viewport across the page boundary", async () => {
      await reading.locator("summary").focus();
      await center.keyboard.press("Enter");
      await reading.locator("summary").evaluate(node => node.scrollIntoView({ block: "center", behavior: "instant" }));
      const top = (await reading.locator("summary").boundingBox())!.y;
      for (const entries of [records.slice(0, 55), [records[55], ...records.slice(0, 55)]]) {
        await session.setStorageLocal({ [EVENT_LOG_KEY]: entries });
        await expect(center.locator("#total")).toHaveText(String(entries.length));
        await expect(center.locator("#refresh")).toBeEnabled();
        expect(await original!.evaluate(node => node.isConnected && (node as HTMLDetailsElement).open)).toBe(true);
        await expect(reading.locator("summary")).toBeFocused();
        expect(Math.abs((await reading.locator("summary").boundingBox())!.y - top)).toBeLessThanOrEqual(2);
        await expect(center.locator("details.event")).toHaveCount(25);
        await expect(center.locator("#showLatest")).toBeVisible();
        await expect(row("record-54.test")).toHaveCount(0);
      }
      await session.screenshot(center, "journal-reading-desktop");
      await center.setViewportSize({ width: 390, height: 900 });
      await center.locator("#showLatest").scrollIntoViewIfNeeded();
      expect(await center.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await session.screenshot(center, "journal-reading-narrow");
    });

    await session.step("export uses every matching record and freezes reviewed bytes while newer arrivals wait", async () => {
      await center.locator("#export").click();
      const preview = await center.locator("#exportPreview").inputValue();
      const payload = JSON.parse(preview);
      expect(payload.events).toHaveLength(56);
      expect(payload.events[0].id).toBe("event-1");
      expect(Object.keys(payload.events[0]).sort()).toEqual(["destinationSite", "id", "kind", "outcome", "reasons", "sourceSite", "timestamp"]);
      expect(preview).not.toMatch(/private-entry|private\?token/);
      await session.setStorageLocal({ [EVENT_LOG_KEY]: records });
      await expect(center.locator("#total")).toHaveText("57");
      await expect(center.locator("#exportPreview")).toHaveValue(preview);
      const downloaded = center.waitForEvent("download");
      await center.locator("#downloadExport").click();
      expect((await readDownload(await downloaded)).toString("utf8")).toBe(preview);
      await expect(center.locator("#export")).toBeFocused();
      await center.locator("#showLatest").click();
      await expect(center.locator("#journal")).toBeFocused();
      expect(await original!.evaluate(node => node.isConnected)).toBe(false);
      await expect(row("record-56.test")).toBeVisible();
      await center.locator("#search").fill("record-0.test");
      await expect(reading).toHaveCount(1);
      await expect(reading).not.toHaveAttribute("open");
      await expect(center.locator("#search")).toBeFocused();
      await center.locator("#resetFilters").click();
      await center.locator("#next").click();
      await expect(center.locator("#pageLabel")).toHaveText("Page 2 of 3");
    });

    await session.step("reused IDs, eviction and clear remove old details and restore journal focus", async () => {
      const entry = records[0]!;
      for (const change of ["replacement", "eviction", "clear"] as const) {
        await session.setStorageLocal({ [EVENT_LOG_KEY]: [entry] });
        await expect(center.locator("#total")).toHaveText("1");
        await reading.locator("summary").focus();
        await center.keyboard.press("Enter");
        const removed = await reading.elementHandle();
        const replacement = { ...entry, url: "https://record-0.test/replaced?token=other" };
        await session.setStorageLocal({ [EVENT_LOG_KEY]: change === "replacement" ? [entry, replacement]
          : change === "eviction" ? [records[1]] : [] });
        await expect.poll(() => removed!.evaluate(node => node.isConnected)).toBe(false);
        await expect(center.locator("#journal")).toBeFocused();
        await expect(center.locator("#status")).toContainText("no longer");
        if (change === "replacement") await expect(reading).not.toHaveAttribute("open");
        else await expect(reading).toHaveCount(0);
      }
      await session.screenshot(center, "journal-cleared");
      await session.setStorageLocal({ [EVENT_LOG_KEY]: [records[0]] });
      await expect(reading).not.toHaveAttribute("open");
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
