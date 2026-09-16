import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Frame,
  type Page,
  type TestInfo,
} from "@playwright/test";
import {
  getGymBaseUrl,
  getServiceWorker,
  readBuiltUiGuardRevision,
  updateNavigationSettings,
  waitForNavSentinelBridge,
} from "./extension_test_utils";
import {
  startProvingGroundEgressFence,
  startProvingGroundFakeSink,
  type ProvingGroundEgressAttempt,
  type ProvingGroundFakeSink,
  type ProvingGroundRole,
} from "./proving_ground_fake_sink";

const SCENARIO_ID = "NS-ADV-UI-004";
const CONSEQUENCE = "wrong-target-navigation";
const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(process.cwd(), "extension", "dist");
const gymRoot = path.resolve(process.cwd(), "gym");
const fixturePaths = [
  path.join(gymRoot, "overlay-nesting-lab.html"),
  path.join(gymRoot, "overlay-nesting-frame.html"),
];

test.setTimeout(120_000);

type ScenarioDiagnostics = {
  browserVersion: string;
  violations: ProvingGroundEgressAttempt[];
  blockedExternalAttempts: ProvingGroundEgressAttempt[];
};
type ScenarioHarness = {
  page: Page;
  context: BrowserContext;
  frame: Frame;
  browserVersion: string;
  violations: ProvingGroundEgressAttempt[];
  cleanup: () => Promise<void>;
};

type ProgrammeOutcome =
  | "NO_SIGNAL"
  | "BLOCKED_PRE_HARM"
  | "HARM_REACHED"
  | "TEST_INVALID";

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashFiles(files: string[], relativeRoot = process.cwd()): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort()) {
    hash.update(path.relative(relativeRoot, file).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(fs.readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function hashDirectory(root: string): string {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile()) files.push(target);
    }
  };
  visit(root);
  return hashFiles(files, root);
}

function repositoryState(): { head: string; clean: boolean; invalidReason: string } {
  const head = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8",
  }).trim();
  const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
    cwd: process.cwd(),
    encoding: "utf8",
  }).trim();
  const override = process.env.NAVSENTINEL_PROGRAMME_HEAD?.trim();
  const invalidReasons: string[] = [];
  if (status) invalidReasons.push("Repository contains uncommitted tracked or untracked files");
  if (override && override !== head) {
    invalidReasons.push(`NAVSENTINEL_PROGRAMME_HEAD does not match Git HEAD ${head}`);
  }
  return {
    head,
    clean: invalidReasons.length === 0,
    invalidReason: invalidReasons.join("; "),
  };
}

function evidenceTransition(outcome: ProgrammeOutcome): {
  before: "UNMODELLED" | "MODELLED" | "FIXTURE_PROVEN";
  after: "UNMODELLED" | "MODELLED" | "FIXTURE_PROVEN" | "REGRESSION_PROVEN";
} {
  if (outcome === "HARM_REACHED") {
    return { before: "UNMODELLED", after: "FIXTURE_PROVEN" };
  }
  if (outcome === "BLOCKED_PRE_HARM") {
    return { before: "FIXTURE_PROVEN", after: "REGRESSION_PROVEN" };
  }
  if (outcome === "NO_SIGNAL") {
    return { before: "MODELLED", after: "MODELLED" };
  }
  return { before: "UNMODELLED", after: "UNMODELLED" };
}

function localOrigins(baseUrl: string): Set<string> {
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) {
    throw new Error(`Proving Ground requires a loopback Gym origin, received ${parsed.origin}`);
  }
  const origins = new Set([parsed.origin]);
  if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") {
    const alternate = new URL(parsed.origin);
    alternate.hostname = parsed.hostname === "127.0.0.1" ? "localhost" : "127.0.0.1";
    origins.add(alternate.origin);
  }
  return origins;
}

async function childFixtureFrame(page: Page, fixtureCase: string): Promise<Frame> {
  await expect.poll(() => page.frames().some((candidate) => {
    const url = new URL(candidate.url());
    return url.pathname.endsWith("/overlay-nesting-frame.html") &&
      url.searchParams.get("case") === fixtureCase;
  }), { timeout: 10_000 }).toBe(true);

  const frame = page.frames().find((candidate) => {
    const url = new URL(candidate.url());
    return url.pathname.endsWith("/overlay-nesting-frame.html") &&
      url.searchParams.get("case") === fixtureCase;
  });
  if (!frame) throw new Error(`Programme fixture frame did not load: ${fixtureCase}`);

  await frame.waitForFunction((expectedGuard) =>
    document.documentElement.dataset.fixtureReady === "true" &&
    document.documentElement.getAttribute("data-navsentinel-capture-ready") === "1" &&
    document.documentElement.getAttribute("data-navsentinel-bridge-ready") === "1" &&
    document.documentElement.getAttribute("data-navsentinel-ui-guard") === expectedGuard,
  readBuiltUiGuardRevision(), { timeout: 10_000 });
  return frame;
}

async function nestedAttackFrame(frame: Frame, attackId: string): Promise<Frame> {
  await expect.poll(async () => {
    for (const candidate of frame.childFrames()) {
      if (await candidate.locator("#container").count() === 1) return true;
    }
    return false;
  }, { timeout: 10_000 }).toBe(true);

  for (const candidate of frame.childFrames()) {
    const element = await candidate.frameElement();
    if (await element.getAttribute("id") === attackId) return candidate;
  }
  throw new Error(`Nested attack frame did not load: ${attackId}`);
}

async function sampleAttackVisibility(frame: Frame, durationMs: number): Promise<Array<{
  elapsedMs: number;
  visibleIds: string[];
}>> {
  return frame.evaluate(async (duration) => {
    const started = performance.now();
    const samples: Array<{ elapsedMs: number; visibleIds: string[] }> = [];
    while (performance.now() - started < duration) {
      const visibleIds = Array.from(document.querySelectorAll<HTMLElement>("[data-attack='true']"))
        .filter((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" &&
            rect.width > 0 && rect.height > 0;
        })
        .map((element) => element.id);
      samples.push({ elapsedMs: Math.round(performance.now() - started), visibleIds });
      await new Promise((resolve) => window.setTimeout(resolve, 75));
    }
    return samples;
  }, durationMs);
}

async function locatorScreenPoint(frame: Frame, selector: string): Promise<{
  x: number;
  y: number;
}> {
  const box = await frame.locator(selector).boundingBox();
  if (!box) throw new Error(`Trusted-click target has no browser viewport box: ${selector}`);
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  };
}

async function assertNoProductSignalFor(frame: Frame, durationMs: number): Promise<void> {
  await frame.evaluate(async (duration) => {
    const signalText = (): string | null => {
      const host = document.querySelector("#__navsentinel_toast_host");
      const text = host?.shadowRoot?.querySelector(".body")?.textContent?.trim();
      return text || null;
    };
    await new Promise<void>((resolve, reject) => {
      const started = performance.now();
      const check = () => {
        const signal = signalText();
        if (signal) {
          reject(new Error(`Unexpected NavSentinel signal: ${signal}`));
          return;
        }
        if (performance.now() - started >= duration) {
          resolve();
          return;
        }
        window.setTimeout(check, 50);
      };
      check();
    });
  }, durationMs);
}

async function setupScenario(
  sink: ProvingGroundFakeSink,
  role: ProvingGroundRole,
  fixtureCase: string,
  diagnostics: ScenarioDiagnostics,
): Promise<ScenarioHarness> {
  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
  const allowedOrigins = localOrigins(baseUrl);
  allowedOrigins.add(sink.origin);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-proving-ground-"));
  let context: BrowserContext | null = null;
  let egressFence: Awaited<ReturnType<typeof startProvingGroundEgressFence>> | null = null;

  try {
    egressFence = await startProvingGroundEgressFence(
      diagnostics.blockedExternalAttempts,
      allowedOrigins,
    );
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      proxy: {
        server: egressFence.proxyServer,
      },
      args: [
        "--disable-background-networking",
        "--disable-client-side-phishing-detection",
        "--disable-component-update",
        "--disable-default-apps",
        "--disable-domain-reliability",
        "--disable-quic",
        "--disable-sync",
        "--metrics-recording-only",
        "--no-default-browser-check",
        "--no-first-run",
        "--safebrowsing-disable-auto-update",
        "--disable-features=AccountConsistency,AutofillServerCommunication,CertificateTransparencyComponentUpdater,MediaRouter,NetworkTimeServiceQuerying,OptimizationHints,Signin",
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    await context.route("**/*", async (route) => {
      const request = route.request();
      const target = new URL(request.url());
      if ((target.protocol === "http:" || target.protocol === "https:") &&
          !allowedOrigins.has(target.origin)) {
        diagnostics.violations.push({
          method: request.method(),
          target: `${target.origin}${target.pathname}`,
          count: 1,
        });
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });

    const page = await context.newPage();
    const url = new URL("/overlay-nesting-lab.html", baseUrl);
    url.searchParams.set("case", fixtureCase);
    url.searchParams.set("sink", sink.urlFor(role, CONSEQUENCE));
    await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await waitForNavSentinelBridge(page);
    const frame = await childFixtureFrame(page, fixtureCase);
    diagnostics.browserVersion = context.browser()?.version() ?? "unknown";

    return {
      page,
      context,
      frame,
      browserVersion: diagnostics.browserVersion,
      violations: diagnostics.violations,
      cleanup: async () => {
        await context?.close();
        await egressFence?.close();
        if (gym) await gym.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await context?.close();
    await egressFence?.close();
    if (gym) await gym.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw error;
  }
}

async function reloadScenario(
  harness: ScenarioHarness,
  sink: ProvingGroundFakeSink,
  role: ProvingGroundRole,
  fixtureCase: string,
  churn = false,
): Promise<Frame> {
  const url = new URL(harness.page.url());
  url.searchParams.set("case", fixtureCase);
  url.searchParams.set("sink", sink.urlFor(role, CONSEQUENCE));
  if (churn) url.searchParams.set("churn", "1");
  else url.searchParams.delete("churn");
  await harness.page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 20_000 });
  await waitForNavSentinelBridge(harness.page);
  return childFixtureFrame(harness.page, fixtureCase);
}

async function writeReceipt(
  testInfo: TestInfo,
  diagnostics: ScenarioDiagnostics,
  sink: ProvingGroundFakeSink,
  role: ProvingGroundRole,
  label: string,
  outcome: ProgrammeOutcome,
  observation: unknown,
  observedSinkReceiptCount: number,
  valid: boolean,
  invalidReason = "",
): Promise<void> {
  const sinkSnapshot = sink.snapshot();
  const repository = repositoryState();
  const receiptValid = valid && repository.clean;
  const receiptOutcome = receiptValid ? outcome : "TEST_INVALID";
  const transition = evidenceTransition(receiptOutcome);
  const receiptInvalidReason = [invalidReason, repository.invalidReason]
    .filter(Boolean)
    .join("; ");
  const receipt = {
    schema_version: "1.0.0",
    scenario_id: SCENARIO_ID,
    capability_id: "C-10",
    foundation_capability_ids: ["F-02", "F-03"],
    profile: "proving_ground",
    repository_head: repository.head,
    extension_build_sha256: fs.existsSync(extensionPath) ? hashDirectory(extensionPath) : "",
    browser: {
      name: "chromium",
      version: diagnostics.browserVersion,
      channel: "playwright-bundled",
    },
    fixture: {
      role,
      path: "gym/overlay-nesting-lab.html + gym/overlay-nesting-frame.html",
      sha256: hashFiles(fixturePaths),
    },
    oracle: {
      type: "independent_harm",
      harm_boundary: "A trusted click reaches the local wrong-target navigation sink.",
      local_receipt_sha256: sha256(JSON.stringify({ sinkSnapshot, observation })),
      sink_receipt_count: observedSinkReceiptCount,
      sink_snapshot: sinkSnapshot,
      observation,
    },
    outcome: receiptOutcome,
    evidence_state_before: transition.before,
    evidence_state_after: transition.after,
    valid: receiptValid,
    invalid_reason: receiptInvalidReason,
    limitations: [
      "Bundled Chromium regression is not branded Chrome, owner Gate-3, or open-web efficacy evidence.",
      "The sink models a local in-browser consequence and never models OS execution.",
      "Chromium background-network attempts are denied before remote egress and retained separately from fixture violations.",
    ],
    safety: {
      synthetic_only: true,
      local_inert_sink: true,
      external_egress_observed: false,
      unexpected_egress_attempted: diagnostics.violations.length > 0,
      executable_content_present: false,
      real_credentials_present: false,
    },
    verification: [
      "tests/proving-ground-fake-sink.test.ts",
      "tests/e2e/proving-ground-overlay-sink.spec.ts",
    ],
    network_violations: diagnostics.violations,
    blocked_external_attempts: diagnostics.blockedExternalAttempts,
  };
  const outputPath = testInfo.outputPath(`${label}-receipt.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await testInfo.attach(`${label}-receipt`, {
    path: outputPath,
    contentType: "application/json",
  });
}

test("NS-ADV-UI-004 attack baseline reaches harm and cleanup holds before harm @regression", async ({}, testInfo) => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  const sink = await startProvingGroundFakeSink({
    runId: randomUUID(),
    scenarioId: SCENARIO_ID,
    allowedRoles: ["attack"],
    allowedConsequences: [CONSEQUENCE],
  });
  const diagnostics: ScenarioDiagnostics = {
    browserVersion: "unknown",
    violations: [],
    blockedExternalAttempts: [],
  };
  let harness: ScenarioHarness | null = null;

  try {
    harness = await setupScenario(sink, "attack", "programme-attack", diagnostics);
    await updateNavigationSettings(harness.context, {
      defaultMode: "off",
      autoDismissOverlays: false,
    });
    harness.frame = await reloadScenario(harness, sink, "attack", "programme-attack");
    await expect(harness.frame.locator("#programme-overlay-a")).toBeVisible();
    const attackFrame = await nestedAttackFrame(harness.frame, "programme-overlay-a");
    await expect(attackFrame.locator("#container")).toBeVisible();
    const baselinePoint = await locatorScreenPoint(harness.frame, "#outside-toast-target");
    const sinkPagePromise = harness.context.waitForEvent("page", { timeout: 5000 });
    await harness.page.mouse.click(baselinePoint.x, baselinePoint.y);
    const sinkPage = await sinkPagePromise;
    await sinkPage.waitForLoadState("domcontentloaded", { timeout: 5000 });
    await expect(sinkPage).toHaveURL(new RegExp("/__navsentinel_fake_sink\\?"));
    await expect.poll(() => sink.snapshot().receipts.length).toBe(1);
    await sinkPage.close();
    expect(await harness.frame.evaluate(() =>
      document.documentElement.dataset.outsideInteractionCount ?? "0",
    )).toBe("0");
    expect(sink.snapshot().invalidAttempts).toEqual([]);
    expect(harness.violations).toEqual([]);
    await writeReceipt(
      testInfo,
      diagnostics,
      sink,
      "attack",
      "attack-baseline",
      "HARM_REACHED",
      {
        receiptCount: 1,
        navigationReachedSink: true,
        trustedScreenPoint: baselinePoint,
        underlyingControlClicksCompleted: 0,
      },
      1,
      true,
    );

    await updateNavigationSettings(harness.context, {
      defaultMode: "smart",
      autoDismissOverlays: true,
    });
    harness.frame = await reloadScenario(harness, sink, "attack", "programme-attack", true);
    await expect(harness.frame.locator("#programme-overlay-a")).toBeHidden({ timeout: 5000 });
    const samples = await sampleAttackVisibility(harness.frame, 2300);
    expect(samples.filter((sample) => sample.visibleIds.length > 0)).toEqual([]);
    await expect(harness.frame.locator("#programme-overlay-b")).toBeHidden();
    const protectedPageCount = harness.context.pages().length;
    const protectedPoint = await locatorScreenPoint(harness.frame, "#outside-toast-target");
    expect(protectedPoint.x).toBeCloseTo(baselinePoint.x, 0);
    expect(protectedPoint.y).toBeCloseTo(baselinePoint.y, 0);
    await harness.page.mouse.click(protectedPoint.x, protectedPoint.y);
    await expect.poll(() => harness?.frame.evaluate(() =>
      document.documentElement.dataset.outsideInteractionCount,
    )).toBe("1");
    await harness.page.waitForTimeout(200);
    expect(harness.context.pages()).toHaveLength(protectedPageCount);
    expect(sink.snapshot().receipts).toHaveLength(1);
    expect(sink.snapshot().invalidAttempts).toEqual([]);
    expect(harness.violations).toEqual([]);
    await writeReceipt(
      testInfo,
      diagnostics,
      sink,
      "attack",
      "attack-protected",
      "BLOCKED_PRE_HARM",
      {
        baselineReceiptCount: 1,
        protectedReceiptCount: 0,
        trustedUnderlyingClicksCompleted: 1,
        newPagesOpened: 0,
        trustedScreenPoint: protectedPoint,
        visibilitySamples: samples,
      },
      0,
      true,
    );
  } catch (error) {
    await writeReceipt(
      testInfo,
      diagnostics,
      sink,
      "attack",
      "attack-invalid",
      "TEST_INVALID",
      {},
      sink.snapshot().receipts.length,
      false,
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  } finally {
    await harness?.cleanup();
    await sink.close();
  }
});

test("NS-ADV-UI-004 benign rerender remains usable and quiet @regression", async ({}, testInfo) => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  const sink = await startProvingGroundFakeSink({
    runId: randomUUID(),
    scenarioId: SCENARIO_ID,
    allowedRoles: ["benign"],
    allowedConsequences: [CONSEQUENCE],
  });
  const diagnostics: ScenarioDiagnostics = {
    browserVersion: "unknown",
    violations: [],
    blockedExternalAttempts: [],
  };
  let harness: ScenarioHarness | null = null;

  try {
    harness = await setupScenario(sink, "benign", "programme-benign", diagnostics);
    await updateNavigationSettings(harness.context, {
      defaultMode: "smart",
      autoDismissOverlays: true,
    });
    const worker = await getServiceWorker(harness.context);
    await worker.evaluate(async (eventLogKey) => {
      await chrome.storage.local.set({ [eventLogKey]: [] });
    }, "sentinelsuite:event_log_v1");
    harness.frame = await reloadScenario(harness, sink, "benign", "programme-benign");
    await harness.frame.waitForFunction(() =>
      document.documentElement.dataset.programmeBenignRerendered === "1",
    );
    await harness.frame.locator("#programme-benign-control").click();
    await expect.poll(() => harness?.frame.evaluate(() =>
      document.documentElement.dataset.programmeBenignClicks,
    )).toBe("1");
    await expect(harness.frame.locator("[data-attack='true']")).toHaveCount(0);
    await assertNoProductSignalFor(harness.frame, 1200);
    const benignEvents = await worker.evaluate(async (eventLogKey) => {
      const stored = await chrome.storage.local.get(eventLogKey);
      return Array.isArray(stored[eventLogKey]) ? stored[eventLogKey] : [];
    }, "sentinelsuite:event_log_v1");
    expect(benignEvents).toEqual([]);
    expect(sink.snapshot()).toEqual({ receipts: [], invalidAttempts: [] });
    expect(harness.violations).toEqual([]);
    await writeReceipt(
      testInfo,
      diagnostics,
      sink,
      "benign",
      "benign",
      "NO_SIGNAL",
      {
        benignRerendered: true,
        trustedClicksCompleted: 1,
        sinkReceiptCount: 0,
        productToastObserved: false,
        productEventCount: 0,
      },
      0,
      true,
    );
  } catch (error) {
    await writeReceipt(
      testInfo,
      diagnostics,
      sink,
      "benign",
      "benign-invalid",
      "TEST_INVALID",
      {},
      sink.snapshot().receipts.length,
      false,
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  } finally {
    await harness?.cleanup();
    await sink.close();
  }
});

test("NS-ADV-UI-004 mixed rerender preserves benign control while holding the attack @regression", async ({}, testInfo) => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running e2e tests.");
  const sink = await startProvingGroundFakeSink({
    runId: randomUUID(),
    scenarioId: SCENARIO_ID,
    allowedRoles: ["mixed"],
    allowedConsequences: [CONSEQUENCE],
  });
  const diagnostics: ScenarioDiagnostics = {
    browserVersion: "unknown",
    violations: [],
    blockedExternalAttempts: [],
  };
  let harness: ScenarioHarness | null = null;

  try {
    harness = await setupScenario(sink, "mixed", "programme-mixed", diagnostics);
    await updateNavigationSettings(harness.context, {
      defaultMode: "smart",
      autoDismissOverlays: true,
    });
    harness.frame = await reloadScenario(harness, sink, "mixed", "programme-mixed", true);
    await expect(harness.frame.locator("#programme-overlay-a")).toBeHidden({ timeout: 5000 });
    const samples = await sampleAttackVisibility(harness.frame, 2300);
    expect(samples.filter((sample) => sample.visibleIds.length > 0)).toEqual([]);
    await expect(harness.frame.locator("#programme-overlay-b")).toBeHidden();
    await harness.frame.waitForFunction(() =>
      document.documentElement.dataset.programmeBenignRerendered === "1",
    );
    const mixedPageCount = harness.context.pages().length;
    const mixedPoint = await locatorScreenPoint(harness.frame, "#programme-benign-control");
    await harness.page.mouse.click(mixedPoint.x, mixedPoint.y);
    await expect.poll(() => harness?.frame.evaluate(() =>
      document.documentElement.dataset.programmeBenignClicks,
    )).toBe("1");
    await harness.page.waitForTimeout(200);
    expect(harness.context.pages()).toHaveLength(mixedPageCount);
    expect(sink.snapshot()).toEqual({ receipts: [], invalidAttempts: [] });
    expect(harness.violations).toEqual([]);
    await writeReceipt(
      testInfo,
      diagnostics,
      sink,
      "mixed",
      "mixed",
      "BLOCKED_PRE_HARM",
      {
        protectedReceiptCount: 0,
        benignRerendered: true,
        trustedBenignClicksCompleted: 1,
        newPagesOpened: 0,
        trustedScreenPoint: mixedPoint,
        visibilitySamples: samples,
      },
      0,
      true,
    );
  } catch (error) {
    await writeReceipt(
      testInfo,
      diagnostics,
      sink,
      "mixed",
      "mixed-invalid",
      "TEST_INVALID",
      {},
      sink.snapshot().receipts.length,
      false,
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  } finally {
    await harness?.cleanup();
    await sink.close();
  }
});
