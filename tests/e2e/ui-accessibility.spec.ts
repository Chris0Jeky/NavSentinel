import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Layout-only regression: no extension reload, API mocks, or runtime readiness
// claims. Render the shipped HTML/CSS without loading scripts or remote assets.
async function renderSurface(page: Page, surface: "popup" | "options" | "evidence") {
  const directory = resolve("extension/src", surface);
  const html = readFileSync(resolve(directory, `${surface}.html`), "utf8")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<link\b[^>]*>/gi, "");
  await page.route("**/*", (route) => route.abort());
  await page.setContent(html);
  await page.addStyleTag({
    content: readFileSync(resolve("extension/src/shared/design_tokens.css"), "utf8"),
  });
  await page.addStyleTag({
    content: readFileSync(resolve(directory, `${surface}.css`), "utf8"),
  });
}

for (const surface of ["popup", "options"] as const) {
  test(`@regression ${surface} controls have 24px hit targets (#978)`, async ({ page }) => {
    await page.setViewportSize({ width: surface === "popup" ? 390 : 1200, height: 950 });
    await renderSurface(page, surface);
    const controls = page.locator(surface === "popup" ? ".seg-btn, .footer-link" : ".seg-btn, .toggle");
    expect(await controls.count()).toBe(surface === "popup" ? 8 : 13);
    for (const control of await controls.all()) {
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width, await control.textContent() ?? "control").toBeGreaterThanOrEqual(24);
      expect(box!.height, await control.textContent() ?? "control").toBeGreaterThanOrEqual(24);
    }
  });
}

test("@regression popup has a single labelled main heading (#980)", async ({ page }) => {
  await renderSurface(page, "popup");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1, name: "Heedline", exact: true })).toBeVisible();
  const margin = await page.locator("h1").evaluate((heading) => getComputedStyle(heading).margin);
  expect(margin).toBe("0px");
});

test("@regression evidence heading separates both sentences (#980)", async ({ page }) => {
  await renderSurface(page, "evidence");
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveCount(1);
  await expect(heading).toHaveAccessibleName("Your browsing. A clearer picture.");
  // textContent catches the missing separator even when a browser's accessible
  // name calculation happens to insert whitespace for <br>.
  expect((await heading.textContent())?.replace(/\s+/g, " ").trim())
    .toBe("Your browsing. A clearer picture.");
  await expect(heading.locator("br")).toHaveCount(1);
});
