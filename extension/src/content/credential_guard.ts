import {
  addTrustedDomain,
  appendEvent,
  appendPromptOutcome,
  getCredentialSettings,
  getTrustedDomains
} from "../shared/storage";
import { computeCredentialRisk, getRegistrableDomain, normalizeHost, recalcSeverity } from "../shared/domain";
import { showToast } from "./ui_toast";
import { showCredentialModal } from "./credential_modal";
import {
  deriveCredentialPasteState,
  getCredentialReasonLines,
  isCrossSiteCredentialAction,
  shouldPromptCredentialSubmit
} from "./credential_guard_model";
import { analyzePageContent } from "./content_analyzer";
import { checkSRI } from "./sri_checker";

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
    form.requestSubmit(submitter);
  } catch {
    try {
      form.submit();
    } catch (e) {
      console.warn("[NavSentinel] form submit fallback failed:", e);
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

    const submitter = evt.submitter;

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
        risk.severity = recalcSeverity(risk.score);
      }
    }

    // SRI awareness: flag missing subresource integrity on credential pages.
    // Skip entirely for trusted domains -- consistent with content analysis above.
    if (!risk.page.isTrusted) {
      const sriAnalysis = checkSRI(document, location.href, location.origin);
      if (sriAnalysis.score !== 0) {
        risk.score = Math.max(0, Math.min(100, risk.score + sriAnalysis.score));
        const sriCode = sriAnalysis.score > 0 ? "SRI_MISSING_ON_CREDENTIAL_PAGE" : "SRI_PRESENT_ON_CREDENTIAL_PAGE";
        for (let i = 0; i < sriAnalysis.reasons.length; i++) {
          risk.reasons.push({ code: sriCode, label: sriAnalysis.reasons[i] ?? "" });
        }
        risk.severity = recalcSeverity(risk.score);
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
      reasons: getCredentialReasonLines(risk.reasons),
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
    // Capture the action (destination) host so cred records carry the same
    // source->dest pairing as nav records (P5-C1 / #238 consistency fix).
    const credDest = risk.action.registrableDomain || risk.action.host || undefined;

    if (choice === "cancel") {
      void appendPromptOutcome({
        domain: credDomain,
        ...(credDest ? { destDomain: credDest } : {}),
        type: "cred",
        score: risk.score,
        outcome: "cancel",
        reasons: credReasons
      }).catch((e) => { console.warn("[NavSentinel] prompt outcome append failed (cancel):", e); });
      return;
    }

    if (choice === "trust_site" || choice === "trust_dest") {
      void appendPromptOutcome({
        domain: credDomain,
        ...(credDest ? { destDomain: credDest } : {}),
        type: "cred",
        score: risk.score,
        outcome: "trust",
        reasons: credReasons
      }).catch((e) => { console.warn("[NavSentinel] prompt outcome append failed (trust):", e); });
    } else {
      void appendPromptOutcome({
        domain: credDomain,
        ...(credDest ? { destDomain: credDest } : {}),
        type: "cred",
        score: risk.score,
        outcome: "allow_once",
        reasons: credReasons
      }).catch((e) => { console.warn("[NavSentinel] prompt outcome append failed (allow_once):", e); });
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
        extra: { error: e instanceof Error ? e.message : String(e) }
      });
    } catch (logErr) {
      console.warn("[NavSentinel] event log append failed (cred_submit_prompt/error):", logErr, "original:", e);
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
            } catch (e) {
              console.warn("[NavSentinel] event log append failed (cred_trust_domain/paste):", e);
            }
          }
        }
      ]
    });

    await appendEvent({ kind: "cred_paste_warn", site: pasteState.siteLabel, url: location.href });
  } catch (e) {
    console.warn("[NavSentinel] credential paste handler failed:", e);
  }
}

document.addEventListener("submit", (e) => void handleSubmit(e), true);
document.addEventListener("paste", (e) => void handlePaste(e), true);
