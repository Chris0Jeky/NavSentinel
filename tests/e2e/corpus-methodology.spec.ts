import { expect, test, chromium, type BrowserContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EVENT_LOG_KEY } from "../../extension/src/shared/storage";
import { getServiceWorker, waitForNavSentinelBridge } from "./extension_test_utils";
import { startProvingGroundEgressFence, type ProvingGroundEgressAttempt } from "./proving_ground_fake_sink";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.resolve(__dirname, "..", "..", "extension", "dist");

const ATTACK_SOURCE_URL = "https://attack.corpus-contract.test/login";
const ATTACK_RECEIPT_URL = "https://credential-receipt.attack-contract.test/received";
const BENIGN_SOURCE_URL = "https://benign.corpus-contract.test/home";
const BENIGN_RECEIPT_URL = "https://benign.corpus-contract.test/visited";
const MIXED_SOURCE_URL = "https://mixed.corpus-contract.test/choices";
const MIXED_RECEIPT_URL = "https://mixed.corpus-contract.test/visited";

type ProbeRecord = {
  type: "pointerdown" | "click" | "submit";
  targetId: string;
  trusted: boolean;
};

type RouteFixture = { marker: string; body: string };

type CorpusHarness = {
  context: BrowserContext;
  routeHits: Map<string, number>;
  probeRecords: ProbeRecord[];
  readonly routeFailure: string | null;
  egressAttempts: ProvingGroundEgressAttempt[];
  cleanup: () => Promise<void>;
};

function sourceHtml(marker: string, content: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="navsentinel-fixture" content="${marker}"><title>Inert corpus contract fixture</title></head>
<body>${content}</body></html>`;
}

const fixtures = new Map<string, RouteFixture>([
  [ATTACK_SOURCE_URL, {
    marker: "attack-source",
    body: sourceHtml("attack-source", `
      <main><h1>Inert attack-form contract</h1>
      <form id="attack-form" action="${ATTACK_RECEIPT_URL}" method="get">
        <label>Email <input id="attack-email" name="email" type="email"></label>
        <label>Password <input id="attack-password" name="password" type="password"></label>
        <button id="attack-submit" type="submit">Continue</button>
      </form></main>`),
  }],
  [ATTACK_RECEIPT_URL, { marker: "attack-receipt", body: sourceHtml("attack-receipt", "<main><h1>Inert credential receipt</h1></main>") }],
  [BENIGN_SOURCE_URL, {
    marker: "benign-source",
    body: sourceHtml("benign-source", `
      <main><h1>Inert benign-link contract</h1>
      <a id="benign-link" href="${BENIGN_RECEIPT_URL}">Open local receipt</a></main>`),
  }],
  [BENIGN_RECEIPT_URL, { marker: "benign-receipt", body: sourceHtml("benign-receipt", "<main><h1>Inert benign receipt</h1></main>") }],
  [MIXED_SOURCE_URL, {
    marker: "mixed-source",
    body: sourceHtml("mixed-source", `
      <main><h1>Inert mixed contract</h1>
      <form id="dormant-attack-form" action="${ATTACK_RECEIPT_URL}" method="get">
        <label>Password <input id="dormant-password" name="password" type="password"></label>
        <button id="dormant-attack-submit" type="submit">Do not select</button>
      </form>
      <a id="mixed-benign-link" href="${MIXED_RECEIPT_URL}">Open selected benign receipt</a></main>`),
  }],
  [MIXED_RECEIPT_URL, { marker: "mixed-receipt", body: sourceHtml("mixed-receipt", "<main><h1>Inert mixed benign receipt</h1></main>") }],
]);

function assertReservedTestUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("TEST_INVALID:fixture_origin_invalid");
  }
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".test") ||
      parsed.username || parsed.password || parsed.hash ||
      ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) {
    throw new Error("TEST_INVALID:fixture_origin_invalid");
  }
}

function reservedTestSite(url: string): string {
  return new URL(url).hostname.split(".").slice(-2).join(".");
}

function assertScenarioTopology(): void {
  if (reservedTestSite(ATTACK_SOURCE_URL) === reservedTestSite(ATTACK_RECEIPT_URL)) {
    throw new Error("TEST_INVALID:attack_not_cross_site");
  }
  if (new URL(BENIGN_SOURCE_URL).origin !== new URL(BENIGN_RECEIPT_URL).origin ||
      new URL(MIXED_SOURCE_URL).origin !== new URL(MIXED_RECEIPT_URL).origin) {
    throw new Error("TEST_INVALID:control_not_same_origin");
  }
}

function corpusResponse(body: string) {
  return {
    status: 200,
    contentType: "text/html; charset=utf-8",
    headers: {
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; base-uri 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; img-src 'none'; form-action https://credential-receipt.attack-contract.test",
      "x-content-type-options": "nosniff",
    },
    body,
  };
}

async function startCorpusHarness(): Promise<CorpusHarness> {
  if (!fs.existsSync(extensionPath)) throw new Error("TEST_INVALID:extension_build_missing");
  for (const url of fixtures.keys()) assertReservedTestUrl(url);
  assertScenarioTopology();

  const probeRecords: ProbeRecord[] = [];
  const routeHits = new Map<string, number>();
  const egressAttempts: ProvingGroundEgressAttempt[] = [];
  const probeBinding = `__navsentinelCorpusProbe_${randomUUID().replaceAll("-", "")}`;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-corpus-contract-"));
  const egressFence = await startProvingGroundEgressFence(egressAttempts, new Set());
  let context: BrowserContext | null = null;
  let routeFailure: string | null = null;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      timeout: 60_000,
      proxy: { server: egressFence.proxyServer },
      args: [
        "--disable-background-networking", "--disable-client-side-phishing-detection",
        "--disable-component-update", "--disable-default-apps", "--disable-domain-reliability",
        "--disable-quic", "--disable-sync", "--metrics-recording-only", "--no-default-browser-check",
        "--no-first-run", "--safebrowsing-disable-auto-update",
        "--disable-features=AccountConsistency,AutofillServerCommunication,CertificateTransparencyComponentUpdater,MediaRouter,NetworkTimeServiceQuerying,OptimizationHints,Signin",
        `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`,
      ],
    });
    await context.exposeBinding(probeBinding, (_source, value: unknown) => {
      if (!value || typeof value !== "object") throw new Error("TEST_INVALID:probe_payload_invalid");
      const record = value as Partial<ProbeRecord>;
      if ((record.type !== "pointerdown" && record.type !== "click" && record.type !== "submit") ||
          typeof record.targetId !== "string" || typeof record.trusted !== "boolean") {
        throw new Error("TEST_INVALID:probe_payload_invalid");
      }
      probeRecords.push({ type: record.type, targetId: record.targetId, trusted: record.trusted });
    });
    await context.addInitScript((bindingName) => {
      for (const type of ["pointerdown", "click", "submit"] as const) {
        window.addEventListener(type, (event) => {
          const target = event.target instanceof Element ? event.target : null;
          const report = (window as unknown as Record<string, ((record: ProbeRecord) => Promise<void>) | undefined>)[bindingName];
          if (!report) throw new Error("TEST_INVALID:probe_binding_missing");
          void report({
            type, targetId: target?.id ?? "", trusted: event.isTrusted,
          });
        }, true);
      }
    }, probeBinding);
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = request.url();
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        await route.continue();
        return;
      }
      const fixture = fixtures.get(url);
      if (request.method() !== "GET" || !request.isNavigationRequest() || !fixture) {
        routeFailure ??= "TEST_INVALID:unexpected_page_request";
        await route.abort("blockedbyclient");
        return;
      }
      routeHits.set(url, (routeHits.get(url) ?? 0) + 1);
      await route.fulfill(corpusResponse(fixture.body));
    });
    return {
      context, routeHits, probeRecords,
      get routeFailure() { return routeFailure; },
      egressAttempts,
      cleanup: async () => {
        await context?.close();
        await egressFence.close();
        fs.rmSync(userDataDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await context?.close();
    await egressFence.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    throw error;
  }
}

async function openSourcePage(harness: CorpusHarness, url: string, marker: string): Promise<Page> {
  const page = await harness.context.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
  } catch {
    await page.close().catch(() => {});
    throw new Error(harness.routeFailure ?? "TEST_INVALID:source_route_miss");
  }
  if (page.url() !== url) throw new Error("TEST_INVALID:source_route_miss");
  const parsed = new URL(page.url());
  expect(parsed.hostname.endsWith(".test")).toBe(true);
  expect(["localhost", "127.0.0.1", "::1"]).not.toContain(parsed.hostname);
  try {
    await expect(page.locator('meta[name="navsentinel-fixture"]')).toHaveAttribute("content", marker);
  } catch {
    throw new Error("TEST_INVALID:scenario_incomplete");
  }
  try {
    await waitForNavSentinelBridge(page);
  } catch {
    throw new Error("TEST_INVALID:bridge_not_ready");
  }
  expect(harness.routeFailure).toBeNull();
  return page;
}

async function failClosedOnRouteFailure<T>(harness: CorpusHarness, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch {
    throw new Error(harness.routeFailure ?? "TEST_INVALID:trusted_activation_failed");
  }
}

async function expectTrustedActivation(harness: CorpusHarness, targetId: string, types: ProbeRecord["type"][]): Promise<void> {
  for (const type of types) {
    try {
      await expect.poll(() => harness.probeRecords.some((record) =>
        record.type === type && record.targetId === targetId && record.trusted,
      )).toBe(true);
    } catch {
      throw new Error("TEST_INVALID:trusted_activation_missing");
    }
  }
}

async function clearEventLog(context: BrowserContext): Promise<void> {
  const worker = await getServiceWorker(context);
  await worker.evaluate(async (key) => { await chrome.storage.local.set({ [key]: [] }); }, EVENT_LOG_KEY);
}

async function hasCredentialPrompt(context: BrowserContext): Promise<boolean> {
  const worker = await getServiceWorker(context);
  return worker.evaluate(async (key) => {
    const stored = await chrome.storage.local.get(key);
    const entries = Array.isArray(stored[key]) ? stored[key] as Array<{ kind?: unknown; extra?: unknown }> : [];
    return entries.some((entry) => entry.kind === "cred_submit_prompt" &&
      (!entry.extra || typeof entry.extra !== "object" || !("error" in entry.extra)));
  }, EVENT_LOG_KEY);
}

function expectHarnessClean(harness: CorpusHarness): void {
  expect(harness.routeFailure).toBeNull();
  // Chromium may attempt background traffic despite its suppression flags. The
  // empty-allowlist proxy denies and records it before egress; page-origin
  // traffic is fail-closed separately by the routeFailure assertion above.
  expect(harness.egressAttempts.every((attempt) => attempt.count > 0)).toBe(true);
}

test("corpus real-host and trusted-input methodology contract @corpus-contract @regression", async () => {
  const harness = await startCorpusHarness();
  try {
    await clearEventLog(harness.context);
    const attack = await openSourcePage(harness, ATTACK_SOURCE_URL, "attack-source");
    await attack.locator("#attack-email").fill("fixture@example.test");
    await attack.locator("#attack-password").fill("inert-password");
    await failClosedOnRouteFailure(harness, () => attack.locator("#attack-submit").click());
    await expectTrustedActivation(harness, "attack-submit", ["pointerdown", "click"]);
    await expectTrustedActivation(harness, "attack-form", ["submit"]);
    await expect.poll(() => hasCredentialPrompt(harness.context)).toBe(true);
    await expect(attack.locator("#__sentinelsuite_cred_modal_host__")).toBeVisible();
    expect(attack.url()).toBe(ATTACK_SOURCE_URL);
    expect(harness.routeHits.get(ATTACK_SOURCE_URL)).toBe(1);
    expect(harness.routeHits.get(ATTACK_RECEIPT_URL) ?? 0).toBe(0);
    await attack.close();

    await clearEventLog(harness.context);
    const benign = await openSourcePage(harness, BENIGN_SOURCE_URL, "benign-source");
    await failClosedOnRouteFailure(harness, () => benign.locator("#benign-link").click());
    await expectTrustedActivation(harness, "benign-link", ["pointerdown", "click"]);
    await expect(benign).toHaveURL(BENIGN_RECEIPT_URL);
    expect(harness.routeHits.get(BENIGN_SOURCE_URL)).toBe(1);
    expect(harness.routeHits.get(BENIGN_RECEIPT_URL)).toBe(1);
    expect(await hasCredentialPrompt(harness.context)).toBe(false);
    await benign.close();

    await clearEventLog(harness.context);
    const mixed = await openSourcePage(harness, MIXED_SOURCE_URL, "mixed-source");
    await expect(mixed.locator("#dormant-attack-form")).toBeAttached();
    await failClosedOnRouteFailure(harness, () => mixed.locator("#mixed-benign-link").click());
    await expectTrustedActivation(harness, "mixed-benign-link", ["pointerdown", "click"]);
    await expect(mixed).toHaveURL(MIXED_RECEIPT_URL);
    expect(harness.routeHits.get(MIXED_SOURCE_URL)).toBe(1);
    expect(harness.routeHits.get(MIXED_RECEIPT_URL)).toBe(1);
    expect(harness.routeHits.get(ATTACK_RECEIPT_URL) ?? 0).toBe(0);
    expect(await hasCredentialPrompt(harness.context)).toBe(false);
    await mixed.close();

    expectHarnessClean(harness);
  } finally {
    await harness.cleanup();
  }
});
