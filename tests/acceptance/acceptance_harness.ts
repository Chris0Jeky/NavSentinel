/**
 * Agent-run acceptance harness for NavSentinel's owner browser procedures.
 *
 * Each session is a fresh, disposable Chrome profile with the exact
 * `extension/dist` loaded, a loopback Gym server, the real toolbar popup
 * (driven over DevTools with trusted input), and an evidence receipt that
 * records the Git head, build hash, Chrome build, readiness markers, step
 * outcomes, console output from every surface, screenshots and storage
 * snapshots. `playwright.acceptance.config.ts` runs it on the installed branded
 * Chrome with Playwright's realism-distorting switches removed.
 *
 * A receipt is automated evidence. It is never an owner Gate-3 result and must
 * not be recorded as one in ACTION_ITEMS.md.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type BrowserContext, type Page, type TestInfo, type Worker } from "@playwright/test";
import { hashDirectory } from "../maintainer-headed/receipt";
import { readBuiltUiGuardRevision, waitForNavSentinelBridge } from "../e2e/extension_test_utils";
import { CdpPageClient, readDevToolsPort, type ConsoleRecord } from "./cdp_page_client";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : path.join(repoRoot, "extension", "dist");
export const gymRoot = path.join(repoRoot, "gym");
export const SETTINGS_KEY = "sentinelsuite:settings_v1";
export const EVENT_LOG_KEY = "sentinelsuite:event_log_v1";

export type StepOutcome = {
  id: string;
  title: string;
  status: "passed" | "failed" | "observed";
  detail?: string;
  durationMs: number;
};

export type Markers = { capture: string | null; bridge: string | null; guard: string | null };

type Receipt = {
  schema: "navsentinel-acceptance-receipt/v1";
  guide: string;
  test: string;
  classification: "AUTOMATED_AGENT_EVIDENCE_NOT_OWNER_GATE3";
  startedAt: string;
  finishedAt?: string;
  git: { head: string; productSourceTree: string; lastProductCommit: string; productSourceClean: boolean; statusLines: string[] };
  build: { distSha256: string; uiGuardRevision: string; manifestVersion: string };
  browser: {
    /** What actually ran, from the browser's UA brands. */
    product: "branded-chrome" | "bundled-chromium";
    /** What the environment asked for. */
    requested: "branded-chrome" | "bundled-chromium";
    brands: string[];
    version: string;
    realistic: boolean;
    executable: string | null;
  };
  extensionId: string;
  gymBaseUrl: string;
  markers: Array<{ url: string; markers: Markers }>;
  steps: StepOutcome[];
  notes: string[];
  screenshots: string[];
  storage: Array<{ label: string; area: "local" | "session"; value: unknown }>;
  console: ConsoleRecord[];
  result?: "PASS" | "FAIL";
  /** Message of a hard failure thrown outside any step, if one occurred. */
  hardFailure?: string;
};

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

export function acceptanceRunDirectory(): string {
  const stamp = process.env.NAVSENTINEL_ACCEPTANCE_RUN ?? "adhoc";
  const directory = path.join(repoRoot, "artifacts", "acceptance", stamp);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

type LaunchedProfile = { context: BrowserContext; worker: Worker; devToolsPort: number };

/**
 * Playwright's Worker handle does not follow a real MV3 worker restart (the
 * Observatory fault driver reads worker state over raw DevTools for the same
 * reason), so after a restart the session evaluates through this DevTools
 * client instead. Only `url()` and `evaluate()` are supported.
 */
function workerProxy(client: CdpPageClient, url: string): Worker {
  return {
    url: () => url,
    evaluate: (fn: (arg: never) => unknown, arg?: unknown) => client.evaluate(fn, arg),
    on: () => undefined,
  } as unknown as Worker;
}

const WORKER_SUFFIX = "/service-worker-loader.js";

/** Launch (or relaunch) Chrome on `userDataDir` with the exact build loaded. */
async function launchProfile(userDataDir: string): Promise<LaunchedProfile> {
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: null,
    timeout: 60_000,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--remote-debugging-port=0",
      "--window-size=1280,900",
    ],
  });
  try {
    const worker = context.serviceWorkers().find((candidate) => candidate.url().endsWith(WORKER_SUFFIX))
      ?? await context.waitForEvent("serviceworker", {
        predicate: (candidate) => candidate.url().endsWith(WORKER_SUFFIX),
        timeout: 20_000,
      });
    return { context, worker, devToolsPort: await readDevToolsPort(userDataDir) };
  } catch (error) {
    await context.close().catch(() => undefined);
    throw error;
  }
}

export class AcceptanceSession {
  readonly receipt: Receipt;
  private popupClient: CdpPageClient | null = null;
  private readonly popupConsole: ConsoleRecord[] = [];
  private hardFailure: string | null = null;
  private readonly directory: string;
  private stepCounter = 0;
  private currentContext: BrowserContext;
  private currentWorker: Worker;
  private currentDevToolsPort: number;
  private workerClient: CdpPageClient | null = null;

  private constructor(
    launched: LaunchedProfile,
    readonly extensionId: string,
    readonly gym: { baseUrl: string; localhostUrl: string; close: () => Promise<void> },
    private readonly userDataDir: string,
    private readonly testInfo: TestInfo,
    receipt: Receipt,
  ) {
    this.currentContext = launched.context;
    this.currentWorker = launched.worker;
    this.currentDevToolsPort = launched.devToolsPort;
    this.receipt = receipt;
    this.directory = path.join(acceptanceRunDirectory(), slug(`${receipt.guide}-${receipt.test}`));
    fs.mkdirSync(this.directory, { recursive: true });
  }

  get context(): BrowserContext {
    return this.currentContext;
  }

  /** The live extension service worker; follows MV3 idle termination and restarts. */
  get worker(): Worker {
    return this.currentWorker;
  }

  get devToolsPort(): number {
    return this.currentDevToolsPort;
  }

  static async open(testInfo: TestInfo, guide: string): Promise<AcceptanceSession> {
    test.skip(!fs.existsSync(path.join(extensionPath, "manifest.json")), "Build extension/dist before the acceptance lane.");
    // Baseline comparisons load an older build whose loader predates the
    // current content-address contract; its printed guard revision is passed in.
    const uiGuardRevision = process.env.NAVSENTINEL_EXPECTED_GUARD ?? readBuiltUiGuardRevision();
    const manifest = JSON.parse(fs.readFileSync(path.join(extensionPath, "manifest.json"), "utf8")) as { version: string };
    const statusLines = git(["status", "--porcelain", "--", "extension/src", "extension/public", "manifest.json", "vite.config.ts", "package.json", "package-lock.json"])
      .split(/\r?\n/).filter(Boolean);
    const gymServer = await startAcceptanceServer();
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-acceptance-"));
    let launched: LaunchedProfile | undefined;
    try {
      launched = await launchProfile(userDataDir);
      const extensionId = new URL(launched.worker.url()).host;
      const branded = Boolean(process.env.NAVSENTINEL_BRANDED_CHROME && process.env.NAVSENTINEL_BRANDED_CHROME !== "0");
      // Derive the product from the running browser (#873): the env flag only
      // says what was requested. Branded Chrome reports a "Google Chrome" brand.
      const brands = await launched.worker.evaluate(() =>
        ((navigator as unknown as { userAgentData?: { brands?: Array<{ brand: string }> } }).userAgentData?.brands ?? []).map((b) => b.brand),
      ).catch(() => [] as string[]);
      const launchedBranded = brands.includes("Google Chrome");
      const receipt: Receipt = {
        schema: "navsentinel-acceptance-receipt/v1",
        guide,
        test: testInfo.title,
        classification: "AUTOMATED_AGENT_EVIDENCE_NOT_OWNER_GATE3",
        startedAt: new Date().toISOString(),
        git: {
          head: git(["rev-parse", "HEAD"]),
          // The checkout HEAD can move with test-only commits; these pin what the
          // build was made from: the extension/src tree and the last product commit.
          productSourceTree: git(["rev-parse", "HEAD:extension/src"]),
          lastProductCommit: git(["log", "-1", "--format=%H", "--", "extension/src", "extension/public", "vite.config.ts", "package-lock.json", "scripts/build-extension.mjs"]),
          productSourceClean: statusLines.length === 0,
          statusLines,
        },
        build: { distSha256: hashDirectory(extensionPath), uiGuardRevision, manifestVersion: manifest.version },
        browser: {
          product: launchedBranded ? "branded-chrome" : "bundled-chromium",
          requested: branded ? "branded-chrome" : "bundled-chromium",
          brands,
          version: launched.context.browser()?.version() ?? "unknown",
          realistic: process.env.NAVSENTINEL_REALISTIC_CHROME === "1",
          executable: branded ? (process.env.NAVSENTINEL_BRANDED_CHROME === "1" ? "default-install" : process.env.NAVSENTINEL_BRANDED_CHROME ?? null) : null,
        },
        extensionId,
        gymBaseUrl: gymServer.baseUrl,
        markers: [],
        steps: [],
        notes: [],
        screenshots: [],
        storage: [],
        console: [],
      };
      const session = new AcceptanceSession(
        launched,
        extensionId,
        { ...gymServer, localhostUrl: gymServer.baseUrl.replace("127.0.0.1", "localhost") },
        userDataDir,
        testInfo,
        receipt,
      );
      session.wireConsole();
      await session.closeOnboarding();
      return session;
    } catch (error) {
      await launched?.context.close().catch(() => undefined);
      await gymServer.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
      throw error;
    }
  }

  private record(source: string, level: string, text: string): void {
    this.receipt.console.push({ source, level, text, at: new Date().toISOString() });
  }

  private wireWorker(worker: Worker): void {
    worker.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") this.record("service-worker", message.type(), message.text());
    });
  }

  private wireConsole(): void {
    const wirePage = (page: Page) => {
      const label = () => {
        try { return `page:${new URL(page.url()).origin}${new URL(page.url()).pathname}`; } catch { return "page"; }
      };
      page.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning") this.record(label(), message.type(), message.text());
      });
      page.on("pageerror", (error) => this.record(label(), "exception", error.message));
    };
    this.context.pages().forEach(wirePage);
    this.context.on("page", wirePage);
    this.wireWorker(this.currentWorker);
    this.context.on("serviceworker", (worker) => {
      if (!worker.url().endsWith(WORKER_SUFFIX) || worker === this.currentWorker) return;
      this.currentWorker = worker;
      this.wireWorker(worker);
      this.note(`service worker (re)started at ${new Date().toISOString()}`);
    });
  }

  /** Close the first-run onboarding tab so it does not steal the active tab. */
  async closeOnboarding(timeoutMs = 4000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const onboarding = this.context.pages().find((page) => page.url().includes("/onboarding/onboarding.html"));
      if (onboarding) {
        await onboarding.close();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  /**
   * Terminate the extension service worker the way MV3 idle shutdown does
   * (DevTools `ServiceWorker.stopAllWorkers`), then wake it with an extension
   * page so its top-level startup re-reads persisted state.
   */
  async stopServiceWorker(): Promise<void> {
    const worker = this.currentWorker;
    const workerUrl = worker.url();
    const epoch = `acceptance-${Date.now()}-${Math.random()}`;
    await worker.evaluate((value) => { (globalThis as unknown as { __nsAcceptanceEpoch?: string }).__nsAcceptanceEpoch = value; }, epoch);
    const probe = await this.context.newPage();
    const session = await this.context.newCDPSession(probe);
    type Version = { versionId: string; scriptURL: string; runningStatus: string };
    const versions = new Map<string, Version>();
    session.on("ServiceWorker.workerVersionUpdated", ({ versions: updates }: { versions: Version[] }) => {
      for (const version of updates) if (version.scriptURL === workerUrl) versions.set(version.versionId, version);
    });
    const waitFor = async (predicate: () => boolean, message: string, timeoutMs = 8000) => {
      const deadline = Date.now() + timeoutMs;
      while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
      if (!predicate()) throw new Error(message);
    };
    try {
      await session.send("ServiceWorker.enable");
      await waitFor(() => [...versions.values()].some((version) => version.runningStatus === "running"), "extension service worker version not visible to DevTools");
      const running = [...versions.values()].find((version) => version.runningStatus === "running")!;
      await session.send("ServiceWorker.stopWorker", { versionId: running.versionId });
      await waitFor(() => versions.get(running.versionId)?.runningStatus === "stopped", "extension service worker did not stop");
      this.note(`service worker stopped at ${new Date().toISOString()}`);
      // Wake it through an ordinary extension surface, as a user would.
      await probe.goto(this.extensionUrl("src/options/options.html"), { waitUntil: "load" });
      await waitFor(() => [...versions.values()].some((version) => version.runningStatus === "running"), "extension service worker did not restart", 20_000);
    } finally {
      await session.detach().catch(() => undefined);
    }
    // Bind to the restarted worker target and prove it is a new realm: the
    // in-memory epoch marker set above must be gone.
    await this.workerClient?.close().catch(() => undefined);
    const client = await CdpPageClient.attach(this.devToolsPort, (target) => target.url === workerUrl, "service-worker", 10_000, "service_worker");
    const marker = await client.evaluate<string | null>("globalThis.__nsAcceptanceEpoch ?? null");
    if (marker !== null) {
      await client.close();
      throw new Error("service worker realm did not change after restart");
    }
    this.workerClient = client;
    this.currentWorker = workerProxy(client, workerUrl);
    this.note(`service worker restarted in a new realm at ${new Date().toISOString()}`);
    await probe.close();
  }

  /** Quit Chrome and relaunch it on the same profile (persisted state survives). */
  async restartBrowser(): Promise<void> {
    await this.closePopup();
    if (this.workerClient) {
      this.receipt.console.push(...this.workerClient.console.filter((entry) => entry.level === "error" || entry.level === "exception" || entry.level === "warning"));
      await this.workerClient.close().catch(() => undefined);
      this.workerClient = null;
    }
    await this.currentContext.close();
    const launched = await launchProfile(this.userDataDir);
    const relaunchedId = new URL(launched.worker.url()).host;
    if (relaunchedId !== this.extensionId) {
      await launched.context.close().catch(() => undefined);
      throw new Error(`extension id changed across restart: ${this.extensionId} -> ${relaunchedId}`);
    }
    this.currentContext = launched.context;
    this.currentWorker = launched.worker;
    this.currentDevToolsPort = launched.devToolsPort;
    this.wireConsole();
    this.note(`browser relaunched on the same profile at ${new Date().toISOString()}`);
    await this.closeOnboarding(3000);
  }

  get chromeVersion(): string {
    return this.receipt.browser.version;
  }

  get guardRevision(): string {
    return this.receipt.build.uiGuardRevision;
  }

  url(pathname: string, host: "127.0.0.1" | "localhost" = "127.0.0.1"): string {
    const base = host === "localhost" ? this.gym.localhostUrl : this.gym.baseUrl;
    return new URL(pathname, `${base}/`).toString();
  }

  extensionUrl(relative: string): string {
    return `chrome-extension://${this.extensionId}/${relative.replace(/^\//, "")}`;
  }

  /** Blank tab reused by most procedures; never the onboarding tab. */
  async newPage(): Promise<Page> {
    return this.context.newPage();
  }

  async readMarkers(page: Page): Promise<Markers> {
    return page.evaluate(() => ({
      capture: document.documentElement.getAttribute("data-navsentinel-capture-ready"),
      bridge: document.documentElement.getAttribute("data-navsentinel-bridge-ready"),
      guard: document.documentElement.getAttribute("data-navsentinel-ui-guard"),
    }));
  }

  /** Navigate and require capture=1, bridge=1 and the exact built guard revision. */
  async gotoReady(page: Page, url: string): Promise<Markers> {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
    return this.requireReady(page);
  }

  async requireReady(page: Page): Promise<Markers> {
    await waitForNavSentinelBridge(page, 15_000, this.guardRevision);
    const markers = await this.readMarkers(page);
    this.receipt.markers.push({ url: redactUrl(page.url()), markers });
    return markers;
  }

  /** One named procedure step; failures are recorded with a screenshot and rethrown. */
  async step<T>(title: string, body: () => Promise<T>, options: { soft?: boolean } = {}): Promise<T | undefined> {
    const id = `step-${String(++this.stepCounter).padStart(2, "0")}`;
    const started = Date.now();
    return test.step(`${id} ${title}`, async () => {
      try {
        const value = await body();
        this.receipt.steps.push({ id, title, status: "passed", durationMs: Date.now() - started });
        return value;
      } catch (error) {
        const detail = error instanceof Error ? error.message.split("\n").slice(0, 12).join("\n") : String(error);
        this.receipt.steps.push({ id, title, status: "failed", detail, durationMs: Date.now() - started });
        await this.screenshotAll(`${id}-failure`).catch(() => undefined);
        if (options.soft) return undefined;
        throw error;
      }
    });
  }

  observe(title: string, detail: string): void {
    const id = `obs-${String(this.receipt.steps.length + 1).padStart(2, "0")}`;
    this.receipt.steps.push({ id, title, status: "observed", detail, durationMs: 0 });
  }

  note(text: string): void {
    this.receipt.notes.push(text);
  }

  async screenshot(page: Page, name: string): Promise<string> {
    const file = path.join(this.directory, `${slug(name)}.png`);
    await page.screenshot({ path: file });
    this.receipt.screenshots.push(path.relative(repoRoot, file));
    await this.testInfo.attach(name, { path: file, contentType: "image/png" });
    return file;
  }

  async screenshotPopup(name: string): Promise<string | null> {
    if (!this.popupClient || this.popupClient.closed) return null;
    const file = path.join(this.directory, `${slug(name)}.png`);
    await this.popupClient.screenshot(file);
    this.receipt.screenshots.push(path.relative(repoRoot, file));
    await this.testInfo.attach(name, { path: file, contentType: "image/png" });
    return file;
  }

  private async screenshotAll(prefix: string): Promise<void> {
    let index = 0;
    for (const page of this.context.pages()) {
      if (page.isClosed()) continue;
      await this.screenshot(page, `${prefix}-tab-${index++}`).catch(() => undefined);
    }
    await this.screenshotPopup(`${prefix}-popup`).catch(() => undefined);
  }

  /** Open the real toolbar popup bound to `page` as the active tab. */
  async openPopup(page: Page): Promise<CdpPageClient> {
    await this.closePopup();
    await page.bringToFront();
    const opened = await this.worker.evaluate(async () => {
      try {
        await chrome.action.openPopup();
        return "ok";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    });
    if (opened !== "ok") throw new Error(`chrome.action.openPopup failed: ${opened}`);
    const prefix = this.extensionUrl("src/popup/popup.html");
    const client = await CdpPageClient.attach(this.devToolsPort, (target) => target.url.startsWith(prefix), "popup");
    // popup.html ships "#site" as the placeholder "-"; refreshUi() replaces it
    // with a host label, so waiting for any other text means the popup has
    // rendered its state and absence checks are meaningful (#873). The
    // pending-decision controller marks #pendingDecisions only after its first
    // refresh settles, so a hidden host is then a rendered empty state rather
    // than a not-yet-rendered one (#884).
    // Baseline attribution deliberately loads older dist builds whose popup
    // predates this marker. Preserve their original site-render wait.
    const olderBuildBaseline = Boolean(process.env.EXTENSION_PATH && process.env.NAVSENTINEL_EXPECTED_GUARD);
    const siteReady = "document.readyState === 'complete' && !['', '-'].includes((document.getElementById('site')?.textContent ?? '').trim())";
    await client.waitFor(olderBuildBaseline ? siteReady : `${siteReady} && document.getElementById('pendingDecisions')?.dataset.pendingDecisionsReady === 'true'`, 8000);
    // Chrome may need time to accept closing and reopening a toolbar popup in
    // the next procedure step, independently of this page's DOM readiness.
    await new Promise((resolve) => setTimeout(resolve, 400));
    this.popupClient = client;
    return client;
  }

  async closePopup(): Promise<void> {
    if (this.popupClient) {
      this.popupConsole.push(...this.popupClient.console);
      await this.popupClient.close().catch(() => undefined);
      this.popupClient = null;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  /** Extension-owned page (Options, Protection Center, ...) in a normal tab. */
  async openExtensionPage(relative: string): Promise<Page> {
    const page = await this.context.newPage();
    await page.goto(this.extensionUrl(relative), { waitUntil: "load" });
    return page;
  }

  async storageLocal<T = unknown>(key: string, label?: string): Promise<T> {
    const value = await this.worker.evaluate(async (storageKey) => (await chrome.storage.local.get(storageKey))[storageKey], key);
    if (label) this.receipt.storage.push({ label, area: "local", value });
    return value as T;
  }

  async storageSessionAll(label?: string): Promise<Record<string, unknown>> {
    const value = await this.worker.evaluate(async () => chrome.storage.session.get(null));
    if (label) this.receipt.storage.push({ label, area: "session", value });
    return value;
  }

  async setStorageLocal(values: Record<string, unknown>): Promise<void> {
    await this.worker.evaluate(async (entries) => chrome.storage.local.set(entries), values);
  }

  async patchNavigation(patch: { defaultMode?: "off" | "smart" | "strict"; debug?: boolean; autoDismissOverlays?: boolean }): Promise<void> {
    await this.worker.evaluate(async ({ key, navPatch }) => {
      const stored = ((await chrome.storage.local.get(key))[key] ?? {}) as Record<string, unknown>;
      const nav = (stored.nav && typeof stored.nav === "object" ? stored.nav : {}) as Record<string, unknown>;
      await chrome.storage.local.set({ [key]: { ...stored, nav: { defaultMode: "smart", debug: false, autoDismissOverlays: false, ...nav, ...navPatch } } });
    }, { key: SETTINGS_KEY, navPatch: patch });
  }

  async eventLog(label?: string): Promise<Array<Record<string, unknown>>> {
    const log = (await this.storageLocal<Array<Record<string, unknown>>>(EVENT_LOG_KEY, label)) ?? [];
    return Array.isArray(log) ? log : [];
  }

  /** Error/exception console records since the session opened, from every surface. */
  consoleErrors(ignore: RegExp[] = []): ConsoleRecord[] {
    const all = [...this.receipt.console, ...this.popupConsole, ...(this.popupClient?.console ?? [])];
    return all.filter((entry) => (entry.level === "error" || entry.level === "exception") && !ignore.some((pattern) => pattern.test(entry.text)));
  }

  /**
   * Record a hard failure thrown outside any step. close() runs in the spec's
   * finally block before Playwright marks the test failed, so without this the
   * receipt could say PASS for a red test (#873).
   */
  markFailed(error: unknown): void {
    this.hardFailure = error instanceof Error ? error.message : String(error);
  }

  async close(): Promise<void> {
    await this.closePopup();
    this.receipt.console.push(...this.popupConsole);
    if (this.workerClient) {
      this.receipt.console.push(...this.workerClient.console.filter((entry) => entry.level === "error" || entry.level === "exception" || entry.level === "warning"));
      await this.workerClient.close().catch(() => undefined);
      this.workerClient = null;
    }
    this.receipt.finishedAt = new Date().toISOString();
    const failedSteps = this.receipt.steps.filter((step) => step.status === "failed").map((step) => `${step.id} ${step.title}`);
    // Soft steps record and continue; the test must still end red.
    expect.soft(failedSteps, "procedure steps that failed (see receipt.json)").toEqual([]);
    const failed = failedSteps.length > 0 || this.hardFailure !== null || this.testInfo.status === "failed" || this.testInfo.status === "timedOut";
    if (this.hardFailure !== null) this.receipt.hardFailure = this.hardFailure.slice(0, 2000);
    this.receipt.result = failed ? "FAIL" : "PASS";
    const file = path.join(this.directory, "receipt.json");
    fs.writeFileSync(file, `${JSON.stringify(this.receipt, null, 2)}\n`);
    await this.testInfo.attach("receipt", { path: file, contentType: "application/json" });
    await this.context.close().catch(() => undefined);
    await this.gym.close();
    fs.rmSync(this.userDataDir, { recursive: true, force: true });
  }
}

const ACCEPTANCE_FIXTURE_ROOT = path.join(repoRoot, "tests", "acceptance", "fixtures");
const LOOPBACK_REDIRECT_HOSTS = new Set(["127.0.0.1", "localhost"]);

/**
 * Loopback static server for the Gym plus acceptance-only fixtures under
 * `/acceptance/`. `/__redirect?to=<loopback URL>&status=302` issues a real
 * HTTP redirect so redirect-chain procedures do not depend on script hops.
 * It sends no caching headers, so pages stay eligible for the back/forward
 * cache exactly as an ordinary static site would.
 */
export async function startAcceptanceServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const http = await import("node:http");
  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    if (requestUrl.pathname === "/favicon.ico") {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (requestUrl.pathname === "/__redirect") {
      const to = requestUrl.searchParams.get("to") ?? "";
      let target: URL | null;
      try { target = new URL(to, `http://${req.headers.host ?? "127.0.0.1"}`); } catch { target = null; }
      if (!target || target.protocol !== "http:" || !LOOPBACK_REDIRECT_HOSTS.has(target.hostname)) {
        res.statusCode = 400;
        res.end("Bad redirect");
        return;
      }
      const status = Number(requestUrl.searchParams.get("status") ?? "302");
      res.statusCode = [301, 302, 303, 307, 308].includes(status) ? status : 302;
      res.setHeader("location", target.toString());
      res.end();
      return;
    }
    const rawPath = decodeURIComponent(requestUrl.pathname);
    // Any `/acceptance/dest/<marker path>` serves the shared destination page,
    // so procedures can put a unique marker in the destination path itself.
    const decoded = rawPath.startsWith("/acceptance/dest/") ? "/acceptance/destination.html" : rawPath;
    const [root, relative] = decoded.startsWith("/acceptance/")
      ? [ACCEPTANCE_FIXTURE_ROOT, decoded.slice("/acceptance".length)]
      : [gymRoot, decoded === "/" ? "/index.html" : decoded];
    const resolved = path.resolve(root, `.${relative}`);
    const inside = path.relative(root, resolved);
    if (inside.startsWith("..") || path.isAbsolute(inside) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    const extension = path.extname(resolved).toLowerCase();
    res.setHeader("content-type", extension === ".js" ? "text/javascript; charset=utf-8"
      : extension === ".css" ? "text/css; charset=utf-8"
        : extension === ".json" ? "application/json; charset=utf-8"
          : "text/html; charset=utf-8");
    const delayMs = Number(requestUrl.searchParams.get("delayMs") ?? "0");
    const send = () => { res.statusCode = 200; res.end(fs.readFileSync(resolved)); };
    if (Number.isFinite(delayMs) && delayMs > 0) setTimeout(send, Math.min(delayMs, 10_000));
    else send();
  });
  let port = 46200;
  for (;; port += 1) {
    if (port > 46260) throw new Error("No free acceptance server port");
    const bound = await new Promise<boolean>((resolve) => {
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => resolve(true));
    });
    if (bound) break;
  }
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Origin plus path only; acceptance receipts never retain queries or fragments. */
export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "unparseable";
  }
}

/** Page-world clicks are synthetic; this clicks an element's centre with trusted input. */
export async function trustedClick(page: Page, selector: string): Promise<void> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`${selector} is not rendered`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** Centre of a button inside NavSentinel's toast shadow root, by visible label. */
export async function toastButtonPoint(page: Page, label: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate((expected) => {
    const hosts = Array.from(document.querySelectorAll("#__navsentinel_toast_host"));
    for (const host of hosts) {
      const button = Array.from(host.shadowRoot?.querySelectorAll("button") ?? []).find((candidate) => candidate.textContent?.trim() === expected);
      if (button) {
        const rect = button.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
    }
    return null;
  }, label);
}

export async function toastState(page: Page): Promise<{ text: string | null; buttons: string[] }> {
  return page.evaluate(() => {
    const host = document.querySelector("#__navsentinel_toast_host");
    const root = host?.shadowRoot;
    const text = root?.querySelector(".body")?.textContent?.trim() || null;
    const buttons = Array.from(root?.querySelectorAll("button") ?? [])
      .filter((button) => (button as HTMLElement).offsetParent !== null || getComputedStyle(button).display !== "none")
      .map((button) => button.textContent?.trim() ?? "");
    return { text, buttons };
  });
}

/** Proves a real back/forward-cache restore rather than a reload. */
export async function installBfcacheProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window as unknown as { __nsAcceptancePageshow?: boolean[] };
    state.__nsAcceptancePageshow = state.__nsAcceptancePageshow ?? [];
    window.addEventListener("pageshow", (event) => state.__nsAcceptancePageshow!.push(event.persisted));
  });
}

export async function lastPageshowPersisted(page: Page): Promise<boolean | null> {
  return page.evaluate(() => {
    const list = (window as unknown as { __nsAcceptancePageshow?: boolean[] }).__nsAcceptancePageshow;
    return list && list.length ? list[list.length - 1]! : null;
  });
}
