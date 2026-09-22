/** Native submit replay must preserve the approved top-level destination.
 * A sink receipt alone is insufficient: a missing source-submit marker can
 * accept the request and then incorrectly roll its result back to the fixture.
 */
import { chromium, expect, test, type BrowserContext, type Frame } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startFormIntentLab } from "./form_intent_lab";
import {
  getServiceWorker,
  readBuiltUiGuardRevision,
  updateNavigationSettings,
} from "./extension_test_utils";
import {
  startProvingGroundEgressFence,
  type ProvingGroundEgressAttempt,
} from "./proving_ground_fake_sink";

const extensionPath = path.resolve(process.env.EXTENSION_PATH ?? "extension/dist");

async function ready(frame: Frame): Promise<void> {
  await frame.waitForFunction((revision) =>
    document.documentElement.getAttribute("data-navsentinel-capture-ready") === "1" &&
    document.documentElement.getAttribute("data-navsentinel-bridge-ready") === "1" &&
    document.documentElement.getAttribute("data-navsentinel-ui-guard") === revision,
  readBuiltUiGuardRevision());
}

for (const mutate of [false, true]) {
  test(`@regression #688 native submit replay ${mutate ? "rejects changed intent" : "preserves the approved destination"}`, async ({}, info) => {
    test.setTimeout(45_000);
    if (!fs.existsSync(path.join(extensionPath, "manifest.json"))) {
      throw new Error("Build the extension before the native form replay regression.");
    }
    const lab = await startFormIntentLab("allow-once");
    const denied: ProvingGroundEgressAttempt[] = [];
    let fence: Awaited<ReturnType<typeof startProvingGroundEgressFence>> | undefined;
    let context: BrowserContext | undefined;
    let profile: string | undefined;
    try {
      fence = await startProvingGroundEgressFence(denied, new Set([lab.fixtureOrigin, lab.sinkOrigin]));
      profile = fs.mkdtempSync(path.join(os.tmpdir(), "ns-native-replay-"));
      context = await chromium.launchPersistentContext(profile, {
        headless: true,
        channel: "chromium",
        ...(process.env.NAVSENTINEL_TEST_CHROMIUM_EXECUTABLE
          ? { executablePath: process.env.NAVSENTINEL_TEST_CHROMIUM_EXECUTABLE } : {}),
        proxy: { server: fence.proxyServer },
        viewport: { width: 1100, height: 850 },
        args: [
          "--host-resolver-rules=MAP localhost 127.0.0.1", "--disable-background-networking",
          "--disable-component-update", "--disable-domain-reliability", "--disable-quic",
          "--disable-sync", "--no-first-run", "--metrics-recording-only",
          `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`,
        ],
      });
      await getServiceWorker(context);
      await updateNavigationSettings(context, { defaultMode: "smart", debug: true });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(lab.fixtureOrigin + "/parent");
      const frame = page.frames().find((candidate) => candidate.url() === lab.fixtureOrigin + "/child");
      if (!frame) throw new Error("Exact child fixture missing");
      await ready(page.mainFrame());
      await ready(frame);
      await frame.waitForFunction(() => document.body.dataset.fixtureReady === "1");

      // Author the inert fixture, not an activation: both subsequent clicks use
      // Playwright's trusted input path, including the real Allow once control.
      await frame.locator("#outside").evaluate((button) => {
        (button as HTMLButtonElement).onclick = () => {
          const form = document.getElementById("f") as HTMLFormElement;
          setTimeout(() => HTMLFormElement.prototype.submit.call(form), 100);
        };
      });
      await frame.locator("#outside").click();
      const allow = frame.locator("#__navsentinel_toast_host")
        .getByRole("button", { name: "Allow once", exact: true });
      await expect(allow).toBeVisible();
      expect(lab.attempts).toEqual([]);
      if (mutate) {
        await frame.locator("#f").evaluate((form, harm) => {
          (form as HTMLFormElement).action = harm;
        }, lab.harmUrl);
      }
      await allow.click();
      // Match the existing #688 post-commit observation window. Do not accept
      // a transient sink arrival as proof that the approved result survives.
      await page.waitForTimeout(2300);
      await info.attach("native-replay-result.json", {
        contentType: "application/json",
        body: Buffer.from(JSON.stringify({
          mutate, attempts: lab.attempts, topUrl: page.url(),
          expectedUrl: mutate ? lab.fixtureOrigin + "/parent" : lab.benignUrl,
          browser: context.browser()?.version(), deniedBrowserBackground: denied,
          observationMs: 2300,
          nonClaims: ["owner Chrome acceptance", "request-body verification", "open-web efficacy"],
        }, null, 2)),
      });
      expect(errors).toEqual([]);
      if (mutate) {
        expect(lab.attempts).toEqual([]);
        expect(page.url()).toBe(lab.fixtureOrigin + "/parent");
      } else {
        expect(lab.attempts).toEqual([{ role: "benign", method: "POST", accepted: true, ordinal: 1 }]);
        expect(page.url()).toBe(lab.benignUrl);
      }
    } finally {
      try { await context?.close(); } finally {
        try { await fence?.close(); } finally {
          try { await lab.close(); } finally {
            if (profile) fs.rmSync(profile, { recursive: true, force: true });
          }
        }
      }
    }
  });
}
