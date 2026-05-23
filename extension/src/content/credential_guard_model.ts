import { getRegistrableDomain, normalizeHost } from "../shared/domain";
import type { CredMode, CredentialSettings } from "../shared/storage";
import type { RiskReason, RiskResult } from "../shared/domain";

export function shouldPromptCredentialSubmit(params: {
  mode: CredMode;
  riskScore: number;
  pageTrusted: boolean;
  actionTrusted: boolean;
  isHttpsOk: boolean;
  crossSite: boolean;
  config: CredentialSettings;
}): boolean {
  const { mode, riskScore, pageTrusted, actionTrusted, isHttpsOk, crossSite, config } = params;
  const threshold = Number.isFinite(config.mediumRiskThreshold) ? config.mediumRiskThreshold : 40;
  if (mode === "off") return false;
  if (config.blockHttpPasswordSubmit && !isHttpsOk) return true;
  if (crossSite && !actionTrusted && riskScore >= 15) return true;

  if (mode === "strict") {
    return !pageTrusted || riskScore >= threshold;
  }

  return (
    (config.promptOnUntrustedDomain && !pageTrusted) ||
    (config.promptOnMediumRisk && riskScore >= threshold)
  );
}

export function getCredentialReasonLines(reasons: RiskReason[]): string[] {
  return reasons.map((reason) => reason.label).slice(0, 10);
}

export function deriveCredentialPasteState(
  pageUrl: string,
  trustedDomains: string[]
): { siteLabel: string; shouldWarn: boolean } {
  let host: string;
  try {
    host = pageUrl ? new URL(pageUrl).hostname : "";
  } catch {
    host = "";
  }

  const normalizedHost = normalizeHost(host);
  const registrableDomain = getRegistrableDomain(normalizedHost);
  const siteLabel = registrableDomain || normalizedHost || "(unknown)";
  const isTrusted = !!(registrableDomain && trustedDomains.includes(registrableDomain));

  return {
    siteLabel,
    shouldWarn: !!siteLabel && siteLabel !== "(unknown)" && !isTrusted
  };
}

export function isCrossSiteCredentialAction(risk: RiskResult): boolean {
  return !!(risk.page.host && risk.action.host && risk.page.host !== risk.action.host);
}
