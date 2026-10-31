import { expect, test } from "@playwright/test";
import { AcceptanceSession, EVENT_LOG_KEY } from "./acceptance_harness";
import { EVIDENCE_PAGE, readDownload } from "./extension_ui_helpers";

test("Review assessments: local opinions persist without changing facts; reviewed bytes survive clear", async ({}, testInfo) => {
  const session = await AcceptanceSession.open(testInfo, "review-assessments-591");
  try {
    const record = { id: "private-review-id", ts: Date.now() - 10000, kind: "nav_click_block", site: "fictional.test",
      url: "https://fictional.test/private?token=secret", reasons: ["no_accessible_name"], score: 42 };
    await session.setStorageLocal({ [EVENT_LOG_KEY]: [record] });
    const center = await session.openExtensionPage(EVIDENCE_PAGE);
    const errors: string[] = [];
    center.on("pageerror", error => errors.push(error.message));
    const row = center.locator("details.event");
    const choice = center.getByLabel("Your assessment", { exact: true });
    await center.setViewportSize({ width: 1280, height: 900 });
    await expect(center.locator("#total")).toHaveText("1");
    await row.locator("summary").focus();
    await center.keyboard.press("Enter");
    const original = await row.elementHandle();
    await choice.focus();
    await choice.selectOption("should-allow");
    await expect(center.locator("#status")).toContainText("Assessment saved");
    await expect(choice).toBeFocused();
    expect(await original!.evaluate(node => node.isConnected && (node as HTMLDetailsElement).open)).toBe(true);
    const stored = await session.worker.evaluate(async key => (await chrome.storage.local.get(key))[key], EVENT_LOG_KEY);
    expect(stored[0]).toMatchObject({ ...record, assessment: { kind: "should-allow" } });
    await expect(center.locator("#clicksCount")).toHaveText("1");
    await expect(center.locator("#correctionsCount")).toHaveText("0");
    await session.screenshot(center, "assessment-desktop");

    await center.reload();
    await row.locator("summary").click();
    await expect(choice).toHaveValue("should-allow");
    await center.setViewportSize({ width: 390, height: 900 });
    await center.emulateMedia({ reducedMotion: "reduce" });
    await choice.scrollIntoViewIfNeeded();
    expect(await center.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await session.screenshot(center, "assessment-narrow-reduced");

    await center.locator("#exportReview").click();
    const preview = await center.locator("#exportPreview").inputValue();
    const payload = JSON.parse(preview);
    expect(payload.events).toHaveLength(1);
    expect(payload.events[0]).toMatchObject({ outcome: "recorded", sourceSite: null, destinationSite: null });
    expect(payload.corrections[0]).toMatchObject({ eventId: "event-1", kind: "should-allow" });
    expect(preview).not.toMatch(/fictional.test|private|secret|score/);
    await session.screenshot(center, "review-preview-narrow");
    await session.setStorageLocal({ [EVENT_LOG_KEY]: [] });
    await expect(center.locator("#total")).toHaveText("0");
    await expect(center.locator("#exportPreview")).toHaveValue(preview);
    const download = center.waitForEvent("download");
    await center.locator("#downloadExport").click();
    expect((await readDownload(await download)).toString("utf8")).toBe(preview);
    await expect(center.locator("#journal")).toBeFocused();
    await session.setStorageLocal({ [EVENT_LOG_KEY]: [record] });
    await expect(row).not.toHaveAttribute("open");
    await row.locator("summary").click();
    await expect(choice).toHaveValue("");
    await expect(center.locator("#exportReview")).toBeDisabled();
    expect(errors).toEqual([]);
    expect(session.consoleErrors([/favicon\.ico/, /net::ERR_/])).toEqual([]);
  } finally { await session.close(); }
});
