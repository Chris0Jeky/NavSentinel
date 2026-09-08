import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

/** Renderer integration only. No unpacked extension is loaded and no live-browser gate is implied. */
test("Protection Center built renderer filters and exports minimized evidence across themes @smoke", async ({ page }, testInfo) => {
  const root = resolve("extension/dist");
  expect(existsSync(resolve(root, "src/evidence/evidence.html")), "Build the extension first").toBe(true);
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    const file = resolve(root, `.${url.pathname}`);
    if (url.origin !== "https://center.test" || !file.startsWith(`${root}${sep}`) || !existsSync(file)) return route.abort();
    const contentType = file.endsWith(".html") ? "text/html" : file.endsWith(".css") ? "text/css" : "application/javascript";
    await route.fulfill({ contentType, body: readFileSync(file) });
  });
  await page.addInitScript(() => {
    const log = Array.from({ length: 30 }, (_, i) => ({
      id: `private-${i}`, ts: 1700000000000 + i, kind: i === 0 ? "cred_submit_prompt" : "nav_click_block",
      site: "source.test", destHost: i === 0 ? "credential.test" : "target.test", score: 40 + i,
      reasons: ["no_accessible_name", "private-message"], url: "https://source.test/private?token=secret", extra: { secret: true },
    }));
    Object.defineProperty(globalThis, "chrome", { value: {
      storage: { local: { get: async () => ({ "sentinelsuite:event_log_v1": log }), set: async () => {} }, onChanged: { addListener: () => {} } },
    } });
  });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 1365, height: 1000 });
  await page.goto("https://center.test/src/evidence/evidence.html");
  await expect(page.locator("#total")).toHaveText("30");
  await expect(page.locator("details")).toHaveCount(25);
  await page.locator("details summary").first().click();
  await expect(page.locator("details[open]")).toContainText("This clickable area has no visible label");
  for (const theme of ["forest", "paper", "midnight"]) {
    await page.getByLabel("Appearance").selectOption(theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.screenshot({ path: testInfo.outputPath(`center-${theme}.png`), fullPage: true });
  }
  await page.getByLabel("Find a hostname").fill("credential.test");
  await page.getByLabel("Category", { exact: true }).selectOption("credential");
  await expect(page.locator("details")).toHaveCount(1);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export visible events" }).click();
  const download = await downloadPromise;
  const file = await download.path();
  const contents = readFileSync(file!, "utf8");
  const data = JSON.parse(contents);
  expect(data.events).toHaveLength(1);
  expect(data.events[0]).toMatchObject({ kind: "cred_submit_prompt", outcome: "recorded", sourceSite: "source.test", destinationSite: "credential.test" });
  expect(contents).not.toMatch(/secret|private|token|url|extra/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("center-mobile.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
