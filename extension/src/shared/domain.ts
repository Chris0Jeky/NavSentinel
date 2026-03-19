import type { CredentialSettings } from "./storage";

const MULTIPART_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "gov.uk",
  "ac.uk",
  "nhs.uk",
  "police.uk",
  "com.au",
  "net.au",
  "org.au",
  "edu.au",
  "gov.au",
  "co.nz",
  "org.nz",
  "govt.nz",
  "co.jp",
  "or.jp",
  "ne.jp",
  "co.kr",
  "or.kr",
  "go.kr",
  "co.in",
  "firm.in",
  "net.in",
  "org.in",
  "com.br",
  "net.br",
  "org.br",
  "com.mx",
  "org.mx",
  "co.za",
  "org.za",
  "com.sg",
  "net.sg",
  "org.sg",
  "com.hk",
  "net.hk",
  "org.hk",
  "com.tw",
  "net.tw",
  "org.tw"
]);

export function normalizeHost(host: string): string {
  if (!host) return "";
  return host.toLowerCase().replace(/\.$/, "");
}

export function isIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})(\.\d{1,3}){3}$/);
  if (!m) return false;
  const parts = host.split(".").map((x) => Number(x));
  return parts.every((n) => Number.isFinite(n) && n >= 0 && n <= 255);
}

export function isIPv6(host: string): boolean {
  if (!host.includes(":")) return false;
  return /^[0-9a-fA-F:.]+$/.test(host);
}

export function isIPAddress(host: string): boolean {
  const h = normalizeHost(host);
  return isIPv4(h) || isIPv6(h);
}

export function splitLabels(host: string): string[] {
  const h = normalizeHost(host);
  if (!h) return [];
  return h.split(".").filter(Boolean);
}

export function getRegistrableDomain(host: string): string {
  const h = normalizeHost(host);
  if (!h) return "";
  if (isIPAddress(h)) return h;

  const labels = splitLabels(h);
  if (labels.length <= 2) return h;

  const last2 = labels.slice(-2).join(".");
  const last3 = labels.slice(-3).join(".");

  if (MULTIPART_SUFFIXES.has(last2) && labels.length >= 3) {
    return last3;
  }

  return last2;
}

export function subdomainDepth(host: string): number {
  const h = normalizeHost(host);
  if (!h || isIPAddress(h)) return 0;
  const labels = splitLabels(h);
  const regLabels = splitLabels(getRegistrableDomain(h));
  return Math.max(0, labels.length - regLabels.length);
}

export function containsPunycode(host: string): boolean {
  return normalizeHost(host)
    .split(".")
    .some((label) => label.startsWith("xn--"));
}

type ScriptClass = "Latin" | "Greek" | "Cyrillic" | "Digit" | "Common" | "Other";

function charScript(cp: number): ScriptClass {
  if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) return "Latin";
  if (cp >= 0x30 && cp <= 0x39) return "Digit";
  if ((cp >= 0x00c0 && cp <= 0x024f) || (cp >= 0x1e00 && cp <= 0x1eff)) return "Latin";
  if ((cp >= 0x0370 && cp <= 0x03ff) || (cp >= 0x1f00 && cp <= 0x1fff)) return "Greek";
  if (
    (cp >= 0x0400 && cp <= 0x052f) ||
    (cp >= 0x2de0 && cp <= 0x2dff) ||
    (cp >= 0xa640 && cp <= 0xa69f)
  ) {
    return "Cyrillic";
  }
  if (cp === 0x2d || cp === 0x2e) return "Common";
  return "Other";
}

export function isMixedScript(host: string): boolean {
  const h = normalizeHost(host);
  if (!h) return false;

  const scripts = new Set<ScriptClass>();
  for (const ch of h) {
    const cp = ch.codePointAt(0) ?? 0;
    const script = charScript(cp);
    if (script === "Digit" || script === "Common") continue;
    scripts.add(script);
    if (scripts.size >= 2) break;
  }

  const hasLatin = scripts.has("Latin");
  const hasGreek = scripts.has("Greek");
  const hasCyrillic = scripts.has("Cyrillic");

  return (
    (hasLatin && hasGreek) ||
    (hasLatin && hasCyrillic) ||
    (hasGreek && hasCyrillic)
  );
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const n = a.length;
  const m = b.length;
  if (n === 0) return m;
  if (m === 0) return n;

  const prev = new Array<number>(m + 1);
  const cur = new Array<number>(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;

  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    for (let j = 0; j <= m; j++) prev[j] = cur[j] ?? 0;
  }

  return prev[m] ?? m;
}

export function findClosestLookalike(
  currentRegDomain: string,
  trustedRegDomains: string[]
): { target: string; distance: number } | null {
  const cur = normalizeHost(currentRegDomain);
  if (!cur) return null;

  let best: { target: string; distance: number } | null = null;
  for (const t of trustedRegDomains ?? []) {
    const target = normalizeHost(t);
    if (!target || target === cur) continue;
    const distance = levenshtein(cur, target);
    if (!best || distance < best.distance) {
      best = { target, distance };
    }
  }

  return best;
}

export function safeUrlParse(url: string, base?: string): URL | null {
  try {
    return new URL(url, base);
  } catch {
    return null;
  }
}

export interface RiskReason {
  code: string;
  label: string;
}

export interface RiskResult {
  score: number;
  severity: "none" | "low" | "medium" | "high";
  reasons: RiskReason[];
  page: {
    url: string;
    host: string;
    registrableDomain: string;
    isHttps: boolean;
    isTrusted: boolean;
  };
  action: {
    url: string;
    host: string;
    registrableDomain: string;
    isHttps: boolean;
    isTrusted: boolean;
  };
  lookalike: { target: string; distance: number } | null;
}

export function computeCredentialRisk(params: {
  pageUrl: string;
  actionUrl: string;
  trustedDomains: string[];
  config: CredentialSettings;
}): RiskResult {
  const cfg = params.config;
  const trusted = params.trustedDomains ?? [];

  const page = safeUrlParse(params.pageUrl);
  const action = safeUrlParse(params.actionUrl, params.pageUrl);

  const reasons: RiskReason[] = [];
  let score = 0;

  const pageHost = page ? normalizeHost(page.hostname) : "";
  const actionHost = action ? normalizeHost(action.hostname) : "";
  const pageReg = pageHost ? getRegistrableDomain(pageHost) : "";
  const actionReg = actionHost ? getRegistrableDomain(actionHost) : "";
  const pageHttps = page ? page.protocol === "https:" : false;
  const actionHttps = action ? action.protocol === "https:" : false;
  const pageTrusted = !!(pageReg && trusted.includes(pageReg));
  const actionTrusted = !!(actionReg && trusted.includes(actionReg));

  if (page && !pageHttps) {
    score += 55;
    reasons.push({
      code: "NON_HTTPS_PAGE",
      label: "Page is not HTTPS (credentials can be intercepted)."
    });
  }

  if (action && !actionHttps) {
    score += 45;
    reasons.push({
      code: "NON_HTTPS_ACTION",
      label: "Form action is not HTTPS."
    });
  }

  if (page && page.username) {
    score += 35;
    reasons.push({
      code: "USERINFO_IN_URL",
      label: "URL contains userinfo (the user@host trick)."
    });
  }

  if (pageHost && isIPAddress(pageHost)) {
    score += 35;
    reasons.push({
      code: "IP_HOST",
      label: "Hostname is an IP address (unusual for real login pages)."
    });
  }

  if (pageHost && containsPunycode(pageHost)) {
    score += 25;
    reasons.push({
      code: "PUNYCODE_HOST",
      label: "Hostname contains punycode (xn--). Potential IDN homograph."
    });
  }

  if (pageHost && isMixedScript(pageHost)) {
    score += 25;
    reasons.push({
      code: "MIXED_SCRIPT_HOST",
      label: "Hostname mixes scripts (Latin/Cyrillic/Greek). Potential homograph."
    });
  }

  const depth = pageHost ? subdomainDepth(pageHost) : 0;
  if (depth >= 3) {
    score += 10;
    reasons.push({
      code: "DEEP_SUBDOMAIN",
      label: `Deep subdomain depth (${depth}).`
    });
  }

  if (pageHost && actionHost && pageHost !== actionHost) {
    if (!actionTrusted) {
      score += 18;
      reasons.push({
        code: "CROSS_SITE_ACTION",
        label: "Form submits to a different host than the page."
      });
    } else {
      score += 5;
      reasons.push({
        code: "CROSS_SITE_ACTION_TRUSTED",
        label: "Form submits cross-site, but destination is trusted."
      });
    }
  }

  const maxDistance = Number.isFinite(cfg.similarity.maxDistance)
    ? cfg.similarity.maxDistance
    : 2;
  const lookalike = cfg.similarity.enabled && pageReg
    ? findClosestLookalike(pageReg, trusted)
    : null;

  if (cfg.similarity.enabled) {
    if (lookalike && lookalike.distance <= maxDistance) {
      score += 45;
      reasons.push({
        code: "LOOKALIKE_DOMAIN",
        label: `Domain is similar to trusted domain "${lookalike.target}" (edit distance ${lookalike.distance}).`
      });
    }
  }

  if (!pageTrusted) {
    score += 10;
    reasons.push({
      code: "UNTRUSTED_DOMAIN",
      label: "Domain is not in your trusted list."
    });
  }

  score = Math.max(0, Math.min(100, score));

  let severity: RiskResult["severity"] = "none";
  if (score >= 70) severity = "high";
  else if (score >= 40) severity = "medium";
  else if (score >= 15) severity = "low";

  return {
    score,
    severity,
    reasons,
    page: {
      url: page ? page.href : String(params.pageUrl || ""),
      host: pageHost,
      registrableDomain: pageReg,
      isHttps: pageHttps,
      isTrusted: pageTrusted
    },
    action: {
      url: action ? action.href : String(params.actionUrl || ""),
      host: actionHost,
      registrableDomain: actionReg,
      isHttps: actionHttps,
      isTrusted: actionTrusted
    },
    lookalike
  };
}

export function isHostWithinDomain(host: string, domain: string): boolean {
  const h = normalizeHost(host);
  const d = normalizeHost(domain);
  if (!h || !d) return false;
  return h === d || h.endsWith(`.${d}`);
}
