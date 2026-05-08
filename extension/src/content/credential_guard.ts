import {
  addTrustedDomain,
  appendEvent,
  appendPromptOutcome,
  getCredentialSettings,
  getTrustedDomains
} from "../shared/storage";
import { computeCredentialRisk, getRegistrableDomain, normalizeHost } from "../shared/domain";
import { explainReasonCodes } from "../shared/explanations";
import { showToast } from "./ui_toast";
import { showCredentialModal } from "./credential_modal";
import {
  deriveCredentialPasteState,
  getCredentialReasonLines,
  isCrossSiteCredentialAction,
  shouldPromptCredentialSubmit
} from "./credential_guard_model";
import { analyzePageContent } from "./content_analyzer";

const allowNextSubmitUntil = new WeakMap<HTMLFormElement, number>();

function nowMs(): number {
  return Date.now();
}

function markAllowNext(form: HTMLFormElement, ms: number): void {
  allowNextSubmitUntil.set(form, nowMs() + ms);
}

function consumeAllowNext(form: HTMLFormElement): boolean {
  const t = allowNextSubmitUntil.get(form);
  if (!t) return false;
  allowNextSubmitUntil.delete(form);
  return nowMs() <= t;
}

function isPasswordForm(form: HTMLFormElement): boolean {
  try {
    const pw = form.querySelector('input[type="password"]') as HTMLInputElement | null;
    return !!pw && !pw.disabled;
  } catch {
    return false;
  }
}

function resolveActionUrl(form: HTMLFormElement): string {
  try {
    const raw = (form.getAttribute("action") || "").trim();
    if (!raw || raw.toLowerCase().startsWith("javascript:")) return location.href;
    return new URL(raw, location.href).href;
  } catch {
    return location.href;
  }
}

function resumeSubmit(form: HTMLFormElement, submitter: HTMLElement | null): void {
  markAllowNext(form, 5000);

  try {
    if (typeof (form as any).requestSubmit === "function") {
      (form as any).requestSubmit(submitter);
    } else {
      form.submit();
    }
  } catch {
    try {
      form.submit();
    } catch {
      // ignore
    }
  }
}

async function handleSubmit(evt: SubmitEvent): Promise<void> {
  try {
    const form = evt.target;
    if (!(form instanceof HTMLFormElement) || !isPasswordForm(form)) return;
    if (consumeAllowNext(form)) return;

    evt.preventDefault();
    evt.stopImmediatePropagation();

    const submitter = (evt as any).submitter as HTMLElement | null;

    const cfg = await getCredentialSettings();
    if (cfg.mode === "off") {
      resumeSubmit(form, submitter);
      return;
    }

    const trusted = await getTrustedDomains();
    const risk = computeCredentialRisk({
      pageUrl: location.href,
      actionUrl: resolveActionUrl(form),
      trustedDomains: trusted,
      config: cfg
    });

    // Content fingerprinting: boost risk when page content signals phishing.
    // Skip entirely for trusted domains -- they have already been allowlisted
    // by the user and content analysis would only produce false positives.
    if (!risk.page.isTrusted) {
      const pageHost = normalizeHost(location.hostname);
      const pageDomain = getRegistrableDomain(pageHost) || pageHost;
      const contentAnalysis = analyzePageContent(document, pageDomain);
      if (contentAnalysis.score > 0) {
        const boost = Math.min(contentAnalysis.score, 100 - risk.score);
        risk.score = Math.min(100, risk.score + boost);
        for (let i = 0; i < contentAnalysis.reasons.length; i++) {
          risk.reasons.push({ code: "CONTENT_FP", label: contentAnalysis.reasons[i] ?? "" });
        }
        // Recalculate severity after boost
        if (risk.score >= 70) risk.severity = "high";
        else if (risk.score >= 40) risk.severity = "medium";
        else if (risk.score >= 15) risk.severity = "low";
        else risk.severity = "none";
      }
    }

    const crossSite = isCrossSiteCredentialAction(risk);
    const isHttpsOk = risk.page.isHttps && risk.action.isHttps;

    if (
      !shouldPromptCredentialSubmit({
        mode: cfg.mode,
        riskScore: risk.score,
        pageTrusted: risk.page.isTrusted,
        actionTrusted: risk.action.isTrusted,
        isHttpsOk,
        crossSite,
        config: cfg
      })
    ) {
      resumeSubmit(form, submitter);
      return;
    }

    await appendEvent({
      kind: "cred_submit_prompt",
      site: risk.page.registrableDomain || risk.page.host,
      url: risk.page.url,
      destHost: risk.action.registrableDomain || risk.action.host,
      score: risk.score,
      reasons: risk.reasons.map((r) => r.code),
      extra: { severity: risk.severity }
    });

    const choice = await showCredentialModal({
      title: "Credential submit blocked",
      subtitle: "You are about to submit a form containing a password field. Verify the domain before proceeding.",
      kv: [
        { k: "Page", v: risk.page.registrableDomain || risk.page.host || "(unknown)" },
        { k: "Destination", v: risk.action.registrableDomain || risk.action.host || "(unknown)" },
        { k: "Risk score", v: `${risk.score} (${risk.severity})` }
      ],
      reasons: explainReasonCodes(getCredentialReasonLines(risk.reasons)),
      actions: [
        { id: "cancel", label: "Cancel", kind: "danger" },
        { id: "proceed_once", label: "Proceed once", kind: "primary" },
        ...(!risk.page.isTrusted && risk.page.registrableDomain
          ? [{ id: "trust_site", label: `Trust ${risk.page.registrableDomain}`, kind: "primary" as const }]
          : []),
        ...(risk.action.registrableDomain &&
        risk.action.registrableDomain !== risk.page.registrableDomain &&
        !risk.action.isTrusted
          ? [
              {
                id: "trust_dest",
                label: `Trust destination ${risk.action.registrableDomain}`,
                kind: "primary" as const
              }
            ]
          : [])
      ],
      outsideAction: "cancel"
    });

    const credDomain = risk.page.registrableDomain || risk.page.host;
    const credReasons = risk.reasons.map((r) => r.code);

    if (choice === "cancel") {
      void appendPromptOutcome({
        domain: credDomain,
        type: "cred",
        score: risk.score,
        outcome: "cancel",
        reasons: credReasons
      }).catch(() => {});
      return;
    }

    if (choice === "trust_site" || choice === "trust_dest") {
      void appendPromptOutcome({
        domain: credDomain,
        type: "cred",
        score: risk.score,
        outcome: "trust",
        reasons: credReasons
      }).catch(() => {});
    } else {
      void appendPromptOutcome({
        domain: credDomain,
        type: "cred",
        score: risk.score,
        outcome: "allow_once",
        reasons: credReasons
      }).catch(() => {});
    }

    if (choice === "trust_site" && risk.page.registrableDomain) {
      await addTrustedDomain(risk.page.registrableDomain);
      await appendEvent({
        kind: "cred_trust_domain",
        site: risk.page.registrableDomain,
        url: risk.page.url
      });
    }

    if (choice === "trust_dest" && risk.action.registrableDomain) {
      await addTrustedDomain(risk.action.registrableDomain);
      await appendEvent({
        kind: "cred_trust_domain",
        site: risk.action.registrableDomain,
        url: risk.page.url,
        destHost: risk.action.registrableDomain
      });
    }

    resumeSubmit(form, submitter);

    await appendEvent({
      kind: "cred_submit_allow_once",
      site: risk.page.registrableDomain || risk.page.host,
      url: risk.page.url,
      destHost: risk.action.registrableDomain || risk.action.host,
      score: risk.score,
      reasons: risk.reasons.map((r) => r.code),
      extra: { choice }
    });
  } catch (e) {
    try {
      await appendEvent({
        kind: "cred_submit_prompt",
        site: normalizeHost(location.hostname),
        url: location.href,
        extra: { error: String((e as any)?.message ?? e) }
      });
    } catch {
      // ignore
    }
  }
}

async function handlePaste(evt: ClipboardEvent): Promise<void> {
  try {
    const cfg = await getCredentialSettings();
    if (cfg.mode === "off" || !cfg.warnOnPaste) return;

    const t = evt.target;
    if (!(t instanceof HTMLInputElement)) return;
    if ((t.getAttribute("type") || "").toLowerCase() !== "password") return;

    const trusted = await getTrustedDomains();
    const host = normalizeHost(location.hostname);
    const reg = getRegistrableDomain(host);
    const pasteState = deriveCredentialPasteState(location.href, trusted);
    if (!pasteState.shouldWarn) return;

    showToast({
      message: `You pasted into a password field on an untrusted domain: ${pasteState.siteLabel}.`,
      timeoutMs: 10000,
      actions: [
        {
          label: reg ? `Trust ${reg}` : "Trust this site",
          onClick: async () => {
            try {
              if (reg) await addTrustedDomain(reg);
              await appendEvent({ kind: "cred_trust_domain", site: reg || host, url: location.href });
            } catch {
              // ignore
            }
          }
        }
      ]
    });

    await appendEvent({ kind: "cred_paste_warn", site: pasteState.siteLabel, url: location.href });
  } catch {
    // ignore
  }
}

document.addEventListener("submit", (e) => void handleSubmit(e as SubmitEvent), true);
document.addEventListener("paste", (e) => void handlePaste(e as ClipboardEvent), true);
