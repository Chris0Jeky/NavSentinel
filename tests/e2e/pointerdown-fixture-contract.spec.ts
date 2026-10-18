import { chromium, expect, test } from "@playwright/test";
import { installDeferredPointerdownNavigation } from "./pointerdown-authority.fixture";

test.setTimeout(30_000);
for (const observationDelay of [0, 350]) {
  test(`pointerdown fixture waits for an explicit authority-read release (${observationDelay}ms) @regression`, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const signals: string[] = [];
      page.on("console", (message) => signals.push(message.text()));
      await page.setContent("<!doctype html><html><head></head><body></body></html>");
      await page.evaluate(installDeferredPointerdownNavigation, {
        targetUrl: "https://example.invalid/fixture-only", marker: "FIXTURE_PROBE",
      });
      // This contract tests scheduling, not protection. Prevent the fixture's
      // default navigation so no remote URL is contacted without an extension.
      await page.evaluate(() => {
        document.querySelector("a")!.addEventListener("click", (event) => event.preventDefault());
      });
      await page.mouse.move(40, 40);
      await page.mouse.down();
      await expect.poll(() => signals).toContain("FIXTURE_PROBE pointerdown true");
      // Deliberately exceed the original 150ms race in one case.
      await page.waitForTimeout(observationDelay);
      expect(signals).not.toContain("FIXTURE_PROBE click false");
      await page.evaluate(() => document.dispatchEvent(new Event("FIXTURE_PROBE:release")));
      await expect.poll(() => signals).toContain("FIXTURE_PROBE click false");
      await page.evaluate(() => document.dispatchEvent(new Event("FIXTURE_PROBE:release")));
      await page.waitForTimeout(200);
      expect(signals.filter((signal) => signal === "FIXTURE_PROBE click false")).toHaveLength(1);
      expect(signals).not.toContain("FIXTURE_PROBE click true");
      await page.mouse.up();
    } finally {
      await browser.close();
    }
  });
}
