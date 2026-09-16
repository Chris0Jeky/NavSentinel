/** #700/#701: exact-input, independently receipted, loopback-only Observatory campaign.
 * No product code, real secret, public target, OS action or release claim.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, expect, test, type BrowserContext, type Frame, type Page, type Worker } from "@playwright/test";
import { createRunRecorder, TRACE_V2, type Arm, type CapturedRun, type FrameContext, type SceneBox } from "../../experiments/evidence-observatory/recorder.mjs";
import { captureInputs, hashArtifact, type SourceInputs } from "../../experiments/evidence-observatory/source-inputs.mjs";
import { startGymServer, getServiceWorker, updateNavigationSettings, readBuiltUiGuardRevision } from "./extension_test_utils";
import { installFixtureTargetBootstrap } from "./local_fixture_target_bootstrap";
import { startProvingGroundEgressFence, startProvingGroundFakeSink, type ProvingGroundEgressAttempt, type ProvingGroundFakeSink, type ProvingGroundEgressFence } from "./proving_ground_fake_sink";

const SCENARIO = "NS-ADV-UI-004";
const REQUIRED_MS = 2300;
const extensionPath = path.resolve("extension/dist");
const SETTINGS = { defaultMode: "smart" as const, autoDismissOverlays: true, debug: false };
const sha = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const fixtureHash = (): string => sha(["gym/overlay-nesting-lab.html", "gym/overlay-nesting-frame.html", "gym/local-fixture-targets.js"].map(f => `${f}\0${sha(fs.readFileSync(f))}`).join("\n"));

test.setTimeout(150_000);
function inputs(): { source: SourceInputs; artifact: string } {
  if (process.env.EXTENSION_PATH || process.env.GYM_BASE_URL || !process.env.NAVSENTINEL_OBSERVATORY_INPUTS) throw new Error("Run the explicit Observatory campaign command first; no stale build is accepted.");
  const raw: unknown = JSON.parse(fs.readFileSync(process.env.NAVSENTINEL_OBSERVATORY_INPUTS, "utf8"));
  const source = captureInputs(); const artifact = hashArtifact(extensionPath);
  expect(raw).toEqual({ source, artifact });
  return { source, artifact };
}
function browserArgs(enabled: boolean): string[] {
  return ["--disable-background-networking", "--disable-client-side-phishing-detection", "--disable-component-update", "--disable-default-apps",
    "--disable-domain-reliability", "--disable-quic", "--disable-sync", "--metrics-recording-only", "--no-default-browser-check", "--no-first-run",
    "--disable-popup-blocking", "--safebrowsing-disable-auto-update",
    "--disable-features=AccountConsistency,AutofillServerCommunication,CertificateTransparencyComponentUpdater,MediaRouter,NetworkTimeServiceQuerying,OptimizationHints,Signin",
    ...(enabled ? [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`] : [])];
}

type Recorder = ReturnType<typeof createRunRecorder>;
function attachFrameObserver(page: Page, recorder: Recorder, active: () => boolean): { frameContext: (frame: Frame) => FrameContext } {
  const states = new WeakMap<Frame, FrameContext>(); const primaryDocuments = new WeakSet<Frame>(); let nextFrame = 0, nextDocument = 0;
  const frameContext = (frame: Frame): FrameContext => {
    let context = states.get(frame);
    if (!context) {
      const parent = frame.parentFrame();
      context = { pageId: "fixture-page", frameId: `frame-${++nextFrame}`, documentId: `document-${++nextDocument}`,
        parentFrameId: parent ? frameContext(parent).frameId : null };
      states.set(frame, context);
    }
    return { ...context };
  };
  page.on("frameattached", frame => { if (active()) recorder.record("browser", "frame.attached", { context: frameContext(frame), frame: "child" }); });
  page.on("framenavigated", frame => {
    if (!active()) return;
    if (primaryDocuments.has(frame)) recorder.gap("PRIMARY_FRAME_NAVIGATED");
    if (frame.url().includes("/overlay-nesting-frame.html")) primaryDocuments.add(frame);
    const context = frameContext(frame); context.documentId = `document-${++nextDocument}`; states.set(frame, context);
    recorder.record("browser", "navigation.committed", { context, frame: frame.parentFrame() ? "child" : "top" });
  });
  page.on("framedetached", frame => {
    if (!active()) return;
    const context = frameContext(frame);
    recorder.record("browser", "frame.detached", { context, frame: "child" });
    if (frame.url().includes("/overlay-nesting-frame.html")) recorder.gap("PRIMARY_FRAME_DETACHED");
  });
  return { frameContext };
}
async function sampleScene(page: Page, frame: Frame, contextOf: (frame: Frame) => FrameContext, harmUrl: string, benignUrl: string): Promise<{ width: number; height: number; boxes: SceneBox[] }> {
  const viewport = page.viewportSize(); if (!viewport) throw new Error("Viewport unavailable");
  const boxes: SceneBox[] = [];
  const add = async (owner: Page | Frame, id: string, kind: SceneBox["kind"], context: FrameContext): Promise<void> => {
    const locator = owner.locator(`#${id}`), exists = await locator.count() > 0;
    const rect = exists ? await locator.boundingBox() : null;
    let declaredTarget: SceneBox["declaredTarget"] = "none", effectiveTarget: SceneBox["effectiveTarget"] = "none", targetScope: SceneBox["targetScope"] = "none";
    const classify = (url: string | null): SceneBox["effectiveTarget"] => url === harmUrl ? "harm-receiver" : url === benignUrl ? "benign-receiver" : url === "#" ? "same-document" : url ? "unknown" : "none";
    let linkFrame: Frame | null = null;
    if (exists && kind === "attack") { const handle = await locator.elementHandle(); linkFrame = await handle?.contentFrame() ?? null; }
    const anchor = kind === "attack" ? linkFrame?.locator("#container") : id === "observatory-benign-receiver" ? locator : null;
    if (anchor && await anchor.count()) {
      const values = await anchor.evaluate(node => ({ declared: node.getAttribute("href"), effective: node instanceof HTMLAnchorElement ? node.href : "", scope: node.getAttribute("target") }));
      declaredTarget = classify(values.declared); effectiveTarget = classify(values.effective);
      targetScope = values.scope === "_blank" ? "new-context" : !values.scope || values.scope === "_self" ? "current-context" : "unknown";
    }
    boxes.push({ id, ...context, kind, state: !exists ? "absent" : rect ? "visible" : "hidden",
      x: Math.round(rect?.x ?? 0), y: Math.round(rect?.y ?? 0), width: Math.round(rect?.width ?? 0), height: Math.round(rect?.height ?? 0),
      declaredTarget, effectiveTarget, targetScope });
  };
  await add(page, "media-frame", "frame", contextOf(frame));
  for (const id of ["outside-toast-target", "programme-benign-control", "observatory-benign-receiver"]) await add(frame, id, "control", contextOf(frame));
  for (const id of ["programme-overlay-a", "programme-overlay-b"]) await add(frame, id, "attack", contextOf(frame));
  // pageId is not part of scene geometry: only frame/document identities are rendered.
  return { ...viewport, boxes: boxes.map(({ ...box }) => { delete (box as SceneBox & { pageId?: string }).pageId; return box; }) };
}
async function readProduct(worker: Worker): Promise<Array<{ code: string }>> {
  return worker.evaluate(async () => {
    const result = await chrome.storage.local.get("sentinelsuite:event_log_v1");
    const values = result["sentinelsuite:event_log_v1"] as Array<{ kind?: string; extra?: { overlayCleanupOutcome?: string } }> | undefined;
    return (values ?? []).filter(v => v.kind === "mutation_alert" && ["suppressed", "reasserted"].includes(v.extra?.overlayCleanupOutcome ?? ""))
      .slice(-64).map(v => ({ code: `overlay-${v.extra?.overlayCleanupOutcome}` }));
  });
}
async function runArm(arm: Arm, churn: boolean, instrumentation: "full" | "minimal"): Promise<{ run: CapturedRun; browserVersion: string; error: string | null }> {
  const runId = randomUUID(), contextId = randomUUID(), harmId = `${arm}-harm`, benignId = `${arm}-benign`;
  const harmRole = arm === "mixed" ? "mixed" : "attack", benignRole = arm === "mixed" ? "mixed" : "benign";
  const recorder = createRunRecorder({ runId, arm, contextId, harmTargetId: harmId, benignTargetId: benignId, requiredMs: REQUIRED_MS, instrumentation });
  let sink: ProvingGroundFakeSink | null = null, unsubscribe = (): void => {},
    gym: Awaited<ReturnType<typeof startGymServer>> | null = null, fence: ProvingGroundEgressFence | null = null, profile: string | null = null;
  let context: BrowserContext | null = null, browserVersion = "unknown", extensionReady = false, trustedInput = false, collecting = true, egressFenced = false;
  let error: string | null = null;
  try {
    sink = await startProvingGroundFakeSink({ runId, scenarioId: SCENARIO, allowedRoles: ["attack", "benign", "mixed"], allowedConsequences: ["wrong-target-navigation", "benign-navigation"],
      targetAuthorities: [{ id: harmId, role: harmRole, consequence: "wrong-target-navigation", maxUses: 1 }, { id: benignId, role: benignRole, consequence: "benign-navigation", maxUses: 1 }] });
    const liveSink = sink;
    unsubscribe = sink.observe(receipt => { recorder.receipt(receipt); });
    gym = await startGymServer(path.resolve("gym"));
    const childOrigin = gym.baseUrl.replace("127.0.0.1", "localhost");
    const allowedOrigins = new Set([gym.baseUrl, childOrigin, sink.origin]);
    const denied: ProvingGroundEgressAttempt[] = [];
    fence = await startProvingGroundEgressFence(denied, allowedOrigins); egressFenced = true;
    profile = fs.mkdtempSync(path.join(os.tmpdir(), "ns-observatory-"));
    recorder.health("start", await sink.probe());
    context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, viewport: { width: 1280, height: 900 }, proxy: { server: fence.proxyServer }, args: browserArgs(arm !== "baseline") });
    browserVersion = context.browser()?.version() ?? "unknown";
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (["http:", "https:"].includes(url.protocol) && !allowedOrigins.has(url.origin)) { recorder.gap("EGRESS_ATTEMPT"); await route.abort(); }
      else await route.continue();
    });
    let worker: Worker | null = null;
    const workerEpoch = randomUUID();
    if (arm !== "baseline") {
      worker = await getServiceWorker(context);
      await updateNavigationSettings(context, SETTINGS);
      await worker.evaluate(epoch => { Object.defineProperty(globalThis, "__nsObservatoryEpoch", { value: epoch, configurable: true }); }, workerEpoch);
    }
    const page = await context.newPage();
    const { frameContext } = attachFrameObserver(page, recorder, () => collecting);
    page.on("pageerror", () => { if (collecting) recorder.gap("PAGE_ERROR"); });
    if (instrumentation === "full") await page.exposeBinding("__nsObservatoryReport", ({ frame }, raw: unknown) => {
      if (!collecting) return;
      const item = raw as { kind?: string; code?: string; at?: number } | null;
      if (!item || typeof item !== "object" || Object.keys(item).some(k => !["kind", "code", "at"].includes(k)) ||
        !["attack.attempt", "dom.changed"].includes(item.kind ?? "") || !["layer-appended", "display-rewritten"].includes(item.code ?? "") ||
        typeof item.at !== "number" || !Number.isFinite(item.at) || item.at < 0 || item.at > 86400000 ||
        new URL(frame.url()).pathname !== "/overlay-nesting-frame.html") { recorder.gap("PAGE_REPORT_REJECTED"); return; }
      const frameIdentity = frameContext(frame);
      recorder.record("page", item.kind!, { code: item.code!, frame: "child", context: frameIdentity, sourceClock: { id: frameIdentity.documentId, timeMs: item.at } });
    });
    await installFixtureTargetBootstrap(page, sink.createFixtureBootstrap({ fixtureOrigin: childOrigin, fixturePath: "/overlay-nesting-frame.html", bindings: [
      { targetRole: "harm", scenarioId: SCENARIO, originMode: "alternate-loopback", source: { kind: "armed-sink", sinkRole: harmRole, consequence: "wrong-target-navigation", targetId: harmId } },
      { targetRole: "benign", scenarioId: SCENARIO, originMode: "alternate-loopback", source: { kind: "armed-sink", sinkRole: benignRole, consequence: "benign-navigation", targetId: benignId } },
    ] }));
    const url = new URL("/overlay-nesting-lab.html", gym.baseUrl);
    url.searchParams.set("case", arm === "benign" ? "programme-benign" : arm === "mixed" ? "programme-mixed" : "programme-attack");
    url.searchParams.set("observatory", "1"); url.searchParams.set("record", instrumentation === "full" ? "1" : "0");
    if (churn) url.searchParams.set("churn", "1");
    await page.goto(url.href, { waitUntil: "domcontentloaded" });
    await expect.poll(() => page.frames().some(f => f.url().startsWith(`${childOrigin}/overlay-nesting-frame.html`))).toBe(true);
    const frame = page.frames().find(f => f.url().startsWith(`${childOrigin}/overlay-nesting-frame.html`))!;
    await frame.waitForFunction(() => document.documentElement.dataset.fixtureReady === "true");
    if (arm !== "baseline") {
      const marker = readBuiltUiGuardRevision();
      await frame.waitForFunction(expected => document.documentElement.getAttribute("data-navsentinel-capture-ready") === "1" && document.documentElement.getAttribute("data-navsentinel-bridge-ready") === "1" && document.documentElement.getAttribute("data-navsentinel-ui-guard") === expected, marker);
      extensionReady = true;
    } else {
      expect(context.serviceWorkers()).toHaveLength(0);
      expect(await frame.locator("html").getAttribute("data-navsentinel-capture-ready")).toBeNull();
    }
    const harmUrl = sink.urlFor(harmRole, "wrong-target-navigation", harmId), benignUrl = sink.urlFor(benignRole, "benign-navigation", benignId);
    const sample = async (): Promise<void> => {
      if (instrumentation === "full") recorder.record("browser", "scene.sample", { scene: await sampleScene(page, frame, frameContext, harmUrl, benignUrl), frame: "child", context: frameContext(frame) });
    };
    await sample();
    // Exercise the declared reinsertion schedule, not a first-hidden-only oracle.
    if (churn) await page.waitForTimeout(1600);
    if (arm !== "baseline" && arm !== "benign") await expect(frame.locator(churn ? "#programme-overlay-b" : "#programme-overlay-a")).toBeHidden();
    await sample();
    const target = await frame.locator("#outside-toast-target").boundingBox();
    if (!target) throw new Error("CONTROL_GEOMETRY_MISSING");
    recorder.record("runner", "input.dispatched", { code: "native-pointer", frame: "child", context: frameContext(frame) }); trustedInput = true;
    await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2);
    if (arm === "baseline") await expect.poll(() => liveSink.snapshot().receipts.filter(r => r.targetId === harmId).length).toBe(1);
    else {
      await expect.poll(() => frame.evaluate(() => Number(document.documentElement.dataset.outsideInteractionCount ?? 0))).toBe(1);
      recorder.record("browser", "control.completed", { code: "underlying-playback", frame: "child", context: frameContext(frame) });
    }
    if (arm === "benign" || arm === "mixed") {
      await frame.locator("#programme-benign-control").click();
      await expect.poll(() => frame.evaluate(() => Number(document.documentElement.dataset.programmeBenignClicks ?? 0))).toBe(1);
      recorder.record("browser", "control.completed", { code: "rerendered-playback", frame: "child", context: frameContext(frame) });
      recorder.record("runner", "input.dispatched", { code: "native-anchor", frame: "child", context: frameContext(frame) });
      await frame.locator("#observatory-benign-receiver").click();
      await expect.poll(() => liveSink.snapshot().receipts.filter(r => r.targetId === benignId).length).toBe(1);
    }
    await sample();
    const end = Date.now() + REQUIRED_MS + 100;
    while (Date.now() < end) { await page.waitForTimeout(Math.min(250, Math.max(1, end - Date.now()))); await sample(); }
    if (worker) {
      const epoch = await worker.evaluate(() => (globalThis as unknown as Record<string, unknown>).__nsObservatoryEpoch);
      if (epoch !== workerEpoch) recorder.gap("WORKER_EPOCH_CHANGED");
      const decisions = await readProduct(worker);
      for (const d of decisions) recorder.record("extension", "decision.block", { code: d.code });
      if (arm === "protected" || arm === "mixed") expect(decisions.length).toBeGreaterThan(0);
      else expect(decisions).toHaveLength(0);
    }
    const snapshot = sink.snapshot();
    expect(snapshot.invalidAttempts).toEqual([]);
    expect(snapshot.receipts.filter(r => r.targetId === harmId)).toHaveLength(arm === "baseline" ? 1 : 0);
    expect(snapshot.receipts.filter(r => r.targetId === benignId)).toHaveLength(arm === "benign" || arm === "mixed" ? 1 : 0);
  } catch (cause) {
    // This lane is synthetic only; detailed failure stays in the runner log, not
    // in minimized report text. The trace still records a terminal invalid run.
    console.error(`Observatory ${arm}/${instrumentation} failed`, cause);
    error = "RUNNER_FAILED"; recorder.gap(error);
  }
  finally {
    collecting = false;
    try { await context?.close(); } catch { error = "RUNNER_FAILED"; recorder.gap(error); }
    try { if (sink) recorder.health("end", await sink.probe()); } catch { error = "RUNNER_FAILED"; recorder.gap(error); }
    unsubscribe();
    for (const resource of [sink, fence, gym]) {
      try { await resource?.close(); } catch { error = "RUNNER_FAILED"; recorder.gap(error); }
    }
    if (profile) fs.rmSync(profile, { recursive: true, force: true });
  }
  return { run: recorder.finish({ completed: error === null, extensionReady, trustedInput, egressFenced }), browserVersion, error };
}

for (const churn of [false, true]) test(`Observatory ${churn ? "reinsertion" : "stable"} four-arm and observer-parity campaign @observatory`, async ({}, testInfo) => {
  const start = inputs(); const variants = [];
  for (const instrumentation of ["full", "minimal"] as const) {
    const runs: CapturedRun[] = []; let browserVersion = "unknown";
    try {
      for (const arm of ["baseline", "protected", "benign", "mixed"] as const) {
        const result = await runArm(arm, churn, instrumentation); runs.push(result.run); browserVersion = result.browserVersion;
      }
    } finally {
      let after = start.source, artifactAfter = start.artifact;
      let rawVerified: boolean;
      try { after = captureInputs(); artifactAfter = hashArtifact(extensionPath); rawVerified = after.head === start.source.head && after.digest === start.source.digest && artifactAfter === start.artifact; } catch { rawVerified = false; }
      const trace = { schema: TRACE_V2, mode: "synthetic", campaignId: `${testInfo.testId.replace(/[^a-zA-Z0-9._-]/g, "-")}-${instrumentation}`, scenarioId: SCENARIO,
        variantId: `${churn ? "reinsertion" : "stable"}-${instrumentation}`,
        identity: { repositoryHead: start.source.head, extensionSha256: start.artifact, fixtureSha256: fixtureHash(), browserVersion, profile: "interaction-only", seed: "overlay-timing-v1" },
        provenance: { sourceTree: start.source.tree, inputsBefore: start.source.digest, inputsAfter: after.digest, artifactAfter,
          lockSha256: start.source.lockSha256, settingsSha256: sha(JSON.stringify(SETTINGS)), rawVerified }, runs };
      const output = testInfo.outputPath(`${instrumentation}-trace.json`); fs.writeFileSync(output, JSON.stringify(trace, null, 2));
      await testInfo.attach(`${instrumentation}-trace`, { path: output, contentType: "application/json" });
      expect(rawVerified, "Source or artifact drift invalidated the campaign").toBe(true);
    }
    variants.push(runs);
  }
  const consequenceVector = (runs: CapturedRun[]) => runs.map(r => ({ arm: r.arm, harm: r.events.filter(e => e.kind === "sink.receipt" && e.consequence === "harm").length,
    benign: r.events.filter(e => e.kind === "sink.receipt" && e.consequence === "benign").length, controls: r.events.filter(e => e.kind === "control.completed").length }));
  expect(variants.flat().every(run => run.completed && run.capture.faults.length === 0)).toBe(true);
  expect(consequenceVector(variants[0]!)).toEqual(consequenceVector(variants[1]!));
});
