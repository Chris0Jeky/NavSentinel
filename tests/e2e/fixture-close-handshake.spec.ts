import { expect, test } from "@playwright/test";
import { FIXTURE_CLOSE_SCRIPT, prepareFixtureClose } from "./fixture_close_handshake";

// Pure harness contract. The negative synthetic click is not a fallback for
// native input; only the subsequent trusted locator click may request closure.
test("fixture close preserves trusted input acknowledgement before native disposal (#1032) @regression", async ({ page }) => {
  await page.route("**/*", (route) => route.abort());
  await page.setContent('<button id="open" onclick="window.open(\'about:blank\')">Open fixture child</button>');
  const opening = page.waitForEvent("popup");
  await page.locator("#open").click();
  const child = await opening;
  await child.setContent('<button id="close">Close fixture child</button>');
  const control = await prepareFixtureClose(child);
  await child.addScriptTag({ content: FIXTURE_CLOSE_SCRIPT });
  try {
    await child.locator("#close").evaluate((button) => (button as HTMLButtonElement).click());
    expect(control.requests).toBe(0);
    expect(child.isClosed()).toBe(false);
    const closed = child.waitForEvent("close");
    await child.locator("#close").click();
    await expect.poll(() => control.requests).toBe(1);
    expect(child.isClosed(), "native close must wait until the trusted click has returned").toBe(false);
    control.release();
    await closed;
    expect(child.isClosed()).toBe(true);
    expect(page.isClosed()).toBe(false);
  } finally {
    // Teardown only; successful closure above must be the fixture's window.close.
    if (!child.isClosed()) await child.close();
  }
});
