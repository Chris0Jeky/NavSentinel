import {
  addTrustedDomain,
  appendEvent,
  getCredentialSettings,
  getTrustedDomains,
  type CredMode
} from "../shared/storage";
import { computeCredentialRisk, getRegistrableDomain, normalizeHost } from "../shared/domain";
import { showToast } from "./ui_toast";
import { showCredentialModal } from "./credential_modal";

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

function shouldPrompt(
  mode: CredMode,
  riskScore: number,
  pageTrusted: boolean,
  actionTrusted: boolean,
  isHttpsOk: boolean,
  crossSite: boolean,
  cfg: Awaited<ReturnType<typeof getCredentialSettings>>
): boolean {
  const threshold = Number.isFinite(cfg.mediumRiskThreshold) ? cfg.mediumRiskThreshold : 40;
  if (mode === "off") return false;
  if (cfg.blockHttpPasswordSubmit && !isHttpsOk) return true;
  if (crossSite && !actionTrusted && riskScore >= 15) return true;

  if (mode === "strict") {
    return !pageTrusted || riskScore >= threshold;
  }

  return (
    (cfg.promptOnUntrustedDomain && !pageTrusted) ||
    (cfg.promptOnMediumRisk && riskScore >= threshold)
  );
}

function reasonLines(risk: ReturnType<typeof computeCredentialRisk>): string[] {
  return risk.reasons.map((r) => r.label).slice(0, 10);
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

    const crossSite = !!(
      risk.page.host &&
      risk.action.host &&
      risk.page.host !== risk.action.host
    );
    const isHttpsOk = risk.page.isHttps && risk.action.isHttps;

    if (
      !shouldPrompt(
        cfg.mode,
        risk.score,
        risk.page.isTrusted,
        risk.action.isTrusted,
        isHttpsOk,
        crossSite,
        cfg
      )
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
      reasons: reasonLines(risk),
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

    if (choice === "cancel") return;

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
    const isTrusted = !!(reg && trusted.includes(reg));
    if (isTrusted) return;

    showToast({
      message: `You pasted into a password field on an untrusted domain: ${reg || host || "(unknown)"}.`,
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

    await appendEvent({ kind: "cred_paste_warn", site: reg || host, url: location.href });
  } catch {
    // ignore
  }
}

document.addEventListener("submit", (e) => void handleSubmit(e as SubmitEvent), true);
document.addEventListener("paste", (e) => void handlePaste(e as ClipboardEvent), true);
