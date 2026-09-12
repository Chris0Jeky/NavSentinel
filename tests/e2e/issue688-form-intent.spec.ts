/** #688: bounded, loopback-only effective-form-authority regressions.
 * No absence-of-alert oracle: assert independent sink attempts and native
 * consequences. Location and late native mutations are post-commit only.
 */
import { chromium, test, expect, type Frame, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { startFormIntentLab, type FormCase } from "./form_intent_lab";
import { startProvingGroundEgressFence, type ProvingGroundEgressAttempt } from "./proving_ground_fake_sink";
import { getServiceWorker, updateNavigationSettings, readBuiltUiGuardRevision } from "./extension_test_utils";

const extensionPath = path.resolve(process.env.EXTENSION_PATH ?? "extension/dist");
const quietMs = 2300;
function artifactHash(root: string): string {
  const hash = createHash("sha256");
  for (const name of (fs.readdirSync(root, { recursive: true }) as string[]).sort()) {
    const file = path.join(root, name); if (!fs.statSync(file).isFile()) continue;
    hash.update(name.replaceAll("\\", "/") + "\0"); hash.update(fs.readFileSync(file));
  }
  return hash.digest("hex");
}
async function ready(frame: Frame): Promise<void> {
  await frame.waitForFunction(expected => document.documentElement.getAttribute("data-navsentinel-capture-ready") === "1" &&
    document.documentElement.getAttribute("data-navsentinel-bridge-ready") === "1" &&
    document.documentElement.getAttribute("data-navsentinel-ui-guard") === expected, readBuiltUiGuardRevision());
}
async function runArm(variant: FormCase, protectedArm: boolean, info: TestInfo) {
  if (!fs.existsSync(path.join(extensionPath, "manifest.json"))) throw new Error("Build the extension before the #688 campaign; missing builds must not skip.");
  const lab = await startFormIntentLab(variant);
  const denied: ProvingGroundEgressAttempt[] = [];
  // The fence must exist before launch, including Chromium background traffic.
  const fence = await startProvingGroundEgressFence(denied, new Set([lab.fixtureOrigin, lab.sinkOrigin]));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ns-form-688-"));
  const context = await chromium.launchPersistentContext(profile, {
    headless: true, channel: "chromium",
    ...(process.env.NAVSENTINEL_TEST_CHROMIUM_EXECUTABLE ? { executablePath: process.env.NAVSENTINEL_TEST_CHROMIUM_EXECUTABLE } : {}),
    proxy: { server: fence.proxyServer }, viewport: { width: 1100, height: 850 },
    args: ["--host-resolver-rules=MAP localhost 127.0.0.1", "--disable-background-networking", "--disable-component-update",
      "--disable-domain-reliability", "--disable-quic", "--disable-sync", "--no-first-run", "--metrics-recording-only",
      ...(protectedArm ? [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] : ["--disable-extensions"])],
  });
  const errors: string[] = [];
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  try {
    if (protectedArm) {
      await getServiceWorker(context); await updateNavigationSettings(context, { defaultMode: "smart", debug: true });
    }
    await page.goto(lab.fixtureOrigin + "/parent");
    const frame = page.frames().find(candidate => candidate.url() === lab.fixtureOrigin + "/child");
    if (!frame) throw new Error("Exact child fixture missing");
    await frame.waitForFunction(() => document.body.dataset.fixtureReady === "1");
    if (protectedArm) { await ready(page.mainFrame()); await ready(frame); }
    if (["allow-once", "allow-mutated"].includes(variant)) {
      await frame.locator("#outside").click();
      if (protectedArm) {
        const control = frame.locator("#__navsentinel_toast_host").getByRole("button", { name: "Allow once", exact: true });
        await expect(control).toBeVisible();
        if (variant === "allow-mutated") await frame.locator("#f").evaluate((form, harm) => (form as HTMLFormElement).action = harm, lab.harmUrl);
        // Trusted hardware-like activation, NOT element.click() in evaluate.
        await control.click();
      }
    } else if (variant === "synthetic") {
      await frame.locator("#a").evaluate(button => (button as HTMLButtonElement).click());
    } else {
      await frame.locator("#a").click();
    }
    if (variant === "validation") {
      await page.waitForTimeout(200); expect(lab.attempts).toEqual([]);
      await frame.locator("#required").fill("inert"); await frame.locator("#a").click();
    }
    if (variant === "mixed" && protectedArm) {
      await frame.waitForFunction(() => document.body.dataset.mixedReady === "1");
      expect(lab.attempts.filter(row => row.role === "harm")).toEqual([]);
      await frame.locator("#a").click();
    }
    await page.waitForTimeout(quietMs);
    const topUrl = page.url();
    let dialogClosed = false;
    if (variant === "dialog") dialogClosed = await frame.locator("dialog").evaluate(dialog => !(dialog as HTMLDialogElement).open);
    expect(errors, "fixture exceptions invalidate the arm").toEqual([]);
    const result = { attempts: [...lab.attempts], topUrl, parentUrl: lab.fixtureOrigin + "/parent", benignUrl: lab.benignUrl,
      sinkOrigin: lab.sinkOrigin, dialogClosed };
    await info.attach(`${variant}-${protectedArm ? "protected" : "baseline"}.json`, { contentType: "application/json",
      body: Buffer.from(JSON.stringify({ ...result, browser: context.browser()?.version(), extensionHash: artifactHash(extensionPath),
        protectedArm, deniedBrowserBackground: denied, observationMs: quietMs,
        nonClaims: ["branded Chrome owner acceptance", "open-web efficacy", "request-body verification", "native late mutation pre-harm prevention"] }, null, 2)) });
    return result;
  } finally {
    await context.close(); await fence.close(); await lab.close(); fs.rmSync(profile, { recursive: true, force: true });
  }
}

const blocked: FormCase[] = ["alternate-submitter", "action-substitution", "target-mutation", "method-mutation", "enctype-mutation",
  "base-href", "base-target", "reassociation", "expired", "mismatch-burn", "synthetic"];
for (const variant of blocked) test(`@regression #688 ${variant}: baseline harm / protected pre-call block`, async ({}, info) => {
  test.setTimeout(45000);
  const baseline = await runArm(variant, false, info);
  expect(baseline.attempts.some(row => row.role === "harm" && row.accepted)).toBe(true);
  const protectedResult = await runArm(variant, true, info);
  expect(protectedResult.attempts).toEqual([]);
  expect(protectedResult.topUrl).toBe(protectedResult.parentUrl);
});
for (const variant of ["location-same", "location-different", "late-submit"] as const) test(`@regression #688 ${variant}: ROLLED_BACK_POST_COMMIT, never pre-harm`, async ({}, info) => {
  test.setTimeout(45000);
  const baseline = await runArm(variant, false, info); expect(baseline.attempts.filter(row => row.role === "harm" && row.accepted)).toHaveLength(1);
  const protectedResult = await runArm(variant, true, info);
  expect(protectedResult.attempts.filter(row => row.role === "harm" && row.accepted)).toHaveLength(1);
  expect(protectedResult.topUrl).toBe(protectedResult.parentUrl);
});
const benign: FormCase[] = ["exact-submit", "exact-request", "native", "server-redirect", "slow-response", "empty-target", "inherited-target", "empty-method", "invalid-method", "self", "validation"];
for (const variant of benign) test(`@regression #688 benign ${variant}`, async ({}, info) => {
  test.setTimeout(45000);
  const result = await runArm(variant, true, info);
  expect(result.attempts).toHaveLength(1); expect(result.attempts[0]).toMatchObject({ role: "benign", accepted: true });
  if (["empty-target", "self"].includes(variant)) expect(result.topUrl).toBe(result.parentUrl);
  else expect(result.topUrl.startsWith(result.sinkOrigin + "/")).toBe(true);
  if (["empty-method", "invalid-method"].includes(variant)) expect(result.attempts[0]?.method).toBe("GET");
});
test("@regression #688 dialog is not a navigation", async ({}, info) => {
  const result = await runArm("dialog", true, info); expect(result.attempts).toEqual([]); expect(result.dialogClosed).toBe(true);
});
test("@regression #688 exact replay cannot double-spend even when the first response is 204", async ({}, info) => {
  test.setTimeout(45000);
  const baseline = await runArm("replay", false, info); expect(baseline.attempts).toHaveLength(2);
  const result = await runArm("replay", true, info); expect(result.attempts).toHaveLength(1);
});
for (const variant of ["allow-once", "allow-mutated"] as const) test(`@regression #688 trusted ${variant} replay`, async ({}, info) => {
  test.setTimeout(45000);
  const result = await runArm(variant, true, info);
  if (variant === "allow-mutated") expect(result.attempts).toEqual([]);
  else { expect(result.attempts).toHaveLength(1); expect(result.attempts[0]?.role).toBe("benign"); }
});
test("@regression #688 mixed: block changed target then allow one fresh click", async ({}, info) => {
  test.setTimeout(45000);
  const result = await runArm("mixed", true, info);
  expect(result.attempts).toHaveLength(1); expect(result.attempts[0]?.role).toBe("benign");
});
