import { execFileSync } from "node:child_process";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  assertExtensionBuildOutputHash,
  hashCanonicalWorktreeFiles,
  hashExtensionBuildOutput,
  hashGitFiles,
  resetExtensionBuildOutput,
  sanitizedGitEnvironment,
  type BuildInputAttestation,
  type BuildOutputAttestation,
} from "./extension_build_provenance";
import { hashMaterializedCampaign } from "./materialized_campaign_provenance";

const HARM_CONSEQUENCE = "wrong-target-navigation";
const BENIGN_CONSEQUENCE = "benign-navigation";
const repositoryRoot = fs.realpathSync.native(path.resolve(process.cwd()));
const campaignExecutionRoot = resolveCampaignExecutionRoot();
const extensionPath = path.join(repositoryRoot, "extension", "dist");
const gymRoot = path.join(campaignExecutionRoot, "gym");

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
  repositoryTree: string;
  objectFormat: string;
  comparisonMode: "raw-blob-byte-equality";
  gitSourceSha256: string;
  executedSourceSha256: string;
  buildOutput: BuildOutputAttestation;
  trackedInputCount: number;
  unexpectedInputCount: number;
  specialInputCount: number;
};

type StateAuthorityLaunchAttestation = {
  schemaVersion: 2;
  runId: string;
  launcherMode: "git-object-materialized-campaign";
  repositoryRoot: string;
  campaignExecutionRoot: string;
  repositoryCommit: string;
  repositoryTree: string;
  objectFormat: string;
  comparisonMode: "raw-blob-byte-equality";
  buildInputGitSha256: string;
  buildInputExecutedSha256: string;
  campaignGitSha256: string;
  campaignExecutedSha256: string;
  campaignMaterializedSha256: string;
  campaignFiles: string[];
  launcherOid: string;
  helperOid: string;
  materializerOid: string;
  manifestOid: string;
  issuedAt: string;
  expiresAt: string;
};

type LaunchSnapshot = {
  buildInputs: BuildInputAttestation;
  campaignGitSha256: string;
  campaignExecutedSha256: string;
  campaignMaterializedSha256: string;
};

let launchAttestation: StateAuthorityLaunchAttestation | undefined;
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

function launchIntegrityError(code: string, message: string): Error {
  return new Error(`State-authority evidence TEST_INVALID [${code}]: ${message}`);
}

function sameNativePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function resolveCampaignExecutionRoot(): string {
  const configured =
    process.env.NAVSENTINEL_STATE_AUTHORITY_CAMPAIGN_ROOT?.trim();
  if (!configured) {
    throw launchIntegrityError(
      "COMMITTED_CAMPAIGN_EXECUTION_REQUIRED",
      "the state-authority spec must execute from the launcher's private committed-object tree",
    );
  }

  const requested = path.resolve(configured);
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(requested);
  } catch (error) {
    throw launchIntegrityError(
      "COMMITTED_CAMPAIGN_EXECUTION_REQUIRED",
      `campaign execution root is unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw launchIntegrityError(
      "COMMITTED_CAMPAIGN_EXECUTION_REQUIRED",
      "campaign execution root is linked or not an ordinary directory",
    );
  }

  const realRoot = fs.realpathSync.native(requested);
  if (!sameNativePath(requested, realRoot)) {
    throw launchIntegrityError(
      "COMMITTED_CAMPAIGN_EXECUTION_REQUIRED",
      "campaign execution root resolves through a link",
    );
  }
  const relativeToRepository = path.relative(repositoryRoot, realRoot);
  if (
    relativeToRepository === ""
    || (
      !relativeToRepository.startsWith(`..${path.sep}`)
      && relativeToRepository !== ".."
      && !path.isAbsolute(relativeToRepository)
    )
  ) {
    throw launchIntegrityError(
      "COMMITTED_CAMPAIGN_EXECUTION_REQUIRED",
      "campaign execution root must be outside the repository worktree",
    );
  }

  const executingSpec = fs.realpathSync.native(
    fileURLToPath(import.meta.url),
  );
  const expectedSpec = path.join(
    realRoot,
    "tests",
    "e2e",
    "state-authority-sink.spec.ts",
  );
  if (!sameNativePath(executingSpec, expectedSpec)) {
    throw launchIntegrityError(
      "COMMITTED_CAMPAIGN_EXECUTION_REQUIRED",
      "the loaded state-authority spec is not the materialized committed copy",
    );
  }
  return realRoot;
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value) {
    throw launchIntegrityError("LAUNCH_ATTESTATION", `missing string field '${key}'`);
  }
  return value;
}

function loadLaunchAttestation(): StateAuthorityLaunchAttestation {
  const attestationPathValue =
    process.env.NAVSENTINEL_STATE_AUTHORITY_ATTESTATION?.trim();
  const keyValue =
    process.env.NAVSENTINEL_STATE_AUTHORITY_KEY?.trim();
  if (!attestationPathValue || !keyValue) {
    throw launchIntegrityError(
      "EXTERNAL_PREFLIGHT_REQUIRED",
      "run this campaign through the Git-object-materializing external launcher",
    );
  }
  if (!/^[0-9a-f]{64}$/u.test(keyValue)) {
    throw launchIntegrityError(
      "LAUNCH_ATTESTATION",
      "launch attestation key is malformed",
    );
  }

  const attestationPath = path.resolve(attestationPathValue);
  const stats = fs.lstatSync(attestationPath);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw launchIntegrityError(
      "LAUNCH_ATTESTATION",
      "launch attestation is linked or not a file",
    );
  }
  if (process.platform !== "win32" && (stats.mode & 0o077) !== 0) {
    throw launchIntegrityError(
      "LAUNCH_ATTESTATION",
      "launch attestation permissions are too broad",
    );
  }
  const realAttestationPath = fs.realpathSync.native(attestationPath);
  const relativeToRepository = path.relative(
    repositoryRoot,
    realAttestationPath,
  );
  if (
    relativeToRepository === ""
    || (
      !relativeToRepository.startsWith(`..${path.sep}`)
      && relativeToRepository !== ".."
      && !path.isAbsolute(relativeToRepository)
    )
  ) {
    throw launchIntegrityError(
      "LAUNCH_ATTESTATION",
      "launch attestation must be outside the repository",
    );
  }

  let parsed: unknown;
  try {
    const serialized = fs.readFileSync(realAttestationPath, "utf8");
    fs.rmSync(realAttestationPath);
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw launchIntegrityError(
      "LAUNCH_ATTESTATION",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    delete process.env.NAVSENTINEL_STATE_AUTHORITY_ATTESTATION;
    delete process.env.NAVSENTINEL_STATE_AUTHORITY_KEY;
  }
  if (
    !isRecord(parsed)
    || parsed.schemaVersion !== 2
    || !isRecord(parsed.payload)
    || typeof parsed.mac !== "string"
    || !/^[0-9a-f]{64}$/u.test(parsed.mac)
  ) {
    throw launchIntegrityError(
      "LAUNCH_ATTESTATION",
      "unsupported launch attestation envelope",
    );
  }

  const expectedMac = createHmac(
    "sha256",
    Buffer.from(keyValue, "hex"),
  )
    .update(JSON.stringify(parsed.payload))
    .digest();
  const suppliedMac = Buffer.from(parsed.mac, "hex");
  if (
    suppliedMac.length !== expectedMac.length
    || !timingSafeEqual(suppliedMac, expectedMac)
  ) {
    throw launchIntegrityError(
      "LAUNCH_ATTESTATION",
      "launch attestation authentication failed",
    );
  }

  const payload = parsed.payload;
  if (payload.schemaVersion !== 2) {
    throw launchIntegrityError(
      "LAUNCH_ATTESTATION",
      "unsupported launch attestation payload schema",
    );
  }
  const campaignFilesValue = payload.campaignFiles;
  if (
    !Array.isArray(campaignFilesValue)
    || campaignFilesValue.some((entry) => typeof entry !== "string")
  ) {
    throw launchIntegrityError(
      "LAUNCH_ATTESTATION",
      "campaignFiles must be an array of strings",
    );
  }
  const campaignFiles = campaignFilesValue as string[];
  for (const relativePath of campaignFiles) {
    if (
      !relativePath
      || relativePath.startsWith("/")
      || relativePath.includes("\\")
      || path.posix.normalize(relativePath) !== relativePath
      || relativePath
        .split("/")
        .some((segment) => !segment || segment === "." || segment === "..")
    ) {
      throw launchIntegrityError(
        "LAUNCH_ATTESTATION",
        `invalid campaign path '${relativePath}'`,
      );
    }
  }
  if (new Set(campaignFiles).size !== campaignFiles.length) {
    throw launchIntegrityError(
      "LAUNCH_ATTESTATION",
      "campaignFiles contains duplicates",
    );
  }

  const attestation: StateAuthorityLaunchAttestation = {
    schemaVersion: 2,
    runId: requiredString(payload, "runId"),
    launcherMode: requiredString(
      payload,
      "launcherMode",
    ) as "git-object-materialized-campaign",
    repositoryRoot: requiredString(payload, "repositoryRoot"),
    campaignExecutionRoot: requiredString(
      payload,
      "campaignExecutionRoot",
    ),
    repositoryCommit: requiredString(payload, "repositoryCommit"),
    repositoryTree: requiredString(payload, "repositoryTree"),
    objectFormat: requiredString(payload, "objectFormat"),
    comparisonMode: requiredString(
      payload,
      "comparisonMode",
    ) as "raw-blob-byte-equality",
    buildInputGitSha256: requiredString(
      payload,
      "buildInputGitSha256",
    ),
    buildInputExecutedSha256: requiredString(
      payload,
      "buildInputExecutedSha256",
    ),
    campaignGitSha256: requiredString(payload, "campaignGitSha256"),
    campaignExecutedSha256: requiredString(
      payload,
      "campaignExecutedSha256",
    ),
    campaignMaterializedSha256: requiredString(
      payload,
      "campaignMaterializedSha256",
    ),
    campaignFiles,
    launcherOid: requiredString(payload, "launcherOid"),
    helperOid: requiredString(payload, "helperOid"),
    materializerOid: requiredString(payload, "materializerOid"),
    manifestOid: requiredString(payload, "manifestOid"),
    issuedAt: requiredString(payload, "issuedAt"),
    expiresAt: requiredString(payload, "expiresAt"),
  };

  if (
    attestation.launcherMode !== "git-object-materialized-campaign"
  ) {
    throw launchIntegrityError(
      "LAUNCH_ATTESTATION",
      "launcher execution mode mismatch",
   );
  }
  if (
     !sameNativePath(attestation.repositoryRoot, repositoryRoot)
    || !sameNativePath(
      attestation.campaignExecutionRoot,
      campaignExecutionRoot,
    )
  ) {
    throw launchIntegrityError(
      "LAUNCH_ATTESTATION",
      "attested repository or campaign root differs from this execution",
    );
  }
  if (attestation.comparisonMode !== "raw-blob-byte-equality") {
    throw launchIntegrityError(
      "LAUNCH_ATTESTATION",
      "unsupported comparison mode",
   );
  }

  const issuedAt = Date.parse(attestation.issuedAt);
  const expiresAt = Date.parse(attestation.expiresAt);
  const now = Date.now();
  if (
    !Number.isFinite(issuedAt)
    || !Number.isFinite(expiresAt)
    || issuedAt > now + 60_000
    || expiresAt < now
    || expiresAt <= issuedAt
    || expiresAt - issuedAt > 10 * 60 * 1000
  ) {
    throw launchIntegrityError(
      "LAUNCH_ATTESTATION",
      "launch attestation is expired or has invalid time bounds",
    );
  }

  const oidLength = attestation.objectFormat === "sha1"
    ? 40
    : attestation.objectFormat === "sha256"
      ? 64
      : 0;
  const oidPattern = new RegExp(`^[0-9a-f]{${oidLength}}$`, "u");
  const sha256Pattern = /^[0-9a-f]{64}$/u;
  if (
    oidLength === 0
    || !oidPattern.test(attestation.repositoryCommit)
    || !oidPattern.test(attestation.repositoryTree)
    || !oidPattern.test(attestation.launcherOid)
    || !oidPattern.test(attestation.helperOid)
    || !oidPattern.test(attestation.materializerOid)
    || !oidPattern.test(attestation.manifestOid)
    || !sha256Pattern.test(attestation.buildInputGitSha256)
    || !sha256Pattern.test(attestation.buildInputExecutedSha256)
    || !sha256Pattern.test(attestation.campaignGitSha256)
    || !sha256Pattern.test(attestation.campaignExecutedSha256)
    || !sha256Pattern.test(attestation.campaignMaterializedSha256)
  ) {
    throw launchIntegrityError(
      "LAUNCH_ATTESTATION",
      "attestation contains malformed object IDs or hashes",
    );
  }
  return attestation;
}

function assertLaunchSnapshotCurrent(
  attestation: StateAuthorityLaunchAttestation,
): LaunchSnapshot {
  const buildInputs = assertCurrentHeadBuildInputs(
    repositoryRoot,
    attestation.repositoryCommit,
  );
  if (
    buildInputs.repositoryCommit !== attestation.repositoryCommit
    || buildInputs.repositoryTree !== attestation.repositoryTree
    || buildInputs.objectFormat !== attestation.objectFormat
    || buildInputs.comparisonMode !== attestation.comparisonMode
    || buildInputs.gitSha256 !== attestation.buildInputGitSha256
    || buildInputs.executedSha256
      !== attestation.buildInputExecutedSha256
  ) {
    throw launchIntegrityError(
      "LAUNCH_SNAPSHOT_MISMATCH",
      "build inputs changed after external preflight",
    );
  }
  const campaignAbsolutePaths = attestation.campaignFiles.map(
    (relativePath) =>
      path.join(repositoryRoot, ...relativePath.split("/")),
  );
  const campaignGitSha256 = hashGitFiles(
    repositoryRoot,
    campaignAbsolutePaths,
    attestation.repositoryCommit,
  );
  const campaignExecutedSha256 = hashCanonicalWorktreeFiles(
    repositoryRoot,
    campaignAbsolutePaths,
    attestation.repositoryCommit,
  );
  const campaignMaterializedSha256 = hashMaterializedCampaign(
    campaignExecutionRoot,
    attestation.campaignFiles,
  );
  if (
    campaignGitSha256 !== attestation.campaignGitSha256
    || campaignExecutedSha256 !== attestation.campaignExecutedSha256
    || campaignGitSha256 !== campaignExecutedSha256
    || campaignMaterializedSha256
      !== attestation.campaignMaterializedSha256
  ) {
    throw launchIntegrityError(
      "LAUNCH_SNAPSHOT_MISMATCH",
      "campaign inputs changed after external preflight",
    );
  }
  return {
    buildInputs,
    campaignGitSha256,
    campaignExecutedSha256,
    campaignMaterializedSha256,
  };
}

function prepareCurrentHeadExtension(attestation: StateAuthorityLaunchAttestation): ExtensionProvenance {
  if (process.env.EXTENSION_PATH && path.resolve(process.env.EXTENSION_PATH) !== extensionPath) {
    throw new Error("State-authority evidence rejects EXTENSION_PATH outside the current worktree build.");
  }
  const initialSnapshot = assertLaunchSnapshotCurrent(attestation);
  const buildInputs = initialSnapshot.buildInputs;
  resetExtensionBuildOutput(repositoryRoot, extensionPath);

  const buildEnvironment = sanitizedGitEnvironment(process.env);
  delete buildEnvironment.EXTENSION_PATH;
  delete buildEnvironment.NODE_OPTIONS;
  delete buildEnvironment.NODE_PATH;
  execFileSync(process.execPath, [path.join(repositoryRoot, "scripts", "build-extension.mjs")], {
    cwd: repositoryRoot,
    env: buildEnvironment,
    stdio: "inherit",
  });
  if (!fs.existsSync(path.join(extensionPath, "manifest.json"))) {
    throw new Error("Current-head extension build did not produce extension/dist/manifest.json.");
  }

  const postBuildSnapshot = assertLaunchSnapshotCurrent(attestation);
  const postBuildInputs = postBuildSnapshot.buildInputs;
  if (
    postBuildInputs.repositoryTree !== buildInputs.repositoryTree
    || postBuildInputs.gitSha256 !== buildInputs.gitSha256
    || postBuildInputs.executedSha256 !== buildInputs.executedSha256
  ) {
    throw new Error("State-authority build inputs changed while producing the extension artifact.");
  }
  return {
    repositoryHead: buildInputs.repositoryCommit,
    repositoryTree: buildInputs.repositoryTree,
    objectFormat: buildInputs.objectFormat,
    comparisonMode: buildInputs.comparisonMode,
    gitSourceSha256: buildInputs.gitSha256,
    executedSourceSha256: buildInputs.executedSha256,
    buildOutput: hashExtensionBuildOutput(repositoryRoot, extensionPath),
    trackedInputCount: buildInputs.trackedInputCount,
    unexpectedInputCount: buildInputs.unexpectedInputCount,
    specialInputCount: buildInputs.specialInputCount,
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
  if (!launchAttestation || !extensionProvenance) {
    throw new Error("External launch and current-head extension provenance were not established.");
  }
  const currentSnapshot = assertLaunchSnapshotCurrent(launchAttestation);
  const repositoryHead = currentSnapshot.buildInputs.repositoryCommit;
  const currentBuildInputs = currentSnapshot.buildInputs;
  const gitSourceSha256 = currentSnapshot.campaignGitSha256;
  const executedSourceSha256 = currentSnapshot.campaignExecutedSha256;
  expect(executedSourceSha256, "Campaign sources must match raw committed bytes").toBe(gitSourceSha256);
  expect(currentBuildInputs.repositoryCommit, "Repository head must not change after the build").toBe(
    extensionProvenance.repositoryHead,
  );
  expect(currentBuildInputs.repositoryTree, "Repository tree must not change after the build").toBe(
    extensionProvenance.repositoryTree,
  );
  expect(currentBuildInputs.objectFormat).toBe(extensionProvenance.objectFormat);
  expect(currentBuildInputs.comparisonMode).toBe(extensionProvenance.comparisonMode);
  expect(currentBuildInputs.gitSha256).toBe(extensionProvenance.gitSourceSha256);
  expect(currentBuildInputs.executedSha256).toBe(extensionProvenance.executedSourceSha256);
  const currentBuildOutput = assertExtensionBuildOutputHash(
    repositoryRoot,
    extensionPath,
    extensionProvenance.buildOutput,
  );
  const receipt = {
    schema_version: 4,
    repository_head: repositoryHead,
    extension_build_sha256: extensionProvenance.buildOutput.sha256,
    extension_build_provenance: {
      build_command: "node scripts/build-extension.mjs",
      fixed_path: "extension/dist",
      repository_head: extensionProvenance.repositoryHead,
      repository_tree: extensionProvenance.repositoryTree,
      object_format: extensionProvenance.objectFormat,
      comparison_mode: extensionProvenance.comparisonMode,
      git_source_sha256: extensionProvenance.gitSourceSha256,
      executed_source_sha256: extensionProvenance.executedSourceSha256,
      exact_head_match: true,
      tracked_input_count: extensionProvenance.trackedInputCount,
      unexpected_input_count: extensionProvenance.unexpectedInputCount,
      special_input_count: extensionProvenance.specialInputCount,
      build_output_file_count: currentBuildOutput.fileCount,
    },
    campaign_source: {
      repository_tree: extensionProvenance.repositoryTree,
      object_format: extensionProvenance.objectFormat,
      comparison_mode: extensionProvenance.comparisonMode,
      git_sha256: gitSourceSha256,
      executed_sha256: executedSourceSha256,
      materialized_sha256: currentSnapshot.campaignMaterializedSha256,
      exact_head_match: true,
      verified_before_module_import: true,
      attestation_consumed: true,
      launch_run_id: launchAttestation.runId,
      launcher_mode: launchAttestation.launcherMode,
      launcher_oid: launchAttestation.launcherOid,
      helper_oid: launchAttestation.helperOid,
      materializer_oid: launchAttestation.materializerOid,
      manifest_oid: launchAttestation.manifestOid,
      manifest_input_count: launchAttestation.campaignFiles.length,
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
  launchAttestation = loadLaunchAttestation();
  extensionProvenance = prepareCurrentHeadExtension(launchAttestation);
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
