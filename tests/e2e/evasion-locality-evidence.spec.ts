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
  getServiceWorker,
  readToastText,
  startGymServer,
  waitForNavSentinelBridge,
  waitForToastMatch,
} from "./extension_test_utils";
import {
  startProvingGroundEgressFence,
  startProvingGroundFakeSink,
  type ProvingGroundEgressAttempt,
  type ProvingGroundFakeSink,
  type ProvingGroundRole,
} from "./proving_ground_fake_sink";
import { installFixtureTargetBootstrap } from "./local_fixture_target_bootstrap";
import { inspectBuiltReleaseProfile } from "../../scripts/check-release-profile.mjs";

const SCENARIO_ID = "NS-ADV-EVADE-006";
const FIXTURE_NAME = "evasion-05-composite.html";
const HARM_CONSEQUENCE = "wrong-target-navigation";
const BENIGN_CONSEQUENCE = "benign-navigation";
const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(process.cwd(), "extension", "dist");
const gymRoot = path.resolve(process.cwd(), "gym");
const evasionFixturePaths = fs.readdirSync(gymRoot)
  .filter((name) => /^evasion-(?:0[1-9]|1[0-2])-.*\.html$/u.test(name))
  .map((name) => path.join(gymRoot, name));

test.setTimeout(180_000);

type Arm = {
  page: Page;
  context: BrowserContext;
  productReady: boolean;
  browserVersion: string;
  violations: ProvingGroundEgressAttempt[];
  blockedExternalAttempts: ProvingGroundEgressAttempt[];
  cleanup: () => Promise<void>;
};

type ArmId = "baseline" | "protected" | "benign" | "mixed";

type ArmObservation = {
  role: ProvingGroundRole;
  productReady: boolean;
  outcome: "HARM_REACHED" | "BLOCKED_PRE_HARM" | "OBSERVED";
  sinkReceiptsBefore: number;
  sinkReceiptsAfter: number;
  productEvent: string | null;
  productEventCount?: number;
  trustedInput: "mouse" | "keyboard" | "keyboard_then_mouse";
};

type ReleaseProfileInspection = ReturnType<typeof inspectBuiltReleaseProfile>;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

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

function hashGitFiles(files: string[], head: string): string {
  const hash = createHash("sha256");
  const relativePaths = files
    .map((file) => path.relative(process.cwd(), file).replaceAll("\\", "/"))
    .sort();
  for (const relativePath of relativePaths) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(execFileSync("git", ["show", `${head}:${relativePath}`], {
      cwd: process.cwd(),
      maxBuffer: 10 * 1024 * 1024,
    }));
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
  const reasons: string[] = [];
  if (status) reasons.push("Repository contains uncommitted tracked or untracked files");
  if (override && override !== head) reasons.push(`NAVSENTINEL_PROGRAMME_HEAD does not match Git HEAD ${head}`);
  return { head, clean: reasons.length === 0, invalidReason: reasons.join("; ") };
}

function localOrigins(baseUrl: string): Set<string> {
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) {
    throw new Error(`Evasion locality evidence requires a loopback Gym origin, received ${parsed.origin}`);
  }
  const origins = new Set([parsed.origin]);
  if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") {
    const alternate = new URL(parsed.origin);
    alternate.hostname = parsed.hostname === "127.0.0.1" ? "localhost" : "127.0.0.1";
    origins.add(alternate.origin);
  }
  return origins;
}

async function openArm(
  sink: ProvingGroundFakeSink,
  armId: ArmId,
  role: ProvingGroundRole,
  withExtension: boolean,
): Promise<Arm> {
  // Evidence must run against the repository-owned server for this arm, never
  // an arbitrary GYM_BASE_URL supplied by the environment.
  const gym = await startGymServer(gymRoot);
  const baseUrl = gym.baseUrl;
  const allowedOrigins = localOrigins(baseUrl);
  allowedOrigins.add(sink.origin);
  const violations: ProvingGroundEgressAttempt[] = [];
  const blockedExternalAttempts: ProvingGroundEgressAttempt[] = [];
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `navsentinel-evasion-locality-${role}-`));
  let context: BrowserContext | null = null;
  let egressFence: Awaited<ReturnType<typeof startProvingGroundEgressFence>> | null = null;

  try {
    egressFence = await startProvingGroundEgressFence(blockedExternalAttempts, allowedOrigins);
    const extensionArgs = withExtension
      ? [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
      : ["--disable-extensions"];
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      proxy: { server: egressFence.proxyServer },
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
        ...extensionArgs,
      ],
    });
    await context.route("**/*", async (route) => {
      const request = route.request();
      const target = new URL(request.url());
      if ((target.protocol === "http:" || target.protocol === "https:") &&
          !allowedOrigins.has(target.origin)) {
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
    const fixtureUrl = new URL(`/${FIXTURE_NAME}`, baseUrl);
    const harmRole: ProvingGroundRole = role === "benign" ? "attack" : role;
    const benignRole: ProvingGroundRole = role === "attack" ? "benign" : role;
    await installFixtureTargetBootstrap(page, sink.createFixtureBootstrap({
      fixtureOrigin: fixtureUrl.origin,
      fixturePath: fixtureUrl.pathname,
      bindings: [
        {
          targetRole: "harm", scenarioId: SCENARIO_ID, originMode: "same-loopback",
          source: { kind: "armed-sink", sinkRole: harmRole, consequence: HARM_CONSEQUENCE, targetId: `${armId}-harm` },
        },
        {
          targetRole: "benign", scenarioId: SCENARIO_ID, originMode: "same-loopback",
          source: { kind: "armed-sink", sinkRole: benignRole, consequence: BENIGN_CONSEQUENCE, targetId: `${armId}-benign` },
        },
      ],
    }));
    await page.goto(fixtureUrl.href, { waitUntil: "domcontentloaded", timeout: 20_000 });
    await expect(page.locator("html")).toHaveAttribute("data-navsentinel-local-targets-ready", "1");
    if (withExtension) {
      await waitForNavSentinelBridge(page);
    }

    return {
      page,
      context,
      productReady: withExtension,
      browserVersion: context.browser()?.version() ?? "unknown",
      violations,
      blockedExternalAttempts,
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

async function clickTrap(arm: Arm): Promise<Page | null> {
  const trap = arm.page.locator("#trap");
  const box = await trap.boundingBox();
  expect(box, "The composite trap must be reachable by trusted pointer input").toBeTruthy();
  const popupPromise = arm.context.waitForEvent("page", { timeout: 1_500 }).catch(() => null);
  await arm.page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  return popupPromise;
}

async function activateBenignLinkByKeyboard(page: Page): Promise<void> {
  const benignTarget = await page.locator("#legit-link").getAttribute("href");
  expect(benignTarget, "The benign link must expose its exact local destination").toBeTruthy();
  const committedTarget = new URL(benignTarget!, page.url()).href;
  let activeId = "";
  for (let attempt = 0; attempt < 4 && activeId !== "legit-link"; attempt += 1) {
    await page.keyboard.press("Tab");
    activeId = await page.evaluate(() => document.activeElement?.id ?? "");
  }
  expect(activeId, "Native Tab traversal must reach the benign link").toBe("legit-link");
  const navigation = page.waitForURL(committedTarget, {
    waitUntil: "domcontentloaded",
    timeout: 10_000,
  });
  await page.keyboard.press("Enter");
  await navigation;
}

async function assertUnsafeOverridesRejected(page: Page): Promise<void> {
  const rejections = await page.evaluate(() => {
    const originalUrl = location.href;
    const api = (window as unknown as {
      NavSentinelLocalTargets: { url: (role: "harm", scenarioId: string) => string };
    }).NavSentinelLocalTargets;
    const attempt = (parameter: "harm_target" | "benign_target", target: string): string => {
      const candidate = new URL(originalUrl);
      candidate.searchParams.set(parameter, target);
      history.replaceState(null, "", candidate.href);
      try {
        api.url("harm", "NS-ADV-EVADE-006");
        return "override-accepted";
      } catch (error) {
        return error instanceof Error ? error.message : "unknown-target-error";
      } finally {
        history.replaceState(null, "", originalUrl);
      }
    };
    return {
      harmTarget: attempt("harm_target", "http://127.0.0.1:46100/__navsentinel_fake_sink?run_id=123e4567-e89b-42d3-a456-426614174000&scenario_id=NS-ADV-EVADE-006&role=attack&consequence=wrong-target-navigation&target_id=baseline-harm&sentinel=NAVSENTINEL_SENTINEL_DO_NOT_RUN"),
      benignTarget: attempt("benign_target", "http://127.0.0.1:46100/__navsentinel_fake_sink?run_id=123e4567-e89b-42d3-a456-426614174000&scenario_id=NS-ADV-EVADE-006&role=benign&consequence=benign-navigation&target_id=baseline-benign&sentinel=NAVSENTINEL_SENTINEL_DO_NOT_RUN"),
    };
  });
  expect(rejections.harmTarget, "A syntactically armed-looking harm query cannot override a trusted resolver")
    .toBe("legacy-target-override-rejected");
  expect(rejections.benignTarget, "A syntactically armed-looking benign query cannot override a trusted resolver")
    .toBe("legacy-target-override-rejected");
}

async function assertFixtureBootstrapCannotBeReplaced(page: Page, sink: ProvingGroundFakeSink): Promise<void> {
  const result = await page.evaluate((expectedHref) => {
    "use strict";
    const target = window as unknown as {
      NavSentinelFixtureTargetBootstrap: {
        resolve: (role: string, scenario: string, originMode: string) => unknown;
      };
    };
    const original = target.NavSentinelFixtureTargetBootstrap;
    const originalResolution = original.resolve("harm", "NS-ADV-EVADE-006", "same-loopback");
    let assignment = "accepted";
    try {
      target.NavSentinelFixtureTargetBootstrap = { resolve: () => ({ status: "replaced" }) };
    } catch (error) {
      assignment = error instanceof TypeError ? "rejected" : "unexpected-error";
    }
    let defineProperty = "accepted";
    try {
      Object.defineProperty(window, "NavSentinelFixtureTargetBootstrap", {
        value: { resolve: () => ({ status: "replaced" }) },
      });
    } catch (error) {
      defineProperty = error instanceof TypeError ? "rejected" : "unexpected-error";
    }
    const current = target.NavSentinelFixtureTargetBootstrap;
    const currentResolution = current.resolve("harm", "NS-ADV-EVADE-006", "same-loopback");
    return {
      assignment,
      defineProperty,
      identityPreserved: current === original,
      resolutionPreserved: JSON.stringify(currentResolution) === JSON.stringify(originalResolution),
      expectedHref,
      actualHref: (currentResolution as { href?: string }).href,
    };
  }, sink.urlFor("attack", HARM_CONSEQUENCE, "baseline-harm"));
  expect(result).toEqual({
    assignment: "rejected",
    defineProperty: "rejected",
    identityPreserved: true,
    resolutionPreserved: true,
    expectedHref: sink.urlFor("attack", HARM_CONSEQUENCE, "baseline-harm"),
    actualHref: sink.urlFor("attack", HARM_CONSEQUENCE, "baseline-harm"),
  });
}

async function writeReceipt(
  testInfo: TestInfo,
  sink: ProvingGroundFakeSink,
  observations: ArmObservation[],
  arms: Arm[],
  releaseProfile: ReleaseProfileInspection,
): Promise<void> {
  const repository = repositoryState();
  const sinkSnapshot = sink.snapshot();
  const fixtureFiles = [
    ...evasionFixturePaths,
    path.join(gymRoot, "local-fixture-targets.js"),
    path.join(gymRoot, "local-fixture-sink.html"),
  ];
  const gitFixtureSha256 = hashGitFiles(fixtureFiles, repository.head);
  const executedFixtureSha256 = hashFiles(fixtureFiles);
  const receipt = {
    schema_version: "1.0.0",
    scenario_id: SCENARIO_ID,
    capability_id: "F-03",
    profile: "proving_ground",
    repository_head: repository.head,
    extension_build_sha256: fs.existsSync(extensionPath) ? hashDirectory(extensionPath) : "",
    extension_profile: {
      id: releaseProfile.profile.id,
      release_eligible: releaseProfile.profile.releaseEligible,
      capabilities: releaseProfile.profile.capabilities,
    },
    browser: {
      name: "chromium",
      version: arms.find((arm) => arm.productReady)?.browserVersion ?? "unknown",
      channel: "playwright-bundled",
    },
    fixture: {
      family: "evasion-01-through-12",
      representative_path: `gym/${FIXTURE_NAME}`,
      localized_path_count: evasionFixturePaths.length,
      sha256: gitFixtureSha256,
      git_blob_sha256: gitFixtureSha256,
      executed_worktree_sha256: executedFixtureSha256,
    },
    oracle: {
      type: "independent_harm",
      harm_boundary: "Trusted input reaches the typed local wrong-target navigation sink.",
      local_receipt_sha256: sha256(JSON.stringify({ sinkSnapshot, observations })),
      sink_snapshot: sinkSnapshot,
      observations,
    },
    outcomes: {
      attack_baseline: "HARM_REACHED",
      protected: "BLOCKED_PRE_HARM",
      benign: "OBSERVED",
      mixed: "BLOCKED_PRE_HARM",
    },
    evidence_state_before: "MODELLED",
    evidence_state_after: "MODELLED",
    valid: repository.clean && arms.every((arm) => arm.violations.length === 0),
    invalid_reason: [
      repository.invalidReason,
      arms.some((arm) => arm.violations.length > 0) ? "Fixture attempted undeclared network egress" : "",
    ].filter(Boolean).join("; "),
    limitations: [
      "This receipt proves the shared local-target contract and one representative composite journey, not mutation robustness across all twelve evasion fixtures.",
      "The existing evasion regression suite remains product-event coupled; its twelve protected fixtures are checked separately and are not promoted beyond MODELLED here.",
      "Bundled Chromium is not branded Chrome, owner Gate-3, open-web efficacy, or release evidence.",
      "Playwright page.addInitScript is privileged harness configuration only; it supplies no hostile or authored-page authority evidence, and SP-F-014 remains PARTIAL.",
    ],
    safety: {
      synthetic_only: true,
      local_inert_sink: true,
      prelaunch_deny_layer: true,
      external_egress_observed: false,
      unexpected_egress_attempted: arms.some((arm) => arm.violations.length > 0),
      executable_content_present: false,
      real_credentials_present: false,
      raw_secret_persistence: false,
    },
    authority_scope: {
      actor: "one authored top-frame evasion fixture",
      task: "one trusted activation per armed destination; the mixed arm sequences one benign keyboard activation and one harm pointer activation",
      tab: "one fresh-profile initiating tab per arm plus its single consequence tab where navigation is allowed",
      frame: "top frame",
      document: `exact ${FIXTURE_NAME} document for each arm`,
      destination: "one armed loopback sink URL per arm, role, and consequence",
      bootstrap: "An immutable page-init resolver matches only the exact fixture origin/path and exact role/scenario/origin-mode keys. It changes only one frozen, non-writable Window resolver; it injects no input, event, navigation, document-node mutation, product call, or decision.",
      ttl: "one test run; the loopback sink closes in the test finally block",
      use_count: 1,
      use_count_scope: "per armed destination",
      sink_revalidation: "The final fake sink independently validates active run, scenario, role, consequence, one-use target authority, and the exact inert sentinel on every request.",
    },
    qualification: {
      privacy: "The sink retains only typed metadata and a SHA-256 of the inert sentinel; no page text, full browsing history, credential, or raw secret is stored.",
      performance: "No release code changed and no runtime performance claim is made.",
      accessibility: "The benign control is reached with native Tab and Enter; no assistive-technology pass was run.",
      page_origin_ui: "Query input cannot select or replace a destination. The bootstrap is harness configuration only, not hostile-page authority proof in an already armed context.",
    },
    network_violations: arms.flatMap((arm) => arm.violations),
    blocked_external_attempts: arms.flatMap((arm) => arm.blockedExternalAttempts),
    verification: [
      "npm run security:check",
      "npm run build",
      "CI=1 npx playwright test tests/e2e/evasion-locality-evidence.spec.ts --workers=1",
      "CI=1 npx playwright test tests/e2e/evasion.spec.ts --workers=1",
    ],
  };
  const outputPath = path.resolve(process.cwd(), "test-results", "issue449-evasion-locality-receipt.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await testInfo.attach("issue449-evasion-locality-receipt.json", {
    path: outputPath,
    contentType: "application/json",
  });
}

test("#449 evasion targets stay local with attack, protected, benign, and mixed evidence @regression", async ({}, testInfo) => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running locality evidence.");
  const releaseProfile = inspectBuiltReleaseProfile(extensionPath, {
    expectedProfile: "interaction-only",
    requireReleaseEligible: true,
  });
  expect(evasionFixturePaths, "The bounded family must contain exactly evasion 01 through 12").toHaveLength(12);
  const sink = await startProvingGroundFakeSink({
    runId: randomUUID(),
    scenarioId: SCENARIO_ID,
    allowedRoles: ["attack", "benign", "mixed"],
    allowedConsequences: [HARM_CONSEQUENCE, BENIGN_CONSEQUENCE],
    targetAuthorities: [
      { id: "baseline-harm", role: "attack", consequence: HARM_CONSEQUENCE, maxUses: 1 },
      { id: "baseline-benign", role: "benign", consequence: BENIGN_CONSEQUENCE, maxUses: 1 },
      { id: "protected-harm", role: "attack", consequence: HARM_CONSEQUENCE, maxUses: 1 },
      { id: "protected-benign", role: "benign", consequence: BENIGN_CONSEQUENCE, maxUses: 1 },
      { id: "benign-harm", role: "attack", consequence: HARM_CONSEQUENCE, maxUses: 1 },
      { id: "benign-benign", role: "benign", consequence: BENIGN_CONSEQUENCE, maxUses: 1 },
      { id: "mixed-harm", role: "mixed", consequence: HARM_CONSEQUENCE, maxUses: 1 },
      { id: "mixed-benign", role: "mixed", consequence: BENIGN_CONSEQUENCE, maxUses: 1 },
    ],
  });
  const observations: ArmObservation[] = [];
  const arms: Arm[] = [];

  try {
    const baseline = await openArm(sink, "baseline", "attack", false);
    arms.push(baseline);
    await expect.poll(() => baseline.page.evaluate(() => {
      const descriptor = Object.getOwnPropertyDescriptor(window, "NavSentinelFixtureTargetBootstrap");
      return Boolean(descriptor && descriptor.writable === false && descriptor.configurable === false &&
        Object.isFrozen(descriptor.value));
    })).toBe(true);
    await expect.poll(() => baseline.page.evaluate((scenarioId) => {
      const resolver = (window as unknown as {
        NavSentinelFixtureTargetBootstrap: {
          resolve: (role: string, scenario: string, originMode: string) => { status: string };
        };
      }).NavSentinelFixtureTargetBootstrap;
      const original = location.href;
      const unbound = resolver.resolve("harm", scenarioId, "alternate-loopback").status;
      history.replaceState(null, "", "/bootstrap-other-document.html");
      const mismatch = resolver.resolve("harm", scenarioId, "same-loopback").status;
      history.replaceState(null, "", original);
      return { unbound, mismatch };
    }, SCENARIO_ID)).toEqual({ unbound: "unbound", mismatch: "document-mismatch" });
    await assertFixtureBootstrapCannotBeReplaced(baseline.page, sink);
    await assertUnsafeOverridesRejected(baseline.page);
    const baselineBefore = sink.snapshot().receipts.length;
    const baselinePopup = await clickTrap(baseline);
    expect(baselinePopup, "The no-product baseline must reach the local fake sink").not.toBeNull();
    await baselinePopup!.waitForLoadState("domcontentloaded", { timeout: 5_000 });
    await expect.poll(() => sink.snapshot().receipts.length).toBe(baselineBefore + 1);
    observations.push({
      role: "attack",
      productReady: false,
      outcome: "HARM_REACHED",
      sinkReceiptsBefore: baselineBefore,
      sinkReceiptsAfter: sink.snapshot().receipts.length,
      productEvent: null,
      trustedInput: "mouse",
    });
    await baselinePopup!.close();
    await baseline.cleanup();

    const protectedArm = await openArm(sink, "protected", "attack", true);
    arms.push(protectedArm);
    const protectedBefore = sink.snapshot().receipts.length;
    expect(await clickTrap(protectedArm), "The release extension must keep the sink unreachable").toBeNull();
    await waitForToastMatch(protectedArm.page, /Blocked new tab|blocked deceptive click/i, 3_000);
    await protectedArm.page.waitForTimeout(200);
    expect(sink.snapshot().receipts).toHaveLength(protectedBefore);
    observations.push({
      role: "attack",
      productReady: true,
      outcome: "BLOCKED_PRE_HARM",
      sinkReceiptsBefore: protectedBefore,
      sinkReceiptsAfter: sink.snapshot().receipts.length,
      productEvent: await readToastText(protectedArm.page),
      trustedInput: "mouse",
    });
    await protectedArm.cleanup();

    const benign = await openArm(sink, "benign", "benign", true);
    arms.push(benign);
    const benignWorker = await getServiceWorker(benign.context);
    await benignWorker.evaluate(async (eventLogKey) => {
      await chrome.storage.local.set({ [eventLogKey]: [] });
    }, "sentinelsuite:event_log_v1");
    const benignBefore = sink.snapshot().receipts.length;
    await activateBenignLinkByKeyboard(benign.page);
    await expect.poll(() => sink.snapshot().receipts.length).toBe(benignBefore + 1);
    await benign.page.waitForTimeout(1_200);
    const benignProductEvent = await readToastText(benign.page);
    expect(benignProductEvent, "The benign task must complete without a product intervention").toBeNull();
    const benignEvents = await benignWorker.evaluate(async (eventLogKey) => {
      const stored = await chrome.storage.local.get(eventLogKey);
      return Array.isArray(stored[eventLogKey]) ? stored[eventLogKey] : [];
    }, "sentinelsuite:event_log_v1");
    expect(benignEvents, "The benign task must persist only its silent allow event").toHaveLength(1);
    expect(benignEvents[0]).toMatchObject({
      kind: "nav_silent_allow",
      site: "127.0.0.1",
      destHost: "127.0.0.1",
    });
    expect(benignEvents[0]).toMatchObject({
      reasons: expect.arrayContaining(["keyboard_activation"]),
    });
    observations.push({
      role: "benign",
      productReady: true,
      outcome: "OBSERVED",
      sinkReceiptsBefore: benignBefore,
      sinkReceiptsAfter: sink.snapshot().receipts.length,
      productEvent: "nav_silent_allow",
      productEventCount: benignEvents.length,
      trustedInput: "keyboard",
    });
    await benign.cleanup();

    const mixed = await openArm(sink, "mixed", "mixed", true);
    arms.push(mixed);
    const mixedBefore = sink.snapshot().receipts.length;
    await activateBenignLinkByKeyboard(mixed.page);
    await expect.poll(() => sink.snapshot().receipts.length).toBe(mixedBefore + 1);
    await mixed.page.goBack({ waitUntil: "domcontentloaded", timeout: 10_000 });
    await expect(mixed.page.locator("html")).toHaveAttribute("data-navsentinel-local-targets-ready", "1");
    await waitForNavSentinelBridge(mixed.page);
    expect(await clickTrap(mixed), "The mixed arm must isolate the later unauthorized consequence").toBeNull();
    await waitForToastMatch(mixed.page, /Blocked new tab|blocked deceptive click/i, 3_000);
    await mixed.page.waitForTimeout(200);
    expect(sink.snapshot().receipts).toHaveLength(mixedBefore + 1);
    observations.push({
      role: "mixed",
      productReady: true,
      outcome: "BLOCKED_PRE_HARM",
      sinkReceiptsBefore: mixedBefore,
      sinkReceiptsAfter: sink.snapshot().receipts.length,
      productEvent: await readToastText(mixed.page),
      trustedInput: "keyboard_then_mouse",
    });
    await mixed.cleanup();

    expect(sink.snapshot().invalidAttempts).toEqual([]);
    expect(sink.snapshot().receipts.map((receipt) => [receipt.role, receipt.consequence])).toEqual([
      ["attack", HARM_CONSEQUENCE],
      ["benign", BENIGN_CONSEQUENCE],
      ["mixed", BENIGN_CONSEQUENCE],
    ]);
    for (const arm of arms) expect(arm.violations).toEqual([]);
    await writeReceipt(testInfo, sink, observations, arms, releaseProfile);
  } finally {
    for (const arm of arms) {
      if (!arm.context.pages().every((page) => page.isClosed())) {
        await arm.cleanup().catch(() => {});
      }
    }
    await sink.close();
  }
});
