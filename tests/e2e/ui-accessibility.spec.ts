import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Layout-only checks of shipped sources, not extension API, reload or readiness
// evidence. Scripts and linked assets are removed; network requests are denied.
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
  test(`@regression ${surface} controls retain 24px hit-test reach (#978)`, async ({ page }) => {
    await page.setViewportSize({ width: surface === "popup" ? 390 : 1200, height: 950 });
    await renderSurface(page, surface);
    const controls = page.locator(surface === "popup" ? ".seg-btn, .footer-link" : ".seg-btn, .toggle");
    expect(await controls.count()).toBe(surface === "popup" ? 8 : 13);
    for (const control of await controls.all()) {
      await expect(control).toBeVisible();
      await control.scrollIntoViewIfNeeded();
      const result = await control.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        // The options switch deliberately paints at 32x18. Its ::before
        // extends the actual hit area to 24px; boundingBox().height alone
        // would reject that valid implementation without testing interaction.
        const points = [
          { edge: "top", x, y: y - 11.5 },
          { edge: "bottom", x, y: y + 11.5 },
          { edge: "left", x: x - 11.5, y },
          { edge: "right", x: x + 11.5, y },
        ];
        return {
          label: element.id || element.textContent?.trim() || "control",
          missed: points.filter((point) => {
            const hit = document.elementFromPoint(point.x, point.y);
            return !hit || (hit !== element && !element.contains(hit));
          }).map((point) => point.edge),
        };
      });
      expect(result.missed, result.label).toEqual([]);
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
  // Preserve textual separation even when accessible-name computation inserts
  // whitespace for <br> independently of the authored text.
  expect((await heading.textContent())?.replace(/\s+/g, " ").trim())
    .toBe("Your browsing. A clearer picture.");
  await expect(heading.locator("br")).toHaveCount(1);
});
