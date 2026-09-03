import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { inspectBuiltReleaseProfile } from "../../scripts/check-release-profile.mjs";
import { readBuiltMainUiGuardRevision, startGymServer } from "../e2e/extension_test_utils";
import { startProvingGroundFakeSink } from "../e2e/proving_ground_fake_sink";
import { MaintainerHeadedError, hashDirectory, hashFiles, parseChromeMetadata, readRepositorySnapshot, redactError, sha256, validateMaintainerInputs, writeEvidenceReceipt } from "./receipt";

const fixturePath = path.resolve(process.cwd(), "gym", "level9-legit-video-overlay.html");
const fixtureContractPath = path.resolve(process.cwd(), "gym", "local-fixture-targets.js");
const extensionPath = path.resolve(process.cwd(), "extension", "dist");
const receiptDirectory = path.resolve(process.cwd(), "artifacts", "maintainer-headed");
type ErrorDigest = { source: "page" | "worker"; sha256: string; length: number };

function assertBuild(): { buildSha256: string; profile: Record<string, unknown> } {
  if (process.env.EXTENSION_PATH && path.resolve(process.env.EXTENSION_PATH) !== extensionPath) {
    throw new MaintainerHeadedError("build_identity", "extension-path-mismatch");
  }
  if (!fs.existsSync(extensionPath) || !fs.existsSync(path.join(extensionPath, "manifest.json"))) throw new MaintainerHeadedError("build_identity", "missing-extension-dist");
  let profile: { id: string; releaseEligible: boolean; capabilities: Record<string, boolean> };
  try { profile = inspectBuiltReleaseProfile(extensionPath, { expectedProfile: "interaction-only", requireReleaseEligible: true }).profile; } catch (error) { throw new MaintainerHeadedError("build_identity", "invalid-release-profile", redactError(error).sha256); }
  const buildSha256 = hashDirectory(extensionPath);
  return { buildSha256, profile: { id: profile.id, release_eligible: profile.releaseEligible, capabilities: profile.capabilities } };
}

async function readiness(page: Page, guard: string): Promise<Record<string, string | null>> {
  const markers = await page.evaluate(() => ({ capture: document.documentElement.getAttribute("data-navsentinel-capture-ready"), bridge: document.documentElement.getAttribute("data-navsentinel-bridge-ready"), ui_guard: document.documentElement.getAttribute("data-navsentinel-ui-guard") }));
  if (markers.capture !== "1" || markers.bridge !== "1" || markers.ui_guard !== guard) throw new MaintainerHeadedError("extension_readiness", "readiness-marker-mismatch");
  return markers;
}

async function noToast(page: Page, durationMs: number): Promise<boolean> {
  return page.evaluate(async (duration) => new Promise<boolean>((resolve) => {
    const started = performance.now();
    const seen = () => Boolean(document.querySelector("#__navsentinel_toast_host")?.shadowRoot?.querySelector(".body")?.textContent?.trim());
    const poll = () => { if (seen()) return resolve(false); if (performance.now() - started >= duration) return resolve(true); window.setTimeout(poll, 50); };
    poll();
  }), durationMs);
}

function observeWorker(worker: Worker, errors: ErrorDigest[]): void {
  worker.on("console", (message) => { if (message.type() === "error") { const text = message.text(); errors.push({ source: "worker", sha256: sha256(text), length: text.length }); } });
}

function observePage(page: Page, errors: ErrorDigest[]): void {
  page.on("pageerror", (error) => { const text = error.message; errors.push({ source: "page", sha256: sha256(text), length: text.length }); });
  page.on("console", (message) => { if (message.type() === "error") { const text = message.text(); errors.push({ source: "page", sha256: sha256(text), length: text.length }); } });
}

test.setTimeout(90_000);
test("#420 records one operator-prepared branded-Chrome benign receipt", async () => {
  let repository = { head: "unavailable", status: "unavailable" };
  const errors: ErrorDigest[] = [];
  const verification: string[] = [];
  let build: ReturnType<typeof assertBuild> | undefined;
  let browserProduct = "unavailable";
  let browserVersion = "unavailable";
  let acknowledgedExtensionId = "";
  let markers: Record<string, string | null> | undefined;
  let sinkCount = 0;
  let sinkDigest = "";
  let failure: unknown;
  let ownedPage: Page | undefined;
  let popup: Page | undefined;
  let gym: Awaited<ReturnType<typeof startGymServer>> | undefined;
  let sink: Awaited<ReturnType<typeof startProvingGroundFakeSink>> | undefined;

  try {
    repository = readRepositorySnapshot();
    const inputs = validateMaintainerInputs(process.env, repository);
    acknowledgedExtensionId = inputs.extensionId;
    build = assertBuild();
    const metadataResponse = await fetch(new URL("/json/version", inputs.endpoint), { redirect: "error" });
    if (!metadataResponse.ok) throw new MaintainerHeadedError("browser_attachment", "cdp-metadata-unavailable");
    const metadata = parseChromeMetadata(await metadataResponse.json());
    browserProduct = metadata.product;
    browserVersion = metadata.version;
    const browser = await chromium.connectOverCDP(metadata.debuggerUrl);
    const contexts = browser.contexts();
    if (contexts.length !== 1) throw new MaintainerHeadedError("browser_attachment", "unexpected-context-count");
    const context: BrowserContext = contexts[0]!;
    const workerPrefix = `chrome-extension://${inputs.extensionId}/`;
    const workers = context.serviceWorkers().filter((worker) => worker.url().startsWith(workerPrefix));
    if (workers.length !== 1) throw new MaintainerHeadedError("extension_readiness", "missing-extension-worker");
    for (const worker of workers) observeWorker(worker, errors);
    context.on("serviceworker", (worker) => { if (worker.url().startsWith(workerPrefix)) observeWorker(worker, errors); });
    verification.push("operator_acknowledged_exact_current_head", "dedicated_profile_acknowledged", "chrome_cdp_attached", "operator_acknowledged_extension_id_worker_present");

    sink = await startProvingGroundFakeSink({ runId: randomUUID(), scenarioId: "NS-ADV-UI-004", allowedRoles: ["benign"], allowedConsequences: ["benign-navigation"], targetAuthorities: [{ id: "level9-benign", role: "benign", consequence: "benign-navigation", maxUses: 1 }] });
    gym = await startGymServer(path.resolve(process.cwd(), "gym"));
    const url = new URL("/level9-legit-video-overlay.html", gym.baseUrl);
    url.searchParams.set("benign_target", sink.urlFor("benign", "benign-navigation", "level9-benign"));
    ownedPage = await context.newPage();
    observePage(ownedPage, errors);
    await ownedPage.goto(url.href, { waitUntil: "domcontentloaded", timeout: 20_000 });
    markers = await readiness(ownedPage, readBuiltMainUiGuardRevision());
    verification.push("capture_bridge_ui_guard_match_exact_build");
    await ownedPage.locator("#overlayBtn").click();
    await expect(ownedPage.locator("#status")).toHaveText("Status: playing");
    if (!await noToast(ownedPage, 1_000)) throw new MaintainerHeadedError("fixture_execution", "unexpected-navsentinel-toast");
    verification.push("trusted_play_click_toggles_without_toast");
    const popupPromise = ownedPage.waitForEvent("popup", { timeout: 10_000 });
    await ownedPage.locator("a[data-navsentinel-local-target='benign']").click();
    popup = await popupPromise;
    await expect.poll(() => sink?.snapshot().receipts.length ?? 0).toBe(1);
    const snapshot = sink.snapshot();
    if (snapshot.invalidAttempts.length !== 0 || snapshot.receipts.length !== 1) throw new MaintainerHeadedError("fixture_execution", "typed-sink-mismatch");
    sinkCount = snapshot.receipts.length;
    sinkDigest = sha256(JSON.stringify(snapshot));
    verification.push("trusted_benign_target_reaches_one_typed_sink_receipt");
    if (errors.length > 0) throw new MaintainerHeadedError("runtime_error", "page-or-worker-error");
  } catch (error) { failure = error; }
  finally {
    await popup?.close().catch(() => undefined);
    await ownedPage?.close().catch(() => undefined);
    await gym?.close().catch(() => undefined);
    await sink?.close().catch(() => undefined);
    const typedFailure = failure instanceof MaintainerHeadedError ? failure : undefined;
    const valid = !failure && errors.length === 0;
    writeEvidenceReceipt(receiptDirectory, {
      schema_version: "1.0.0", outcome: valid ? "OBSERVED" : "TEST_INVALID", valid,
      failure_classification: typedFailure?.classification ?? (failure ? "runtime_error" : "none"), failure: failure ? redactError(failure) : null,
      repository_head: repository.head, extension_build_sha256: build?.buildSha256 ?? null, inspected_release_profile: build?.profile ?? null,
      browser: { product: browserProduct, version: browserVersion, declared_channel: "owner-prepared-branded-chrome" }, extension_id_sha256: acknowledgedExtensionId ? sha256(acknowledgedExtensionId) : null,
      fixture: { path: "gym/level9-legit-video-overlay.html", git_and_executed_sha256: hashFiles([fixturePath, fixtureContractPath]) },
      sink: { receipt_count: sinkCount, typed_snapshot_sha256: sinkDigest || null }, readiness: markers ?? null, verification, runtime_error_digests: errors,
      safety: { cdp_attach_only: true, browser_launched_by_runner: false, extension_reloaded_by_runner: false, chrome_extensions_controlled_by_runner: false, live_sites_visited: false, scheduler_registered: false, fp_measurement_run: false, gate_3_claimed: false, raw_sensitive_data_persisted: false },
      limitations: ["This is one owner-prepared, local benign Gym observation; it is not Gate-3, release, open-web, robustness, or false-positive measurement evidence.", "The operator, not this runner, starts Chrome, uses a dedicated non-default profile, reloads the exact build, and acknowledges its extension ID and reload head.", "Reload-head acknowledgement plus MAIN-world readiness markers do not independently prove every loaded artifact byte; the deterministic dist SHA-256 is recorded for comparison.", "The runner creates and closes only its own Gym page and its sink popup, and never closes the attached browser or context."],
    });
  }
  if (failure) throw new Error(`maintainer-headed-${redactError(failure).kind}`);
});
