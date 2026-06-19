// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../extension/src/shared/storage", () => ({
  getCredentialSettings: vi.fn(),
  getTrustedDomains: vi.fn(),
  addTrustedDomain: vi.fn(),
  appendEvent: vi.fn(),
  appendPromptOutcome: vi.fn(),
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
      expect(mockAppendOutcome).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: "cancel" }),
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

    it("catches errors and logs them without resuming submit", async () => {
      mockGetSettings.mockRejectedValue(new Error("storage failed"));
      mockNormalizeHost.mockReturnValue("example.com");

      const form = createPasswordForm();
      const requestSubmitSpy = vi.fn();
      stubRequestSubmit(form, requestSubmitSpy);

      await dispatchSubmit(form);

      expect(mockAppendEvent).toHaveBeenCalledTimes(1);
      const errorEvent = mockAppendEvent.mock.calls[0]![0];
      expect(errorEvent.kind).toBe("cred_submit_prompt");
      expect(errorEvent.extra!.error).toBe("storage failed");
      expect(errorEvent).not.toHaveProperty("score");
      expect(errorEvent).not.toHaveProperty("reasons");
      expect(errorEvent).not.toHaveProperty("destHost");
      expect(requestSubmitSpy).not.toHaveBeenCalled();
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

  // The module-level WeakMap `allowNextSubmitUntil` persists across tests.
  // Each test creates a fresh form, so entries from prior tests are GC-eligible
  // and cannot leak. Do NOT reuse form references across `it` blocks.
  describe("allowNextSubmit mechanism", () => {
    it("second submit on same form within window proceeds without prompt", async () => {
      mockShowModal.mockResolvedValue("proceed_once");
      const form = createPasswordForm();
      stubRequestSubmit(form, vi.fn());

      await dispatchSubmit(form);

      expect(mockShowModal).toHaveBeenCalledTimes(1);
      vi.resetAllMocks();

      const event2 = await dispatchSubmit(form);

      expect(event2.defaultPrevented).toBe(false);
      expect(mockGetSettings).not.toHaveBeenCalled();
      expect(mockShowModal).not.toHaveBeenCalled();
    });

    it("bypass does not apply to a different form", async () => {
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

    it("bypass expires after 5-second window", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        mockShowModal.mockResolvedValue("proceed_once");
        const form = createPasswordForm();
        stubRequestSubmit(form, vi.fn());

        const event1 = new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: null });
        form.dispatchEvent(event1);
        await vi.advanceTimersByTimeAsync(0);

        expect(mockShowModal).toHaveBeenCalledTimes(1);
        vi.resetAllMocks();
        mockGetSettings.mockResolvedValue(defaultConfig());
        mockGetTrusted.mockResolvedValue([]);
        mockComputeRisk.mockReturnValue(defaultRisk());
        mockIsCrossSite.mockReturnValue(true);
        mockGetReasonLines.mockReturnValue(["Domain mismatch"]);
        mockShouldPrompt.mockReturnValue(true);
        mockShowModal.mockResolvedValue("cancel");
        mockAnalyzeContent.mockReturnValue({ ...CONTENT_BASE, score: 0, reasons: [] });
        mockCheckSRI.mockReturnValue({ ...SRI_BASE, score: 0, reasons: [], totalExternal: 0, withSRI: 0, withoutSRI: 0 });
        mockAppendEvent.mockResolvedValue(undefined);
        mockAppendOutcome.mockResolvedValue(undefined);
        mockNormalizeHost.mockReturnValue("example.com");
        mockGetRegDomain.mockReturnValue("example.com");
        mockRecalcSeverity.mockReturnValue("medium");

        vi.advanceTimersByTime(5001);

        const event3 = new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: null });
        form.dispatchEvent(event3);
        await vi.advanceTimersByTimeAsync(0);

        expect(event3.defaultPrevented).toBe(true);
        expect(mockShowModal).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
