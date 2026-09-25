import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

/** Renderer integration only. No unpacked extension is loaded and no live-browser gate is implied. Synthetic fixtures only. */
test("Overlay review queue labels, reported miss, and privacy-safe diagnostic bundle @smoke", async ({ page }) => {
  const root = resolve("extension/dist");
  expect(existsSync(resolve(root, "src/evidence/evidence.html")), "Build the extension first").toBe(true);
  const requested: string[] = [];
  await page.route("**/*", async route => {
    requested.push(route.request().url());
    const url = new URL(route.request().url());
    const file = resolve(root, `.${url.pathname}`);
    if (url.origin !== "https://center.test" || !file.startsWith(`${root}${sep}`) || !existsSync(file)) return route.abort();
    const contentType = file.endsWith(".html") ? "text/html" : file.endsWith(".css") ? "text/css" : "application/javascript";
    await route.fulfill({ contentType, body: readFileSync(file) });
  });
  await page.addInitScript(() => {
    const diag = (frame: string) => ({ frame, positionBucket: "fixed", coverageBucket: "half_to_full", stackingBucket: "topmost", retryCount: 2, readiness: "ready", error: "none" });
    const log: Array<Record<string, unknown>> = [
      { id: "private-suppressed", ts: 1700000000000, kind: "mutation_alert", site: "synthetic.test", url: "https://synthetic.test/private?token=secret", destHost: "destination.test", score: 99, reasons: ["overlay_injected"], extra: { details: "Overlay detected: position=fixed", severity: "high", overlayCleanupOutcome: "suppressed", overlayDiag: diag("top") } },
      { id: "private-reasserted", ts: 1700000000001, kind: "mutation_alert", site: "synthetic.test", reasons: ["overlay_injected"], extra: { overlayCleanupOutcome: "reasserted", overlayDiag: diag("child") } },
      { id: "private-hidden", ts: 1700000000002, kind: "mutation_alert", site: "synthetic.test", reasons: ["overlay_injected"], extra: { overlayCleanupOutcome: "already_hidden", overlayDiag: diag("top") } },
      { id: "private-budget", ts: 1700000000003, kind: "mutation_alert", site: "synthetic.test", reasons: ["overlay_injected"], extra: { overlayCleanupOutcome: "budget_exhausted", overlayDiag: diag("child") } },
      { id: "private-restored", ts: 1700000000004, kind: "mutation_alert", site: "synthetic.test", reasons: ["overlay_cleanup_undo"], extra: { overlayCleanupOutcome: "restored", overlayDiag: diag("top") } },
      { id: "private-miss", ts: 1700000000005, kind: "mutation_alert", reasons: ["overlay_user_reported_miss"], extra: { overlayCleanupOutcome: "user_reported_miss" } },
      { id: "private-observed", ts: 1700000000006, kind: "mutation_alert", site: "synthetic.test", reasons: ["overlay_detected"], extra: { overlayDiag: diag("top") } },
      { id: "private-nav", ts: 1700000000007, kind: "nav_click_block", site: "synthetic.test", reasons: ["no_accessible_name"] },
    ];
    const session: Record<string, unknown> = {};
    Object.defineProperty(globalThis, "chrome", { value: {
      storage: {
        local: {
          get: async (keys?: unknown) => {
            if (typeof keys === "string") return keys in { "sentinelsuite:event_log_v1": 1 } ? { "sentinelsuite:event_log_v1": log } : {};
            if (Array.isArray(keys)) {
              const out: Record<string, unknown> = {};
              for (const key of keys as string[]) {
                if (key === "sentinelsuite:event_log_v1") out[key] = log;
                if (key === "sentinelsuite:settings_v1") out[key] = { nav: { defaultMode: "smart", debug: false, autoDismissOverlays: true }, credential: { mode: "strict" }, logLimit: 300, autoSave: true };
              }
              return out;
            }
            return { "sentinelsuite:event_log_v1": log };
          },
          set: async (next: Record<string, unknown>) => {
            if (Array.isArray(next["sentinelsuite:event_log_v1"])) log.splice(0, log.length, ...(next["sentinelsuite:event_log_v1"] as Array<Record<string, unknown>>));
            const entry = (next["sentinelsuite:event_log_v1"] as Array<Record<string, unknown>> | undefined)?.[0];
            void entry;
          },
        },
        session: {
          get: async () => ({ ...session }),
          set: async (next: Record<string, unknown>) => { Object.assign(session, next); },
        },
        onChanged: { addListener: () => {} },
      },
      runtime: { getManifest: () => ({ version: "0.4.0" }) },
    } });
  });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("https://center.test/src/evidence/evidence.html");
  await expect(page.locator("#total")).toHaveText("8");

  const review = page.locator("#reviewList");
  await expect(review.locator("details")).toHaveCount(7);
  for (const name of ["Suppressed", "Reasserted", "Already hidden", "Budget-limited", "Restored", "Reported miss", "Observed"]) {
    await expect(review).toContainText(name);
  }
  await expect(review).not.toContainText("private-");
  await expect(review).not.toContainText("synthetic.test");
  await expect(review).not.toContainText("token=secret");

  const first = review.locator("details").first();
  await first.locator("summary").click();
  await first.getByRole("button", { name: "Should block", exact: true }).click();
  await expect(page.locator("#status")).toContainText("Saved the local label");
  await expect(first).toContainText("Should block");

  await first.getByRole("button", { name: "Should allow", exact: true }).click();
  await expect(page.locator("#status")).toContainText("Saved the local label");
  await expect(first).toContainText("Should allow");

  await page.getByRole("button", { name: "Report a missed overlay" }).click();
  await expect(page.locator("#status")).toContainText("reported miss");
  await expect(review.locator("details")).toHaveCount(8);

  const downloads: string[] = [];
  page.on("download", download => downloads.push(download.suggestedFilename()));
  await page.getByRole("button", { name: "Prepare diagnostic bundle" }).click();
  const dialog = page.getByRole("dialog", { name: "Review your diagnostic bundle" });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  expect(downloads).toEqual([]);
  const preview = page.getByLabel("File contents (read only)").last();
  const reviewed = await preview.inputValue();
  expect(reviewed.length).toBeGreaterThan(0);
  const bundle = JSON.parse(reviewed);
  expect(bundle).toMatchObject({ format: "navsentinel-overlay-diagnostics", schema: 1, productVersion: "0.4.0" });
  expect(typeof bundle.browserMajor).toBe("number");
  expect(bundle.records.length).toBeGreaterThanOrEqual(7);
  for (const record of bundle.records) {
    expect(Object.keys(record).sort()).toEqual(["error", "frame", "geometryBucket", "outcome", "positionBucket", "readiness", "reasonCodes", "retryCount", "stackingBucket", "timestamp"].sort());
    expect(["top", "child", "unknown"]).toContain(record.frame);
    expect(["suppressed", "reasserted", "already_hidden", "budget_limited", "restored", "user_reported_miss", "observed"]).toContain(record.outcome);
    expect(record.retryCount).toBeGreaterThanOrEqual(0);
    expect(record.retryCount).toBeLessThanOrEqual(128);
  }
  expect(reviewed).not.toMatch(/private-|synthetic\.test|destination\.test|https:\/\/|token=secret|severity|should_block|overlayReviewLabel|overlayDiag|password|clipboard|cookie|request body|element text/);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download reviewed file" }).click();
  const download = await downloadPromise;
  const file = await download.path();
  expect(readFileSync(file!, "utf8")).toBe(reviewed);

  await page.getByRole("button", { name: "Prepare diagnostic bundle" }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Prepare diagnostic bundle" })).toBeFocused();
  expect(downloads).toHaveLength(1);

  const keyboardTarget = review.locator("details").nth(1);
  await keyboardTarget.locator("summary").click();
  await keyboardTarget.getByRole("button", { name: "Should block", exact: true }).focus();
  await expect(keyboardTarget.getByRole("button", { name: "Should block", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#status")).toContainText("Saved the local label");

  expect(requested.every(url => url.startsWith("https://center.test/"))).toBe(true);
  expect(errors).toEqual([]);
});
