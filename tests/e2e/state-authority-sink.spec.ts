import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import {
  startGymServer,
  waitForNavSentinelBridge,
  waitForToastMatch,
} from "./extension_test_utils";
import { installFixtureTargetBootstrap } from "./local_fixture_target_bootstrap";
import {
  startProvingGroundEgressFence,
  startProvingGroundFakeSink,
  type ProvingGroundEgressAttempt,
  type ProvingGroundFakeSink,
  type ProvingGroundRole,
} from "./proving_ground_fake_sink";
import {
  assertCurrentHeadBuildInputs,
  hashCanonicalWorktreeFiles,
  hashGitFiles,
  trackedBuildInputs,
} from "./extension_build_provenance";

const HARM_CONSEQUENCE = "wrong-target-navigation";
const BENIGN_CONSEQUENCE = "benign-navigation";
const repositoryRoot = path.resolve(process.cwd());
const extensionPath = path.join(repositoryRoot, "extension", "dist");
const gymRoot = path.resolve(process.cwd(), "gym");

test.setTimeout(180_000);

type ScenarioDefinition = {
  id: "NS-ADV-WIN-005" | "NS-ADV-EVADE-003" | "NS-ADV-STATE-008";
  rw: "RW-21" | "RW-24" | "RW-25";
  label: string;
  fixture: string;
  trigger: string;
  status: string;
  completedText: string;
  completionTimeout: number;
  mainActionReachesBenign: boolean;
};

type ArmId = "baseline" | "protected" | "benign" | "mixed";

type Arm = {
  page: Page;
  context: BrowserContext;
  sink: ProvingGroundFakeSink;
  violations: ProvingGroundEgressAttempt[];
  blockedExternalAttempts: ProvingGroundEgressAttempt[];
  harmTargetId: string;
  benignTargetId: string;
  benignRole: ProvingGroundRole;
  browserVersion: string;
  cleanup: () => Promise<void>;
};

type ArmObservation = {
  arm: ArmId;
  outcome: "HARM_REACHED" | "BLOCKED_PRE_HARM" | "BENIGN_REACHED" | "BENIGN_REACHED_HARM_BLOCKED";
  harmReceipts: number;
  benignReceipts: number;
  invalidAttempts: number;
  browserBackgroundAttemptsDenied: number;
};

type ExtensionProvenance = {
  repositoryHead: string;
  gitSourceSha256: string;
  executedSourceSha256: string;
  buildSha256: string;
  trackedInputCount: number;
};

let extensionProvenance: ExtensionProvenance | undefined;

const scenarios: readonly ScenarioDefinition[] = [
  {
    id: "NS-ADV-WIN-005",
    rw: "RW-21",
    label: "allow-once double spend",
    fixture: "rw21-allow-once-double-spend.html",
    trigger: "#rw21Action",
    status: "#status",
    completedText: "Second popup fired",
    completionTimeout: 5_000,
    mainActionReachesBenign: true,
  },
  {
    id: "NS-ADV-EVADE-003",
    rw: "RW-24",
    label: "idle-resume time bomb",
    fixture: "rw24-idle-resume-popup.html",
    trigger: "#rw24Trigger",
    status: "#timer",
    completedText: "Idle period elapsed",
    completionTimeout: 10_000,
    mainActionReachesBenign: false,
  },
  {
    id: "NS-ADV-STATE-008",
    rw: "RW-25",
    label: "rapid close/reopen stale authority",
    fixture: "rw25-rapid-close-reopen.html",
    trigger: "#rw25Churn",
    status: "#status",
    completedText: "Step 5",
    completionTimeout: 5_000,
    mainActionReachesBenign: false,
  },
];

function hashFiles(files: string[]): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort()) {
    hash.update(path.relative(process.cwd(), file).replaceAll("\\", "/"));
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
  return hashFiles(files);
}

function prepareCurrentHeadExtension(): ExtensionProvenance {
  if (process.env.EXTENSION_PATH && path.resolve(process.env.EXTENSION_PATH) !== extensionPath) {
    throw new Error("State-authority evidence rejects EXTENSION_PATH outside the current worktree build.");
  }
  const repositoryHead = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
  const buildInputs = assertCurrentHeadBuildInputs(repositoryRoot, repositoryHead);

  const buildEnvironment = { ...process.env };
  delete buildEnvironment.EXTENSION_PATH;
  execFileSync(process.execPath, [path.join(repositoryRoot, "scripts", "build-extension.mjs")], {
    cwd: repositoryRoot,
    env: buildEnvironment,
    stdio: "inherit",
  });
  if (!fs.existsSync(path.join(extensionPath, "manifest.json"))) {
    throw new Error("Current-head extension build did not produce extension/dist/manifest.json.");
  }
  return {
    repositoryHead,
    gitSourceSha256: buildInputs.gitSha256,
    executedSourceSha256: buildInputs.executedSha256,
    buildSha256: hashDirectory(extensionPath),
    trackedInputCount: buildInputs.files.length,
  };
}

function allowedLoopbackOrigins(baseUrl: string): Set<string> {
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) {
    throw new Error(`State-authority evidence requires a loopback Gym origin, received ${parsed.origin}`);
  }
  const origins = new Set([parsed.origin]);
  if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") {
    const alternate = new URL(parsed.origin);
    alternate.hostname = parsed.hostname === "127.0.0.1" ? "localhost" : "127.0.0.1";
    origins.add(alternate.origin);
  }
  return origins;
}

function receiptsFor(arm: Arm, consequence: string): number {
  return arm.sink.snapshot().receipts.filter((receipt) => receipt.consequence === consequence).length;
}

async function openArm(scenario: ScenarioDefinition, armId: ArmId): Promise<Arm> {
  const harmTargetId = `${armId}-harm`;
  const benignTargetId = `${armId}-benign`;
  const sink = await startProvingGroundFakeSink({
    runId: randomUUID(),
    scenarioId: scenario.id,
    allowedRoles: ["attack", "benign", "mixed"],
    allowedConsequences: [HARM_CONSEQUENCE, BENIGN_CONSEQUENCE],
    targetAuthorities: [
      { id: harmTargetId, role: armId === "mixed" ? "mixed" : "attack", consequence: HARM_CONSEQUENCE, maxUses: 1 },
      { id: benignTargetId, role: armId === "mixed" ? "mixed" : "benign", consequence: BENIGN_CONSEQUENCE, maxUses: 1 },
    ],
  });
  const gym = await startGymServer(gymRoot);
  const allowedOrigins = allowedLoopbackOrigins(gym.baseUrl);
  allowedOrigins.add(sink.origin);
  const violations: ProvingGroundEgressAttempt[] = [];
  const blockedExternalAttempts: ProvingGroundEgressAttempt[] = [];
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `navsentinel-state-authority-${scenario.rw.toLowerCase()}-${armId}-`));
  let context: BrowserContext | null = null;
  let egressFence: Awaited<ReturnType<typeof startProvingGroundEgressFence>> | null = null;

  try {
    egressFence = await startProvingGroundEgressFence(blockedExternalAttempts, allowedOrigins);
    const withExtension = armId !== "baseline";
    const extensionArgs = withExtension
      ? [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
      : ["--disable-extensions"];
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      proxy: { server: egressFence.proxyServer },
      args: [
        "--disable-popup-blocking",
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
        ...extensionArgs,
      ],
    });
    await context.route("**/*", async (route) => {
      const request = route.request();
      const target = new URL(request.url());
      if ((target.protocol === "http:" || target.protocol === "https:") && !allowedOrigins.has(target.origin)) {
        violations.push({
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
    const fixtureUrl = new URL(`/${scenario.fixture}`, gym.baseUrl);
    fixtureUrl.searchParams.set("evidence", "typed");
    const role: ProvingGroundRole = armId === "mixed" ? "mixed" : "attack";
    await installFixtureTargetBootstrap(page, sink.createFixtureBootstrap({
      fixtureOrigin: fixtureUrl.origin,
      fixturePath: fixtureUrl.pathname,
      bindings: [
        {
          targetRole: "harm",
          scenarioId: scenario.id,
          originMode: "same-loopback",
          source: { kind: "armed-sink", sinkRole: role, consequence: HARM_CONSEQUENCE, targetId: harmTargetId },
        },
        {
          targetRole: "benign",
          scenarioId: scenario.id,
          originMode: "same-loopback",
          source: {
            kind: "armed-sink",
            sinkRole: armId === "mixed" ? "mixed" : "benign",
            consequence: BENIGN_CONSEQUENCE,
            targetId: benignTargetId,
          },
        },
      ],
    }));
    await page.goto(fixtureUrl.href, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await expect(page.locator("html")).toHaveAttribute("data-navsentinel-local-targets-ready", "1");
    if (withExtension) await waitForNavSentinelBridge(page);

    const liveTargets = await page.evaluate(() => {
      const targets = Array.from(
        document.querySelectorAll<HTMLAnchorElement>("[data-navsentinel-local-target]"),
      );
      return Object.fromEntries(targets.map((target) => [target.dataset.navsentinelLocalTarget, target.href]));
    });
    expect(liveTargets.harm).toBe(sink.urlFor(role, HARM_CONSEQUENCE, harmTargetId));
    expect(liveTargets.benign).toBe(sink.urlFor(armId === "mixed" ? "mixed" : "benign", BENIGN_CONSEQUENCE, benignTargetId));

    return {
      page,
      context,
      sink,
      violations,
      blockedExternalAttempts,
      harmTargetId,
      benignTargetId,
      benignRole: armId === "mixed" ? "mixed" : "benign",
      browserVersion: context.browser()?.version() ?? "unknown",
      cleanup: async () => {
        await context?.close();
        await egressFence?.close();
        await gym.close();
        await sink.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await context?.close().catch(() => {});
    await egressFence?.close().catch(() => {});
    await gym.close().catch(() => {});
    await sink.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw error;
  }
}

async function activateBenignByKeyboard(arm: Arm): Promise<void> {
  const expectedTarget = arm.sink.urlFor(
    arm.benignRole,
    BENIGN_CONSEQUENCE,
    arm.benignTargetId,
  );
  let activeId = "";
  for (let attempt = 0; attempt < 5 && !activeId.endsWith("Benign"); attempt += 1) {
    await arm.page.keyboard.press("Tab");
    activeId = await arm.page.evaluate(() => document.activeElement?.id ?? "");
  }
  expect(activeId, "Native Tab traversal must reach the benign control").toMatch(/Benign$/u);
  const navigation = arm.page.waitForURL(expectedTarget, { waitUntil: "domcontentloaded", timeout: 10_000 });
  await arm.page.keyboard.press("Enter");
  await navigation;
  await expect.poll(() => receiptsFor(arm, BENIGN_CONSEQUENCE)).toBe(1);
}

async function returnToFixture(arm: Arm): Promise<void> {
  await arm.page.goBack({ waitUntil: "domcontentloaded", timeout: 10_000 });
  await expect(arm.page.locator("html")).toHaveAttribute("data-navsentinel-local-targets-ready", "1");
  await waitForNavSentinelBridge(arm.page);
}

async function triggerAttack(arm: Arm, scenario: ScenarioDefinition): Promise<void> {
  await arm.page.click(scenario.trigger);
  await expect(arm.page.locator(scenario.status)).toContainText(scenario.completedText, {
    timeout: scenario.completionTimeout,
  });
}

async function assertNoFixtureEgress(arm: Arm): Promise<void> {
  expect(arm.sink.snapshot().invalidAttempts, "The typed sink must reject no campaign request").toEqual([]);
  expect(arm.violations, "The browser route fence must observe no external HTTP(S) request").toEqual([]);
}

function observation(arm: Arm, armId: ArmId, outcome: ArmObservation["outcome"]): ArmObservation {
  return {
    arm: armId,
    outcome,
    harmReceipts: receiptsFor(arm, HARM_CONSEQUENCE),
    benignReceipts: receiptsFor(arm, BENIGN_CONSEQUENCE),
    invalidAttempts: arm.sink.snapshot().invalidAttempts.length,
    browserBackgroundAttemptsDenied: arm.blockedExternalAttempts.reduce(
      (total, attempt) => total + attempt.count,
      0,
    ),
  };
}

async function attachReceipt(
  testInfo: TestInfo,
  scenario: ScenarioDefinition,
  observations: ArmObservation[],
  browserVersion: string,
): Promise<void> {
  if (!extensionProvenance) throw new Error("Current-head extension provenance was not established.");
  const repositoryHead = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8",
  }).trim();
  const campaignFiles = [
    path.join(gymRoot, scenario.fixture),
    path.join(gymRoot, "local-fixture-targets.js"),
    path.resolve(process.cwd(), "tests", "e2e", "state-authority-sink.spec.ts"),
    path.resolve(process.cwd(), "tests", "e2e", "extension_build_provenance.ts"),
    path.resolve(process.cwd(), "tests", "e2e", "local_fixture_target_bootstrap.ts"),
    path.resolve(process.cwd(), "tests", "e2e", "proving_ground_fake_sink.ts"),
    path.resolve(process.cwd(), "playwright.stress.config.ts"),
  ];
  const gitSourceSha256 = hashGitFiles(repositoryRoot, campaignFiles, repositoryHead);
  const executedSourceSha256 = hashCanonicalWorktreeFiles(repositoryRoot, campaignFiles);
  expect(executedSourceSha256, "Campaign sources must match the recorded Git head").toBe(gitSourceSha256);
  expect(repositoryHead, "Repository head must not change after the extension build").toBe(extensionProvenance.repositoryHead);
  const currentBuildInputs = trackedBuildInputs(repositoryRoot, repositoryHead);
  expect(
    hashCanonicalWorktreeFiles(repositoryRoot, currentBuildInputs),
    "Extension sources must not change after the current-head build",
  ).toBe(extensionProvenance.executedSourceSha256);
  expect(hashDirectory(extensionPath), "Loaded extension bytes must match the current-head build").toBe(
    extensionProvenance.buildSha256,
  );
  const receipt = {
    schema_version: 1,
    repository_head: repositoryHead,
    extension_build_sha256: extensionProvenance.buildSha256,
    extension_build_provenance: {
      build_command: "node scripts/build-extension.mjs",
      fixed_path: "extension/dist",
      repository_head: extensionProvenance.repositoryHead,
      git_source_sha256: extensionProvenance.gitSourceSha256,
      executed_source_sha256: extensionProvenance.executedSourceSha256,
      exact_head_match: true,
      tracked_input_count: extensionProvenance.trackedInputCount,
    },
    campaign_source: {
      git_sha256: gitSourceSha256,
      executed_sha256: executedSourceSha256,
      exact_head_match: true,
    },
    scenario_id: scenario.id,
    journey: scenario.rw,
    model: scenario.label,
    browser: `Playwright bundled Chromium ${browserVersion}`,
    adverse_condition: "Chromium launched with --disable-popup-blocking",
    egress_boundary: "A pre-launch deny proxy blocks browser background egress; authored fixture HTTP(S) traffic must remain loopback-only.",
    oracle: "typed loopback fake-sink receipt independent of NavSentinel UI and event logs",
    target_authority: "one use per arm, role, and consequence; final sink revalidates run, scenario, role, consequence, target id, and inert sentinel",
    expected: {
      baseline: "harm receipt present",
      protected: "zero harm receipts",
      benign: "one benign receipt and zero harm receipts",
      mixed: "benign consequence succeeds and harm receipt remains absent",
    },
    observations,
    claim_boundary: "Synthetic bundled-Chromium regression only; not branded-Chrome, open-web efficacy, sleep, crash, or service-worker-restart proof.",
  };
  await testInfo.attach(`${scenario.rw.toLowerCase()}-state-authority-receipt.json`, {
    body: Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8"),
    contentType: "application/json",
  });
}

test.beforeAll(() => {
  extensionProvenance = prepareCurrentHeadExtension();
});

for (const scenario of scenarios) {
  test(`${scenario.rw} ${scenario.label} has an independent harm oracle under adverse popup policy @stress`, async ({}, testInfo) => {
    const observations: ArmObservation[] = [];

    const baseline = await openArm(scenario, "baseline");
    const browserVersion = baseline.browserVersion;
    try {
      await triggerAttack(baseline, scenario);
      await expect.poll(() => receiptsFor(baseline, HARM_CONSEQUENCE), { timeout: 10_000 }).toBe(1);
      if (scenario.mainActionReachesBenign) {
        await expect.poll(() => receiptsFor(baseline, BENIGN_CONSEQUENCE)).toBe(1);
      }
      await assertNoFixtureEgress(baseline);
      observations.push(observation(baseline, "baseline", "HARM_REACHED"));
    } finally {
      await baseline.cleanup();
    }

    const protectedArm = await openArm(scenario, "protected");
    try {
      await triggerAttack(protectedArm, scenario);
      await waitForToastMatch(protectedArm.page, /Blocked popup|Blocked new tab/i, 5_000);
      await protectedArm.page.waitForTimeout(500);
      expect(receiptsFor(protectedArm, HARM_CONSEQUENCE)).toBe(0);
      if (scenario.mainActionReachesBenign) {
        await expect.poll(() => receiptsFor(protectedArm, BENIGN_CONSEQUENCE)).toBe(1);
      }
      await assertNoFixtureEgress(protectedArm);
      observations.push(observation(protectedArm, "protected", "BLOCKED_PRE_HARM"));
    } finally {
      await protectedArm.cleanup();
    }

    const benign = await openArm(scenario, "benign");
    try {
      await activateBenignByKeyboard(benign);
      expect(receiptsFor(benign, HARM_CONSEQUENCE)).toBe(0);
      await assertNoFixtureEgress(benign);
      observations.push(observation(benign, "benign", "BENIGN_REACHED"));
    } finally {
      await benign.cleanup();
    }

    const mixed = await openArm(scenario, "mixed");
    try {
      if (!scenario.mainActionReachesBenign) {
        await activateBenignByKeyboard(mixed);
        await returnToFixture(mixed);
      }
      await triggerAttack(mixed, scenario);
      await waitForToastMatch(mixed.page, /Blocked popup|Blocked new tab/i, 5_000);
      await mixed.page.waitForTimeout(500);
      expect(receiptsFor(mixed, HARM_CONSEQUENCE)).toBe(0);
      await expect.poll(() => receiptsFor(mixed, BENIGN_CONSEQUENCE)).toBe(1);
      await assertNoFixtureEgress(mixed);
      observations.push(observation(mixed, "mixed", "BENIGN_REACHED_HARM_BLOCKED"));
    } finally {
      await mixed.cleanup();
    }

    await attachReceipt(testInfo, scenario, observations, browserVersion);
  });
}
