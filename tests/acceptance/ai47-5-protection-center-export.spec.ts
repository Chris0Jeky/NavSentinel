/**
 * AI-47 row 5 — Protection Center (#640, docs/vision-overhaul/BROWSER_ACCEPTANCE.md)
 * and the evidence export preview (#641, docs/vision-overhaul/EXPORT_REVIEW.md
 * "Human Chrome check — AI-45"), encoded step by step in a fresh branded-Chrome
 * profile. Real events are recorded first by triggering detections on loopback
 * pages whose URLs, destinations, password value and paste payload carry unique
 * markers; the downloaded export is then scanned for every marker.
 *
 * Automated agent evidence only — never an owner Gate-3 result.
 */
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { AcceptanceSession, EVENT_LOG_KEY, SETTINGS_KEY, acceptanceRunDirectory, toastState, trustedClick } from "./acceptance_harness";
import {
  EVIDENCE_PAGE,
  OPTIONS_PAGE,
  allowProceedControls,
  contrastRatio,
  downloadWithin,
  parseCssColor,
  readDownload,
  shadowButtonPoint,
  tabUntil,
  uniqueMarker,
} from "./extension_ui_helpers";

const SOURCE_FIXTURE = "/acceptance/extui-srcpath-nspathmark7q/evidence-source.html";
const STATIC_PATH_MARKERS = ["nspathmark7q", "extui-srcpath", "evidence-source"];
const SAFE_CLAIMS = [/\b(is|are|looks?|appears?) safe\b/i, /\byou('re| are) (safe|protected)\b/i, /\bno threats?\b/i, /\bverified safe\b/i, /\bsafe to (use|visit|browse)\b/i, /\ball clear\b/i];
const EXPORT_TOP_KEYS = ["events", "evidence", "exportedAt", "format", "schema", "source"];
const EXPORT_EVENT_KEYS = new Set(["id", "timestamp", "kind", "sourceSite", "destinationSite", "outcome", "reasons", "score"]);
const THEMES = ["forest", "paper", "midnight"] as const;

async function waitForSnapshot(pc: Page): Promise<void> {
  await expect(pc.locator("#status")).toContainText("Local snapshot refreshed", { timeout: 10_000 });
}

async function resultsCounts(pc: Page): Promise<{ matching: number; retained: number }> {
  const text = (await pc.locator("#results").textContent()) ?? "";
  const match = /^(\d+) of (\d+) retained events match/.exec(text.trim());
  if (!match) throw new Error(`unexpected results text: ${text}`);
  return { matching: Number(match[1]), retained: Number(match[2]) };
}

async function focusedId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return !el || el === document.body ? "body" : el.id || el.tagName.toLowerCase();
  });
}

async function focusInsideDialog(page: Page): Promise<boolean | null> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    return Boolean(document.getElementById("exportDialog")?.contains(el));
  });
}

/**
 * Change the Appearance select with arrow keys. `viaTab` reaches it with Tab
 * from the document start (used right after a load/reload); otherwise the
 * select is focused directly and only the value change is keyboard-driven.
 */
async function chooseThemeByKeyboard(pc: Page, theme: (typeof THEMES)[number], viaTab = false): Promise<void> {
  if (viaTab) {
    const visited = await tabUntil(pc, "document.activeElement?.id === 'theme'", 30);
    expect(visited.length, "Appearance is reachable with a few Tab presses").toBeLessThanOrEqual(12);
  } else if ((await focusedId(pc)) !== "theme") {
    await pc.locator("#theme").focus();
  }
  const current = await pc.locator("#theme").inputValue();
  const delta = THEMES.indexOf(theme) - THEMES.indexOf(current as (typeof THEMES)[number]);
  for (let index = 0; index < Math.abs(delta); index += 1) await pc.keyboard.press(delta > 0 ? "ArrowDown" : "ArrowUp");
  await expect(pc.locator("html")).toHaveAttribute("data-theme", theme);
}

/** Trusted mouse click after scrolling the element into view (narrow layouts). */
async function clickInView(page: Page, selector: string): Promise<void> {
  await page.locator(selector).first().scrollIntoViewIfNeeded();
  await trustedClick(page, selector);
}

function safeClaims(text: string): string[] {
  return SAFE_CLAIMS.filter((pattern) => pattern.test(text)).map(String);
}

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, out));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectStrings(item, out));
  return out;
}

test("AI-47.5: Protection Center (#640) and evidence export preview (#641) in branded Chrome", async ({}, testInfo) => {
  test.setTimeout(540_000);
  const session = await AcceptanceSession.open(testInfo, "AI-47.5-protection-center-640-export-641");
  const pageErrors: string[] = [];
  try {
    await session.step("1. record tested head, build and Chrome version", async () => {
      session.note(`head ${session.receipt.git.head}; Chrome ${session.chromeVersion}; ui-guard ${session.guardRevision}; dist ${session.receipt.build.distSha256}`);
      expect(session.receipt.git.productSourceClean, "no uncommitted product source changes").toBe(true);
      expect(session.receipt.browser.product).toBe("branded-chrome");
    });

    // ---------------------------------------------------------------- empty state via Options entry
    let emptyStateChecked = false;
    await session.step("3a. entry from Options: sidebar 'Protection Center' opens the extension page; an empty journal is not called safe", async () => {
      const initialLog = await session.eventLog("event log in the fresh profile");
      session.note(`fresh-profile event log length: ${initialLog.length} (${initialLog.map((entry) => entry.kind).join(", ")})`);
      const options = await session.openExtensionPage(OPTIONS_PAGE);
      options.on("pageerror", (error) => pageErrors.push(`options: ${error.message}`));
      await trustedClick(options, "a.nav-btn[href$='evidence/evidence.html']");
      await options.waitForURL(`**/${EVIDENCE_PAGE}`, { timeout: 10_000 });
      expect(options.url()).toBe(session.extensionUrl(EVIDENCE_PAGE));
      await expect(options).toHaveTitle("Protection Center · NavSentinel");
      await waitForSnapshot(options);
      const body = await options.locator("body").innerText();
      expect(safeClaims(body), "Protection Center must not describe history as a safety verdict").toEqual([]);
      const retained = Number(await options.locator("#total").textContent());
      if (retained === 0) {
        await expect(options.locator("#events")).toHaveText("No retained events. This is not a verdict on browsing safety.");
        await expect(options.locator("#export")).toBeDisabled();
        emptyStateChecked = true;
      } else {
        session.note(`fresh profile already held ${retained} evidence events; empty-state wording is checked after the behavioural reset at the end`);
      }
      await session.screenshot(options, "3a-protection-center-from-options-empty");
      await options.close();
    });

    // ---------------------------------------------------------------- record real events
    const markers = {
      srcQuery: uniqueMarker("nsq"),
      srcFrag: uniqueMarker("nsf"),
      trapDest: uniqueMarker("nsd"),
      lvl1Query: uniqueMarker("nsl"),
      lvl10Query: uniqueMarker("nsr"),
      loginDest: uniqueMarker("nsa"),
      password: uniqueMarker("nspw"),
      clipboard: uniqueMarker("nsclip"),
      plantedPath: uniqueMarker("nspp"),
      plantedToken: uniqueMarker("nstok"),
      plantedExtra: uniqueMarker("nsextra"),
      plantedId: uniqueMarker("nsid"),
      plantedReason: uniqueMarker("nsreason"),
    };
    session.note(`markers: ${JSON.stringify(markers)} plus static path markers ${STATIC_PATH_MARKERS.join(", ")}`);
    const page = await session.newPage();
    page.on("pageerror", (error) => pageErrors.push(`page: ${error.message}`));

    await session.step("setup-a. held cross-site new-tab trap on a marker-path page (query+fragment markers); page toast offers no Allow/Proceed", async () => {
      await session.gotoReady(page, session.url(`${SOURCE_FIXTURE}?srcq=${markers.srcQuery}#srcf-${markers.srcFrag}`));
      await page.evaluate((marker) => (window as unknown as { armTrap: (m: string) => void }).armTrap(marker), markers.trapDest);
      await trustedClick(page, "#play");
      await expect.poll(async () => (await toastState(page)).text, { timeout: 6000 }).not.toBeNull();
      const toast = await toastState(page);
      session.note(`fixture trap toast: ${toast.text} | buttons: ${toast.buttons.join(", ")}`);
      expect(await allowProceedControls(page), "no page-injected Allow/Proceed control").toEqual([]);
      await session.screenshot(page, "setup-a-trap-toast");
      await page.evaluate(() => (window as unknown as { disarmTrap: () => void }).disarmTrap());
    });

    await session.step("setup-b. Gym level 1 trusted Play click records a blocked new-tab event", async () => {
      await session.gotoReady(page, session.url(`/level1-basic-opacity.html?lvl1=${markers.lvl1Query}`));
      await trustedClick(page, "#play");
      await expect.poll(async () => (await toastState(page)).text, { timeout: 6000 }).not.toBeNull();
      const toast = await toastState(page);
      session.note(`level1 toast: ${toast.text} | buttons: ${toast.buttons.join(", ")}`);
      expect(await allowProceedControls(page), "no page-injected Allow/Proceed control").toEqual([]);
    });

    await session.step("setup-c. Gym level 10 delayed same-tab redirect is held", async () => {
      await session.gotoReady(page, session.url(`/level10-redirects-and-forms.html?lvl10=${markers.lvl10Query}`));
      const before = (await session.eventLog()).length;
      await trustedClick(page, "#delayed");
      await expect.poll(async () => (await session.eventLog()).length, { timeout: 8000 }).toBeGreaterThan(before);
      await page.waitForTimeout(800);
      const toast = await toastState(page).catch(() => ({ text: null, buttons: [] as string[] }));
      session.note(`level10 after delayed redirect: url path ${new URL(page.url()).pathname}; toast ${toast.text} | ${toast.buttons.join(", ")}`);
      await session.screenshot(page, "setup-c-rollback-toast");
    });

    // Recorded separately (soft) so the procedure continues: the same-tab
    // rollback toast is a pre-existing page-injected surface (capture_isolated.ts
    // showRollbackPrompt), outside the Protection Center/export UI under test.
    // Owner ruling 2026-09-25 (#872, D-2026-09-25-Q): this post-commit rollback
    // notice keeps its trusted-input Proceed. Any other page-injected
    // Allow/Proceed control on it still fails; the synthetic-activation arm
    // lives in ai47-4 and redteam-1.
    await session.step("setup-c2. same-tab rollback toast: only the ruled Proceed exception, no other Allow/Proceed control", async () => {
      const controls = await allowProceedControls(page);
      session.observe("rollback toast Allow/Proceed controls", controls.join(" | ") || "none");
      expect(
        controls.filter((label) => label.toLowerCase() !== "proceed"),
        "page-injected Allow/Proceed control other than the rollback notice's Proceed",
      ).toEqual([]);
    }, { soft: true });

    await session.step("setup-d. cross-site HTTP password submit with a marker password is prompted and cancelled", async () => {
      await session.gotoReady(page, session.url(`${SOURCE_FIXTURE}?login=${markers.srcQuery}`));
      await page.evaluate(({ dest, pw }) => (window as unknown as { armLogin: (m: string, p: string) => void }).armLogin(dest, pw), { dest: markers.loginDest, pw: markers.password });
      await trustedClick(page, "#submit");
      await expect.poll(async () => shadowButtonPoint(page, "Cancel"), { timeout: 8000 }).not.toBeNull();
      const modalButtons = await page.evaluate(() => Array.from(document.getElementById("__sentinelsuite_cred_modal_host__")?.shadowRoot?.querySelectorAll("button") ?? []).map((button) => button.textContent?.trim() ?? ""));
      session.observe("credential modal controls (pre-existing credential flow, not an evidence surface)", modalButtons.join(" | "));
      await session.screenshot(page, "setup-d-credential-modal");
      const cancel = (await shadowButtonPoint(page, "Cancel"))!;
      await page.mouse.click(cancel.x, cancel.y);
      await expect.poll(async () => shadowButtonPoint(page, "Cancel"), { timeout: 5000 }).toBeNull();
      expect(page.url(), "the cancelled submit did not navigate").toContain(SOURCE_FIXTURE);
    });

    await session.step("setup-e. paste into the password field (synthetic paste event carrying a marker payload)", async () => {
      const before = (await session.eventLog()).filter((entry) => entry.kind === "cred_paste_warn").length;
      await page.evaluate((clip) => {
        const field = document.getElementById("password") as HTMLInputElement;
        field.focus();
        field.value = clip;
        const data = new DataTransfer();
        data.setData("text/plain", clip);
        field.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
      }, markers.clipboard);
      const recorded = await expect.poll(async () => (await session.eventLog()).filter((entry) => entry.kind === "cred_paste_warn").length, { timeout: 5000 })
        .toBeGreaterThan(before).then(() => true, () => false);
      session.observe("paste warning recorded", recorded ? "cred_paste_warn recorded" : "no cred_paste_warn recorded for this loopback host (not required; clipboard marker still scanned)");
    });

    let storedIds: string[] = [];
    await session.step("setup-f. plant one adversarial stored entry (url path/query, extra, password/clipboard fields, internal id, token, unknown reason)", async () => {
      await session.worker.evaluate(async ({ key, entry }) => {
        const current = ((await chrome.storage.local.get(key))[key] ?? []) as unknown[];
        await chrome.storage.local.set({ [key]: [...current, entry] });
      }, {
        key: EVENT_LOG_KEY,
        entry: {
          id: `internal-${markers.plantedId}`,
          ts: Date.now(),
          kind: "nav_click_block",
          site: "planted-source.example",
          pageSite: "planted-source.example",
          destHost: "planted-dest.example",
          url: `https://planted-source.example/${markers.plantedPath}/x?token=${markers.plantedToken}#${markers.plantedPath}`,
          reasons: ["no_accessible_name", `raw_${markers.plantedReason}`],
          score: 61,
          extra: { secret: markers.plantedExtra, password: markers.password, clipboard: markers.clipboard, deliveryToken: markers.plantedToken },
          deliveryToken: markers.plantedToken,
        },
      });
      const log = await session.eventLog("event log after triggers and planted entry");
      storedIds = log.map((entry) => String(entry.id ?? "")).filter(Boolean);
      session.note(`event log kinds: ${log.map((entry) => entry.kind).join(", ")}`);
      expect(log.some((entry) => entry.id === `internal-${markers.plantedId}`), "planted entry persisted").toBe(true);
      const real = log.filter((entry) => entry.id !== `internal-${markers.plantedId}` && /^(nav_|cred_|dblclickjack|clickfix)/.test(String(entry.kind)));
      expect(real.length, "real recorded detection events exist").toBeGreaterThanOrEqual(3);
    });

    // ---------------------------------------------------------------- entry from popup
    let pc!: Page;
    await session.step("3. popup 'Protection Center' opens the extension-owned page with retained observations", async () => {
      await session.gotoReady(page, session.url("/index.html"));
      const popup = await session.openPopup(page);
      const opened = session.context.waitForEvent("page", { timeout: 10_000 });
      await popup.click("a.footer-link[href$='evidence/evidence.html']");
      pc = await opened;
      pc.on("pageerror", (error) => pageErrors.push(`protection-center: ${error.message}`));
      await pc.waitForURL(`**/${EVIDENCE_PAGE}`, { timeout: 10_000 });
      await pc.waitForLoadState("load");
      expect(pc.url()).toBe(session.extensionUrl(EVIDENCE_PAGE));
      await expect(pc).toHaveTitle("Protection Center · NavSentinel");
      await waitForSnapshot(pc);
      const total = Number(await pc.locator("#total").textContent());
      expect(total, "retained observations are shown").toBeGreaterThanOrEqual(4);
      expect((await resultsCounts(pc)).retained).toBe(total);
      expect(await pc.locator("details.event").count()).toBe(Math.min(total, 25));
      const body = await pc.locator("body").innerText();
      expect(safeClaims(body)).toEqual([]);
      expect(await allowProceedControls(pc), "Protection Center has no Allow/Proceed control").toEqual([]);
      for (const marker of [...Object.values(markers), ...STATIC_PATH_MARKERS]) expect(body.toLowerCase()).not.toContain(marker);
      session.note(`Protection Center status: ${await pc.locator("#status").textContent()} | modes: ${await pc.locator("#modes").textContent()}`);
      await session.screenshot(pc, "3-protection-center-from-popup");
      await session.closePopup();
    });

    // ---------------------------------------------------------------- themes
    await session.step("4. theme choices by keyboard (Forest, Paper, Midnight) persist after reopening", async () => {
      await pc.bringToFront();
      await pc.setViewportSize({ width: 1280, height: 860 });
      expect(await pc.locator("#theme").inputValue()).toBe("forest");
      await expect(pc.locator("html")).toHaveAttribute("data-theme", "forest");
      for (const theme of ["paper", "midnight"] as const) {
        await chooseThemeByKeyboard(pc, theme, true);
        await session.screenshot(pc, `4-theme-${theme}`);
        await pc.reload({ waitUntil: "load" });
        await waitForSnapshot(pc);
        await expect(pc.locator("html"), `${theme} persists after reload`).toHaveAttribute("data-theme", theme);
        expect(await pc.locator("#theme").inputValue()).toBe(theme);
      }
      const reopened = await session.openExtensionPage(EVIDENCE_PAGE);
      await expect(reopened.locator("html"), "choice persists in a newly opened Protection Center").toHaveAttribute("data-theme", "midnight");
      await reopened.close();
      const settings = await session.storageLocal<Record<string, unknown>>(SETTINGS_KEY);
      expect(JSON.stringify(settings ?? {})).not.toMatch(/theme/i);
      await pc.bringToFront();
      await chooseThemeByKeyboard(pc, "forest", true);
      await pc.reload({ waitUntil: "load" });
      await expect(pc.locator("html")).toHaveAttribute("data-theme", "forest");
    });

    await session.step("4b. narrow window: no horizontal overflow; journal and Appearance remain usable in every theme", async () => {
      await pc.setViewportSize({ width: 400, height: 860 });
      for (const theme of THEMES) {
        await chooseThemeByKeyboard(pc, theme);
        const overflow = await pc.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `${theme} narrow: no horizontal overflow`).toBeLessThanOrEqual(0);
        await session.screenshot(pc, `4b-narrow-${theme}`);
      }
      session.observe("Windows high contrast / zoom", "NOT-AUTOMATED: owner-setup-specific (forced colours / OS zoom) — not emulated");
      await pc.setViewportSize({ width: 1280, height: 860 });
      await chooseThemeByKeyboard(pc, "forest");
    });

    // ---------------------------------------------------------------- filter + inspect
    let filtered = { matching: 0, retained: 0 };
    await session.step("5a. inspect a real recorded event that stored reason codes (credential submit prompt): readable reasons are shown", async () => {
      const log = await session.eventLog();
      const stored = log.filter((entry) => entry.kind === "cred_submit_prompt");
      expect(stored.length, "a real cred_submit_prompt was recorded").toBeGreaterThanOrEqual(1);
      const storedReasons = (stored[stored.length - 1]!.reasons as string[] | undefined) ?? [];
      session.note(`stored cred_submit_prompt reasons: ${storedReasons.join(", ")}`);
      await pc.locator("#category").selectOption("credential");
      const row = pc.locator("details.event", { hasText: "credential submit prompt" }).first();
      await row.locator("summary").click();
      await expect(row).toHaveAttribute("open", "");
      const detail = await row.locator(".details").innerText();
      session.note(`inspected credential event: ${(await row.locator("summary").innerText()).replace(/\s+/g, " ")} || ${detail.replace(/\s+/g, " ")}`);
      await session.screenshot(pc, "5a-credential-event-inspected");
      expect(await row.locator(".event-route").textContent()).toBe("127.0.0.1 → localhost");
      expect(storedReasons.length, "the stored record carries reason codes").toBeGreaterThan(0);
      const shown = await row.locator(".details li").allTextContents();
      expect(shown.length, `readable reasons for the stored codes ${storedReasons.join(", ")}`).toBeGreaterThan(0);
    }, { soft: true });

    await session.step("5. filter the journal and inspect an event: readable reasons and source/destination hostnames", async () => {
      await clickInView(pc, "#resetFilters");
      await pc.locator("details.event").first().waitFor();
      await pc.locator("#search").click();
      await pc.keyboard.type("localhost");
      await pc.locator("#category").selectOption("navigation");
      filtered = await resultsCounts(pc);
      session.note(`filter 'localhost' + Navigation: ${filtered.matching} of ${filtered.retained}`);
      expect(filtered.matching).toBeGreaterThanOrEqual(1);
      expect(filtered.matching).toBeLessThan(filtered.retained);
      const routes = await pc.locator("details.event .event-route").allTextContents();
      expect(routes.length).toBe(Math.min(filtered.matching, 25));
      for (const route of routes) {
        expect(route).toContain("localhost");
        expect(route, "route shows hostnames only").toMatch(/^[a-z0-9.-]+ → [a-z0-9.-]+$|unavailable/);
      }
      const titles = await pc.locator("details.event .event-title").allTextContents();
      for (const title of titles) expect(title).toMatch(/^navigation /);
      const first = pc.locator("details.event").first();
      await first.locator("summary").click();
      await expect(first).toHaveAttribute("open", "");
      const detail = await first.locator(".details").innerText();
      session.note(`inspected event: ${(await first.locator("summary").innerText()).replace(/\s+/g, " ")} || ${detail.replace(/\s+/g, " ")}`);
      expect(detail).toContain("Recorded observation");
      expect(detail).toMatch(/Event code: nav_[a-z_]+/);
      const reasons = await first.locator(".details li").allTextContents();
      if (reasons.length) {
        for (const reason of reasons) expect(reason, "reason is a readable sentence, not a raw code").toMatch(/\s/);
      } else {
        expect(detail).toContain("No recognized signal explanation");
        session.observe("real blocked-new-tab event reasons", "the stored nav_blank_prompt record carries no reason codes, so the journal shows 'No recognized signal explanation is available for this entry.'");
      }
      // The planted stored entry (known + unknown code) shows only the known code, as a sentence.
      await pc.locator("#search").fill("planted-source.example");
      await pc.locator("#category").selectOption("all");
      const planted = pc.locator("details.event").first();
      await planted.locator("summary").click();
      expect(await planted.locator(".details li").allTextContents()).toEqual(["This clickable area has no visible label"]);
      await pc.locator("#search").fill("localhost");
      await pc.locator("#category").selectOption("navigation");
      expect(await resultsCounts(pc)).toEqual(filtered);
      await session.screenshot(pc, "5-filtered-and-inspected");
    });

    // ---------------------------------------------------------------- AI-45 export
    await session.step("AI-45.1 'Export visible events' preview includes all matching events", async () => {
      await clickInView(pc, "#export");
      await expect(pc.locator("#exportDialog")).toHaveJSProperty("open", true);
      const preview = JSON.parse(await pc.locator("#exportPreview").inputValue()) as { events: Array<Record<string, unknown>> };
      expect(preview.events.length, "preview holds every matching event, not only the visible page").toBe(filtered.matching);
      for (const event of preview.events) {
        expect(String(event.kind)).toMatch(/^nav_/);
        expect([event.sourceSite, event.destinationSite].some((host) => typeof host === "string" && host.includes("localhost"))).toBe(true);
      }
      await expect(pc.locator("#exportSummary")).toContainText(`${filtered.matching} recorded observations`);
      expect(await allowProceedControls(pc)).toEqual([]);
      await session.screenshot(pc, "ai45-1-export-preview");
    });

    await session.step("AI-45.2 Tab reaches Cancel, Download and the read-only contents; Escape cancels without download and returns focus to Export", async () => {
      expect(await focusedId(pc), "Cancel is focused when the dialog opens").toBe("cancelExport");
      const sequence: string[] = ["cancelExport"];
      const outside: string[] = [];
      for (let index = 0; index < 6; index += 1) {
        await pc.keyboard.press("Tab");
        const id = await focusedId(pc);
        sequence.push(id);
        if ((await focusInsideDialog(pc)) === false) outside.push(id);
      }
      session.note(`dialog Tab sequence: ${sequence.join(" > ")}`);
      expect(sequence).toContain("downloadExport");
      expect(sequence).toContain("exportPreview");
      expect(outside, "focus never lands on the inert page behind the modal").toEqual([]);
      await pc.locator("#cancelExport").focus();
      const download = downloadWithin(pc, 2000);
      await pc.keyboard.press("Escape");
      expect(await download, "Escape must not download").toBeNull();
      await expect(pc.locator("#exportDialog")).toHaveJSProperty("open", false);
      expect(await focusedId(pc)).toBe("export");
      expect(await pc.locator("#exportPreview").inputValue()).toBe("");
    });

    await session.step("AI-45.2b repeat with Cancel (keyboard Enter and mouse): no download, focus returns to Export", async () => {
      await pc.keyboard.press("Enter");
      await expect(pc.locator("#exportDialog")).toHaveJSProperty("open", true);
      expect(await focusedId(pc)).toBe("cancelExport");
      let download = downloadWithin(pc, 2000);
      await pc.keyboard.press("Enter");
      expect(await download, "keyboard Cancel must not download").toBeNull();
      await expect(pc.locator("#exportDialog")).toHaveJSProperty("open", false);
      expect(await focusedId(pc)).toBe("export");
      await clickInView(pc, "#export");
      await expect(pc.locator("#exportDialog")).toHaveJSProperty("open", true);
      download = downloadWithin(pc, 2000);
      await clickInView(pc, "#cancelExport");
      expect(await download, "mouse Cancel must not download").toBeNull();
      await expect(pc.locator("#exportDialog")).toHaveJSProperty("open", false);
      expect(await focusedId(pc)).toBe("export");
    });

    const exportsDir = path.join(acceptanceRunDirectory(), "ai47-5-exports");
    fs.mkdirSync(exportsDir, { recursive: true });
    const downloaded: Array<{ name: string; text: string }> = [];

    await session.step("AI-45.3 review hostnames/timestamps, then Download saves bytes identical to the preview", async () => {
      await clickInView(pc, "#export");
      const previewText = await pc.locator("#exportPreview").inputValue();
      const preview = JSON.parse(previewText) as { exportedAt: string; events: Array<{ timestamp: string; sourceSite: string | null; destinationSite: string | null }> };
      for (const event of preview.events) {
        expect(Number.isFinite(Date.parse(event.timestamp))).toBe(true);
        session.note(`preview event ${event.timestamp} ${event.sourceSite} -> ${event.destinationSite}`);
      }
      const pending = pc.waitForEvent("download", { timeout: 10_000 });
      await clickInView(pc, "#downloadExport");
      const download = await pending;
      const bytes = await readDownload(download);
      expect(download.suggestedFilename()).toMatch(/^navsentinel-evidence-\d{4}-\d{2}-\d{2}\.json$/);
      expect(bytes.equals(Buffer.from(previewText, "utf8")), "downloaded bytes are identical to the reviewed preview").toBe(true);
      const saved = path.join(exportsDir, `filtered-${download.suggestedFilename()}`);
      await download.saveAs(saved);
      session.note(`filtered export saved: ${path.relative(process.cwd(), saved)}`);
      downloaded.push({ name: "filtered", text: bytes.toString("utf8") });
      await expect(pc.locator("#exportDialog")).toHaveJSProperty("open", false);
      await expect(pc.locator("#status")).toContainText(`Prepared ${preview.events.length} reviewed, minimized events for download. Nothing was uploaded.`);
      session.observe("Lab Evidence workspace import of the downloaded file", "NOT-AUTOMATED: the served Lab/desktop shell is outside this extension-UI lane");
    });

    await session.step("AI-45.3b export ALL retained events (Reset filters) and download: count equals the journal total", async () => {
      await clickInView(pc, "#resetFilters");
      const all = await resultsCounts(pc);
      expect(all.matching).toBe(all.retained);
      await clickInView(pc, "#export");
      const previewText = await pc.locator("#exportPreview").inputValue();
      expect((JSON.parse(previewText) as { events: unknown[] }).events.length).toBe(all.retained);
      const pending = pc.waitForEvent("download", { timeout: 10_000 });
      await clickInView(pc, "#downloadExport");
      const download = await pending;
      const bytes = await readDownload(download);
      expect(bytes.equals(Buffer.from(previewText, "utf8"))).toBe(true);
      const saved = path.join(exportsDir, `all-${download.suggestedFilename()}`);
      await download.saveAs(saved);
      downloaded.push({ name: "all", text: bytes.toString("utf8") });
    });

    await session.step("5b. downloaded JSON has no URL paths/queries/fragments, password/clipboard values, extra fields, internal ids or tokens", async () => {
      const log = await session.eventLog();
      for (const file of downloaded) {
        const lower = file.text.toLowerCase();
        for (const marker of [...Object.values(markers), ...STATIC_PATH_MARKERS]) {
          expect(lower, `${file.name} export must not contain marker ${marker}`).not.toContain(marker);
        }
        for (const id of storedIds) expect(file.text, `${file.name} export must not contain stored id ${id}`).not.toContain(id);
        const data = JSON.parse(file.text) as Record<string, unknown> & { events: Array<Record<string, unknown>> };
        expect(Object.keys(data).sort()).toEqual(EXPORT_TOP_KEYS);
        expect(data).toMatchObject({ format: "navsentinel-evidence", schema: 1, source: "navsentinel-extension", evidence: "recorded-observation" });
        for (const event of data.events) {
          const extraKeys = Object.keys(event).filter((key) => !EXPORT_EVENT_KEYS.has(key));
          expect(extraKeys, `${file.name}: no fields beyond the evidence allowlist`).toEqual([]);
          expect(String(event.id)).toMatch(/^event-\d+$/);
          for (const host of [event.sourceSite, event.destinationSite]) {
            if (host !== null) expect(String(host)).toMatch(/^[a-z0-9.-]+$/);
          }
        }
        const strings = collectStrings(data);
        const pathLike = strings.filter((value) => /[/?#=&]/.test(value));
        expect(pathLike, `${file.name}: no path/query/fragment-shaped string values`).toEqual([]);
        expect(file.text).not.toMatch(/"(url|extra|password|clipboard|deliveryToken|token|pageSite|site|destHost)"\s*:/i);
      }
      const all = JSON.parse(downloaded.find((file) => file.name === "all")!.text) as { events: Array<{ sourceSite: string | null; reasons: string[] }> };
      const planted = all.events.find((event) => event.sourceSite === "planted-source.example");
      expect(planted, "planted adversarial entry is exported only in minimized form").toBeTruthy();
      expect(planted!.reasons).toEqual(["no_accessible_name"]);
      session.note(`log length at export ${log.length}; exported ${all.events.length}`);
    });

    await session.step("AI-45.4 export dialog in Forest, Paper and Midnight at normal and narrow widths: readable, both actions reachable", async () => {
      for (const width of [1280, 400]) {
        await pc.setViewportSize({ width, height: 860 });
        for (const theme of THEMES) {
          await chooseThemeByKeyboard(pc, theme);
          await clickInView(pc, "#export");
          await expect(pc.locator("#exportDialog")).toHaveJSProperty("open", true);
          const layout = await pc.evaluate(() => {
            const dialog = document.getElementById("exportDialog")!;
            const inViewport = (id: string) => {
              const rect = document.getElementById(id)!.getBoundingClientRect();
              return rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight && rect.width > 0;
            };
            const colours = (selector: string) => {
              const el = document.querySelector(selector) as HTMLElement;
              const cs = getComputedStyle(el);
              return { color: cs.color, background: cs.backgroundColor };
            };
            return {
              dialogOverflowX: dialog.scrollWidth - dialog.clientWidth,
              pageOverflowX: document.documentElement.scrollWidth - window.innerWidth,
              cancelVisible: inViewport("cancelExport"),
              downloadVisible: inViewport("downloadExport"),
              dialogBg: getComputedStyle(dialog).backgroundColor,
              text: colours("#exportDisclosure"),
              preview: colours("#exportPreview"),
              cancel: colours("#cancelExport"),
              download: colours("#downloadExport"),
            };
          });
          // Reach both actions by keyboard: Cancel is focused; Tab reaches Download.
          const viewport = pc.viewportSize()!;
          const onScreen = async (selector: string) => {
            const box = await pc.locator(selector).boundingBox();
            return Boolean(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height);
          };
          expect(await focusedId(pc)).toBe("cancelExport");
          expect(await onScreen("#cancelExport"), `${theme}@${width}: focused Cancel is on-screen`).toBe(true);
          await pc.keyboard.press("Tab");
          expect(await focusedId(pc)).toBe("downloadExport");
          expect(await onScreen("#downloadExport"), `${theme}@${width}: focused Download is on-screen`).toBe(true);
          const ratio = (fg: string, bg: string) => contrastRatio(parseCssColor(fg).rgb, parseCssColor(bg).rgb);
          const ratios = {
            disclosure: ratio(layout.text.color, layout.dialogBg),
            preview: ratio(layout.preview.color, layout.preview.background),
            cancel: ratio(layout.cancel.color, layout.cancel.background),
            download: ratio(layout.download.color, layout.download.background),
          };
          session.note(`${theme}@${width}px dialog: ${JSON.stringify({ ...layout, ratios })}`);
          expect(layout.dialogOverflowX, `${theme}@${width}: dialog has no horizontal overflow`).toBeLessThanOrEqual(0);
          for (const [name, value] of Object.entries(ratios)) expect(value, `${theme}@${width}: ${name} contrast`).toBeGreaterThanOrEqual(4.5);
          await session.screenshot(pc, `ai45-4-dialog-${theme}-${width}`);
          const none = downloadWithin(pc, 1200);
          await pc.keyboard.press("Escape");
          expect(await none).toBeNull();
          await expect(pc.locator("#exportDialog")).toHaveJSProperty("open", false);
        }
      }
      await pc.setViewportSize({ width: 1280, height: 860 });
      await chooseThemeByKeyboard(pc, "forest");
    });

    await session.step("7. existing popup and Options controls still behave: popup mode change reaches storage, Options and Protection Center", async () => {
      const popup = await session.openPopup(page);
      await popup.click("#navSeg .seg-btn[data-value='strict']");
      await popup.waitFor("document.querySelector(\"#navSeg .seg-btn[data-value='strict']\").getAttribute('aria-checked') === 'true'");
      await popup.click("#credSeg .seg-btn[data-value='strict']");
      await popup.waitFor("document.querySelector(\"#credSeg .seg-btn[data-value='strict']\").getAttribute('aria-checked') === 'true'");
      await expect.poll(async () => {
        const settings = await session.storageLocal<{ nav: { defaultMode: string }; credential: { mode: string } }>(SETTINGS_KEY);
        return `${settings?.nav?.defaultMode}/${settings?.credential?.mode}`;
      }).toBe("strict/strict");
      await session.closePopup();
      const options = await session.openExtensionPage(OPTIONS_PAGE);
      await expect(options.locator("#navModeSeg .seg-btn[data-value='strict']")).toHaveAttribute("aria-checked", "true");
      await expect(options.locator("#credModeSeg .seg-btn[data-value='strict']")).toHaveAttribute("aria-checked", "true");
      await pc.bringToFront();
      await clickInView(pc, "#refresh");
      await expect(pc.locator("#modes")).toContainText("Navigation: strict · Credentials: strict");
      const popupAgain = await session.openPopup(page);
      await popupAgain.click("#navSeg .seg-btn[data-value='smart']");
      await popupAgain.click("#credSeg .seg-btn[data-value='smart']");
      await expect.poll(async () => {
        const settings = await session.storageLocal<{ nav: { defaultMode: string }; credential: { mode: string } }>(SETTINGS_KEY);
        return `${settings?.nav?.defaultMode}/${settings?.credential?.mode}`;
      }).toBe("smart/smart");
      await expect(options.locator("#navModeSeg .seg-btn[data-value='smart']")).toHaveAttribute("aria-checked", "true");
      await session.closePopup();
      await options.close();
    });

    if (!emptyStateChecked) {
      await session.step("3c. empty journal wording after 'Clear behavioural data' is not a safety verdict", async () => {
        const options = await session.openExtensionPage(OPTIONS_PAGE);
        options.once("dialog", (dialog) => void dialog.accept());
        await trustedClick(options, ".nav-btn[data-section='analytics']");
        await trustedClick(options, "#clearBehavioural");
        await expect(options.locator("#status")).toContainText("Behavioural data cleared", { timeout: 10_000 });
        await options.close();
        await pc.bringToFront();
        await clickInView(pc, "#refresh");
        await waitForSnapshot(pc);
        await expect(pc.locator("#total")).toHaveText("0");
        await expect(pc.locator("#events")).toHaveText("No retained events. This is not a verdict on browsing safety.");
        expect(safeClaims(await pc.locator("body").innerText())).toEqual([]);
        await session.screenshot(pc, "3c-empty-journal");
      });
    }

    await session.step("no uncaught page errors and no console errors on Protection Center, Options, popup or worker", async () => {
      const errors = session.consoleErrors([/favicon\.ico/, /net::ERR_/]);
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
