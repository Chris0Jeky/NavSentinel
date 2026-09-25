/**
 * AI-47 row 6 — Settings autosave and conflict choices (#643, #655, #658),
 * encoding docs/agentic/GATE3_558_SETTINGS_AUTOSAVE.md steps 1-8 in a fresh
 * branded-Chrome profile. The two "Options windows" are real separate browser
 * windows; the popup is the real toolbar popup bound to a Gym tab.
 *
 * Automated agent evidence only — never an owner Gate-3 result, and never a
 * substitute for Chris's #658 same-field observation.
 */
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { AcceptanceSession, SETTINGS_KEY, acceptanceRunDirectory, trustedClick } from "./acceptance_harness";
import type { CdpPageClient } from "./cdp_page_client";
import {
  OPTIONS_PAGE,
  contrastRatio,
  openExtensionWindow,
  parseCssColor,
  popupTabUntil,
  readDownload,
  tabUntil,
} from "./extension_ui_helpers";

type Settings = {
  autoSave: boolean;
  nav: { defaultMode: string; debug: boolean; autoDismissOverlays: boolean };
  credential: { mode: string; warnOnPaste: boolean; blockHttpPasswordSubmit: boolean; promptOnUntrustedDomain: boolean; promptOnMediumRisk: boolean; mediumRiskThreshold: number; similarity: { enabled: boolean; maxDistance: number } };
  logLimit: number;
};

const GREEN = "rgb(122, 183, 135)";
const RED = "rgb(208, 69, 49)";
const INVALID_TEXT = "Unsaved changes — enter valid numbers within the shown limits.";

function leafDiff(a: unknown, b: unknown, prefix = ""): string[] {
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    return [...keys].flatMap((key) => leafDiff((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], prefix ? `${prefix}.${key}` : key));
  }
  return Object.is(a, b) ? [] : [prefix];
}

async function segValue(page: Page, segId: string): Promise<string | null> {
  return page.locator(`#${segId} .seg-btn[aria-checked='true']`).getAttribute("data-value");
}

async function toggleValue(page: Page, id: string): Promise<boolean> {
  return (await page.locator(`#${id}`).getAttribute("aria-checked")) === "true";
}

async function clickSeg(page: Page, segId: string, value: string): Promise<void> {
  await trustedClick(page, `#${segId} .seg-btn[data-value='${value}']`);
  await expect(page.locator(`#${segId} .seg-btn[data-value='${value}']`)).toHaveAttribute("aria-checked", "true");
}

async function replaceNumber(page: Page, id: string, text: string): Promise<void> {
  await trustedClick(page, `#${id}`);
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  if (text) await page.keyboard.type(text);
}

async function popupSeg(popup: CdpPageClient, segId: string): Promise<string> {
  return popup.evaluate<string>(`document.querySelector("#${segId} .seg-btn[aria-checked='true']")?.dataset.value ?? ""`);
}

test("AI-47.6: settings autosave and conflict choices (#643, #655, #658) in branded Chrome", async ({}, testInfo) => {
  test.setTimeout(540_000);
  const session = await AcceptanceSession.open(testInfo, "AI-47.6-settings-autosave-643-655-658");
  const pageErrors: string[] = [];
  const settings = (label?: string) => session.storageLocal<Settings>(SETTINGS_KEY, label);
  const exportsDir = path.join(acceptanceRunDirectory(), "ai47-6-exports");
  fs.mkdirSync(exportsDir, { recursive: true });
  try {
    let web!: Page;
    await session.step("1. record head, Chrome and exact build markers (capture=1, bridge=1, built ui-guard)", async () => {
      web = await session.newPage();
      const markers = await session.gotoReady(web, session.url("/index.html"));
      session.note(`head ${session.receipt.git.head}; Chrome ${session.chromeVersion}; markers ${JSON.stringify(markers)}`);
      expect(markers).toEqual({ capture: "1", bridge: "1", guard: session.guardRevision });
      expect(session.receipt.git.productSourceClean).toBe(true);
    });

    let A!: Page;
    await session.step("2. fresh profile: Auto-save on; arrow-key Navigation change and overlay toggle persist after reload without Save", async () => {
      A = await openExtensionWindow(session, OPTIONS_PAGE);
      A.on("pageerror", (error) => pageErrors.push(`options A: ${error.message}`));
      await expect(A.locator("#dirtyStatus")).toHaveText("All changes saved");
      await expect(A.locator("#autoSave")).toBeChecked();
      expect((await settings())?.autoSave ?? true).toBe(true);
      await tabUntil(A, "document.activeElement?.closest('#navModeSeg')", 40);
      expect(await A.evaluate(() => (document.activeElement as HTMLElement).dataset.value)).toBe("smart");
      await A.keyboard.press("ArrowRight");
      await expect(A.locator("#navModeSeg .seg-btn[data-value='strict']")).toHaveAttribute("aria-checked", "true");
      await tabUntil(A, "document.activeElement?.id === 'dismiss'", 10);
      await A.keyboard.press("Space");
      await expect(A.locator("#dismiss")).toHaveAttribute("aria-checked", "true");
      await expect.poll(async () => { const s = await settings(); return `${s?.nav?.defaultMode}/${s?.nav?.autoDismissOverlays}`; }, { timeout: 5000 }).toBe("strict/true");
      await A.reload({ waitUntil: "load" });
      await expect(A.locator("#navModeSeg .seg-btn[data-value='strict']")).toHaveAttribute("aria-checked", "true");
      await expect(A.locator("#dismiss")).toHaveAttribute("aria-checked", "true");
      await expect(A.locator("#dirtyStatus")).toHaveText("All changes saved");
      await session.screenshot(A, "2-autosaved-after-reload");
    });

    await session.step("3. cleanup status: Active (green) in Smart/Strict, Paused · Navigation Off (red) in Off, Disabled when off — Options and popup match", async () => {
      const expectState = async (text: string, state: string, color: string | null) => {
        await expect(A.locator("#cleanupStatus")).toHaveText(text);
        await expect(A.locator("#cleanupStatus")).toHaveAttribute("data-state", state);
        if (color) expect(await A.locator("#cleanupStatus").evaluate((el) => getComputedStyle(el).color)).toBe(color);
        const popup = await session.openPopup(web);
        const popupStatus = await popup.evaluate<{ text: string; state: string; color: string }>(`(() => { const el = document.getElementById("cleanupStatus"); return { text: el.textContent, state: el.dataset.state, color: getComputedStyle(el).color }; })()`);
        session.note(`cleanup ${text}: popup ${JSON.stringify(popupStatus)}`);
        expect(popupStatus.text).toBe(text);
        expect(popupStatus.state).toBe(state);
        if (color) expect(popupStatus.color).toBe(color);
        await session.screenshotPopup(`3-popup-cleanup-${state}`);
        await session.closePopup();
        await A.bringToFront();
      };
      await expectState("Active", "active", GREEN);
      await clickSeg(A, "navModeSeg", "smart");
      await expect.poll(async () => (await settings())?.nav?.defaultMode).toBe("smart");
      await expectState("Active", "active", GREEN);
      await clickSeg(A, "navModeSeg", "off");
      await expect.poll(async () => (await settings())?.nav?.defaultMode).toBe("off");
      await expectState("Paused · Navigation Off", "paused", RED);
      await session.screenshot(A, "3-options-cleanup-paused");
      await trustedClick(A, "#dismiss");
      await expect.poll(async () => (await settings())?.nav?.autoDismissOverlays).toBe(false);
      await expectState("Disabled", "disabled", null);
      await clickSeg(A, "navModeSeg", "smart");
      await expect.poll(async () => (await settings())?.nav?.defaultMode).toBe("smart");
    });

    let B!: Page;
    await session.step("4. invalid/out-of-range number keeps Save unavailable; a second window's change keeps the incomplete input; both converge on a valid value", async () => {
      await replaceNumber(A, "logLimit", "");
      await expect(A.locator("#dirtyStatus")).toHaveText(INVALID_TEXT);
      await expect(A.locator("#save")).toBeDisabled();
      await replaceNumber(A, "logLimit", "20000");
      await expect(A.locator("#dirtyStatus")).toHaveText(INVALID_TEXT);
      await expect(A.locator("#save")).toBeDisabled();
      await A.waitForTimeout(600);
      expect((await settings())?.logLimit, "invalid input is never autosaved").toBe(300);
      B = await openExtensionWindow(session, OPTIONS_PAGE);
      B.on("pageerror", (error) => pageErrors.push(`options B: ${error.message}`));
      await expect(B.locator("#dirtyStatus")).toHaveText("All changes saved");
      expect(await toggleValue(B, "warnOnPaste")).toBe(true);
      await trustedClick(B, "#warnOnPaste");
      await expect.poll(async () => (await settings())?.credential?.warnOnPaste).toBe(false);
      await A.bringToFront();
      await expect(A.locator("#warnOnPaste"), "window A adopts the clean field changed in B").toHaveAttribute("aria-checked", "false");
      expect(await A.locator("#logLimit").inputValue(), "incomplete input remains intact").toBe("20000");
      await expect(A.locator("#save")).toBeDisabled();
      await expect(A.locator("#dirtyStatus")).toHaveText(INVALID_TEXT);
      await session.screenshot(A, "4-invalid-number-kept");
      await replaceNumber(A, "logLimit", "400");
      await expect.poll(async () => (await settings())?.logLimit, { timeout: 5000 }).toBe(400);
      await expect(B.locator("#logLimit")).toHaveValue("400");
      await expect(A.locator("#dirtyStatus")).toHaveText("All changes saved");
      await expect(B.locator("#dirtyStatus")).toHaveText("All changes saved");
      expect(await toggleValue(A, "warnOnPaste")).toBe(false);
    });

    await session.step("5. disable Auto-save survives reload; edits across panes stay unsaved with Save/Discard; Discard restores; Save persists only the edited field", async () => {
      await A.bringToFront();
      await trustedClick(A, "#autoSave");
      await expect.poll(async () => (await settings())?.autoSave).toBe(false);
      await A.reload({ waitUntil: "load" });
      await expect(A.locator("#autoSave")).not.toBeChecked();
      await expect(B.locator("#autoSave"), "second window adopts the preference").not.toBeChecked();
      const before = await settings();
      await trustedClick(A, "#blockHttpPasswordSubmit");
      await expect(A.locator("#dirtyStatus")).toHaveText("Unsaved changes");
      for (const section of ["analytics", "log", "trust", "protect"]) {
        await trustedClick(A, `.nav-btn[data-section='${section}']`);
        await expect(A.locator("#dirtyStatus")).toHaveText("Unsaved changes");
        await expect(A.locator("#save")).toBeEnabled();
        await expect(A.locator("#discard")).toBeEnabled();
      }
      await A.waitForTimeout(600);
      expect(leafDiff(before, await settings()), "nothing saved without Save").toEqual([]);
      await session.screenshot(A, "5-unsaved-changes");
      await trustedClick(A, "#discard");
      await expect(A.locator("#blockHttpPasswordSubmit")).toHaveAttribute("aria-checked", "true");
      await expect(A.locator("#dirtyStatus")).toHaveText("All changes saved");
      await trustedClick(A, "#blockHttpPasswordSubmit");
      await trustedClick(A, "#save");
      await expect.poll(async () => (await settings())?.credential?.blockHttpPasswordSubmit).toBe(false);
      expect(leafDiff(before, await settings("after step-5 save")), "Save persisted only the edited leaf").toEqual(["credential.blockHttpPasswordSubmit"]);
      await expect(A.locator("#dirtyStatus")).toHaveText("All changes saved");
    });

    await session.step("6a. conflict: A drafts Strict, B saves Off -> A keeps its draft; 'Use external values' adopts Off and keeps unrelated edits", async () => {
      expect(await segValue(A, "navModeSeg")).toBe("smart");
      expect(await segValue(B, "navModeSeg")).toBe("smart");
      const mediumBefore = await toggleValue(A, "promptOnMediumRisk");
      await trustedClick(A, "#promptOnMediumRisk");
      await clickSeg(A, "navModeSeg", "strict");
      await B.bringToFront();
      await clickSeg(B, "navModeSeg", "off");
      await trustedClick(B, "#save");
      await expect.poll(async () => (await settings())?.nav?.defaultMode).toBe("off");
      await A.bringToFront();
      await expect(A.locator("#settingsConflict")).toBeVisible();
      await expect(A.locator("#conflictText")).toContainText("nav.defaultMode");
      await expect(A.locator("#dirtyStatus")).toHaveText("Conflicting changes — choose which values to keep.");
      expect(await segValue(A, "navModeSeg"), "A keeps its draft").toBe("strict");
      await expect(A.locator("#save")).toBeDisabled();
      await session.screenshot(A, "6a-conflict-shown");
      await trustedClick(A, "#useExternal");
      await expect(A.locator("#settingsConflict")).toBeHidden();
      expect(await segValue(A, "navModeSeg")).toBe("off");
      expect(await toggleValue(A, "promptOnMediumRisk"), "unrelated unsaved edit remains").toBe(!mediumBefore);
      await expect(A.locator("#dirtyStatus")).toHaveText("Unsaved changes");
      expect((await settings())?.credential?.promptOnMediumRisk).toBe(mediumBefore);
      await trustedClick(A, "#discard");
      await expect(A.locator("#dirtyStatus")).toHaveText("All changes saved");
    });

    await session.step("6b. conflict repeated with 'Keep my edits' then Save: the explicit local choice wins and both windows show it", async () => {
      await clickSeg(A, "navModeSeg", "smart");
      await trustedClick(A, "#save");
      await expect.poll(async () => (await settings())?.nav?.defaultMode).toBe("smart");
      await expect.poll(() => segValue(B, "navModeSeg")).toBe("smart");
      await clickSeg(A, "navModeSeg", "strict");
      await B.bringToFront();
      await clickSeg(B, "navModeSeg", "off");
      await trustedClick(B, "#save");
      await expect.poll(async () => (await settings())?.nav?.defaultMode).toBe("off");
      await A.bringToFront();
      await expect(A.locator("#settingsConflict")).toBeVisible();
      await trustedClick(A, "#keepDraft");
      await expect(A.locator("#settingsConflict")).toBeHidden();
      expect(await segValue(A, "navModeSeg")).toBe("strict");
      await trustedClick(A, "#save");
      await expect.poll(async () => (await settings())?.nav?.defaultMode).toBe("strict");
      await expect.poll(() => segValue(B, "navModeSeg"), { message: "window B shows the kept local choice" }).toBe("strict");
      await expect(A.locator("#dirtyStatus")).toHaveText("All changes saved");
      await expect(B.locator("#dirtyStatus")).toHaveText("All changes saved");
    });

    await session.step("6c. differing Navigation saves in both windows without waiting: the later write shows the conflict choice, never a silent overwrite", async () => {
      await clickSeg(A, "navModeSeg", "off");
      await clickSeg(B, "navModeSeg", "smart");
      await Promise.all([trustedClick(A, "#save"), trustedClick(B, "#save")]);
      await A.waitForTimeout(2000);
      const persisted = (await settings("after simultaneous saves"))?.nav?.defaultMode;
      const conflictA = await A.locator("#settingsConflict").isVisible();
      const conflictB = await B.locator("#settingsConflict").isVisible();
      const draftA = await segValue(A, "navModeSeg");
      const draftB = await segValue(B, "navModeSeg");
      session.note(`simultaneous saves: persisted=${persisted}; A draft=${draftA} conflict=${conflictA}; B draft=${draftB} conflict=${conflictB}`);
      await session.screenshot(A, "6c-window-a");
      await session.screenshot(B, "6c-window-b");
      expect(Number(conflictA) + Number(conflictB), "exactly one window (the later write) shows the conflict").toBe(1);
      const winner = conflictA ? { draft: draftB } : { draft: draftA };
      const loser = conflictA ? { page: A, draft: draftA, want: "off" } : { page: B, draft: draftB, want: "smart" };
      expect(persisted, "storage holds the first write, not a silent replacement").toBe(winner.draft);
      expect(loser.draft, "the later window keeps its own draft").toBe(loser.want);
      await trustedClick(loser.page, "#useExternal");
      await trustedClick(loser.page, "#discard");
      await expect.poll(() => segValue(A, "navModeSeg")).toBe(persisted);
      await expect.poll(() => segValue(B, "navModeSeg")).toBe(persisted);
      // Converge back on Smart for step 7.
      await clickSeg(A, "navModeSeg", "smart");
      await trustedClick(A, "#save");
      await expect.poll(async () => (await settings())?.nav?.defaultMode).toBe("smart");
    });

    await session.step("7. dirty unrelated Options field + popup Navigation/Credential/overlay changes (mouse and keyboard) + Save Options: popup choices survive; status readable when narrow", async () => {
      await B.close();
      await A.bringToFront();
      await A.setViewportSize({ width: 480, height: 860 });
      await expect(A.locator("#dirtyStatus")).toHaveText("All changes saved");
      const untrustedBefore = await toggleValue(A, "promptOnUntrustedDomain");
      await A.locator("#promptOnUntrustedDomain").focus();
      await A.keyboard.press("Space");
      await expect(A.locator("#dirtyStatus")).toHaveText("Unsaved changes");
      const start = await settings();
      expect(`${start.nav.defaultMode}/${start.credential.mode}/${start.nav.autoDismissOverlays}`).toBe("smart/smart/false");
      const popup = await session.openPopup(web);
      await popup.click("#navSeg .seg-btn[data-value='strict']");
      await popup.waitFor(`document.querySelector("#navSeg .seg-btn[data-value='strict']").getAttribute("aria-checked") === "true"`);
      await popupTabUntil(popup, "document.activeElement?.id === 'autoDismiss'");
      await popup.press("Space");
      await popup.waitFor("document.getElementById('autoDismiss').checked === true");
      await popupTabUntil(popup, "document.activeElement?.closest('#credSeg')");
      await popup.press("ArrowRight");
      await popup.waitFor(`document.querySelector("#credSeg .seg-btn[data-value='strict']").getAttribute("aria-checked") === "true"`);
      await expect.poll(async () => { const s = await settings(); return `${s.nav.defaultMode}/${s.credential.mode}/${s.nav.autoDismissOverlays}`; }).toBe("strict/strict/true");
      await session.screenshotPopup("7-popup-changes");
      await session.closePopup();
      await A.bringToFront();
      await expect(A.locator("#navModeSeg .seg-btn[data-value='strict']")).toHaveAttribute("aria-checked", "true");
      await expect(A.locator("#credModeSeg .seg-btn[data-value='strict']")).toHaveAttribute("aria-checked", "true");
      await expect(A.locator("#dismiss")).toHaveAttribute("aria-checked", "true");
      expect(await toggleValue(A, "promptOnUntrustedDomain"), "dirty field survives the popup update").toBe(!untrustedBefore);
      await A.locator("#save").focus();
      await A.keyboard.press("Enter");
      await expect.poll(async () => (await settings())?.credential?.promptOnUntrustedDomain).toBe(!untrustedBefore);
      const after = await settings("after step-7 Options save");
      expect(`${after.nav.defaultMode}/${after.credential.mode}/${after.nav.autoDismissOverlays}`, "popup choices survive the Options save").toBe("strict/strict/true");
      const layout = await A.evaluate(() => {
        const bar = document.querySelector(".settings-state") as HTMLElement;
        const status = document.getElementById("dirtyStatus")!;
        const rect = status.getBoundingClientRect();
        return {
          barOverflow: bar.scrollWidth - bar.clientWidth,
          pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
          statusInside: rect.left >= 0 && rect.right <= window.innerWidth && rect.width > 0,
          statusText: status.textContent,
          color: getComputedStyle(status).color,
          background: getComputedStyle(bar).backgroundColor,
        };
      });
      session.note(`narrow Options (480px) layout: ${JSON.stringify(layout)}`);
      await session.screenshot(A, "7-options-narrow-saved");
      expect(layout.statusText).toBe("All changes saved");
      expect(layout.barOverflow).toBeLessThanOrEqual(0);
      expect(layout.statusInside).toBe(true);
      expect(contrastRatio(parseCssColor(layout.color).rgb, parseCssColor(layout.background).rgb)).toBeGreaterThanOrEqual(4.5);
      const reopened = await session.openPopup(web);
      expect(await popupSeg(reopened, "navSeg")).toBe("strict");
      expect(await popupSeg(reopened, "credSeg")).toBe("strict");
      expect(await reopened.evaluate<boolean>("document.getElementById('autoDismiss').checked")).toBe(true);
      await session.closePopup();
      await A.setViewportSize({ width: 1100, height: 800 });
    });

    await session.step("8. export with Auto-save off, enable it, import the backup: Auto-save returns to off and the complete draft is replaced; logLimit 55 backup accepted and preserved after a later save (#655)", async () => {
      await A.bringToFront();
      await expect(A.locator("#autoSave")).not.toBeChecked();
      const firstDownload = A.waitForEvent("download", { timeout: 10_000 });
      await trustedClick(A, "#exportBtn");
      const exported = await firstDownload;
      const backupFile = path.join(exportsDir, "backup-autosave-off.json");
      await exported.saveAs(backupFile);
      const backup = JSON.parse((await readDownload(exported)).toString("utf8")) as { settings: Settings };
      expect(backup.settings.autoSave).toBe(false);
      expect(backup.settings.logLimit).toBe(400);
      await trustedClick(A, "#autoSave");
      await expect.poll(async () => (await settings())?.autoSave).toBe(true);
      // An unsaved (invalid) draft that the import must replace.
      await replaceNumber(A, "logLimit", "");
      await expect(A.locator("#dirtyStatus")).toHaveText(INVALID_TEXT);
      await A.locator("#importFile").setInputFiles(backupFile);
      await expect(A.locator("#status")).toHaveText(/^Imported\./, { timeout: 10_000 });
      await expect.poll(async () => (await settings())?.autoSave).toBe(false);
      await expect(A.locator("#autoSave")).not.toBeChecked();
      await expect(A.locator("#logLimit"), "import replaced the incomplete draft").toHaveValue("400");
      await expect(A.locator("#dirtyStatus")).toHaveText("All changes saved");

      const backup55 = { ...backup, settings: { ...backup.settings, logLimit: 55 } };
      const backup55File = path.join(exportsDir, "backup-loglimit-55.json");
      fs.writeFileSync(backup55File, JSON.stringify(backup55, null, 2));
      await A.locator("#importFile").setInputFiles(backup55File);
      await expect(A.locator("#status")).toHaveText(/^Imported\./, { timeout: 10_000 });
      await expect(A.locator("#logLimit")).toHaveValue("55");
      await expect(A.locator("#dirtyStatus"), "no validation error for 55").toHaveText("All changes saved");
      await expect(A.locator("#save")).toBeEnabled();
      expect(await A.locator("#logLimit").evaluate((el) => (el as HTMLInputElement).validity.valid)).toBe(true);
      await expect.poll(async () => (await settings())?.logLimit).toBe(55);
      const navBefore = await segValue(A, "navModeSeg");
      const navNext = navBefore === "smart" ? "strict" : "smart";
      await clickSeg(A, "navModeSeg", navNext);
      await trustedClick(A, "#save");
      await expect.poll(async () => (await settings())?.nav?.defaultMode).toBe(navNext);
      expect((await settings("after #655 save"))?.logLimit).toBe(55);
      const secondDownload = A.waitForEvent("download", { timeout: 10_000 });
      await trustedClick(A, "#exportBtn");
      const reexported = await secondDownload;
      await reexported.saveAs(path.join(exportsDir, "re-export-after-55.json"));
      const again = JSON.parse((await readDownload(reexported)).toString("utf8")) as { settings: Settings };
      expect(again.settings.logLimit, "#655: logLimit stays 55 after a later save").toBe(55);
      expect(again.settings.nav.defaultMode).toBe(navNext);
      await session.screenshot(A, "8-after-import-55");
    });

    await session.step("no uncaught page errors and no console errors on Options, popup or worker", async () => {
      const errors = session.consoleErrors([/favicon\.ico/]);
      session.note(`page errors: ${JSON.stringify(pageErrors)}; console errors: ${JSON.stringify(errors)}`);
      expect(pageErrors).toEqual([]);
      expect(errors).toEqual([]);
    }, { soft: true });

    // Soft steps keep the procedure running past a finding; the test still fails on any.
    const failedSteps = session.receipt.steps.filter((step) => step.status === "failed").map((step) => `${step.id} ${step.title}`);
    expect(failedSteps, "every procedure step passed").toEqual([]);
  } finally {
    await session.close();
  }
});
