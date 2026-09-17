/** #688: bounded, loopback-only effective-form-authority regressions.
 * No absence-of-alert oracle: assert independent sink attempts and native
 * consequences. Location and late native mutations are post-commit only.
 */
import { chromium, test, expect, type Frame, type TestInfo, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { FormObservation } from "./form_observatory";
import { startFormIntentLab, type FormCase, type FormReceipt } from "./form_intent_lab";
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
async function executeArm(variant: FormCase, protectedArm: boolean, info: TestInfo, trace?: FormObservation) {
  if (!fs.existsSync(path.join(extensionPath, "manifest.json"))) throw new Error("Build the extension before the #688 campaign; missing builds must not skip.");
  const lab = await startFormIntentLab(variant, { observeIntent: !!trace });
  const removeObserver = trace ? lab.observe(row => trace.receiver(row)) : () => {};
  let allocated: BrowserContext | undefined, fence: Awaited<ReturnType<typeof startProvingGroundEgressFence>> | undefined, profile: string | undefined;
  let outcome: { attempts: FormReceipt[]; topUrl: string; parentUrl: string; benignUrl: string; sinkOrigin: string; dialogClosed: boolean } | undefined;
  let operationFailed = false, operationError: unknown, cleanupFailed = false;
  try {
  if (trace) trace.health("start", await lab.probe());
  const denied: ProvingGroundEgressAttempt[] = [];
  // The fence must exist before launch, including Chromium background traffic.
  fence = await startProvingGroundEgressFence(denied, new Set([lab.fixtureOrigin, lab.sinkOrigin]));
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "ns-form-688-"));
  const context = await chromium.launchPersistentContext(profile, {
    headless: true, channel: "chromium",
    ...(process.env.NAVSENTINEL_TEST_CHROMIUM_EXECUTABLE ? { executablePath: process.env.NAVSENTINEL_TEST_CHROMIUM_EXECUTABLE } : {}),
    proxy: { server: fence.proxyServer }, viewport: { width: 1100, height: 850 },
    args: ["--host-resolver-rules=MAP localhost 127.0.0.1", "--disable-background-networking", "--disable-component-update",
      "--disable-domain-reliability", "--disable-quic", "--disable-sync", "--no-first-run", "--metrics-recording-only",
      ...(protectedArm ? [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] : ["--disable-extensions"])],
  });
  allocated = context;
  if (trace) trace.browser(context.browser()!.version());
  const errors: string[] = [];
  const page = await context.newPage();
  page.on("pageerror", error => { errors.push(error.message); trace?.fail("PAGE_ERROR"); });
  if (trace) {
    await context.exposeBinding("__nsFormObservation", ({ page: sourcePage }, value: unknown) => {
      if (sourcePage !== page) { trace.fail("PROBE_REJECTED"); return; }
      trace.pageReport(value);
    });
    await context.exposeBinding("__nsFormObservationFault", ({ page: sourcePage }, code: unknown) => {
      if (sourcePage !== page) { trace.fail("PROBE_REJECTED"); return; }
      if (code === "PROBE_REJECTED" || code === "RECEIVER_CALLBACK_LOSS") trace.fail(code);
      else trace.fail("PROBE_REJECTED");
    });
    const destination = (url: string): "fixture" | "harm" | "benign" | "other" => {
      try {
        const parsed = new URL(url), address = parsed.origin + parsed.pathname;
        if (address === lab.fixtureOrigin + "/parent" || address === lab.fixtureOrigin + "/child") return "fixture";
        if (address === lab.harmUrl) return "harm";
        if (address === lab.benignUrl || address === lab.sinkOrigin + "/done") return "benign";
      } catch { /* Unknown navigation remains unknown. */ }
      return "other";
    };
    page.on("framenavigated", frame => trace.navigation(frame.parentFrame() ? "child" : "top", destination(frame.url())));
  }
    if (protectedArm) {
      await getServiceWorker(context); await updateNavigationSettings(context, { defaultMode: "smart", debug: true });
    }
    await page.goto(lab.fixtureOrigin + "/parent");
    const frame = page.frames().find(candidate => candidate.url() === lab.fixtureOrigin + "/child");
    if (!frame) throw new Error("Exact child fixture missing");
    await frame.waitForFunction(() => document.body.dataset.fixtureReady === "1");
    if (protectedArm) { await ready(page.mainFrame()); await ready(frame); }
    if (["allow-once", "allow-mutated"].includes(variant)) {
      trace?.input("click"); await frame.locator("#outside").click();
      if (protectedArm) {
        const control = frame.locator("#__navsentinel_toast_host").getByRole("button", { name: "Allow once", exact: true });
        await expect(control).toBeVisible();
        if (variant === "allow-mutated") await frame.locator("#f").evaluate((form, harm) => {
          (form as HTMLFormElement).action = harm;
          (globalThis as unknown as { __nsFormReport?: (phase: string, form: Element, submitter: Element | null, primitive: string) => void }).__nsFormReport?.("prepared", form, form.querySelector("#a"), "requestSubmit");
        }, lab.harmUrl);
        // Trusted hardware-like activation, NOT element.click() in evaluate.
        trace?.input("allow-once"); await control.click();
      }
    } else if (variant === "synthetic") {
      trace?.input("synthetic-click"); await frame.locator("#a").evaluate(button => (button as HTMLButtonElement).click());
    } else {
      trace?.input("click"); await frame.locator("#a").click();
    }
    if (variant === "validation") {
      await page.waitForTimeout(200); expect(lab.attempts).toEqual([]);
      trace?.input("fill-required"); await frame.locator("#required").fill("inert"); trace?.input("click"); await frame.locator("#a").click();
    }
    if (variant === "mixed" && protectedArm) {
      await frame.waitForFunction(() => document.body.dataset.mixedReady === "1");
      expect(lab.attempts.filter(row => row.role === "harm")).toEqual([]);
      trace?.input("click"); await frame.locator("#a").click();
    }
    await page.waitForTimeout(quietMs);
    if (trace && protectedArm) {
      try {
        const worker = await getServiceWorker(context);
        const codes = await worker.evaluate(async () => {
          const stored = await chrome.storage.local.get("sentinelsuite:event_log_v1");
          const rows = stored["sentinelsuite:event_log_v1"] as Array<{ kind?: string }> | undefined;
          return (rows ?? []).filter(row => ["nav_blank_prompt", "nav_click_block", "nav_rollback"].includes(row.kind ?? "")).slice(-32)
            .map(row => row.kind === "nav_rollback" ? "navigation-rollback" as const : "navigation-blocked" as const);
        });
        for (const code of codes) trace.product(code);
      } catch { trace.fail("PRODUCT_READ_FAILED"); }
    }
    const topUrl = page.url();
    let dialogClosed = false;
    if (variant === "dialog") dialogClosed = await frame.locator("dialog").evaluate(dialog => !(dialog as HTMLDialogElement).open);
    expect(errors, "fixture exceptions invalidate the arm").toEqual([]);
    const result = { attempts: [...lab.attempts], topUrl, parentUrl: lab.fixtureOrigin + "/parent", benignUrl: lab.benignUrl,
      sinkOrigin: lab.sinkOrigin, dialogClosed };
    fs.writeFileSync(info.outputPath(`${variant}-${protectedArm ? "protected" : "baseline"}.result.json`), JSON.stringify({ variant, protectedArm,
      attempts: result.attempts, atFixture: result.topUrl === result.parentUrl, atSink: result.topUrl.startsWith(result.sinkOrigin + "/"), dialogClosed }));
    await info.attach(`${variant}-${protectedArm ? "protected" : "baseline"}.json`, { contentType: "application/json",
      body: Buffer.from(JSON.stringify({ ...result, browser: context.browser()?.version(), extensionHash: artifactHash(extensionPath),
        protectedArm, deniedBrowserBackground: denied, observationMs: quietMs,
        nonClaims: ["branded Chrome owner acceptance", "open-web efficacy", "request-body verification", "native late mutation pre-harm prevention"] }, null, 2)) });
    outcome = result;
  } catch (error) { operationFailed = true; operationError = error; } finally {
    try { await allocated?.close(); } catch { cleanupFailed = true; }
    if (trace) {
      trace.health("end", await lab.probe());
      if (lab.observerErrors()) trace.fail("RECEIVER_CALLBACK_LOSS");
    }
    removeObserver();
    try { await fence?.close(); } catch { cleanupFailed = true; }
    try { await lab.close(); } catch { cleanupFailed = true; }
    if (profile) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { cleanupFailed = true; } }
    if (cleanupFailed) trace?.fail("CLEANUP_FAILED");
  }
  if (operationFailed) throw operationError;
  if (cleanupFailed) throw new Error("FORM_CLEANUP_FAILED");
  if (!outcome) throw new Error("FORM_OUTCOME_MISSING");
  return outcome;
}


/** Optional projection; original operation/assertion matrix remains below unchanged. */
async function runArm(variant: FormCase, protectedArm: boolean, info: TestInfo) {
  if (process.env.NAVSENTINEL_FORM_OBSERVATORY !== "1") return executeArm(variant, protectedArm, info);
  const git = (arg: string): string => execFileSync("git", ["rev-parse", "--verify", arg], { encoding: "utf8" }).trim();
  const fixtureFiles = ["tests/e2e/form_intent_lab.ts", "tests/e2e/form_observatory.ts", "tests/e2e/form_observatory_probe.ts", "tests/e2e/issue688-form-intent.spec.ts"];
  const fixtureSha256 = createHash("sha256"); for (const file of fixtureFiles) fixtureSha256.update(file + "\0").update(fs.readFileSync(file));
  const trace = new FormObservation({ variant, protectedArm, pairId: createHash("sha256").update(`${info.testId}:${info.retry}:${info.repeatEachIndex}`).digest("hex"),
    identity: { head: git("HEAD"), tree: git("HEAD^{tree}"), extensionSha256: artifactHash(extensionPath), fixtureSha256: fixtureSha256.digest("hex") } });
  let completed = false;
  try { const result = await executeArm(variant, protectedArm, info, trace); completed = true; return result; }
  catch (error) { trace.fail("RUNNER_FAILED"); throw error; }
  finally {
    const file = info.outputPath(`${variant}-${protectedArm ? "protected" : "baseline"}.form-trace.json`);
    fs.writeFileSync(file, JSON.stringify(trace.finish(completed), null, 2));
    await info.attach("form-observatory", { contentType: "application/json", path: file });
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
const benign: FormCase[] = ["exact-submit", "exact-request", "native", "slow-response", "empty-target", "inherited-target", "empty-method", "invalid-method", "self", "validation"];
for (const variant of benign) test(`@regression #688 benign ${variant}`, async ({}, info) => {
  test.setTimeout(45000);
  const result = await runArm(variant, true, info);
  expect(result.attempts).toHaveLength(1); expect(result.attempts[0]).toMatchObject({ role: "benign", accepted: true });
  if (["empty-target", "self"].includes(variant)) expect(result.topUrl).toBe(result.parentUrl);
  else expect(result.topUrl.startsWith(result.sinkOrigin + "/")).toBe(true);
  if (["empty-method", "invalid-method"].includes(variant)) expect(result.attempts[0]?.method).toBe("GET");
});
test("@regression #688 server-redirect: an unproven changed start is rolled back post-commit", async ({}, info) => {
  test.setTimeout(45000);
  const result = await runArm("server-redirect", true, info);
  expect(result.attempts).toHaveLength(1);
  expect(result.attempts[0]).toMatchObject({ role: "benign", accepted: true });
  expect(result.topUrl).toBe(result.parentUrl);
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
