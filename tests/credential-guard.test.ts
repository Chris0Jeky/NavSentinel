// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../extension/src/shared/storage", () => ({
  getCredentialSettings: vi.fn(),
  getTrustedDomains: vi.fn(),
  addTrustedDomain: vi.fn(),
  appendEvent: vi.fn(),
  appendPromptOutcome: vi.fn(),
  onSuiteSettingsChange: vi.fn(),
}));

vi.mock("../extension/src/shared/domain", () => ({
  computeCredentialRisk: vi.fn(),
  getRegistrableDomain: vi.fn(),
  normalizeHost: vi.fn(),
  recalcSeverity: vi.fn(),
}));

vi.mock("../extension/src/content/ui_toast", () => ({
  showToast: vi.fn(),
}));

vi.mock("../extension/src/content/credential_modal", () => ({
  showCredentialModal: vi.fn(),
}));

vi.mock("../extension/src/content/credential_guard_model", () => ({
  deriveCredentialPasteState: vi.fn(),
  getCredentialReasonLines: vi.fn(),
  isCrossSiteCredentialAction: vi.fn(),
  shouldPromptCredentialSubmit: vi.fn(),
}));

vi.mock("../extension/src/content/content_analyzer", () => ({
  analyzePageContent: vi.fn(),
}));

vi.mock("../extension/src/content/sri_checker", () => ({
  checkSRI: vi.fn(),
}));

import {
  getCredentialSettings,
  getTrustedDomains,
  addTrustedDomain,
  appendEvent,
  appendPromptOutcome,
  onSuiteSettingsChange,
  type SuiteSettings,
} from "../extension/src/shared/storage";
import {
  computeCredentialRisk,
  getRegistrableDomain,
  normalizeHost,
  recalcSeverity,
} from "../extension/src/shared/domain";
import { showToast } from "../extension/src/content/ui_toast";
import { showCredentialModal } from "../extension/src/content/credential_modal";
import {
  deriveCredentialPasteState,
  getCredentialReasonLines,
  isCrossSiteCredentialAction,
  shouldPromptCredentialSubmit,
} from "../extension/src/content/credential_guard_model";
import { analyzePageContent } from "../extension/src/content/content_analyzer";
import { checkSRI } from "../extension/src/content/sri_checker";

const mockGetSettings = vi.mocked(getCredentialSettings);
const mockGetTrusted = vi.mocked(getTrustedDomains);
const mockAddTrusted = vi.mocked(addTrustedDomain);
const mockAppendEvent = vi.mocked(appendEvent);
const mockAppendOutcome = vi.mocked(appendPromptOutcome);
const mockComputeRisk = vi.mocked(computeCredentialRisk);
const mockGetRegDomain = vi.mocked(getRegistrableDomain);
const mockNormalizeHost = vi.mocked(normalizeHost);
const mockRecalcSeverity = vi.mocked(recalcSeverity);
const mockShowToast = vi.mocked(showToast);
const mockShowModal = vi.mocked(showCredentialModal);
const mockShouldPrompt = vi.mocked(shouldPromptCredentialSubmit);
const mockGetReasonLines = vi.mocked(getCredentialReasonLines);
const mockIsCrossSite = vi.mocked(isCrossSiteCredentialAction);
const mockDeriveCredPaste = vi.mocked(deriveCredentialPasteState);
const mockAnalyzeContent = vi.mocked(analyzePageContent);
const mockCheckSRI = vi.mocked(checkSRI);

function stubLocation(url: string): void {
  const parsed = new URL(url);
  Object.defineProperty(window, "location", {
    value: {
      href: parsed.href,
      hostname: parsed.hostname,
      origin: parsed.origin,
      host: parsed.host,
      protocol: parsed.protocol,
      pathname: parsed.pathname,
      search: parsed.search,
      hash: parsed.hash,
    },
    writable: true,
    configurable: true,
  });
}

function createPasswordForm(action?: string): HTMLFormElement {
  const form = document.createElement("form");
  if (action) form.setAttribute("action", action);
  const pw = document.createElement("input");
  pw.type = "password";
  form.appendChild(pw);
  document.body.appendChild(form);
  return form;
}

function createPlainForm(): HTMLFormElement {
  const form = document.createElement("form");
  const input = document.createElement("input");
  input.type = "text";
  form.appendChild(input);
  document.body.appendChild(form);
  return form;
}

function createPasswordInput(): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "password";
  document.body.appendChild(input);
  return input;
}

// Stub/override the form.requestSubmit DOM method (or remove it) for tests
// that exercise the requestSubmit-vs-submit fallback path. Accepts a spy,
// vi.fn(), or undefined.
function stubRequestSubmit(form: HTMLFormElement, value: unknown): void {
  (form as unknown as { requestSubmit: unknown }).requestSubmit = value;
}

// All mocks resolve synchronously so the async handler's microtask chain
// completes within a single macrotask tick. This flush is sufficient because
// no mock introduces real async delays.
async function flushMicrotasks(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

async function dispatchSubmit(form: HTMLFormElement, submitter?: HTMLElement): Promise<Event> {
  const event = new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: submitter ?? null });
  form.dispatchEvent(event);
  await flushMicrotasks();
  return event;
}

async function dispatchPaste(el: HTMLElement): Promise<void> {
  const event = new Event("paste", { bubbles: true });
  el.dispatchEvent(event);
  await flushMicrotasks();
}

function defaultRisk() {
  return {
    score: 30,
    severity: "medium" as "none" | "low" | "medium" | "high",
    reasons: [{ code: "DOMAIN_MISMATCH", label: "Domain mismatch" }],
    page: {
      url: "https://example.com/login",
      host: "example.com",
      registrableDomain: "example.com",
      isHttps: true,
      isTrusted: false,
    },
    action: {
      url: "https://evil.com/collect",
      host: "evil.com",
      registrableDomain: "evil.com",
      isHttps: true,
      isTrusted: false,
    },
    lookalike: null,
  };
}

function defaultConfig() {
  return {
    mode: "smart" as const,
    promptOnUntrustedDomain: true,
    promptOnMediumRisk: true,
    mediumRiskThreshold: 20,
    blockHttpPasswordSubmit: true,
    warnOnPaste: true,
    similarity: { enabled: true, maxDistance: 2 },
  };
}

// Import module under test — registers event listeners on document
import "../extension/src/content/credential_guard";

// The guard registers a settings-change subscription at module load to keep its
// synchronous credential-mode cache fresh (#227.5). Capture that callback now
// (before resetAllMocks clears mock.calls) so tests can drive the cached mode.
const credSettingsCb = vi.mocked(onSuiteSettingsChange).mock.calls[0]?.[0] as
  | ((s: SuiteSettings) => void)
  | undefined;

function setCachedCredMode(mode: string): void {
  credSettingsCb?.({ credential: { mode } } as unknown as SuiteSettings);
}

// Required-field defaults so mock returns satisfy the full result interfaces.
const SRI_BASE = { totalExternal: 0, withSRI: 0, withoutSRI: 0 };
const CONTENT_BASE = {
  brandMismatch: false,
  phishingKitMatch: false,
  suspiciousFormAction: false,
};

describe("credential_guard", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    stubLocation("https://example.com/login");

    mockGetSettings.mockResolvedValue(defaultConfig());
    mockGetTrusted.mockResolvedValue([]);
    mockAddTrusted.mockResolvedValue([]);
    mockAppendEvent.mockResolvedValue(undefined);
    mockAppendOutcome.mockResolvedValue(undefined);
    mockComputeRisk.mockReturnValue(defaultRisk());
    mockGetRegDomain.mockReturnValue("example.com");
    mockNormalizeHost.mockReturnValue("example.com");
    mockRecalcSeverity.mockReturnValue("medium");
    mockIsCrossSite.mockReturnValue(true);
    mockGetReasonLines.mockReturnValue(["Domain mismatch"]);
    mockShouldPrompt.mockReturnValue(true);
    mockShowModal.mockResolvedValue("cancel");
    mockAnalyzeContent.mockReturnValue({ ...CONTENT_BASE, score: 0, reasons: [] });
    mockCheckSRI.mockReturnValue({ ...SRI_BASE, score: 0, reasons: [], totalExternal: 0, withSRI: 0, withoutSRI: 0 });
    // Normalize the module-level credential-mode cache so each test starts from a
    // non-"off" state (resetAllMocks above does not touch module globals).
    setCachedCredMode("smart");
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  describe("handleSubmit", () => {
    it("ignores forms without password fields", async () => {
      const form = createPlainForm();
      await dispatchSubmit(form);

      expect(mockGetSettings).not.toHaveBeenCalled();
    });

    it("ignores disabled password fields", async () => {
      const form = document.createElement("form");
      const pw = document.createElement("input");
      pw.type = "password";
      pw.disabled = true;
      form.appendChild(pw);
      document.body.appendChild(form);

      await dispatchSubmit(form);

      expect(mockGetSettings).not.toHaveBeenCalled();
    });

    it("guards a form whose first password input is disabled but a later one is enabled (#227.2)", async () => {
      const form = document.createElement("form");
      const decoy = document.createElement("input");
      decoy.type = "password";
      decoy.disabled = true;
      const real = document.createElement("input");
      real.type = "password";
      real.name = "pw";
      form.appendChild(decoy);
      form.appendChild(real);
      document.body.appendChild(form);

      const event = await dispatchSubmit(form);

      expect(event.defaultPrevented).toBe(true);
      expect(mockComputeRisk).toHaveBeenCalled();
    });

    it("prevents default and stops propagation on password form", async () => {
      const form = createPasswordForm();
      const event = await dispatchSubmit(form);

      expect(event.defaultPrevented).toBe(true);
    });

    it("allows submit when credential mode is off", async () => {
      mockGetSettings.mockResolvedValue({ ...defaultConfig(), mode: "off" });
      const form = createPasswordForm();
      const requestSubmitSpy = vi.fn();
      stubRequestSubmit(form, requestSubmitSpy);

      await dispatchSubmit(form);

      expect(mockComputeRisk).not.toHaveBeenCalled();
      expect(requestSubmitSpy).toHaveBeenCalled();
    });

    it("allows submit when shouldPromptCredentialSubmit returns false", async () => {
      mockShouldPrompt.mockReturnValue(false);
      const form = createPasswordForm();
      const requestSubmitSpy = vi.fn();
      stubRequestSubmit(form, requestSubmitSpy);

      await dispatchSubmit(form);

      expect(mockShowModal).not.toHaveBeenCalled();
      expect(requestSubmitSpy).toHaveBeenCalled();
    });

    it("shows modal when prompt is required", async () => {
      const form = createPasswordForm("https://evil.com/collect");
      await dispatchSubmit(form);

      expect(mockShowModal).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Credential submit blocked",
          outsideAction: "cancel",
        }),
      );
    });

    it("logs cred_submit_prompt event before showing modal", async () => {
      const form = createPasswordForm();
      await dispatchSubmit(form);

      expect(mockAppendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "cred_submit_prompt",
          site: "example.com",
        }),
      );
    });

    it("handles cancel choice — does not resume submit", async () => {
      mockShowModal.mockResolvedValue("cancel");
      const form = createPasswordForm();
      const requestSubmitSpy = vi.fn();
      stubRequestSubmit(form, requestSubmitSpy);

      await dispatchSubmit(form);

      expect(requestSubmitSpy).not.toHaveBeenCalled();
      // P5-C1 (#238): cred records now carry the action host as destDomain
      // (consistency with nav records). The fixture's action.host is "evil.com".
      expect(mockAppendOutcome).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: "cancel", type: "cred", destDomain: "evil.com" }),
      );
    });

    it("preserves the action host (subdomain) in destDomain, not the registrable domain", async () => {
      // #249 review: a same-registrable-domain host mismatch must not be hidden.
      const risk = defaultRisk();
      risk.action.host = "login.evil.com";
      risk.action.registrableDomain = "evil.com";
      mockComputeRisk.mockReturnValue(risk);
      mockShowModal.mockResolvedValue("cancel");
      const form = createPasswordForm();
      stubRequestSubmit(form, vi.fn());

      await dispatchSubmit(form);

      expect(mockAppendOutcome).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: "cancel", type: "cred", destDomain: "login.evil.com" }),
      );
    });

    it("handles proceed_once choice — resumes submit", async () => {
      mockShowModal.mockResolvedValue("proceed_once");
      const form = createPasswordForm();
      const requestSubmitSpy = vi.fn();
      stubRequestSubmit(form, requestSubmitSpy);

      await dispatchSubmit(form);

      expect(requestSubmitSpy).toHaveBeenCalled();
      expect(mockAppendOutcome).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: "allow_once" }),
      );
    });

    it("handles trust_site choice — adds trusted domain and resumes", async () => {
      const risk = defaultRisk();
      risk.page.registrableDomain = "example.com";
      mockComputeRisk.mockReturnValue(risk);
      mockShowModal.mockResolvedValue("trust_site");

      const form = createPasswordForm();
      const requestSubmitSpy = vi.fn();
      stubRequestSubmit(form, requestSubmitSpy);

      await dispatchSubmit(form);

      expect(mockAddTrusted).toHaveBeenCalledWith("example.com");
      expect(mockAppendEvent).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "cred_trust_domain", site: "example.com" }),
      );
      expect(requestSubmitSpy).toHaveBeenCalled();
    });

    it("handles trust_dest choice — adds destination domain and resumes", async () => {
      const risk = defaultRisk();
      risk.action.registrableDomain = "evil.com";
      mockComputeRisk.mockReturnValue(risk);
      mockShowModal.mockResolvedValue("trust_dest");

      const form = createPasswordForm();
      const requestSubmitSpy = vi.fn();
      stubRequestSubmit(form, requestSubmitSpy);

      await dispatchSubmit(form);

      expect(mockAddTrusted).toHaveBeenCalledWith("evil.com");
      expect(mockAppendEvent).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "cred_trust_domain", site: "evil.com" }),
      );
      expect(requestSubmitSpy).toHaveBeenCalled();
    });

    it("boosts risk score with content analysis when page is untrusted", async () => {
      const risk = defaultRisk();
      risk.page.isTrusted = false;
      risk.score = 30;
      mockComputeRisk.mockReturnValue(risk);
      mockAnalyzeContent.mockReturnValue({ ...CONTENT_BASE,
        score: 25,
        reasons: ["Fake login form detected"],
      });
      mockRecalcSeverity.mockReturnValue("high");

      const form = createPasswordForm();
      await dispatchSubmit(form);

      expect(mockAnalyzeContent).toHaveBeenCalled();
      expect(risk.score).toBe(55);
      expect(risk.reasons).toContainEqual(
        expect.objectContaining({ code: "CONTENT_FP" }),
      );
    });

    it("skips content analysis when page is trusted", async () => {
      const risk = defaultRisk();
      risk.page.isTrusted = true;
      mockComputeRisk.mockReturnValue(risk);

      const form = createPasswordForm();
      await dispatchSubmit(form);

      expect(mockAnalyzeContent).not.toHaveBeenCalled();
    });

    it("adds SRI analysis when page is untrusted", async () => {
      const risk = defaultRisk();
      risk.page.isTrusted = false;
      risk.score = 30;
      mockComputeRisk.mockReturnValue(risk);
      mockCheckSRI.mockReturnValue({ ...SRI_BASE,
        score: 10,
        reasons: ["Missing SRI on scripts"],
      });

      const form = createPasswordForm();
      await dispatchSubmit(form);

      expect(mockCheckSRI).toHaveBeenCalled();
      expect(risk.reasons).toContainEqual(
        expect.objectContaining({ code: "SRI_MISSING_ON_CREDENTIAL_PAGE" }),
      );
    });

    it("applies SRI bonus (negative score) for good SRI", async () => {
      const risk = defaultRisk();
      risk.page.isTrusted = false;
      risk.score = 30;
      mockComputeRisk.mockReturnValue(risk);
      mockCheckSRI.mockReturnValue({ ...SRI_BASE,
        score: -5,
        reasons: ["All scripts have SRI"],
      });

      const form = createPasswordForm();
      await dispatchSubmit(form);

      expect(risk.score).toBe(25);
      expect(risk.reasons).toContainEqual(
        expect.objectContaining({ code: "SRI_PRESENT_ON_CREDENTIAL_PAGE" }),
      );
    });

    it("skips SRI check when page is trusted", async () => {
      const risk = defaultRisk();
      risk.page.isTrusted = true;
      mockComputeRisk.mockReturnValue(risk);

      const form = createPasswordForm();
      await dispatchSubmit(form);

      expect(mockCheckSRI).not.toHaveBeenCalled();
    });

    it("caps risk score at 100 when content analysis + SRI push it higher", async () => {
      const risk = defaultRisk();
      risk.page.isTrusted = false;
      risk.score = 80;
      mockComputeRisk.mockReturnValue(risk);
      mockAnalyzeContent.mockReturnValue({ ...CONTENT_BASE, score: 50, reasons: ["Suspicious"] });
      mockCheckSRI.mockReturnValue({ ...SRI_BASE, score: 50, reasons: ["Missing SRI"] });

      const form = createPasswordForm();
      await dispatchSubmit(form);

      expect(risk.score).toBe(100);
    });

    it("clamps risk score floor at 0 when SRI bonus reduces it", async () => {
      const risk = defaultRisk();
      risk.page.isTrusted = false;
      risk.score = 3;
      mockComputeRisk.mockReturnValue(risk);
      mockCheckSRI.mockReturnValue({ ...SRI_BASE, score: -10, reasons: ["SRI present"] });

      const form = createPasswordForm();
      await dispatchSubmit(form);

      expect(risk.score).toBeGreaterThanOrEqual(0);
    });

    it("resolves form action URL relative to location", async () => {
      stubLocation("https://example.com/app/login");
      const form = createPasswordForm("/submit");

      await dispatchSubmit(form);

      expect(mockComputeRisk).toHaveBeenCalledWith(
        expect.objectContaining({
          actionUrl: "https://example.com/submit",
        }),
      );
    });

    it("uses location.href as action URL when form has no action", async () => {
      stubLocation("https://example.com/login");
      const form = createPasswordForm();

      await dispatchSubmit(form);

      expect(mockComputeRisk).toHaveBeenCalledWith(
        expect.objectContaining({
          actionUrl: "https://example.com/login",
        }),
      );
    });

    it("uses location.href for javascript: action URLs", async () => {
      stubLocation("https://example.com/login");
      const form = createPasswordForm("javascript:void(0)");

      await dispatchSubmit(form);

      expect(mockComputeRisk).toHaveBeenCalledWith(
        expect.objectContaining({
          actionUrl: "https://example.com/login",
        }),
      );
    });

    it("resolves data: action URLs without fallback", async () => {
      stubLocation("https://example.com/login");
      const form = createPasswordForm("data:text/html,<h1>phish</h1>");

      await dispatchSubmit(form);

      expect(mockComputeRisk).toHaveBeenCalledWith(
        expect.objectContaining({
          actionUrl: "data:text/html,<h1>phish</h1>",
        }),
      );
    });

    it("assesses the submitter's formaction as the destination (#227.1)", async () => {
      stubLocation("https://bank.example/login");
      const form = createPasswordForm("https://bank.example/login");
      const btn = document.createElement("button");
      btn.type = "submit";
      btn.setAttribute("formaction", "https://evil.example/collect");
      form.appendChild(btn);

      await dispatchSubmit(form, btn);

      expect(mockComputeRisk).toHaveBeenCalledWith(
        expect.objectContaining({ actionUrl: "https://evil.example/collect" }),
      );
    });

    it("falls back to the form action when the submitter has no formaction (#227.1)", async () => {
      stubLocation("https://bank.example/login");
      const form = createPasswordForm("https://bank.example/submit");
      const btn = document.createElement("button");
      btn.type = "submit";
      form.appendChild(btn);

      await dispatchSubmit(form, btn);

      expect(mockComputeRisk).toHaveBeenCalledWith(
        expect.objectContaining({ actionUrl: "https://bank.example/submit" }),
      );
    });

    it("passes submitter through to requestSubmit", async () => {
      mockShowModal.mockResolvedValue("proceed_once");
      const form = createPasswordForm();
      const btn = document.createElement("button");
      btn.type = "submit";
      form.appendChild(btn);
      const requestSubmitSpy = vi.fn();
      stubRequestSubmit(form, requestSubmitSpy);

      await dispatchSubmit(form, btn);

      expect(requestSubmitSpy).toHaveBeenCalledWith(btn);
    });

    it("falls back to form.submit() when requestSubmit is unavailable", async () => {
      mockShowModal.mockResolvedValue("proceed_once");
      const form = createPasswordForm();
      stubRequestSubmit(form, undefined);
      const submitSpy = vi.spyOn(form, "submit").mockImplementation(() => {});

      await dispatchSubmit(form);

      expect(submitSpy).toHaveBeenCalled();
    });

    it("logs cred_submit_allow_once event after allowing submit", async () => {
      mockShowModal.mockResolvedValue("proceed_once");
      const form = createPasswordForm();
      stubRequestSubmit(form, vi.fn());

      await dispatchSubmit(form);

      expect(mockAppendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "cred_submit_allow_once",
          extra: expect.objectContaining({ choice: "proceed_once" }),
        }),
      );
    });

    it("includes trust_site button only when page is untrusted with registrable domain", async () => {
      const risk = defaultRisk();
      risk.page.isTrusted = false;
      risk.page.registrableDomain = "example.com";
      risk.action.registrableDomain = "example.com";
      risk.action.isTrusted = false;
      mockComputeRisk.mockReturnValue(risk);

      const form = createPasswordForm();
      await dispatchSubmit(form);

      const modalSpec = mockShowModal.mock.calls[0]?.[0];
      const actionIds = modalSpec?.actions.map((a) => a.id);
      expect(actionIds).toContain("trust_site");
    });

    it("excludes trust_site button when page is trusted", async () => {
      const risk = defaultRisk();
      risk.page.isTrusted = true;
      mockComputeRisk.mockReturnValue(risk);

      const form = createPasswordForm();
      await dispatchSubmit(form);

      const modalSpec = mockShowModal.mock.calls[0]?.[0];
      const actionIds = modalSpec?.actions.map((a) => a.id);
      expect(actionIds).not.toContain("trust_site");
    });

    it("includes trust_dest button when action domain differs and is untrusted", async () => {
      const risk = defaultRisk();
      risk.page.registrableDomain = "example.com";
      risk.action.registrableDomain = "evil.com";
      risk.action.isTrusted = false;
      mockComputeRisk.mockReturnValue(risk);

      const form = createPasswordForm();
      await dispatchSubmit(form);

      const modalSpec = mockShowModal.mock.calls[0]?.[0];
      const actionIds = modalSpec?.actions.map((a) => a.id);
      expect(actionIds).toContain("trust_dest");
    });

    it("excludes trust_dest button when action domain is same as page", async () => {
      const risk = defaultRisk();
      risk.page.registrableDomain = "example.com";
      risk.action.registrableDomain = "example.com";
      mockComputeRisk.mockReturnValue(risk);

      const form = createPasswordForm();
      await dispatchSubmit(form);

      const modalSpec = mockShowModal.mock.calls[0]?.[0];
      const actionIds = modalSpec?.actions.map((a) => a.id);
      expect(actionIds).not.toContain("trust_dest");
    });

    it("falls back to form.submit() when requestSubmit throws", async () => {
      mockShowModal.mockResolvedValue("proceed_once");
      const form = createPasswordForm();
      stubRequestSubmit(form, vi.fn(() => { throw new Error("requestSubmit failed"); }));
      const submitSpy = vi.spyOn(form, "submit").mockImplementation(() => {});

      await dispatchSubmit(form);

      expect(submitSpy).toHaveBeenCalled();
    });

    it("logs appendPromptOutcome with outcome trust for trust_site choice", async () => {
      const risk = defaultRisk();
      risk.page.registrableDomain = "example.com";
      mockComputeRisk.mockReturnValue(risk);
      mockShowModal.mockResolvedValue("trust_site");

      const form = createPasswordForm();
      stubRequestSubmit(form, vi.fn());
      await dispatchSubmit(form);

      expect(mockAppendOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: "trust",
          domain: "example.com",
          type: "cred",
        }),
      );
    });

    it("logs appendPromptOutcome with outcome trust for trust_dest choice", async () => {
      const risk = defaultRisk();
      risk.action.registrableDomain = "evil.com";
      mockComputeRisk.mockReturnValue(risk);
      mockShowModal.mockResolvedValue("trust_dest");

      const form = createPasswordForm();
      stubRequestSubmit(form, vi.fn());
      await dispatchSubmit(form);

      expect(mockAppendOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: "trust",
          domain: "example.com",
          type: "cred",
        }),
      );
    });

    it("caps content analysis boost at exactly 100 - risk.score", async () => {
      const risk = defaultRisk();
      risk.page.isTrusted = false;
      risk.score = 70;
      mockComputeRisk.mockReturnValue(risk);
      mockAnalyzeContent.mockReturnValue({ ...CONTENT_BASE, score: 50, reasons: ["Suspicious content"] });

      const form = createPasswordForm();
      await dispatchSubmit(form);

      expect(risk.score).toBe(100);
    });

    it("appends multiple content analysis reasons as separate CONTENT_FP entries", async () => {
      const risk = defaultRisk();
      risk.page.isTrusted = false;
      risk.score = 20;
      mockComputeRisk.mockReturnValue(risk);
      mockAnalyzeContent.mockReturnValue({ ...CONTENT_BASE,
        score: 15,
        reasons: ["Fake login", "Suspicious URL", "Hidden iframe"],
      });

      const form = createPasswordForm();
      await dispatchSubmit(form);

      const contentReasons = risk.reasons.filter((r) => r.code === "CONTENT_FP");
      expect(contentReasons).toHaveLength(3);
      expect(contentReasons[0]!.label).toBe("Fake login");
      expect(contentReasons[1]!.label).toBe("Suspicious URL");
      expect(contentReasons[2]!.label).toBe("Hidden iframe");
    });

    it("modal spec includes kv entries, subtitle, and reason lines", async () => {
      const risk = defaultRisk();
      risk.page.registrableDomain = "example.com";
      risk.action.registrableDomain = "evil.com";
      risk.score = 55;
      risk.severity = "high";
      mockComputeRisk.mockReturnValue(risk);
      mockGetReasonLines.mockReturnValue(["Domain mismatch", "Cross-site action"]);

      const form = createPasswordForm();
      await dispatchSubmit(form);

      const modalSpec = mockShowModal.mock.calls[0]![0];
      expect(modalSpec.subtitle).toContain("password");
      expect(modalSpec.kv).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ k: "Page", v: "example.com" }),
          expect.objectContaining({ k: "Destination", v: "evil.com" }),
          expect.objectContaining({ k: "Risk score", v: "55 (high)" }),
        ]),
      );
      expect(modalSpec.reasons).toEqual(["Domain mismatch", "Cross-site action"]);
    });

    it("fails open (resumes submit) and logs when a pre-decision error occurs (#227.4)", async () => {
      // A transient settings/storage error before any decision must not permanently
      // brick a legitimate login; fail open and still record the error.
      mockGetSettings.mockRejectedValue(new Error("storage failed"));
      mockNormalizeHost.mockReturnValue("example.com");

      const form = createPasswordForm();
      const requestSubmitSpy = vi.fn();
      stubRequestSubmit(form, requestSubmitSpy);

      await dispatchSubmit(form);

      expect(requestSubmitSpy).toHaveBeenCalled();
      expect(mockAppendEvent).toHaveBeenCalledTimes(1);
      const errorEvent = mockAppendEvent.mock.calls[0]![0];
      expect(errorEvent.kind).toBe("cred_submit_prompt");
      expect(errorEvent.extra!.error).toBe("storage failed");
      expect(errorEvent).not.toHaveProperty("score");
      expect(errorEvent).not.toHaveProperty("reasons");
      expect(errorEvent).not.toHaveProperty("destHost");
    });

    it("does not interpose when the cached credential mode is off (#227.5)", async () => {
      setCachedCredMode("off");
      const form = createPasswordForm();
      const requestSubmitSpy = vi.fn();
      stubRequestSubmit(form, requestSubmitSpy);

      const event = await dispatchSubmit(form);

      // Disabled guard: the native submit proceeds untouched -- no preventDefault,
      // no async settings read, no synthetic resubmit.
      expect(event.defaultPrevented).toBe(false);
      expect(mockGetSettings).not.toHaveBeenCalled();
      expect(requestSubmitSpy).not.toHaveBeenCalled();
    });

    it("does not bypass the prompt when content analysis throws (#227.4)", async () => {
      // A hostile DOM that makes an analyzer throw must drop the signal, not the
      // guard: the modal must still be shown.
      mockAnalyzeContent.mockImplementation(() => {
        throw new Error("hostile DOM");
      });
      const form = createPasswordForm("https://evil.com/collect");

      await dispatchSubmit(form);

      expect(mockShowModal).toHaveBeenCalled();
    });

    it("blocks the submit when the action changes to a cross-site destination during the prompt (#227.3)", async () => {
      // Assert registrableOf passes a BARE host (not a full URL), so a broken
      // actionHost extractor cannot slip through masked (R2-L5).
      mockGetRegDomain.mockImplementation((h: string) => {
        if (h.includes("/") || h.includes(":")) throw new Error(`getRegistrableDomain got a non-host arg: ${h}`);
        return h.includes("evil") ? "evil.example" : "bank.example";
      });
      stubLocation("https://bank.example/login");
      const form = createPasswordForm("https://bank.example/login");
      const requestSubmitSpy = vi.fn();
      stubRequestSubmit(form, requestSubmitSpy);
      // Mutate the destination while the modal is open, then approve.
      mockShowModal.mockImplementation(async () => {
        form.setAttribute("action", "https://evil.example/collect");
        return "proceed_once";
      });

      await dispatchSubmit(form);

      expect(requestSubmitSpy).not.toHaveBeenCalled();
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining("destination changed") }),
      );
      expect(mockAppendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          extra: expect.objectContaining({ error: "action_mutated_during_prompt" }),
        }),
      );
    });

    it("does NOT block a same-registrable-domain (www->api) action change during the prompt (R1-4)", async () => {
      mockGetRegDomain.mockReturnValue("bank.example"); // every host resolves to the same registrable domain
      stubLocation("https://www.bank.example/login");
      const form = createPasswordForm("https://www.bank.example/login");
      const requestSubmitSpy = vi.fn();
      stubRequestSubmit(form, requestSubmitSpy);
      mockShowModal.mockImplementation(async () => {
        form.setAttribute("action", "https://api.bank.example/login");
        return "proceed_once";
      });

      await dispatchSubmit(form);

      expect(requestSubmitSpy).toHaveBeenCalled(); // benign same-site resolution -> resumed, not blocked
    });

    it("blocks an https->http action downgrade during the prompt (R1-4)", async () => {
      mockGetRegDomain.mockReturnValue("bank.example");
      stubLocation("https://bank.example/login");
      const form = createPasswordForm("https://bank.example/login");
      const requestSubmitSpy = vi.fn();
      stubRequestSubmit(form, requestSubmitSpy);
      mockShowModal.mockImplementation(async () => {
        form.setAttribute("action", "http://bank.example/login");
        return "proceed_once";
      });

      await dispatchSubmit(form);

      expect(requestSubmitSpy).not.toHaveBeenCalled();
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining("destination changed") }),
      );
    });

    it("does not fall back to form.submit() when requestSubmit throws and a formaction was assessed (R1-1)", async () => {
      mockShowModal.mockResolvedValue("proceed_once");
      stubLocation("https://bank.example/login");
      const form = createPasswordForm("https://bank.example/login");
      const btn = document.createElement("button");
      btn.type = "submit";
      btn.setAttribute("formaction", "https://pay.example/checkout");
      form.appendChild(btn);
      // requestSubmit throws (e.g. submitter detached); the unsafe form.submit
      // fallback uses form.action and would ignore the assessed formaction.
      stubRequestSubmit(form, vi.fn(() => { throw new Error("NotFoundError"); }));
      const submitSpy = vi.spyOn(form, "submit").mockImplementation(() => {});

      await dispatchSubmit(form, btn);

      expect(submitSpy).not.toHaveBeenCalled();
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining("could not be completed safely") }),
      );
    });

    it("blocks when the submitter is detached from the form during the prompt (R1-1/2)", async () => {
      mockGetRegDomain.mockReturnValue("bank.example");
      stubLocation("https://bank.example/login");
      const form = createPasswordForm("https://bank.example/login");
      const btn = document.createElement("button");
      btn.type = "submit";
      form.appendChild(btn);
      const requestSubmitSpy = vi.fn();
      stubRequestSubmit(form, requestSubmitSpy);
      mockShowModal.mockImplementation(async () => {
        form.removeChild(btn); // submitter no longer associated with this form
        return "proceed_once";
      });

      await dispatchSubmit(form, btn);

      expect(requestSubmitSpy).not.toHaveBeenCalled();
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining("destination changed") }),
      );
    });

    it("treats an empty formaction as the current document, not the form action (R1-5d)", async () => {
      stubLocation("https://bank.example/login");
      const form = createPasswordForm("https://bank.example/submit");
      const btn = document.createElement("button");
      btn.type = "submit";
      btn.setAttribute("formaction", "");
      form.appendChild(btn);

      await dispatchSubmit(form, btn);

      expect(mockComputeRisk).toHaveBeenCalledWith(
        expect.objectContaining({ actionUrl: "https://bank.example/login" }),
      );
    });

    it("trust-path: a failed trust write still runs the action re-check (no fail-open) (R1-3)", async () => {
      mockGetRegDomain.mockImplementation((h: string) => (h.includes("evil") ? "evil.example" : "bank.example"));
      stubLocation("https://bank.example/login");
      const risk = defaultRisk();
      risk.page.registrableDomain = "bank.example";
      mockComputeRisk.mockReturnValue(risk);
      mockAddTrusted.mockRejectedValue(new Error("storage failed"));
      const form = createPasswordForm("https://bank.example/login");
      const requestSubmitSpy = vi.fn();
      stubRequestSubmit(form, requestSubmitSpy);
      // Mutate to a cross-site destination, then choose trust_site (whose
      // addTrustedDomain rejects). The mutated destination must still be blocked
      // rather than silently resumed via the fail-open catch.
      mockShowModal.mockImplementation(async () => {
        form.setAttribute("action", "https://evil.example/collect");
        return "trust_site";
      });

      await dispatchSubmit(form);

      expect(requestSubmitSpy).not.toHaveBeenCalled();
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining("destination changed") }),
      );
    });

    it("trust-path: blocks when the action is swapped DURING the async trust write (TOCTOU) (#339)", async () => {
      // The pre-resume re-check happens BEFORE the await addTrustedDomain. Page JS that swaps
      // the action while that storage write is in flight would otherwise reach resumeSubmit with
      // an unassessed destination. A second re-check immediately before resume must catch it.
      mockGetRegDomain.mockImplementation((h: string) => (h.includes("evil") ? "evil.example" : "bank.example"));
      stubLocation("https://bank.example/login");
      const risk = defaultRisk();
      risk.page.registrableDomain = "bank.example";
      mockComputeRisk.mockReturnValue(risk);
      const form = createPasswordForm("https://bank.example/login");
      const requestSubmitSpy = vi.fn();
      stubRequestSubmit(form, requestSubmitSpy);
      mockShowModal.mockResolvedValue("trust_site");
      // The action is unchanged at the first (pre-trust-write) re-check; it is swapped only
      // once the trust write is awaited — i.e. strictly after the existing gate.
      mockAddTrusted.mockImplementation(async () => {
        form.setAttribute("action", "https://evil.example/collect");
        return [];
      });

      await dispatchSubmit(form);

      expect(requestSubmitSpy).not.toHaveBeenCalled();
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining("destination changed") }),
      );
    });

    it("trust_dest path: blocks when the action is swapped DURING the async trust write (TOCTOU) (#339)", async () => {
      // Same TOCTOU as the trust_site test, but via the trust_dest await branch (line ~464),
      // which the new second gate must also cover.
      mockGetRegDomain.mockImplementation((h: string) => (h.includes("evil") ? "evil.example" : "bank.example"));
      stubLocation("https://bank.example/login");
      const risk = defaultRisk();
      risk.page.registrableDomain = "bank.example";
      risk.action.registrableDomain = "bank.example";
      mockComputeRisk.mockReturnValue(risk);
      const form = createPasswordForm("https://bank.example/login");
      const requestSubmitSpy = vi.fn();
      stubRequestSubmit(form, requestSubmitSpy);
      mockShowModal.mockResolvedValue("trust_dest");
      mockAddTrusted.mockImplementation(async () => {
        form.setAttribute("action", "https://evil.example/collect");
        return [];
      });

      await dispatchSubmit(form);

      expect(requestSubmitSpy).not.toHaveBeenCalled();
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining("destination changed") }),
      );
    });

    it("trust-path: a showToast fault in the SECOND gate fails closed (decided=true, no resume) (#339)", async () => {
      // If blockIfActionMutated throws (showToast faults) in the post-trust-write gate, the
      // exception unwinds to the outer catch where decided=true must prevent a fail-open resume.
      mockGetRegDomain.mockImplementation((h: string) => (h.includes("evil") ? "evil.example" : "bank.example"));
      stubLocation("https://bank.example/login");
      const risk = defaultRisk();
      risk.page.registrableDomain = "bank.example";
      mockComputeRisk.mockReturnValue(risk);
      const form = createPasswordForm("https://bank.example/login");
      const requestSubmitSpy = vi.fn();
      stubRequestSubmit(form, requestSubmitSpy);
      mockShowModal.mockResolvedValue("trust_site");
      mockAddTrusted.mockImplementation(async () => {
        form.setAttribute("action", "https://evil.example/collect");
        return [];
      });
      mockShowToast.mockImplementation(() => { throw new Error("toast boom"); });

      await dispatchSubmit(form);

      expect(requestSubmitSpy).not.toHaveBeenCalled();
    });

    it("blocks a silent-path submit when the action changes cross-site before resume (R1-5a)", async () => {
      mockShouldPrompt.mockReturnValue(false); // silent pass, no modal
      mockGetRegDomain.mockImplementation((h: string) => (h.includes("evil") ? "evil.example" : "bank.example"));
      stubLocation("https://bank.example/login");
      const form = createPasswordForm("https://bank.example/login");
      const requestSubmitSpy = vi.fn();
      stubRequestSubmit(form, requestSubmitSpy);
      // Mutate the action while the cred_form_evaluated append is in flight.
      mockAppendEvent.mockImplementation(async (e: { kind: string }) => {
        if (e.kind === "cred_form_evaluated") form.setAttribute("action", "https://evil.example/collect");
        return undefined;
      });

      await dispatchSubmit(form);

      expect(mockShowModal).not.toHaveBeenCalled(); // silent branch, no prompt
      expect(requestSubmitSpy).not.toHaveBeenCalled();
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining("destination changed") }),
      );
    });

    it("does not bypass the prompt when the SRI check throws (R1-5b)", async () => {
      mockCheckSRI.mockImplementation(() => {
        throw new Error("hostile DOM");
      });
      const form = createPasswordForm("https://evil.com/collect");

      await dispatchSubmit(form);

      expect(mockShowModal).toHaveBeenCalled();
    });

    it("guards a form whose only password field is associated via the form= attribute (R1-5c)", async () => {
      const form = document.createElement("form");
      form.id = "loginform";
      document.body.appendChild(form);
      const pw = document.createElement("input");
      pw.type = "password";
      pw.setAttribute("form", "loginform"); // associated, not a descendant
      document.body.appendChild(pw);

      const event = await dispatchSubmit(form);

      expect(event.defaultPrevented).toBe(true);
      expect(mockComputeRisk).toHaveBeenCalled();
    });

    it("resumes exactly once even when the post-resume append rejects (R2-M2)", async () => {
      mockShowModal.mockResolvedValue("proceed_once");
      stubLocation("https://bank.example/login");
      const form = createPasswordForm("https://bank.example/login");
      const requestSubmitSpy = vi.fn();
      stubRequestSubmit(form, requestSubmitSpy);
      // The trailing cred_submit_allow_once append rejects; the .catch guard must
      // swallow it so the fail-open catch never re-enters and double-submits.
      mockAppendEvent.mockImplementation(async (e: { kind: string }) => {
        if (e.kind === "cred_submit_allow_once") throw new Error("post-resume boom");
        return undefined;
      });

      await dispatchSubmit(form);

      expect(requestSubmitSpy).toHaveBeenCalledTimes(1);
    });

    it("does not resume after an intentional block even if a post-decision op throws (R2-M2)", async () => {
      mockGetRegDomain.mockImplementation((h: string) => (h.includes("evil") ? "evil.example" : "bank.example"));
      stubLocation("https://bank.example/login");
      const form = createPasswordForm("https://bank.example/login");
      const requestSubmitSpy = vi.fn();
      stubRequestSubmit(form, requestSubmitSpy);
      // showToast (inside blockIfActionMutated, after decided=true) throws and
      // unwinds to the fail-open catch, which must NOT override the block.
      mockShowToast.mockImplementation(() => { throw new Error("toast boom"); });
      mockShowModal.mockImplementation(async () => {
        form.setAttribute("action", "https://evil.example/collect");
        return "proceed_once";
      });

      await dispatchSubmit(form);

      expect(requestSubmitSpy).not.toHaveBeenCalled();
    });

    it("blocks when the submitter is re-pointed to another form during the prompt (R2-M3)", async () => {
      mockGetRegDomain.mockReturnValue("bank.example");
      stubLocation("https://bank.example/login");
      const form = document.createElement("form");
      form.id = "loginform";
      form.setAttribute("action", "https://bank.example/login");
      const pw = document.createElement("input");
      pw.type = "password";
      form.appendChild(pw);
      document.body.appendChild(form);
      const attacker = document.createElement("form");
      attacker.id = "attacker";
      attacker.setAttribute("action", "https://bank.example/login");
      document.body.appendChild(attacker);
      // Submitter associated to the login form via form= (not a descendant), then
      // re-pointed to the attacker form during the prompt.
      const btn = document.createElement("button");
      btn.type = "submit";
      btn.setAttribute("form", "loginform");
      document.body.appendChild(btn);
      const requestSubmitSpy = vi.fn();
      stubRequestSubmit(form, requestSubmitSpy);
      mockShowModal.mockImplementation(async () => {
        btn.setAttribute("form", "attacker");
        return "proceed_once";
      });

      await dispatchSubmit(form, btn);

      expect(requestSubmitSpy).not.toHaveBeenCalled();
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining("destination changed") }),
      );
    });

    it("blocks even if the action_mutated event append rejects (R2-NIT2)", async () => {
      mockGetRegDomain.mockImplementation((h: string) => (h.includes("evil") ? "evil.example" : "bank.example"));
      stubLocation("https://bank.example/login");
      const form = createPasswordForm("https://bank.example/login");
      const requestSubmitSpy = vi.fn();
      stubRequestSubmit(form, requestSubmitSpy);
      mockAppendEvent.mockImplementation(async (e: { extra?: { error?: string } }) => {
        if (e.extra?.error === "action_mutated_during_prompt") throw new Error("log boom");
        return undefined;
      });
      mockShowModal.mockImplementation(async () => {
        form.setAttribute("action", "https://evil.example/collect");
        return "proceed_once";
      });

      await dispatchSubmit(form);

      expect(requestSubmitSpy).not.toHaveBeenCalled();
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining("destination changed") }),
      );
    });

    it("registers a settings-change subscription at module load (R2-L6)", () => {
      expect(credSettingsCb).toBeTypeOf("function");
    });

    it("fail-open catch re-checks the destination and blocks a swapped action (R2-M1)", async () => {
      mockGetRegDomain.mockImplementation((h: string) => (h.includes("evil") ? "evil.example" : "bank.example"));
      stubLocation("https://bank.example/login");
      const form = createPasswordForm("https://bank.example/login");
      const requestSubmitSpy = vi.fn();
      stubRequestSubmit(form, requestSubmitSpy);
      // Modal rejects (post-assessment infra fault) while the action is swapped.
      mockShowModal.mockImplementation(async () => {
        form.setAttribute("action", "https://evil.example/collect");
        throw new Error("modal boom");
      });

      await dispatchSubmit(form);

      expect(requestSubmitSpy).not.toHaveBeenCalled();
    });

    it("fail-open catch still resumes when nothing was assessed (settings read rejects) (R2-M1)", async () => {
      mockGetSettings.mockRejectedValue(new Error("storage failed"));
      mockNormalizeHost.mockReturnValue("example.com");
      const form = createPasswordForm("https://bank.example/login");
      const requestSubmitSpy = vi.fn();
      stubRequestSubmit(form, requestSubmitSpy);

      await dispatchSubmit(form);

      expect(requestSubmitSpy).toHaveBeenCalled(); // pre-assessment fault -> fail open
    });

    it("off-mode async resume does not block a formaction submit when requestSubmit throws (R2-L2)", async () => {
      mockGetSettings.mockResolvedValue({ ...defaultConfig(), mode: "off" });
      const form = createPasswordForm("https://bank.example/login");
      const btn = document.createElement("button");
      btn.type = "submit";
      btn.setAttribute("formaction", "https://pay.example/checkout");
      form.appendChild(btn);
      stubRequestSubmit(form, vi.fn(() => { throw new Error("NotFoundError"); }));
      const submitSpy = vi.spyOn(form, "submit").mockImplementation(() => {});

      await dispatchSubmit(form, btn);

      // Disabled guard must not block: fall back to form.submit(), no safety toast.
      expect(submitSpy).toHaveBeenCalled();
      expect(mockComputeRisk).not.toHaveBeenCalled();
      expect(mockShowToast).not.toHaveBeenCalled(); // allowUnsafeFallback suppresses the toast (R2)
    });

    it("blocks an opaque->opaque (data:) action swap during the prompt (R2-L1)", async () => {
      // The real getRegistrableDomain("") returns "" for an opaque/empty host.
      mockGetRegDomain.mockImplementation((h: string) => (h === "" ? "" : "example.com"));
      stubLocation("https://bank.example/login");
      const form = createPasswordForm("data:text/html,a");
      const requestSubmitSpy = vi.fn();
      stubRequestSubmit(form, requestSubmitSpy);
      mockShowModal.mockImplementation(async () => {
        form.setAttribute("action", "data:text/html,b");
        return "proceed_once";
      });

      await dispatchSubmit(form);

      expect(requestSubmitSpy).not.toHaveBeenCalled();
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining("destination changed") }),
      );
    });

    it("does not log an outcome or widen trust when a trust choice is mutation-blocked (R2-L4)", async () => {
      mockGetRegDomain.mockImplementation((h: string) => (h.includes("evil") ? "evil.example" : "bank.example"));
      stubLocation("https://bank.example/login");
      const risk = defaultRisk();
      risk.page.registrableDomain = "bank.example";
      mockComputeRisk.mockReturnValue(risk);
      const form = createPasswordForm("https://bank.example/login");
      stubRequestSubmit(form, vi.fn());
      mockShowModal.mockImplementation(async () => {
        form.setAttribute("action", "https://evil.example/collect");
        return "trust_site";
      });

      await dispatchSubmit(form);

      expect(mockAddTrusted).not.toHaveBeenCalled();
      expect(mockAppendOutcome).not.toHaveBeenCalled();
    });
  });

  describe("handlePaste", () => {
    it("ignores paste when credential mode is off", async () => {
      mockGetSettings.mockResolvedValue({ ...defaultConfig(), mode: "off" });

      const input = createPasswordInput();
      await dispatchPaste(input);

      expect(mockShowToast).not.toHaveBeenCalled();
    });

    it("ignores paste when warnOnPaste is false", async () => {
      mockGetSettings.mockResolvedValue({ ...defaultConfig(), warnOnPaste: false });

      const input = createPasswordInput();
      await dispatchPaste(input);

      expect(mockShowToast).not.toHaveBeenCalled();
    });

    it("ignores paste on non-password inputs", async () => {
      const input = document.createElement("input");
      input.type = "text";
      document.body.appendChild(input);

      await dispatchPaste(input);

      expect(mockDeriveCredPaste).not.toHaveBeenCalled();
    });

    it("ignores paste on non-input elements", async () => {
      const div = document.createElement("div");
      document.body.appendChild(div);

      await dispatchPaste(div);

      expect(mockDeriveCredPaste).not.toHaveBeenCalled();
    });

    it("shows toast when pasting into password field on untrusted domain", async () => {
      mockDeriveCredPaste.mockReturnValue({
        shouldWarn: true,
        siteLabel: "suspicious-site.com",
      });

      const input = createPasswordInput();
      await dispatchPaste(input);

      expect(mockGetTrusted).toHaveBeenCalled();
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("suspicious-site.com"),
          timeoutMs: 10000,
        }),
      );
    });

    it("does not show toast when shouldWarn is false", async () => {
      mockDeriveCredPaste.mockReturnValue({
        shouldWarn: false,
        siteLabel: "trusted-site.com",
      });

      const input = createPasswordInput();
      await dispatchPaste(input);

      expect(mockGetTrusted).toHaveBeenCalled();
      expect(mockShowToast).not.toHaveBeenCalled();
    });

    it("logs cred_paste_warn event when warning is shown", async () => {
      mockDeriveCredPaste.mockReturnValue({
        shouldWarn: true,
        siteLabel: "suspicious-site.com",
      });

      const input = createPasswordInput();
      await dispatchPaste(input);

      expect(mockAppendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "cred_paste_warn",
          site: "suspicious-site.com",
        }),
      );
    });

    it("toast trust action calls addTrustedDomain", async () => {
      mockGetRegDomain.mockReturnValue("suspicious-site.com");
      mockDeriveCredPaste.mockReturnValue({
        shouldWarn: true,
        siteLabel: "suspicious-site.com",
      });

      const input = createPasswordInput();
      await dispatchPaste(input);

      const toastCall = mockShowToast.mock.calls[0]![0];
      expect(toastCall.actions).toHaveLength(1);

      await toastCall.actions![0]!.onClick();

      expect(mockAddTrusted).toHaveBeenCalledWith("suspicious-site.com");
      expect(mockAppendEvent).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "cred_trust_domain" }),
      );
    });

    it("toast onClick error catch does not throw", async () => {
      mockGetRegDomain.mockReturnValue("suspicious-site.com");
      mockDeriveCredPaste.mockReturnValue({
        shouldWarn: true,
        siteLabel: "suspicious-site.com",
      });
      mockAddTrusted.mockRejectedValue(new Error("storage write failed"));

      const input = createPasswordInput();
      await dispatchPaste(input);

      const toastCall = mockShowToast.mock.calls[0]![0];
      await expect(toastCall.actions![0]!.onClick()).resolves.toBeUndefined();
    });

    it("handlePaste error catch does not throw", async () => {
      mockGetSettings.mockRejectedValue(new Error("storage failed"));

      const input = createPasswordInput();
      await expect(dispatchPaste(input)).resolves.toBeUndefined();
      expect(mockShowToast).not.toHaveBeenCalled();
    });
  });

  // The module-level WeakSet `allowNextSubmit` persists across tests.
  // Each test creates a fresh form, so entries from prior tests are GC-eligible
  // and cannot leak. Do NOT reuse form references across `it` blocks.
  describe("allowNextSubmit mechanism", () => {
    it("lets the synchronous re-entrant submit from requestSubmit through (one-shot)", async () => {
      // The bypass exists ONLY so the submit event that requestSubmit re-dispatches
      // synchronously is let through. Real browsers dispatch that event during the
      // requestSubmit() call, so consumeAllowNext (at the top of handleSubmit, before
      // any await) sees the token and returns early without re-prompting.
      // NOTE: this validates the one-shot DESIGN, not the #264 fix — it passes on pre-fix
      // code too (the re-entrant consume deletes the token before `finally` runs). The fix
      // discriminator is the constraint-validation-no-op test below.
      mockShowModal.mockResolvedValue("proceed_once");
      const form = createPasswordForm();
      let reentrantCount = 0;
      let reentrantPrevented: boolean | undefined;
      stubRequestSubmit(
        form,
        vi.fn(() => {
          reentrantCount += 1;
          const ev = new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: null });
          form.dispatchEvent(ev); // synchronous re-dispatch, as the browser does
          reentrantPrevented = ev.defaultPrevented;
        }),
      );

      const first = await dispatchSubmit(form);

      expect(first.defaultPrevented).toBe(true); // user submit #1 was interposed (modal shown)
      expect(reentrantCount).toBe(1);
      expect(reentrantPrevented).toBe(false); // the re-entrant submit was let through
      expect(mockShowModal).toHaveBeenCalledTimes(1); // re-entrant submit did NOT re-prompt
    });

    it("bypass does not apply to a different form", async () => {
      // NOTE: validates WeakSet form-identity isolation, which was correct before #264 —
      // this passes on pre-fix code too. The fix discriminator is the no-op test above.
      mockShowModal.mockResolvedValue("proceed_once");
      const form1 = createPasswordForm();
      stubRequestSubmit(form1, vi.fn());

      await dispatchSubmit(form1);
      expect(mockShowModal).toHaveBeenCalledTimes(1);

      const form2 = createPasswordForm();
      const event2 = await dispatchSubmit(form2);

      expect(event2.defaultPrevented).toBe(true);
      expect(mockShowModal).toHaveBeenCalledTimes(2);
    });

    it("does not let the bypass token linger after a constraint-validation no-op (#264)", async () => {
      // Interactive constraint validation (an empty `required` field / `pattern` mismatch)
      // makes requestSubmit no-op WITHOUT throwing and WITHOUT re-dispatching a submit, so
      // nothing consumes the token. Pre-fix it lingered up to 5s and the NEXT separate submit
      // bypassed assessment + the action-mutation re-check. Post-fix resumeSubmit's `finally`
      // clears it synchronously, so the next submit is fully re-assessed.
      mockShowModal.mockResolvedValue("proceed_once");
      const form = createPasswordForm();
      stubRequestSubmit(form, vi.fn()); // no re-dispatch, no throw (constraint-validation no-op)

      await dispatchSubmit(form); // submit #1 -> modal proceed -> resumeSubmit -> requestSubmit no-op
      expect(mockShowModal).toHaveBeenCalledTimes(1);

      // A separate later submit on the SAME form must be re-assessed (prompted), not bypassed.
      mockShowModal.mockResolvedValue("cancel");
      const second = await dispatchSubmit(form);

      expect(second.defaultPrevented).toBe(true); // interposed again -> token did not linger
      expect(mockShowModal).toHaveBeenCalledTimes(2); // assessment ran for submit #2
    });

    it("clears the bypass token after requestSubmit throws (no lingering) (#264)", async () => {
      // Pins the throw exit path: requestSubmit throws -> resumeSubmit falls back and the
      // `finally` clears the token, so a separate later submit on the same form is re-assessed.
      // (Pre-fix the catch already deleted on throw, so this is coverage-pinning, not a
      // discriminator — the no-op test above is the discriminator.)
      mockShowModal.mockResolvedValue("proceed_once");
      const form = createPasswordForm();
      stubRequestSubmit(form, vi.fn(() => { throw new Error("requestSubmit failed"); }));
      vi.spyOn(form, "submit").mockImplementation(() => {}); // avoid jsdom navigation

      await dispatchSubmit(form); // submit #1 -> resumeSubmit -> requestSubmit throws -> fallback
      expect(mockShowModal).toHaveBeenCalledTimes(1);

      mockShowModal.mockResolvedValue("cancel");
      const second = await dispatchSubmit(form);

      expect(second.defaultPrevented).toBe(true); // re-assessed -> token did not linger after throw
      expect(mockShowModal).toHaveBeenCalledTimes(2);
    });

    it("clears the bypass token on the formaction safety-toast early-return path (#264)", async () => {
      // The one finally-covered exit not pinned elsewhere: requestSubmit throws AND the
      // submitter has a formaction AND allowUnsafeFallback is false -> catch shows the
      // safety toast and returns early (no form.submit fallback). The `finally` must still
      // clear the token so the next separate submit is re-assessed. Guards against a future
      // refactor moving the delete out of `finally` into only the form.submit() path.
      mockShowModal.mockResolvedValue("proceed_once");
      const form = createPasswordForm();
      const btn = document.createElement("button");
      btn.type = "submit";
      btn.setAttribute("formaction", "https://pay.example/checkout");
      form.appendChild(btn);
      stubRequestSubmit(form, vi.fn(() => { throw new Error("NotFoundError"); }));
      const submitSpy = vi.spyOn(form, "submit").mockImplementation(() => {});

      await dispatchSubmit(form, btn); // toast + early return (form.submit NOT called)
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining("could not be completed safely") }),
      );
      expect(submitSpy).not.toHaveBeenCalled();
      expect(mockShowModal).toHaveBeenCalledTimes(1);

      // Token must be cleared by finally -> next submit fully re-assessed (not bypassed).
      mockShowModal.mockResolvedValue("cancel");
      const second = await dispatchSubmit(form, btn);
      expect(second.defaultPrevented).toBe(true);
      expect(mockShowModal).toHaveBeenCalledTimes(2);
    });
  });
});
