import fs from "fs";
import * as http from "node:http";
import path from "path";
import type { BrowserContext, CDPSession, Frame, Page, Worker } from "@playwright/test";
import { DBLCLICK_WINDOW_MS } from "../../extension/src/shared/doubleclick_timing";
import {
  assertContentAddressedLoader,
  assertUiGuardRevision,
} from "../../scripts/content-loader-contract.mjs";

type GymServerHandle = { baseUrl: string; close: () => Promise<void> };
const SAFE_GYM_PORT_START = 46000;
const SAFE_GYM_PORT_ATTEMPTS = 25;
let builtUiGuardRevision: string | undefined;

/** Runtime revision of the built isolated-world capture loader that carries the UI input fence. */
export function readBuiltUiGuardRevision(): string {
  if (builtUiGuardRevision) return builtUiGuardRevision;
  const dist = process.env.EXTENSION_PATH
    ? path.resolve(process.env.EXTENSION_PATH)
    : path.resolve(process.cwd(), "extension", "dist");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dist, "manifest.json"), "utf8"),
  ) as { content_scripts?: Array<{ world?: string; js?: string[] }> };
  const captureScript = manifest.content_scripts
    ?.find((entry) => entry.world === "ISOLATED" && /capture_isolated/.test(entry.js?.[0] ?? ""))
    ?.js?.[0];
  if (!captureScript) throw new Error("Built isolated-world capture content-script loader is missing");
  const loader = fs.readFileSync(path.join(dist, captureScript), "utf8");
  assertContentAddressedLoader(captureScript, loader);
  builtUiGuardRevision = assertUiGuardRevision(loader);
  return builtUiGuardRevision;
}

export async function getServiceWorker(context: BrowserContext): Promise<Worker> {
  const existing = context.serviceWorkers()[0];
  if (existing) return existing;
  return context.waitForEvent("serviceworker");
}

type NavigationSettingsPatch = {
  defaultMode?: "off" | "smart" | "strict";
  debug?: boolean;
  autoDismissOverlays?: boolean;
};

/** Apply a narrow navigation-settings patch without replacing sibling settings. */
export async function updateNavigationSettings(
  context: BrowserContext,
  patch: NavigationSettingsPatch,
): Promise<void> {
  const worker = await getServiceWorker(context);
  await worker.evaluate(async ({ key, navPatch }) => {
    const result = await chrome.storage.local.get(key);
    const stored = result[key] && typeof result[key] === "object"
      ? result[key] as Record<string, unknown>
      : {};
    const storedNav = stored.nav && typeof stored.nav === "object"
      ? stored.nav as Record<string, unknown>
      : {};
    await chrome.storage.local.set({
      [key]: {
        ...stored,
        nav: {
          defaultMode: "smart",
          debug: false,
          autoDismissOverlays: false,
          ...storedNav,
          ...navPatch,
        },
      },
    });
  }, { key: "sentinelsuite:settings_v1", navPatch: patch });
}

export async function getExtensionId(context: BrowserContext): Promise<string> {
  const worker = await getServiceWorker(context);
  return new URL(worker.url()).host;
}

export async function waitForNavSentinelBridge(
  page: Page,
  timeout = 15000,
  expectedGuard = readBuiltUiGuardRevision(),
): Promise<void> {
  try {
    await page.waitForFunction(
      (expectedGuard) =>
        document.documentElement.getAttribute("data-navsentinel-capture-ready") === "1" &&
        document.documentElement.getAttribute("data-navsentinel-bridge-ready") === "1" &&
        document.documentElement.getAttribute("data-navsentinel-ui-guard") === expectedGuard,
      expectedGuard,
      { timeout }
    );
  } catch (error) {
    const readiness = await page
      .evaluate(() => ({
        capture: document.documentElement.getAttribute("data-navsentinel-capture-ready"),
        bridge: document.documentElement.getAttribute("data-navsentinel-bridge-ready"),
        guard: document.documentElement.getAttribute("data-navsentinel-ui-guard"),
      }))
      .catch(() => ({ capture: null, bridge: null, guard: null }));
    const original = error instanceof Error ? error.message : String(error);

    throw new Error(
      `NavSentinel did not initialize on this page (capture=${readiness.capture ?? "missing"}, ` +
        `bridge=${readiness.bridge ?? "missing"}, guard=${readiness.guard ?? "missing"}; ` +
        `expected guard=${expectedGuard}). If this is an unpacked build from ` +
        "extension/dist, its owner must reload NavSentinel at chrome://extensions before " +
        "reloading the page; browser automation cannot prove that Chrome accepted the new " +
        `artifact. Original error: ${original}`,
      { cause: error }
    );
  }
  await dismissOnboarding(page.context(), 1000);
}

export const TOAST_HOST_ID = "__navsentinel_toast_host";

type CdpNode = {
  nodeName: string;
  backendNodeId: number;
  attributes?: string[];
  children?: CdpNode[];
  shadowRoots?: CdpNode[];
  contentDocument?: CdpNode;
};

/** Visits light-DOM descendants in tree order, as querySelectorAll does: no shadow roots, no frame documents. */
function visitLightTree(node: CdpNode, visit: (node: CdpNode) => void): void {
  for (const child of node.children ?? []) {
    visit(child);
    visitLightTree(child, visit);
  }
}

/** Index of `frame` (and each ancestor) among its parent document's iframe/frame elements, outermost first. */
async function frameIndexPath(frame: Frame): Promise<number[]> {
  const indices: number[] = [];
  for (let current = frame; current.parentFrame(); current = current.parentFrame()!) {
    const owner = await current.frameElement();
    indices.unshift(
      await owner.evaluate((element) => Array.from(document.querySelectorAll("iframe,frame")).indexOf(element as Element))
    );
  }
  return indices;
}

/**
 * Calls `source`, a `(roots, arg) => result` function, in `target`'s main world
 * with the shadow root of every element whose id is `hostId`, in tree order.
 * Extension UI roots are closed (#894, #1142), so neither page script nor
 * Playwright's selectors can reach them; the DevTools protocol can. A click
 * the function makes is untrusted, the same as one from page script.
 * A same-process child frame is reached through the page's document tree; an
 * out-of-process one through its own DevTools session.
 */
async function evaluateWithShadowRoots(
  target: Page | Frame,
  hostId: string,
  source: string,
  arg: unknown
): Promise<unknown> {
  const frame = "mainFrame" in target ? target.mainFrame() : target;
  const page = frame.page();
  const indices = await frameIndexPath(frame);
  const result = await evaluateInSession(await page.context().newCDPSession(page), indices, hostId, source, arg);
  if (result !== FRAME_OUT_OF_PROCESS) return result;
  return evaluateInSession(await page.context().newCDPSession(frame), [], hostId, source, arg);
}

const FRAME_OUT_OF_PROCESS = Symbol("frame out of process");

async function evaluateInSession(
  cdp: CDPSession,
  indices: number[],
  hostId: string,
  source: string,
  arg: unknown
): Promise<unknown> {
  try {
    const { result: documentRef } = await cdp.send("Runtime.evaluate", { expression: "document" });
    if (!documentRef.objectId) throw new Error("Page document did not resolve");
    let { node: doc } = (await cdp.send("DOM.describeNode", {
      objectId: documentRef.objectId,
      depth: -1,
      pierce: true
    })) as { node: CdpNode };
    for (const index of indices) {
      const frames: CdpNode[] = [];
      visitLightTree(doc, (node) => {
        if (node.nodeName === "IFRAME" || node.nodeName === "FRAME") frames.push(node);
      });
      const next = frames[index]?.contentDocument;
      if (!next) return FRAME_OUT_OF_PROCESS;
      doc = next;
    }
    const rootIds: number[] = [];
    visitLightTree(doc, (node) => {
      const attributes = node.attributes ?? [];
      for (let i = 0; i < attributes.length; i += 2) {
        if (attributes[i] === "id" && attributes[i + 1] === hostId && node.shadowRoots?.[0]) {
          rootIds.push(node.shadowRoots[0].backendNodeId);
        }
      }
    });
    const resolve = async (backendNodeId: number): Promise<string> => {
      const { object } = await cdp.send("DOM.resolveNode", { backendNodeId });
      if (!object.objectId) throw new Error(`Node ${backendNodeId} did not resolve`);
      return object.objectId;
    };
    const documentObject = await resolve(doc.backendNodeId);
    const roots = await Promise.all(rootIds.map(resolve));
    const { result, exceptionDetails } = await cdp.send("Runtime.callFunctionOn", {
      objectId: documentObject,
      functionDeclaration: `function (arg, ...roots) { return (${source})(roots, arg); }`,
      arguments: [{ value: arg }, ...roots.map((objectId) => ({ objectId }))],
      returnByValue: true,
      awaitPromise: true
    });
    if (exceptionDetails) {
      throw new Error(
        `Shadow-root evaluation failed: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`
      );
    }
    return result.value ?? null;
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

/**
 * Runs `fn` with the shadow roots of every element carrying the toast host id
 * (the real host and any page-forged one, in tree order) and returns its JSON
 * result. The toast's root is closed (#1142): see evaluateWithShadowRoots.
 */
export async function evaluateInToast<T, A = undefined>(
  target: Page | Frame,
  fn: (roots: ShadowRoot[], arg: A) => T,
  arg?: A
): Promise<T> {
  return (await evaluateWithShadowRoots(target, TOAST_HOST_ID, fn.toString(), arg)) as T;
}

/**
 * Polls `fn` (see evaluateInToast) until it returns a truthy value and returns
 * that value. A read that throws (a navigation destroying the context) keeps
 * waiting; the timeout error carries the last failure.
 */
export async function waitForToast<T, A = undefined>(
  target: Page | Frame,
  fn: (roots: ShadowRoot[], arg: A) => T,
  arg?: A,
  timeout = 4000
): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeout;
  for (;;) {
    let failure: unknown = null;
    try {
      const value = await evaluateInToast(target, fn, arg);
      if (value) return value as NonNullable<T>;
    } catch (error) {
      failure = error;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Toast condition not met within ${timeout} ms${failure ? ` (last read error: ${String(failure)})` : ""}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Trimmed text of the first host's first card body, or null. */
function firstToastBody(roots: ShadowRoot[]): string | null {
  return roots[0]?.querySelector(".body")?.textContent?.trim() || null;
}

/** Viewport centre of the first rendered toast button labelled `label`, or null. */
function toastButtonCenter(roots: ShadowRoot[], label: string): { x: number; y: number } | null {
  for (const root of roots) {
    for (const button of Array.from(root.querySelectorAll("button"))) {
      if (button.textContent?.trim() !== label) continue;
      const rect = button.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
    }
  }
  return null;
}

export async function waitForToastText(target: Page | Frame, text: string, timeout = 4000): Promise<void> {
  await waitForToast(
    target,
    (roots, expected) => !!roots[0]?.querySelector(".body")?.textContent?.includes(expected),
    text,
    timeout
  );
}

export async function waitForToastMatch(page: Page, pattern: RegExp, timeout = 4000): Promise<string> {
  return waitForToast(
    page,
    (roots, { source, flags }) => {
      const text = roots[0]?.querySelector(".body")?.textContent?.trim();
      return text && new RegExp(source, flags).test(text) ? text : null;
    },
    { source: pattern.source, flags: pattern.flags },
    timeout
  );
}

export async function readToastText(target: Page | Frame): Promise<string | null> {
  return evaluateInToast(target, firstToastBody);
}

/** Viewport centre of a rendered toast button, waiting for it to render. */
export async function toastButtonPoint(
  target: Page | Frame,
  label: string,
  timeout = 4000
): Promise<{ x: number; y: number }> {
  return waitForToast(target, toastButtonCenter, label, timeout);
}

/** Focus a toast button from the page's main world (a programmatic focus a closed root keeps from page script). */
export async function focusToastButton(target: Page | Frame, label: string): Promise<void> {
  const focused = await evaluateInToast(
    target,
    (roots, expected) => {
      for (const root of roots) {
        const match = Array.from(root.querySelectorAll("button")).find(
          (button) => button.textContent?.trim() === expected
        );
        if (match) {
          match.focus();
          return true;
        }
      }
      return false;
    },
    label
  );
  if (!focused) throw new Error(`Toast button not found: ${label}`);
}

/** Wait for a toast button to render, then (except Dismiss) for its entrance animation and visible-exposure arming window. */
async function waitForArmedToastButton(target: Page | Frame, label: string): Promise<void> {
  await toastButtonPoint(target, label, 10_000);
  if (label !== "Dismiss") await new Promise((resolve) => setTimeout(resolve, DBLCLICK_WINDOW_MS + 700));
}

/** Offset of `frame`'s viewport within the top page's viewport. */
export async function frameViewportOffset(frame: Frame): Promise<{ x: number; y: number }> {
  let x = 0;
  let y = 0;
  for (let current = frame; current.parentFrame(); current = current.parentFrame()!) {
    const owner = await current.frameElement();
    const origin = await owner.evaluate((node) => {
      const element = node as Element;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        x: rect.x + element.clientLeft + parseFloat(style.paddingLeft),
        y: rect.y + element.clientTop + parseFloat(style.paddingTop)
      };
    });
    x += origin.x;
    y += origin.y;
  }
  return { x, y };
}

export async function clickToastButton(target: Page | Frame, label: string): Promise<void> {
  // Trusted activation only (#783): extension-owned controls ignore
  // page-synthesized clicks, so resolve the button's viewport coordinates
  // and drive a real (trusted) mouse click at that point — the same pattern
  // as toast-input-fence.spec.ts.
  await waitForArmedToastButton(target, label);
  const frame = "mainFrame" in target ? target.mainFrame() : target;
  const point = await toastButtonPoint(target, label);
  const offset = await frameViewportOffset(frame);
  await frame.page().mouse.click(point.x + offset.x, point.y + offset.y);
}

/** Focus a toast button and activate it with a real key press. */
export async function pressToastButton(target: Page | Frame, label: string, key = "Enter"): Promise<void> {
  await waitForArmedToastButton(target, label);
  await focusToastButton(target, label);
  const page = "mainFrame" in target ? target : target.page();
  await page.keyboard.press(key);
}

/**
 * Attempts a hostile-page-style synthetic activation of a toast button.
 * Page script cannot reach the closed root (#1142); this models an attacker
 * who could, and checks the control's own trusted-input gate (#783). Must NOT
 * trigger the action. Negative-path helper only.
 */
export async function attemptSyntheticToastClick(page: Page, label: string): Promise<void> {
  const clicked = await evaluateInToast(
    page,
    (roots, expected) => {
      const match = roots
        .flatMap((root) => Array.from(root.querySelectorAll("button")))
        .find((button) => button.textContent?.trim() === expected);
      if (!match) return false;
      match.click();
      return true;
    },
    label
  );
  if (!clicked) throw new Error(`Toast button not found: ${label}`);
}

export const CREDENTIAL_MODAL_HOST_ID = "__sentinelsuite_cred_modal_host__";

/**
 * Runs `fn` with the credential prompt's shadow root as `this` and returns its
 * JSON result, or null while no prompt host exists. The root is closed (#894);
 * see evaluateWithShadowRoots.
 */
export async function evaluateInCredentialModal<T, A = undefined>(
  page: Page | Frame,
  fn: (this: ShadowRoot, arg: A) => T,
  arg?: A
): Promise<T | null> {
  const source = `(roots, arg) => roots.length ? (${fn.toString()}).call(roots[0], arg) : null`;
  return (await evaluateWithShadowRoots(page, CREDENTIAL_MODAL_HOST_ID, source, arg)) as T | null;
}

export type CredentialModalState = {
  title: string;
  buttons: string[];
  /** Label of the prompt control that has focus, if any. */
  focused: string | null;
};

/**
 * The open credential prompt, or null when none is rendered. A failed read
 * throws rather than reading as "no prompt", so a check that the prompt went
 * away cannot pass on an error.
 */
export async function readCredentialModal(page: Page): Promise<CredentialModalState | null> {
  return evaluateInCredentialModal(page, function (this: ShadowRoot) {
    const overlay = this.querySelector(".overlay");
    if (!overlay) return null;
    const rect = overlay.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      title: this.querySelector(".title")?.textContent?.trim() ?? "",
      buttons: Array.from(this.querySelectorAll(".footer button")).map(
        (button) => button.textContent?.trim() ?? ""
      ),
      focused: this.activeElement?.textContent?.trim() ?? null
    };
  });
}

/** Waits for the credential prompt ("Credential submit blocked") to render. */
export async function waitForCredentialModal(
  page: Page,
  timeout = 4000
): Promise<CredentialModalState> {
  const deadline = Date.now() + timeout;
  for (;;) {
    let state: CredentialModalState | null = null;
    let failure: unknown = null;
    try {
      state = await readCredentialModal(page);
    } catch (error) {
      // A navigation can destroy the context mid-read; keep waiting.
      failure = error;
    }
    if (state?.title === "Credential submit blocked") return state;
    if (Date.now() >= deadline) {
      throw new Error(
        `Credential prompt did not appear within ${timeout} ms (last: ${JSON.stringify(state)}` +
          `${failure ? `, last read error: ${String(failure)}` : ""})`
      );
    }
    await page.waitForTimeout(100);
  }
}

export async function clickModalButton(page: Page, label: string): Promise<void> {
  // waitForCredentialModal already proved the host. A locator wait would also wait
  // on the held submit's pending navigation, so only allow the arming window here.
  // Arming starts once the prompt is painted still: its open animation and the
  // IntersectionObserver v2 report delay add about 300 ms to the 800 ms window (#1142).
  if (label !== "Cancel") await page.waitForTimeout(DBLCLICK_WINDOW_MS + 700);
  // Trusted activation only (#783): see clickToastButton.
  const point = await evaluateInCredentialModal(
    page,
    function (this: ShadowRoot, expected: string) {
      const buttons = Array.from(this.querySelectorAll(".footer button"));
      const match = buttons.find((button) => button.textContent?.trim() === expected);
      if (!match) return null;
      const rect = match.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    },
    label
  );
  if (!point) throw new Error(`Modal button not found: ${label}`);
  await page.mouse.click(point.x, point.y);
}

/**
 * Attempts a synthetic (untrusted) activation of a credential-modal button.
 * Page script cannot reach the closed root (#894); this models an attacker
 * who could, and checks the button's own trusted-input gate (#783). Must NOT
 * resolve the prompt. Negative-path helper only.
 */
export async function attemptSyntheticModalClick(page: Page, label: string): Promise<void> {
  const clicked = await evaluateInCredentialModal(
    page,
    function (this: ShadowRoot, expected: string) {
      const buttons = Array.from(this.querySelectorAll(".footer button"));
      const match = buttons.find((button) => button.textContent?.trim() === expected);
      if (!(match instanceof HTMLElement)) return false;
      match.click();
      return true;
    },
    label
  );
  if (!clicked) throw new Error(`Modal button not found: ${label}`);
}

export async function assertNoToastFor(target: Page | Frame, durationMs = 1200): Promise<void> {
  const deadline = Date.now() + durationMs;
  for (;;) {
    const text = await readToastText(target);
    if (text) throw new Error(`Unexpected toast text: ${text}`);
    if (Date.now() >= deadline) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export async function dismissOnboarding(context: BrowserContext, timeout = 5000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const onboarding = context.pages().find((p) => p.url().includes("onboarding.html"));
    if (onboarding) {
      await onboarding.close();
      return;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

export function getGymBaseUrlOverride(): string | undefined {
  const raw = process.env.GYM_BASE_URL?.trim();
  return raw ? raw : undefined;
}

function isWithinRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function startGymServer(gymRoot: string): Promise<GymServerHandle> {
  const server = http.createServer(async (req, res) => {
    try {
      const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
      const pathname = decodeURIComponent(reqUrl.pathname);
      const rel = pathname === "/" ? "/index.html" : pathname;
      const resolved = path.resolve(gymRoot, `.${rel}`);

      if (!isWithinRoot(gymRoot, resolved)) {
        res.statusCode = 400;
        res.end("Bad request");
        return;
      }

      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        res.statusCode = 404;
        res.end("Not found");
        return;
      }

      const ext = path.extname(resolved).toLowerCase();
      if (ext === ".css") res.setHeader("content-type", "text/css; charset=utf-8");
      else if (ext === ".js") res.setHeader("content-type", "text/javascript; charset=utf-8");
      else res.setHeader("content-type", "text/html; charset=utf-8");

      const delayMs = Number(reqUrl.searchParams.get("delayMs") ?? "0");
      if (Number.isFinite(delayMs) && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      res.statusCode = 200;
      res.end(fs.readFileSync(resolved));
    } catch {
      res.statusCode = 500;
      res.end("Server error");
    }
  });

  await bindGymServer(server);
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Failed to bind Gym server");

  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

async function bindGymServer(server: http.Server): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < SAFE_GYM_PORT_ATTEMPTS; attempt += 1) {
    const port = SAFE_GYM_PORT_START + attempt;

    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: NodeJS.ErrnoException) => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          server.off("error", onError);
          resolve();
        };

        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, "127.0.0.1");
      });
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error("Failed to bind Gym server to a safe local port");
}

export async function getGymBaseUrl(
  gymRoot: string
): Promise<{ baseUrl: string; gym: GymServerHandle | null }> {
  const override = getGymBaseUrlOverride();
  if (override) {
    return { baseUrl: override, gym: null };
  }

  const gym = await startGymServer(gymRoot);
  return { baseUrl: gym.baseUrl, gym };
}
