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
  PROVING_GROUND_SENTINEL,
  PROVING_GROUND_SINK_PATH,
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

type MutationId = "control" | "opacity-010" | "zindex-9997" | "dom-depth-1" | "class-token-a7c1";

type MutationAxis = "control" | "opacity" | "zIndex" | "domDepth" | "classList";

type MutationDefinition = {
  id: MutationId;
  declaredOpacity: string;
  declaredZIndex: string;
  computedOpacity: string;
  computedZIndex: string;
  axis: MutationAxis;
};

const MUTATION_DEFINITIONS: readonly MutationDefinition[] = [
  { id: "control", declaredOpacity: "0.09", declaredZIndex: "9998", computedOpacity: "0.09", computedZIndex: "9998", axis: "control" },
  { id: "opacity-010", declaredOpacity: "0.10", declaredZIndex: "9998", computedOpacity: "0.1", computedZIndex: "9998", axis: "opacity" },
  { id: "zindex-9997", declaredOpacity: "0.09", declaredZIndex: "9997", computedOpacity: "0.09", computedZIndex: "9997", axis: "zIndex" },
  { id: "dom-depth-1", declaredOpacity: "0.09", declaredZIndex: "9998", computedOpacity: "0.09", computedZIndex: "9998", axis: "domDepth" },
  { id: "class-token-a7c1", declaredOpacity: "0.09", declaredZIndex: "9998", computedOpacity: "0.09", computedZIndex: "9998", axis: "classList" },
];

type RectFingerprint = { x: number; y: number; width: number; height: number; top: number; right: number; bottom: number; left: number };

type MutationFingerprint = {
  classList: string[];
  parentTag: string | null;
  ancestorDepthFromBody: number;
  computedStyle: {
    position: string;
    opacity: string;
    zIndex: string;
    cursor: string;
    width: string;
    height: string;
    top: string;
    left: string;
  };
  rect: RectFingerprint;
  targetAttributes: Array<[string, string]>;
  targetHrefPresent: boolean;
  targetReady: string | null;
  localTargetsReady: string | null;
  benignLink: {
    attributes: Array<[string, string]>;
    hrefPresent: boolean;
    ready: string | null;
    parentTag: string | null;
    computedStyle: { display: string; width: string; height: string; top: string; left: string };
    rect: RectFingerprint;
  };
};

type MutationObservation = MutationDefinition & {
  reported: string | null;
  invalid: string | null;
  computedOpacity: string;
  computedZIndex: string;
  fingerprint: MutationFingerprint;
};

type NormalizedTargetAuthority = {
  origin: string;
  pathname: string;
  fragment: string;
  credentials: { username: string; password: string };
  queryNames: string[];
  queryCount: number;
  runIdSha256: string;
  scenarioId: string | null;
  role: string | null;
  consequence: string | null;
  targetId: string | null;
  sentinelSha256: string;
};

type ArmObservation = {
  mutation: MutationObservation;
  role: ProvingGroundRole;
  productReady: boolean;
  outcome: "HARM_REACHED" | "BLOCKED_PRE_HARM" | "OBSERVED";
  sinkReceiptsBefore: number;
  sinkReceiptsAfter: number;
  productEvent: string | null;
  productEventCount?: number;
  trustedInput: "mouse" | "keyboard" | "keyboard_then_mouse";
};

type CampaignCase = {
  mutation: MutationObservation;
  observations: ArmObservation[];
  sinkSnapshot: ReturnType<ProvingGroundFakeSink["snapshot"]>;
  networkViolations: ProvingGroundEgressAttempt[];
  blockedExternalAttempts: ProvingGroundEgressAttempt[];
};

type ReleaseProfileInspection = ReturnType<typeof inspectBuiltReleaseProfile>;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeTargetAuthority(href: string): NormalizedTargetAuthority {
  const url = new URL(href);
  const queryEntries = [...url.searchParams.entries()];
  const value = (name: string): string | null => url.searchParams.get(name);
  return {
    origin: url.origin,
    pathname: url.pathname,
    fragment: url.hash,
    credentials: { username: url.username, password: url.password },
    queryNames: queryEntries.map(([name]) => name).sort(),
    queryCount: queryEntries.length,
    runIdSha256: sha256(value("run_id") ?? ""),
    scenarioId: value("scenario_id"),
    role: value("role"),
    consequence: value("consequence"),
    targetId: value("target_id"),
    sentinelSha256: sha256(value("sentinel") ?? ""),
  };
}

async function assertArmedTargetAuthorities(
  page: Page,
  sink: ProvingGroundFakeSink,
  fixtureUrl: URL,
  armId: ArmId,
  harmRole: ProvingGroundRole,
  benignRole: ProvingGroundRole,
): Promise<void> {
  const expected = {
    harm: normalizeTargetAuthority(sink.urlFor(harmRole, HARM_CONSEQUENCE, `${armId}-harm`)),
    benign: normalizeTargetAuthority(sink.urlFor(benignRole, BENIGN_CONSEQUENCE, `${armId}-benign`)),
  };
  expect(expected.harm.pathname, "The armed harm authority must use the proving-ground sink path")
    .toBe(PROVING_GROUND_SINK_PATH);
  expect(expected.benign.pathname, "The armed benign authority must use the proving-ground sink path")
    .toBe(PROVING_GROUND_SINK_PATH);
  expect(expected.harm.sentinelSha256).toBe(sha256(PROVING_GROUND_SENTINEL));
  expect(expected.benign.sentinelSha256).toBe(sha256(PROVING_GROUND_SENTINEL));
  const sinkHostname = new URL(sink.origin).hostname;
  expect(sinkHostname, "The sink must remain on the fixture's same-loopback hostname")
    .toBe(fixtureUrl.hostname);

  const actualHrefs = await page.evaluate(() => ({
    harm: document.querySelector<HTMLAnchorElement>("#trap")?.href ?? null,
    benign: document.querySelector<HTMLAnchorElement>("#legit-link")?.href ?? null,
  }));
  expect(actualHrefs.harm, "The harm target must be armed before activation").not.toBeNull();
  expect(actualHrefs.benign, "The benign target must be armed before activation").not.toBeNull();
  const actual = {
    harm: normalizeTargetAuthority(actualHrefs.harm!),
    benign: normalizeTargetAuthority(actualHrefs.benign!),
  };
  expect(new URL(actualHrefs.harm!).hostname, "The harm target must use the same-loopback hostname")
    .toBe(fixtureUrl.hostname);
  expect(new URL(actualHrefs.benign!).hostname, "The benign target must use the same-loopback hostname")
    .toBe(fixtureUrl.hostname);
  expect(actual.harm, "The live harm href must match its exact armed target authority")
    .toEqual(expected.harm);
  expect(actual.benign, "The live benign href must match its exact armed target authority")
    .toEqual(expected.benign);
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
  mutation: MutationId,
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
    fixtureUrl.searchParams.set("mutation", mutation);
    const harmRole: ProvingGroundRole = role === "mixed" ? "mixed" : "attack";
    const benignRole: ProvingGroundRole = role === "mixed" ? "mixed" : "benign";
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
    await assertArmedTargetAuthorities(page, sink, fixtureUrl, armId, harmRole, benignRole);

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

async function readMutationObservation(page: Page, definition: MutationDefinition): Promise<MutationObservation> {
  const observed = await page.evaluate(() => {
    const rounded = (value: number): number => Number(value.toFixed(3));
    const rectFingerprint = (element: Element): RectFingerprint => {
      const rect = element.getBoundingClientRect();
      return {
        x: rounded(rect.x), y: rounded(rect.y), width: rounded(rect.width), height: rounded(rect.height),
        top: rounded(rect.top), right: rounded(rect.right), bottom: rounded(rect.bottom), left: rounded(rect.left),
      };
    };
    const attributes = (element: Element, excluded: Set<string>): Array<[string, string]> => Array.from(element.attributes)
      .filter((attribute) => !excluded.has(attribute.name))
      .map((attribute) => [attribute.name, attribute.value] as [string, string])
      .sort(([left], [right]) => left.localeCompare(right));
    const depthFromBody = (element: Element): number => {
      let depth = 0;
      for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) depth += 1;
      return depth;
    };
    const root = document.documentElement;
    const trap = document.querySelector<HTMLElement>("#trap");
    const benignLink = document.querySelector<HTMLElement>("#legit-link");
    const trapStyle = trap ? getComputedStyle(trap) : null;
    const benignStyle = benignLink ? getComputedStyle(benignLink) : null;
    return {
      reported: root.getAttribute("data-navsentinel-evasion-mutation"),
      invalid: root.getAttribute("data-navsentinel-fixture-invalid"),
      computedOpacity: trapStyle?.opacity ?? "missing-trap",
      computedZIndex: trapStyle?.zIndex ?? "missing-trap",
      fingerprint: {
        classList: trap ? Array.from(trap.classList) : [],
        parentTag: trap?.parentElement?.tagName ?? null,
        ancestorDepthFromBody: trap ? depthFromBody(trap) : -1,
        computedStyle: {
          position: trapStyle?.position ?? "missing-trap",
          opacity: trapStyle?.opacity ?? "missing-trap",
          zIndex: trapStyle?.zIndex ?? "missing-trap",
          cursor: trapStyle?.cursor ?? "missing-trap",
          width: trapStyle?.width ?? "missing-trap",
          height: trapStyle?.height ?? "missing-trap",
          top: trapStyle?.top ?? "missing-trap",
          left: trapStyle?.left ?? "missing-trap",
        },
        rect: trap ? rectFingerprint(trap) : { x: -1, y: -1, width: -1, height: -1, top: -1, right: -1, bottom: -1, left: -1 },
        targetAttributes: trap ? attributes(trap, new Set(["class", "href"])) : [],
        targetHrefPresent: Boolean(trap?.getAttribute("href")),
        targetReady: trap?.getAttribute("data-navsentinel-local-target-ready") ?? null,
        localTargetsReady: root.getAttribute("data-navsentinel-local-targets-ready"),
        benignLink: {
          attributes: benignLink ? attributes(benignLink, new Set(["href"])) : [],
          hrefPresent: Boolean(benignLink?.getAttribute("href")),
          ready: benignLink?.getAttribute("data-navsentinel-local-target-ready") ?? null,
          parentTag: benignLink?.parentElement?.tagName ?? null,
          computedStyle: {
            display: benignStyle?.display ?? "missing-link",
            width: benignStyle?.width ?? "missing-link",
            height: benignStyle?.height ?? "missing-link",
            top: benignStyle?.top ?? "missing-link",
            left: benignStyle?.left ?? "missing-link",
          },
          rect: benignLink ? rectFingerprint(benignLink) : { x: -1, y: -1, width: -1, height: -1, top: -1, right: -1, bottom: -1, left: -1 },
        },
      },
    };
  });
  expect(observed.invalid, "The requested mutation must be recognised by the fixture").toBeNull();
  expect(observed.reported, "The fixture must report the requested mutation").toBe(definition.id);
  expect(observed.computedOpacity, "The trap opacity must match the mutation definition")
    .toBe(definition.computedOpacity);
  expect(observed.computedZIndex, "The trap z-index must match the mutation definition")
    .toBe(definition.computedZIndex);
  return { ...definition, ...observed };
}

function assertMutationAxes(
  control: MutationObservation,
  mutant: MutationObservation,
  changedAxis: MutationAxis,
): void {
  expect(mutant.axis, `${mutant.id} must declare the checked mutation axis`).toBe(changedAxis);
  expect(mutant.fingerprint.computedStyle.position).toBe(control.fingerprint.computedStyle.position);
  expect(mutant.fingerprint.computedStyle.cursor).toBe(control.fingerprint.computedStyle.cursor);
  expect(mutant.fingerprint.computedStyle.width).toBe(control.fingerprint.computedStyle.width);
  expect(mutant.fingerprint.computedStyle.height).toBe(control.fingerprint.computedStyle.height);
  expect(mutant.fingerprint.computedStyle.top).toBe(control.fingerprint.computedStyle.top);
  expect(mutant.fingerprint.computedStyle.left).toBe(control.fingerprint.computedStyle.left);
  expect(mutant.fingerprint.rect).toEqual(control.fingerprint.rect);
  expect(mutant.fingerprint.targetAttributes).toEqual(control.fingerprint.targetAttributes);
  expect(mutant.fingerprint.targetHrefPresent).toBe(control.fingerprint.targetHrefPresent);
  expect(mutant.fingerprint.targetReady).toBe(control.fingerprint.targetReady);
  expect(mutant.fingerprint.localTargetsReady).toBe(control.fingerprint.localTargetsReady);
  expect(mutant.fingerprint.benignLink).toEqual(control.fingerprint.benignLink);
  if (changedAxis === "opacity") {
    expect(mutant.fingerprint.classList).toEqual(control.fingerprint.classList);
    expect(mutant.fingerprint.parentTag).toBe(control.fingerprint.parentTag);
    expect(mutant.fingerprint.ancestorDepthFromBody).toBe(control.fingerprint.ancestorDepthFromBody);
    expect(mutant.fingerprint.computedStyle.opacity).not.toBe(control.fingerprint.computedStyle.opacity);
    expect(mutant.fingerprint.computedStyle.zIndex).toBe(control.fingerprint.computedStyle.zIndex);
  } else if (changedAxis === "zIndex") {
    expect(mutant.fingerprint.classList).toEqual(control.fingerprint.classList);
    expect(mutant.fingerprint.parentTag).toBe(control.fingerprint.parentTag);
    expect(mutant.fingerprint.ancestorDepthFromBody).toBe(control.fingerprint.ancestorDepthFromBody);
    expect(mutant.fingerprint.computedStyle.opacity).toBe(control.fingerprint.computedStyle.opacity);
    expect(mutant.fingerprint.computedStyle.zIndex).not.toBe(control.fingerprint.computedStyle.zIndex);
  } else if (changedAxis === "domDepth") {
    expect(mutant.fingerprint.classList).toEqual(control.fingerprint.classList);
    expect(mutant.fingerprint.parentTag).toBe("SPAN");
    expect(mutant.fingerprint.parentTag).not.toBe(control.fingerprint.parentTag);
    expect(mutant.fingerprint.ancestorDepthFromBody).toBe(control.fingerprint.ancestorDepthFromBody + 1);
    expect(mutant.fingerprint.computedStyle.opacity).toBe(control.fingerprint.computedStyle.opacity);
    expect(mutant.fingerprint.computedStyle.zIndex).toBe(control.fingerprint.computedStyle.zIndex);
  } else if (changedAxis === "classList") {
    expect(mutant.fingerprint.classList).toEqual(["evasion-overlay--token-a7c1"]);
    expect(mutant.fingerprint.classList).not.toEqual(control.fingerprint.classList);
    expect(mutant.fingerprint.parentTag).toBe(control.fingerprint.parentTag);
    expect(mutant.fingerprint.ancestorDepthFromBody).toBe(control.fingerprint.ancestorDepthFromBody);
    expect(mutant.fingerprint.computedStyle.opacity).toBe(control.fingerprint.computedStyle.opacity);
    expect(mutant.fingerprint.computedStyle.zIndex).toBe(control.fingerprint.computedStyle.zIndex);
  } else {
    expect(mutant.fingerprint.computedStyle.opacity).toBe(control.fingerprint.computedStyle.opacity);
    expect(mutant.fingerprint.computedStyle.zIndex).toBe(control.fingerprint.computedStyle.zIndex);
  }
}

async function writeReceipt(
  testInfo: TestInfo,
  controlCase: CampaignCase,
  campaign: CampaignCase[],
  arms: Arm[],
  releaseProfile: ReleaseProfileInspection,
): Promise<void> {
  const repository = repositoryState();
  const sinkSnapshot = controlCase.sinkSnapshot;
  const fixtureFiles = [
    ...evasionFixturePaths,
    path.join(gymRoot, "local-fixture-targets.js"),
    path.join(gymRoot, "local-fixture-sink.html"),
  ];
  const gitFixtureSha256 = hashGitFiles(fixtureFiles, repository.head);
  const executedFixtureSha256 = hashFiles(fixtureFiles);
  const campaignCases = campaign.map((entry) => ({
    mutation: entry.mutation,
    observations: entry.observations,
    sink_snapshot: entry.sinkSnapshot,
    network_violations: entry.networkViolations,
    blocked_external_attempts: entry.blockedExternalAttempts,
  }));
  const campaignPayloadSha256 = sha256(JSON.stringify({ cases: campaignCases }));
  const targetAuthorityAssertion = {
    timing: "before_activation",
    target_count_per_arm: 2,
    asserted_arm_count: arms.length,
    asserted_target_count: arms.length * 2,
    normalized_fields: [
      "origin",
      "pathname",
      "fragment",
      "credentials",
      "query_names",
      "query_count",
      "run_id_sha256",
      "scenario_id",
      "role",
      "consequence",
      "target_id",
      "sentinel_sha256",
    ],
    exact_arm_target_ids: true,
    same_loopback_hostname: true,
    raw_runtime_urls_persisted: false,
  };
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
      local_receipt_sha256: campaignPayloadSha256,
      target_authority_assertion: targetAuthorityAssertion,
      sink_snapshot: sinkSnapshot,
      observations: controlCase.observations,
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
      "This receipt proves the shared local-target contract and one representative composite journey across control plus four deterministic CSS and structural neighbours, not mutation robustness across all twelve evasion fixtures.",
      "The mutation campaign changes only one declared trap opacity, z-index, DOM-depth, or class-token axis at a time. Its allowlisted query selector cannot select destinations, roles, authorities, or sink URLs.",
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
    mutation_campaign: {
      selector: "mutation",
      cases: campaignCases,
      payload_sha256: campaignPayloadSha256,
      hash_method: "SHA-256(UTF-8 bytes of JSON.stringify({cases: mutation_campaign.cases}))",
      qualification: "Four deterministic CSS and structural neighbours only; query selection cannot change target authority.",
    },
    network_violations: campaign.flatMap((entry) => entry.networkViolations),
    blocked_external_attempts: campaign.flatMap((entry) => entry.blockedExternalAttempts),
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

async function runMutationCase(definition: MutationDefinition): Promise<{ result: CampaignCase; arms: Arm[] }> {
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
    const baseline = await openArm(sink, "baseline", "attack", false, definition.id);
    arms.push(baseline);
    const mutation = await readMutationObservation(baseline.page, definition);
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
    if (definition.id === "control") {
      await assertFixtureBootstrapCannotBeReplaced(baseline.page, sink);
      await assertUnsafeOverridesRejected(baseline.page);
    }
    const baselineBefore = sink.snapshot().receipts.length;
    const baselinePopup = await clickTrap(baseline);
    expect(baselinePopup, "The no-product baseline must reach the local fake sink").not.toBeNull();
    await baselinePopup!.waitForLoadState("domcontentloaded", { timeout: 5_000 });
    await expect.poll(() => sink.snapshot().receipts.length).toBe(baselineBefore + 1);
    observations.push({
      mutation,
      role: "attack", productReady: false, outcome: "HARM_REACHED",
      sinkReceiptsBefore: baselineBefore, sinkReceiptsAfter: sink.snapshot().receipts.length,
      productEvent: null, trustedInput: "mouse",
    });
    await baselinePopup!.close();
    await baseline.cleanup();

    const protectedArm = await openArm(sink, "protected", "attack", true, definition.id);
    arms.push(protectedArm);
    const protectedMutation = await readMutationObservation(protectedArm.page, definition);
    const protectedBefore = sink.snapshot().receipts.length;
    expect(await clickTrap(protectedArm), "The release extension must keep the sink unreachable").toBeNull();
    await waitForToastMatch(protectedArm.page, /Blocked new tab|blocked deceptive click/i, 3_000);
    await protectedArm.page.waitForTimeout(200);
    expect(sink.snapshot().receipts).toHaveLength(protectedBefore);
    observations.push({
      mutation: protectedMutation,
      role: "attack", productReady: true, outcome: "BLOCKED_PRE_HARM",
      sinkReceiptsBefore: protectedBefore, sinkReceiptsAfter: sink.snapshot().receipts.length,
      productEvent: await readToastText(protectedArm.page), trustedInput: "mouse",
    });
    await protectedArm.cleanup();

    const benign = await openArm(sink, "benign", "benign", true, definition.id);
    arms.push(benign);
    const benignMutation = await readMutationObservation(benign.page, definition);
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
    expect(benignEvents[0]).toMatchObject({ kind: "nav_silent_allow", site: "127.0.0.1", destHost: "127.0.0.1" });
    expect(benignEvents[0]).toMatchObject({ reasons: expect.arrayContaining(["keyboard_activation"]) });
    observations.push({
      mutation: benignMutation,
      role: "benign", productReady: true, outcome: "OBSERVED",
      sinkReceiptsBefore: benignBefore, sinkReceiptsAfter: sink.snapshot().receipts.length,
      productEvent: "nav_silent_allow", productEventCount: benignEvents.length, trustedInput: "keyboard",
    });
    await benign.cleanup();

    const mixed = await openArm(sink, "mixed", "mixed", true, definition.id);
    arms.push(mixed);
    const mixedMutation = await readMutationObservation(mixed.page, definition);
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
      mutation: mixedMutation,
      role: "mixed", productReady: true, outcome: "BLOCKED_PRE_HARM",
      sinkReceiptsBefore: mixedBefore, sinkReceiptsAfter: sink.snapshot().receipts.length,
      productEvent: await readToastText(mixed.page), trustedInput: "keyboard_then_mouse",
    });
    await mixed.cleanup();

    expect(sink.snapshot().invalidAttempts).toEqual([]);
    expect(sink.snapshot().receipts.map((receipt) => [receipt.role, receipt.consequence])).toEqual([
      ["attack", HARM_CONSEQUENCE], ["benign", BENIGN_CONSEQUENCE], ["mixed", BENIGN_CONSEQUENCE],
    ]);
    for (const observation of observations) {
      expect(observation.mutation.fingerprint, `${observation.role} must preserve the mutation fingerprint`)
        .toEqual(mutation.fingerprint);
    }
    for (const arm of arms) expect(arm.violations).toEqual([]);
    return {
      result: {
        mutation, observations, sinkSnapshot: sink.snapshot(),
        networkViolations: arms.flatMap((arm) => arm.violations),
        blockedExternalAttempts: arms.flatMap((arm) => arm.blockedExternalAttempts),
      },
      arms,
    };
  } finally {
    for (const arm of arms) {
      if (!arm.context.pages().every((page) => page.isClosed())) await arm.cleanup().catch(() => {});
    }
    await sink.close();
  }
}

test("#449 rejects a same-role target authority swap before activation @regression", async () => {
  const sink = await startProvingGroundFakeSink({
    runId: randomUUID(),
    scenarioId: SCENARIO_ID,
    allowedRoles: ["attack", "benign", "mixed"],
    allowedConsequences: [HARM_CONSEQUENCE, BENIGN_CONSEQUENCE],
    targetAuthorities: [
      { id: "baseline-harm", role: "attack", consequence: HARM_CONSEQUENCE, maxUses: 1 },
      { id: "baseline-benign", role: "benign", consequence: BENIGN_CONSEQUENCE, maxUses: 1 },
      { id: "swap-harm", role: "attack", consequence: HARM_CONSEQUENCE, maxUses: 1 },
    ],
  });
  let baseline: Arm | null = null;

  try {
    baseline = await openArm(sink, "baseline", "attack", false, "control");
    const fixtureUrl = new URL(baseline.page.url());
    const swappedTarget = sink.urlFor("attack", HARM_CONSEQUENCE, "swap-harm");
    await baseline.page.locator("#trap").evaluate((element, href) => {
      (element as HTMLAnchorElement).href = href;
    }, swappedTarget);

    await expect(assertArmedTargetAuthorities(
      baseline.page,
      sink,
      fixtureUrl,
      "baseline",
      "attack",
      "benign",
    )).rejects.toThrow();
    expect(sink.snapshot()).toEqual({ receipts: [], invalidAttempts: [] });
  } finally {
    await baseline?.cleanup().catch(() => {});
    await sink.close();
  }
});

test("#449 evasion targets stay local with attack, protected, benign, and mixed evidence @regression", async ({}, testInfo) => {
  test.skip(!fs.existsSync(extensionPath), "Build the extension before running locality evidence.");
  const releaseProfile = inspectBuiltReleaseProfile(extensionPath, {
    expectedProfile: "interaction-only", requireReleaseEligible: true,
  });
  expect(evasionFixturePaths, "The bounded family must contain exactly evasion 01 through 12").toHaveLength(12);
  const campaign: CampaignCase[] = [];
  const allArms: Arm[] = [];
  for (const definition of MUTATION_DEFINITIONS) {
    const entry = await runMutationCase(definition);
    campaign.push(entry.result);
    allArms.push(...entry.arms);
  }
  const control = campaign.find((entry) => entry.mutation.id === "control");
  expect(control, "The mutation campaign must include a control case").toBeDefined();
  const opacity = campaign.find((entry) => entry.mutation.id === "opacity-010");
  const zIndex = campaign.find((entry) => entry.mutation.id === "zindex-9997");
  const domDepth = campaign.find((entry) => entry.mutation.id === "dom-depth-1");
  const classToken = campaign.find((entry) => entry.mutation.id === "class-token-a7c1");
  expect(opacity).toBeDefined();
  expect(zIndex).toBeDefined();
  expect(domDepth).toBeDefined();
  expect(classToken).toBeDefined();
  assertMutationAxes(control!.mutation, opacity!.mutation, "opacity");
  assertMutationAxes(control!.mutation, zIndex!.mutation, "zIndex");
  assertMutationAxes(control!.mutation, domDepth!.mutation, "domDepth");
  assertMutationAxes(control!.mutation, classToken!.mutation, "classList");
  await writeReceipt(testInfo, control!, campaign, allArms, releaseProfile);
});
