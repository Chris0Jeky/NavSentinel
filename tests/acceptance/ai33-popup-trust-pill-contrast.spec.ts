/**
 * AI-33 — issue #530 popup trust-pill contrast (PR #582), encoding
 * docs/agentic/GATE3_GUIDES.md "Active guide: AI-33" steps 4-7 on current main
 * (the PR prechecks are superseded by the post-merge banner). Readability is a
 * human judgement; this spec records objective proxies in the REAL toolbar
 * popup: WCAG contrast of the computed label colour against the actually
 * rendered pill background (pixels from a DevTools screenshot), full visibility
 * and no clipping, a text label, and distinctness from the signal chips; plus
 * Tab/Enter activation of Trust and its keyboard reversal. Screenshots of both
 * pill states are saved for the owner.
 *
 * Automated agent evidence only — never an owner Gate-3 result.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { AcceptanceSession, acceptanceRunDirectory, repoRoot, trustedClick } from "./acceptance_harness";
import type { CdpPageClient } from "./cdp_page_client";
import { TRUSTED_DOMAINS_KEY, measurePopupPill, popupTabUntil, shadowButtonPoint, type PillMeasurement } from "./extension_ui_helpers";

const PR_582_MERGE = "d1895b51763a6c6b7b5280f0ea80664d2f0c796d";
const AA = 4.5;
const IMPLEMENTATION_TARGET = 5; // tests/popup-contrast.test.ts TRUST_PILL_TARGET

function assertPill(measure: PillMeasurement, label: string, expected: { text: string; state: string }): void {
  expect(measure.text, `${label}: text label present`).toBe(expected.text);
  expect(measure.state, `${label}: data-state`).toBe(expected.state);
  expect(measure.contrastComputedTextVsRenderedBackground, `${label}: WCAG AA contrast vs rendered background`).toBeGreaterThanOrEqual(AA);
  expect(measure.scrollWidth, `${label}: label not truncated`).toBeLessThanOrEqual(measure.clientWidth);
  expect(measure.clippedBy, `${label}: not clipped by an ancestor`).toEqual([]);
  const { rect, viewport } = measure;
  expect(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= viewport.width && rect.y + rect.height <= viewport.height, `${label}: fully inside the popup viewport`).toBe(true);
  expect(rect.width > 0 && rect.height > 0).toBe(true);
  expect(measure.className).toContain("trust-pill");
  expect(measure.className).not.toContain("signal-chip");
  for (const chip of measure.distinctFromChips) {
    expect(chip.color, `${label}: pill colour differs from signal chip ${chip.className}`).not.toBe(measure.color);
  }
}

async function measure(session: AcceptanceSession, popup: CdpPageClient, name: string): Promise<PillMeasurement> {
  const clips = path.join(acceptanceRunDirectory(), "ai33-pill-clips");
  fs.mkdirSync(clips, { recursive: true });
  const result = await measurePopupPill(popup, "#trustStatus", path.join(clips, `${name}.png`));
  session.note(`${name}: ${JSON.stringify(result)}`);
  if (result.contrastComputedTextVsRenderedBackground < IMPLEMENTATION_TARGET) {
    session.observe(`${name} below the unit test's 5:1 implementation target`, String(result.contrastComputedTextVsRenderedBackground));
  }
  await session.screenshotPopup(`${name}-popup`);
  return result;
}

test("AI-33: popup trust pill is readable, unclipped, labelled and keyboard-reversible (#530/#582)", async ({}, testInfo) => {
  test.setTimeout(300_000);
  const session = await AcceptanceSession.open(testInfo, "AI-33-popup-trust-pill-contrast-582");
  const trusted = async () => ((await session.storageLocal<string[]>(TRUSTED_DOMAINS_KEY)) ?? []);
  try {
    await session.step("1-2. post-merge: main head contains the #582 merge; record head, Chrome, ui-guard", async () => {
      execFileSync("git", ["merge-base", "--is-ancestor", PR_582_MERGE, "HEAD"], { cwd: repoRoot });
      session.note(`head ${session.receipt.git.head}; Chrome ${session.chromeVersion}; ui-guard ${session.guardRevision}`);
      expect(session.receipt.git.productSourceClean).toBe(true);
    });

    const page = await session.newPage();
    await session.step("4-5a. Gym root reports capture=1, bridge=1 and the built ui-guard before the popup opens", async () => {
      const markers = await session.gotoReady(page, session.url("/"));
      expect(markers).toEqual({ capture: "1", bridge: "1", guard: session.guardRevision });
      const stale = session.consoleErrors().filter((entry) => /Failed to fetch dynamically imported module/.test(entry.text));
      session.note(`stale-loader signature present: ${stale.length > 0}`);
      expect(stale).toEqual([]);
    });

    let popup!: CdpPageClient;
    await session.step("5. gold 'observing' pill: readable (>=4.5:1 vs rendered background), fully visible, labelled, not a signal chip", async () => {
      popup = await session.openPopup(page);
      const site = await popup.evaluate<string>("document.getElementById('site').textContent");
      expect(site).toBe("127.0.0.1");
      const observing = await measure(session, popup, "5-observing");
      assertPill(observing, "observing", { text: "observing", state: "" });
      expect(observing.color, "observing label uses the gold treatment").toBe("rgb(228, 197, 68)");
    });

    await session.step("6a. Tab reaches Trust and Enter activates it; trusted pill is readable, fully visible, labelled with a green treatment", async () => {
      const visited = await popupTabUntil(popup, "document.activeElement?.id === 'trustBtn'", 10);
      session.note(`popup Tab path to Trust: ${visited.join(" > ")}`);
      await popup.press("Enter");
      if (popup.closed) popup = await session.openPopup(page);
      await popup.waitFor("document.getElementById('trustStatus').dataset.state === 'trusted'", 5000);
      expect(await trusted()).toContain("127.0.0.1");
      const trustedPill = await measure(session, popup, "6-trusted");
      assertPill(trustedPill, "trusted", { text: "trusted", state: "trusted" });
      expect(trustedPill.backgroundColor, "green tint").toBe("rgba(122, 183, 135, 0.12)");
      expect(trustedPill.borderColor, "green border").toBe("rgba(122, 183, 135, 0.25)");
      expect(await popup.evaluate<boolean>("document.getElementById('trustBtn').hidden && !document.getElementById('untrustBtn').hidden")).toBe(true);
    });

    await session.step("6b. reverse by keyboard (Tab to Untrust, Enter): observing treatment returns without clipping or stale text", async () => {
      const visited = await popupTabUntil(popup, "document.activeElement?.id === 'untrustBtn'", 12);
      session.note(`popup Tab path to Untrust: ${visited.join(" > ")}`);
      await popup.press("Enter");
      if (popup.closed) popup = await session.openPopup(page);
      await popup.waitFor("document.getElementById('trustStatus').dataset.state === '' && document.getElementById('trustStatus').textContent === 'observing'", 5000);
      expect(await trusted()).not.toContain("127.0.0.1");
      const reverted = await measure(session, popup, "6b-observing-again");
      assertPill(reverted, "observing (reverted)", { text: "observing", state: "" });
      expect(await popup.evaluate<boolean>("!document.getElementById('trustBtn').hidden && document.getElementById('untrustBtn').hidden")).toBe(true);
      await session.closePopup();
    });

    await session.step("5+. with orange signal chips present for this site, the pill stays distinct and readable", async () => {
      // A cross-site HTTP password submit on the same host records a scored event with reasons.
      await session.gotoReady(page, session.url("/acceptance/extui-srcpath-nspathmark7q/evidence-source.html"));
      await page.evaluate(() => (window as unknown as { armLogin: (m: string, p: string) => void }).armLogin("ai33chips", "ai33-not-a-secret"));
      await trustedClick(page, "#submit");
      await expect.poll(async () => shadowButtonPoint(page, "Cancel"), { timeout: 8000 }).not.toBeNull();
      await page.keyboard.press("Escape");
      await expect.poll(async () => shadowButtonPoint(page, "Cancel"), { timeout: 5000 }).toBeNull();
      await session.gotoReady(page, session.url("/"));
      popup = await session.openPopup(page);
      await popup.waitFor("document.querySelectorAll('.signal-chip').length > 0", 5000);
      const withChips = await measure(session, popup, "5plus-observing-with-chips");
      expect(withChips.distinctFromChips.length).toBeGreaterThan(0);
      assertPill(withChips, "observing with chips", { text: "observing", state: "" });
      await session.closePopup();
    });

    await session.step("7. no new popup, page or worker console errors", async () => {
      const errors = session.consoleErrors([/favicon\.ico/]);
      session.note(`console errors: ${JSON.stringify(errors)}`);
      expect(errors).toEqual([]);
    }, { soft: true });

    const failedSteps = session.receipt.steps.filter((step) => step.status === "failed").map((step) => `${step.id} ${step.title}`);
    expect(failedSteps, "every procedure step passed").toEqual([]);
  } finally {
    await session.close();
  }
});
