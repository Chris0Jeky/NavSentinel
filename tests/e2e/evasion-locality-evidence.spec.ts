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
  getGymBaseUrl,
  readToastText,
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
  outcome: "HARM_REACHED" | "BLOCKED_PRE_HARM" | "NO_SIGNAL";
  sinkReceiptsBefore: number;
  sinkReceiptsAfter: number;
  productEvent: string | null;
  trustedInput: "mouse" | "keyboard" | "keyboard_then_mouse";
};

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
  const { baseUrl, gym } = await getGymBaseUrl(gymRoot);
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
    fixtureUrl.searchParams.set(
      "harm_target",
      sink.urlFor(harmRole, HARM_CONSEQUENCE, `${armId}-harm`),
    );
    fixtureUrl.searchParams.set(
      "benign_target",
      sink.urlFor(benignRole, BENIGN_CONSEQUENCE, `${armId}-benign`),
    );
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
  let activeId = "";
  for (let attempt = 0; attempt < 4 && activeId !== "legit-link"; attempt += 1) {
    await page.keyboard.press("Tab");
    activeId = await page.evaluate(() => document.activeElement?.id ?? "");
  }
  expect(activeId, "Native Tab traversal must reach the benign link").toBe("legit-link");
  await page.keyboard.press("Enter");
}

async function assertUnsafeOverridesRejected(page: Page): Promise<void> {
  const rejections = await page.evaluate(() => {
    const originalUrl = location.href;
    const api = (window as unknown as {
      NavSentinelLocalTargets: { url: (role: "harm", scenarioId: string) => string };
    }).NavSentinelLocalTargets;
    const attempt = (target: string): string => {
      const candidate = new URL(originalUrl);
      candidate.searchParams.set("harm_target", target);
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
      reservedExternal: attempt("https://not-a-live-target.invalid/"),
      unarmedLocal: attempt("http://127.0.0.1:46100/untyped-local-target"),
    };
  });
  expect(rejections.reservedExternal, "A reserved external override must fail closed before navigation")
    .toBe("non-loopback-target");
  expect(rejections.unarmedLocal, "An untyped local override must fail closed before navigation")
    .toBe("unarmed-local-target");
}

async function writeReceipt(
  testInfo: TestInfo,
  sink: ProvingGroundFakeSink,
  observations: ArmObservation[],
  arms: Arm[],
): Promise<void> {
  const repository = repositoryState();
  const sinkSnapshot = sink.snapshot();
  const fixtureFiles = [
    ...evasionFixturePaths,
    path.join(gymRoot, "local-fixture-targets.js"),
    path.join(gymRoot, "local-fixture-sink.html"),
  ];
  const receipt = {
    schema_version: "1.0.0",
    scenario_id: SCENARIO_ID,
    capability_id: "F-03",
    profile: "proving_ground",
    repository_head: repository.head,
    extension_build_sha256: fs.existsSync(extensionPath) ? hashDirectory(extensionPath) : "",
    browser: {
      name: "chromium",
      version: arms.find((arm) => arm.productReady)?.browserVersion ?? "unknown",
      channel: "playwright-bundled",
    },
    fixture: {
      family: "evasion-01-through-12",
      representative_path: `gym/${FIXTURE_NAME}`,
      localized_path_count: evasionFixturePaths.length,
      sha256: hashFiles(fixtureFiles),
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
      benign: "NO_SIGNAL",
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
      tab: "one fresh-profile tab per arm",
      frame: "top frame",
      document: `exact ${FIXTURE_NAME} document for each arm`,
      destination: "one armed loopback sink URL per arm, role, and consequence",
      ttl: "one browser arm",
      use_count: 1,
      use_count_scope: "per armed destination",
      sink_revalidation: "The fake sink validates run, scenario, role, consequence, one-use target authority, and the exact inert sentinel on every request.",
    },
    qualification: {
      privacy: "The sink retains only typed metadata and a SHA-256 of the inert sentinel; no page text, full browsing history, credential, or raw secret is stored.",
      performance: "No release code changed and no runtime performance claim is made.",
      accessibility: "The benign control is reached with native Tab and Enter; no assistive-technology pass was run.",
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
    const benignBefore = sink.snapshot().receipts.length;
    await activateBenignLinkByKeyboard(benign.page);
    await expect.poll(() => sink.snapshot().receipts.length).toBe(benignBefore + 1);
    const benignProductEvent = await readToastText(benign.page);
    expect(benignProductEvent, "The benign task must complete without a product intervention").toBeNull();
    observations.push({
      role: "benign",
      productReady: true,
      outcome: "NO_SIGNAL",
      sinkReceiptsBefore: benignBefore,
      sinkReceiptsAfter: sink.snapshot().receipts.length,
      productEvent: benignProductEvent,
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
    await writeReceipt(testInfo, sink, observations, arms);
  } finally {
    for (const arm of arms) {
      if (!arm.context.pages().every((page) => page.isClosed())) {
        await arm.cleanup().catch(() => {});
      }
    }
    await sink.close();
  }
});
