import {
  chromium,
  expect,
  type BrowserContext,
  type Locator,
  type Page,
  type Route,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { waitForNavSentinelBridge } from "./extension_test_utils";
import {
  startProvingGroundEgressFence,
  type ProvingGroundEgressAttempt,
} from "./proving_ground_fake_sink";

export type ReplayDocument = {
  url: string;
  bytes: Buffer;
};

export type ProbeType = "pointerdown" | "click" | "submit" | "keydown";

export type ProbeExpectation = {
  type: ProbeType;
  target: Locator;
};

export const CORPUS_RECEIPT_SETTLE_MS = 500;

export type NativeExerciseResult =
  | {
      kind: "none";
      receiptBefore: null;
      getQueryPathBound: false;
    }
  | {
      kind: "form" | "link";
      receiptBefore: number;
      getQueryPathBound: boolean;
    };

type Probe = {
  page: Page;
  type: ProbeType;
  target: string;
  trusted: boolean;
};

type ActiveSource = {
  document: ReplayDocument;
  page: Page;
  consumed: boolean;
};

type ArmedReceipt = {
  url: URL;
  method: "GET" | "POST";
  source: Page;
  allowPopup: boolean;
  getPathOnly: boolean;
  consumed: boolean;
  popup: Page | null;
};

export class CorpusReplayInvalid extends Error {
  constructor(public readonly code: string) {
    super(`TEST_INVALID:${code}`);
    this.name = "CorpusReplayInvalid";
  }
}

/**
 * Static replay deliberately blocks snapshot JavaScript and every resource
 * request. Forms may attempt a first-hop HTTP(S) navigation only because the
 * context route and empty-allowlist proxy fail closed around that harm oracle.
 */
const STATIC_REPLAY_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "form-action http: https:",
].join("; ");

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class CorpusReplayHarness {
  readonly routeHits = new Map<string, number>();
  readonly receipts: Array<{ url: string; method: "GET" | "POST" }> = [];

  private invalid: string | null = null;
  private source: ActiveSource | null = null;
  private arm: ArmedReceipt | null = null;
  private probes: Probe[] = [];
  private readonly observedPages = new WeakSet<Page>();
  private readonly probeBinding =
    `__navsentinelCorpusProbe_${randomUUID().replaceAll("-", "")}`;

  private constructor(
    readonly context: BrowserContext,
    readonly egressAttempts: ProvingGroundEgressAttempt[],
    private readonly closeFence: () => Promise<void>,
    private readonly userDataDir: string,
  ) {}

  static async start(extensionPath: string): Promise<CorpusReplayHarness> {
    if (!fs.existsSync(extensionPath)) {
      throw new CorpusReplayInvalid("extension_build_missing");
    }

    const attempts: ProvingGroundEgressAttempt[] = [];
    const fence = await startProvingGroundEgressFence(attempts, new Set());
    const userDataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "navsentinel-corpus-replay-"),
    );
    let context: BrowserContext | null = null;

    try {
      context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        timeout: 60_000,
        proxy: { server: fence.proxyServer },
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

      const harness = new CorpusReplayHarness(
        context,
        attempts,
        fence.close,
        userDataDir,
      );

      await context.exposeBinding(
        harness.probeBinding,
        (source, value: unknown) => {
          harness.recordProbe(source.page, value);
        },
      );
      await context.addInitScript((binding) => {
        const targetKey = (element: Element | null): string => {
          if (!element) return "";
          const parts: string[] = [];
          for (
            let node: Element | null = element;
            node;
            node = node.parentElement
          ) {
            const siblings = node.parentElement
              ? Array.from(node.parentElement.children)
              : [node];
            parts.unshift(`${node.tagName}:${siblings.indexOf(node)}`);
          }
          return parts.join("/");
        };

        for (const type of [
          "pointerdown",
          "click",
          "submit",
          "keydown",
        ] as const) {
          window.addEventListener(
            type,
            (event) => {
              const send = (
                window as unknown as Record<
                  string,
                  ((record: unknown) => Promise<void>) | undefined
                >
              )[binding];
              if (!send) {
                throw new Error("TEST_INVALID:probe_binding_missing");
              }
              void send({
                type,
                target: targetKey(
                  event.target instanceof Element ? event.target : null,
                ),
                trusted: event.isTrusted,
              });
            },
            true,
          );
        }
      }, harness.probeBinding);

      await context.route("**/*", async (route) => {
        await harness.handleRoute(route);
      });

      return harness;
    } catch (error) {
      await context?.close().catch(() => {});
      await fence.close().catch(() => {});
      fs.rmSync(userDataDir, { recursive: true, force: true });
      throw error;
    }
  }

  private fail(code: string): void {
    this.invalid ??= code;
  }

  private recordProbe(page: Page, value: unknown): void {
    const record = value as Partial<Omit<Probe, "page">>;
    if (
      !record ||
      !["pointerdown", "click", "submit", "keydown"].includes(
        record.type ?? "",
      ) ||
      typeof record.target !== "string" ||
      typeof record.trusted !== "boolean"
    ) {
      this.fail("probe_payload_invalid");
      return;
    }
    this.probes.push({
      page,
      type: record.type as ProbeType,
      target: record.target,
      trusted: record.trusted,
    });
  }

  private observe(page: Page): void {
    if (this.observedPages.has(page)) return;
    this.observedPages.add(page);
    page.on("pageerror", () => this.fail("page_error"));
    page.on("dialog", (dialog) => {
      this.fail("unexpected_dialog");
      void dialog.dismiss().catch(() => {});
    });
    page.on("popup", (popup) => {
      void this.observeNewPage(popup).catch(() => {
        this.fail("popup_observer_failure");
        void popup.close().catch(() => {});
      });
    });
  }

  private async observeNewPage(page: Page): Promise<void> {
    const arm = this.arm;
    const opener = await page.opener().catch(() => null);
    if (
      !arm?.allowPopup ||
      (arm.popup !== null && arm.popup !== page) ||
      opener !== arm.source
    ) {
      this.fail("unexpected_popup");
      await page.close().catch(() => {});
      return;
    }

    arm.popup = page;
    this.observe(page);
    if (arm.consumed) {
      await page.close().catch(() => {});
    }
  }

  private async pageAllowedForReceipt(
    page: Page,
    arm: ArmedReceipt,
  ): Promise<boolean> {
    if (page === arm.source) return true;
    if (!arm.allowPopup) return false;
    if (page === arm.popup) return true;
    if (arm.popup) return false;

    const opener = await page.opener().catch(() => null);
    if (opener !== arm.source) return false;
    arm.popup = page;
    this.observe(page);
    return true;
  }

  private async handleRoute(route: Route): Promise<void> {
    try {
      const request = route.request();
      const rawUrl = request.url();
      if (!rawUrl.startsWith("http://") && !rawUrl.startsWith("https://")) {
        await route.continue();
        return;
      }
      if (this.invalid) {
        await route.abort("blockedbyclient");
        return;
      }

      let page: Page | null = null;
      let isMainNavigation = false;
      if (request.isNavigationRequest()) {
        try {
          const frame = request.frame();
          page = frame.page();
          isMainNavigation = frame === page.mainFrame();
        } catch {
          // Chromium exposes the first request for a new popup before its
          // Page/Frame exists. It may be accepted provisionally only by the
          // exact, one-use popup arm below; the popup event must still prove
          // the source opener before the run can use the receipt.
          isMainNavigation = true;
        }
      }
      const source = this.source;

      if (
        source &&
        !source.consumed &&
        page === source.page &&
        isMainNavigation &&
        request.method() === "GET" &&
        rawUrl === source.document.url
      ) {
        source.consumed = true;
        this.routeHits.set(
          rawUrl,
          (this.routeHits.get(rawUrl) ?? 0) + 1,
        );
        await route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          headers: {
            "cache-control": "no-store",
            "content-security-policy": STATIC_REPLAY_CSP,
            "x-content-type-options": "nosniff",
          },
          body: source.document.bytes,
        });
        return;
      }

      const arm = this.arm;
      let destination: URL;
      try {
        destination = new URL(rawUrl);
      } catch {
        this.fail("route_request_invalid");
        await route.abort("blockedbyclient");
        return;
      }

      const pageAllowed = arm
        ? page
          ? await this.pageAllowedForReceipt(page, arm)
          : arm.allowPopup && arm.popup === null
        : false;
      const destinationMatches = arm?.getPathOnly
        ? destination.origin === arm.url.origin &&
          destination.pathname === arm.url.pathname
        : destination.href === arm?.url.href;

      if (
        arm &&
        !arm.consumed &&
        pageAllowed &&
        isMainNavigation &&
        request.method() === arm.method &&
        destinationMatches
      ) {
        arm.consumed = true;
        this.receipts.push({
          url: rawUrl,
          method: request.method() as "GET" | "POST",
        });
        await route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          headers: {
            "cache-control": "no-store",
            "content-security-policy": STATIC_REPLAY_CSP,
            "x-content-type-options": "nosniff",
          },
          body: "<!doctype html><title>Inert corpus harm receipt</title>",
        });
        if (page && page !== arm.source) {
          await page.close().catch(() => {});
        }
        return;
      }

      this.fail("unexpected_page_request");
      await route.abort("blockedbyclient");
    } catch {
      this.fail("route_failure");
      await route.abort("blockedbyclient").catch(() => {});
    }
  }

  async open(document: ReplayDocument): Promise<Page> {
    let replayUrl: URL;
    try {
      replayUrl = new URL(document.url);
    } catch {
      throw new CorpusReplayInvalid("replay_url_invalid");
    }
    if (
      (replayUrl.protocol !== "http:" && replayUrl.protocol !== "https:") ||
      replayUrl.username ||
      replayUrl.password ||
      replayUrl.hash ||
      replayUrl.href !== document.url
    ) {
      throw new CorpusReplayInvalid("replay_url_not_canonical");
    }

    this.source = null;
    this.arm = null;
    this.probes = [];
    const page = await this.context.newPage();
    this.observe(page);
    this.source = { document, page, consumed: false };

    try {
      await page.goto(document.url, {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });
    } catch {
      if (!this.invalid) this.fail("source_route_miss");
      this.throwIfInvalid();
    }
    if (page.url() !== document.url || !this.source.consumed) {
      this.fail("source_route_miss");
    }
    try {
      await waitForNavSentinelBridge(page);
    } catch {
      this.fail("bridge_not_ready");
    }
    this.throwIfInvalid();
    return page;
  }

  armReceipt(
    page: Page,
    destination: string,
    method: "GET" | "POST",
    options: { allowPopup?: boolean; getPathOnly?: boolean } = {},
  ): number {
    this.throwIfInvalid();
    if (page !== this.source?.page || page.isClosed()) {
      throw new CorpusReplayInvalid("receipt_source_invalid");
    }
    if (this.arm && !this.arm.consumed) {
      throw new CorpusReplayInvalid("receipt_already_armed");
    }

    let url: URL;
    try {
      url = new URL(destination);
    } catch {
      throw new CorpusReplayInvalid("receipt_destination_invalid");
    }
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.hash ||
      (options.getPathOnly === true && method !== "GET")
    ) {
      throw new CorpusReplayInvalid("receipt_destination_invalid");
    }

    const receiptBefore = this.receipts.length;
    this.arm = {
      url,
      method,
      source: page,
      allowPopup: options.allowPopup === true,
      getPathOnly: options.getPathOnly === true,
      consumed: false,
      popup: null,
    };
    return receiptBefore;
  }

  private async targetKey(locator: Locator): Promise<string> {
    return locator.evaluate((element) => {
      const parts: string[] = [];
      for (
        let node: Element | null = element;
        node;
        node = node.parentElement
      ) {
        const siblings = node.parentElement
          ? Array.from(node.parentElement.children)
          : [node];
        parts.unshift(`${node.tagName}:${siblings.indexOf(node)}`);
      }
      return parts.join("/");
    });
  }

  async activate(
    page: Page,
    expectations: readonly ProbeExpectation[],
    action: () => Promise<void>,
  ): Promise<void> {
    if (page !== this.source?.page || page.isClosed() || !this.arm) {
      throw new CorpusReplayInvalid("input_unavailable");
    }

    const expected = await Promise.all(
      expectations.map(async (entry) => ({
        type: entry.type,
        target: await this.targetKey(entry.target),
      })),
    );
    if (expected.some((entry) => !entry.target)) {
      throw new CorpusReplayInvalid("input_unavailable");
    }
    const probeBefore = this.probes.length;

    try {
      await action();
    } catch {
      if (!this.invalid) this.fail("native_input_failed");
      this.throwIfInvalid();
    }

    for (const entry of expected) {
      try {
        await expect
          .poll(
            () =>
              this.probes.slice(probeBefore).some(
                (probe) =>
                  probe.page === page &&
                  probe.type === entry.type &&
                  probe.target === entry.target &&
                  probe.trusted,
              ),
            { timeout: 3_000 },
          )
          .toBe(true);
      } catch {
        this.fail("trusted_activation_missing");
      }
    }
    this.throwIfInvalid();
  }

  async awaitTerminal(
    receiptBefore: number,
    protectedNow: () => Promise<boolean>,
  ): Promise<boolean> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      this.throwIfInvalid();
      if (
        this.receipts.length > receiptBefore &&
        (!this.arm?.allowPopup || this.arm.popup !== null)
      ) {
        // Event persistence is asynchronous. Keep the receipt visible while
        // late/post-commit product signals settle before the caller scores it.
        await delay(CORPUS_RECEIPT_SETTLE_MS);
        this.throwIfInvalid();
        return true;
      }
      if (await protectedNow()) {
        // A protection signal must remain ahead of the first-hop receipt. This
        // dwell catches a signal that fired but failed to stop navigation.
        await delay(500);
        this.throwIfInvalid();
        const harmReached = this.receipts.length > receiptBefore;
        if (!harmReached) this.arm = null;
        return harmReached;
      }
      await delay(100);
    }

    throw new CorpusReplayInvalid("terminal_state_missing");
  }

  throwIfInvalid(): void {
    if (this.invalid) throw new CorpusReplayInvalid(this.invalid);
  }

  async close(): Promise<void> {
    try {
      await this.context.close();
    } finally {
      try {
        await this.closeFence();
      } finally {
        fs.rmSync(this.userDataDir, { recursive: true, force: true });
      }
    }
  }
}

async function isUsable(locator: Locator): Promise<boolean> {
  try {
    return (await locator.isVisible()) && (await locator.isEnabled());
  } catch {
    return false;
  }
}

async function prepareForm(form: Locator): Promise<boolean> {
  const inputs = form.locator(
    'input[type="password"], input[type="email"], input[type="text"], input[type="search"], input[type="tel"], input[type="url"], input[type="number"], input:not([type]), textarea',
  );
  const hasUnsupportedInvalidControl = await form.evaluate((element) => {
    if (!(element instanceof HTMLFormElement)) return true;
    const supportedInputTypes = new Set([
      "password",
      "email",
      "text",
      "search",
      "tel",
      "url",
      "number",
    ]);
    return Array.from(element.elements).some((control) => {
      if (
        !(
          control instanceof HTMLInputElement ||
          control instanceof HTMLTextAreaElement ||
          control instanceof HTMLSelectElement
        ) ||
        !control.willValidate ||
        control.validity.valid
      ) {
        return false;
      }
      return !(
        control instanceof HTMLTextAreaElement ||
        (control instanceof HTMLInputElement &&
          supportedInputTypes.has(control.type))
      );
    });
  });
  if (hasUnsupportedInvalidControl) return false;

  const fillable: Array<{ locator: Locator; type: string | null }> = [];
  for (let index = 0; index < (await inputs.count()); index += 1) {
    const input = inputs.nth(index);
    const hasUnsupportedConstraint = await input
      .evaluate(
        (element) =>
          ["pattern", "minlength", "maxlength", "min", "max", "step"].some(
            (attribute) => element.hasAttribute(attribute),
          ),
      )
      .catch(() => true);
    if (hasUnsupportedConstraint) return false;
    const needsValue = await input
      .evaluate((element) => {
        if (
          !(
            element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement
          )
        ) {
          return true;
        }
        return element.willValidate && !element.validity.valid;
      })
      .catch(() => true);
    const visible = await input.isVisible().catch(() => false);
    const editable = await input.isEditable().catch(() => false);
    if (needsValue && (!visible || !editable)) return false;
    if (!visible || !editable) continue;
    fillable.push({ locator: input, type: await input.getAttribute("type") });
  }

  for (const { locator: input, type } of fillable) {
    const value =
      type === "email"
        ? "fixture@example.test"
        : type === "url"
          ? "https://fixture.example.test/"
          : type === "number"
            ? "1"
            : type === "tel"
              ? "0000000000"
              : type === "password"
                ? "fixture-password"
                : "fixture";
    try {
      await input.fill(value);
    } catch {
      throw new CorpusReplayInvalid("form_preparation_failed");
    }
  }

  try {
    const valid = await form.evaluate(
      (element) =>
        element instanceof HTMLFormElement &&
        Array.from(element.elements).every((control) => {
          if (
            !(
              control instanceof HTMLInputElement ||
              control instanceof HTMLTextAreaElement ||
              control instanceof HTMLSelectElement ||
              control instanceof HTMLButtonElement
            )
          ) {
            return true;
          }
          return !control.willValidate || control.validity.valid;
        }),
    );
    return valid;
  } catch {
    throw new CorpusReplayInvalid("form_preparation_failed");
  }
}

/**
 * Selects the first eligible credential form, otherwise the first eligible
 * link. Discovery is read-only; preparation and activation use Playwright's
 * native locator APIs. An absent eligible control is explicit, not an error.
 */
export async function exerciseFirstEligibleControl(
  harness: CorpusReplayHarness,
  page: Page,
): Promise<NativeExerciseResult> {
  const forms = page.locator('form:has(input[type="password"])');
  for (let formIndex = 0; formIndex < (await forms.count()); formIndex += 1) {
    const form = forms.nth(formIndex);
    const password = form.locator('input[type="password"]').first();
    if (!(await isUsable(password))) continue;

    const submitters = form.locator(
      'button[type="submit"], input[type="submit"], button:not([type])',
    );
    for (
      let submitIndex = 0;
      submitIndex < (await submitters.count());
      submitIndex += 1
    ) {
      const submitter = submitters.nth(submitIndex);
      if (!(await isUsable(submitter))) continue;

      const detail = await submitter.evaluate((element) => {
        if (
          !(element instanceof HTMLButtonElement) &&
          !(element instanceof HTMLInputElement)
        ) {
          return null;
        }
        const form = element.form;
        if (!form) return null;
        const normalizedMethod = (
          element.formMethod ||
          form.method ||
          "get"
        ).toUpperCase();
        if (normalizedMethod !== "GET" && normalizedMethod !== "POST") {
          return null;
        }
        const method: "GET" | "POST" = normalizedMethod;
        const action = new URL(element.formAction || form.action, document.baseURI);
        action.hash = "";
        const target = element.formTarget || form.target;
        const normalizedTarget = target.trim().toLowerCase();
        const opensPopup =
          normalizedTarget !== "" &&
          !["_self", "_top", "_parent"].includes(normalizedTarget);
        // Form popups cannot carry rel=opener, so this first static runner
        // cannot prove their source identity after Chromium creates the page.
        if (opensPopup) return null;
        return {
          action: action.href,
          method,
          popup: false,
        };
      });
      if (!detail) continue;
      if (!(await prepareForm(form))) continue;

      const receiptBefore = harness.armReceipt(
        page,
        detail.action,
        detail.method,
        {
          allowPopup: detail.popup,
          getPathOnly: detail.method === "GET",
        },
      );
      await harness.activate(
        page,
        [
          { type: "pointerdown", target: submitter },
          { type: "click", target: submitter },
          { type: "submit", target: form },
        ],
        () => submitter.click(),
      );
      return {
        kind: "form",
        receiptBefore,
        getQueryPathBound: detail.method === "GET",
      };
    }
  }

  const links = page.locator("a[href]");
  for (let index = 0; index < (await links.count()); index += 1) {
    const link = links.nth(index);
    if (!(await isUsable(link))) continue;
    const detail = await link.evaluate((element) => {
      if (!(element instanceof HTMLAnchorElement) || element.hasAttribute("download")) {
        return null;
      }
      const destination = new URL(element.href, document.baseURI);
      const current = new URL(document.URL);
      const sameDocument =
        destination.origin === current.origin &&
        destination.pathname === current.pathname &&
        destination.search === current.search &&
        destination.hash !== "";
      if (
        (destination.protocol !== "http:" && destination.protocol !== "https:") ||
        destination.username ||
        destination.password ||
        sameDocument ||
        element.getAttribute("aria-disabled") === "true"
      ) {
        return null;
      }
      destination.hash = "";
      const target = element.target;
      const normalized = target.trim().toLowerCase();
      const opensPopup =
        normalized !== "" &&
        !["_self", "_top", "_parent"].includes(normalized);
      if (opensPopup && !element.relList.contains("opener")) return null;
      return {
        href: destination.href,
        popup: opensPopup,
      };
    });
    if (!detail) continue;

    const receiptBefore = harness.armReceipt(page, detail.href, "GET", {
      allowPopup: detail.popup,
    });
    await harness.activate(
      page,
      [
        { type: "pointerdown", target: link },
        { type: "click", target: link },
      ],
      () => link.click(),
    );
    return { kind: "link", receiptBefore, getQueryPathBound: false };
  }

  return { kind: "none", receiptBefore: null, getQueryPathBound: false };
}
