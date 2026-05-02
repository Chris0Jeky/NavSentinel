/**
 * Page Content Fingerprinting (P2-04)
 *
 * Detects phishing by analyzing page content patterns:
 * 1. Brand/domain mismatch (login form + brand signals on wrong domain)
 * 2. Phishing kit HTML fingerprints (known template signatures)
 * 3. Suspicious form actions (data: URIs, base64, cross-domain)
 * 4. Login form on unrecognizable domain mimicking branded flow
 *
 * All analysis is local -- no network calls.
 * Performance budget: < 50ms per analysis.
 * No form values or page content are stored or transmitted.
 */

import { getRegistrableDomain, normalizeHost } from "../shared/domain";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ContentAnalysisResult {
  brandMismatch: boolean;
  brandDetected?: string;
  phishingKitMatch: boolean;
  kitName?: string;
  suspiciousFormAction: boolean;
  score: number; // 0-100
  reasons: string[];
}

/**
 * Minimal snapshot of page content needed for analysis.
 * Built from the real Document in the content script, but can be
 * constructed manually in tests without a DOM environment.
 */
export interface PageSnapshot {
  title: string;
  /** Body text content (first ~5000 chars) */
  bodyText: string;
  /** Full innerHTML of <html> (first ~50000 chars) */
  htmlSnippet: string;
  /** Concatenated inline script text (first ~30000 chars) */
  scriptText: string;
  /** Image alt+src signals */
  imgSignals: string;
  /** Whether at least one non-disabled, non-hidden password input exists */
  hasPasswordField: boolean;
  /** Raw form action attributes paired with whether the form has a password field */
  formActions: Array<{ action: string; hasPassword: boolean }>;
  /** Meta tag entries: { name, content } */
  metaTags: Array<{ name: string; content: string }>;
  /** CSS selectors that exist in the document (for kit fingerprint matching) */
  matchedSelectors: string[];
}

// ---------------------------------------------------------------------------
// Brand database
// ---------------------------------------------------------------------------

export interface BrandEntry {
  name: string;
  domains: string[];
  titlePatterns: RegExp[];
  formActionDomains?: string[];
}

export const BRAND_DB: ReadonlyArray<BrandEntry> = [
  {
    name: "Google",
    domains: ["google.com", "accounts.google.com", "googleapis.com", "googlemail.com", "gmail.com"],
    titlePatterns: [/\bgoogle\b/i, /\bgmail\b/i, /\bsign\s*in\s*[-–]\s*google/i],
    formActionDomains: ["google.com", "googleapis.com"],
  },
  {
    name: "Microsoft",
    domains: ["microsoft.com", "live.com", "outlook.com", "microsoftonline.com", "office.com", "office365.com"],
    titlePatterns: [/\bmicrosoft\b/i, /\boutlook\b/i, /\boffice\s*365\b/i, /\bsign\s*in\s*to\s*your\s*account/i],
    formActionDomains: ["microsoft.com", "microsoftonline.com", "live.com"],
  },
  {
    name: "Apple",
    domains: ["apple.com", "icloud.com", "appleid.apple.com"],
    titlePatterns: [/\bapple\s*id\b/i, /\bicloud\b/i, /\bsign\s*in.*apple/i],
    formActionDomains: ["apple.com", "icloud.com"],
  },
  {
    name: "Amazon",
    domains: ["amazon.com", "amazon.co.uk", "amazon.de", "amazon.fr", "amazon.co.jp", "amazonaws.com"],
    titlePatterns: [/\bamazon\b/i, /\bamazon\s*sign[\s-]*in\b/i],
    formActionDomains: ["amazon.com"],
  },
  {
    name: "PayPal",
    domains: ["paypal.com", "paypal.me"],
    titlePatterns: [/\bpaypal\b/i, /\blog\s*in\s*to\s*paypal\b/i],
    formActionDomains: ["paypal.com"],
  },
  {
    name: "Netflix",
    domains: ["netflix.com"],
    titlePatterns: [/\bnetflix\b/i, /\bsign\s*in.*netflix/i],
    formActionDomains: ["netflix.com"],
  },
  {
    name: "Facebook",
    domains: ["facebook.com", "fb.com", "facebookcorewwwi.onion"],
    titlePatterns: [/\bfacebook\b/i, /\blog\s*in.*facebook/i],
    formActionDomains: ["facebook.com", "fb.com"],
  },
  {
    name: "Instagram",
    domains: ["instagram.com"],
    titlePatterns: [/\binstagram\b/i, /\blog\s*in.*instagram/i],
    formActionDomains: ["instagram.com"],
  },
  {
    name: "Twitter",
    domains: ["twitter.com", "x.com"],
    titlePatterns: [/\btwitter\b/i, /\b(?:log\s*in|sign\s*in).*(?:twitter|x\.com)/i],
    formActionDomains: ["twitter.com", "x.com"],
  },
  {
    name: "LinkedIn",
    domains: ["linkedin.com"],
    titlePatterns: [/\blinkedin\b/i, /\bsign\s*in.*linkedin/i],
    formActionDomains: ["linkedin.com"],
  },
  {
    name: "Dropbox",
    domains: ["dropbox.com"],
    titlePatterns: [/\bdropbox\b/i, /\bsign\s*in.*dropbox/i],
    formActionDomains: ["dropbox.com"],
  },
  {
    name: "Adobe",
    domains: ["adobe.com", "adobelogin.com"],
    titlePatterns: [/\badobe\b/i, /\bsign\s*in.*adobe/i],
    formActionDomains: ["adobe.com"],
  },
  {
    name: "Yahoo",
    domains: ["yahoo.com", "yahooapis.com"],
    titlePatterns: [/\byahoo\b/i, /\bsign\s*in.*yahoo/i],
    formActionDomains: ["yahoo.com"],
  },
  {
    name: "Wells Fargo",
    domains: ["wellsfargo.com"],
    titlePatterns: [/\bwells\s*fargo\b/i, /\bsign\s*on.*wells\s*fargo/i],
    formActionDomains: ["wellsfargo.com"],
  },
  {
    name: "Chase",
    domains: ["chase.com"],
    titlePatterns: [/\bchase\b/i, /\bsign\s*in.*chase/i, /\bjpmorgan\s*chase\b/i],
    formActionDomains: ["chase.com"],
  },
  {
    name: "Bank of America",
    domains: ["bankofamerica.com", "bofa.com"],
    titlePatterns: [/\bbank\s*of\s*america\b/i, /\bbofa\b/i, /\bsign\s*in.*bank\s*of\s*america/i],
    formActionDomains: ["bankofamerica.com"],
  },
  {
    name: "Citibank",
    domains: ["citibank.com", "citi.com", "citibankonline.com"],
    titlePatterns: [/\bcitibank\b/i, /\bciti\b/i, /\bsign\s*on.*citi/i],
    formActionDomains: ["citibank.com", "citi.com"],
  },
  {
    name: "USPS",
    domains: ["usps.com"],
    titlePatterns: [/\busps\b/i, /\bunited\s*states\s*postal/i],
    formActionDomains: ["usps.com"],
  },
  {
    name: "DHL",
    domains: ["dhl.com", "dhl.de"],
    titlePatterns: [/\bdhl\b/i, /\bsign\s*in.*dhl/i],
    formActionDomains: ["dhl.com"],
  },
  {
    name: "FedEx",
    domains: ["fedex.com"],
    titlePatterns: [/\bfedex\b/i, /\bsign\s*in.*fedex/i],
    formActionDomains: ["fedex.com"],
  },
];

// ---------------------------------------------------------------------------
// Phishing kit fingerprints
// ---------------------------------------------------------------------------

export interface KitFingerprint {
  name: string;
  /** CSS selectors or attribute patterns to look for */
  selectors?: string[];
  /** Regex patterns to match against innerHTML snippets */
  htmlPatterns?: RegExp[];
  /** Meta tag patterns */
  metaPatterns?: Array<{ name: string; contentPattern: RegExp }>;
  /** Script variable names known to phishing kits */
  scriptVarPatterns?: RegExp[];
}

export const KIT_FINGERPRINTS: ReadonlyArray<KitFingerprint> = [
  {
    name: "16Shop",
    selectors: [".login-16shop", "#panel-16shop"],
    htmlPatterns: [/16shop/i, /panel16/i],
    scriptVarPatterns: [/\b16shop\b/i, /\bpanel16\b/i],
  },
  {
    name: "Kr3pto",
    selectors: [".kr3pto", "#kr3pto"],
    htmlPatterns: [/kr3pto/i],
    scriptVarPatterns: [/\bkr3pto\b/i],
  },
  {
    name: "LogoKit",
    htmlPatterns: [/logokit/i, /logo-kit/i],
    scriptVarPatterns: [/\blogokit\b/i],
  },
  {
    name: "Chase-XBALTI",
    htmlPatterns: [/xbalti/i, /x-balti/i],
    selectors: ["#xbalti-form", ".xbalti"],
  },
  {
    name: "Ex-Robotos",
    htmlPatterns: [/ex[-_]?robotos/i],
    scriptVarPatterns: [/\bexrobotos\b/i],
  },
  {
    name: "Bulletproof-Link",
    htmlPatterns: [/bulletprooflink/i, /bulletproof[-_]link/i],
    scriptVarPatterns: [/\bbulletprooflink\b/i],
  },
  {
    name: "EvilProxy",
    htmlPatterns: [/evilproxy/i, /evil[-_]proxy/i],
    scriptVarPatterns: [/\bevilproxy\b/i],
  },
  {
    name: "W3LL-Panel",
    htmlPatterns: [/w3ll[-_]?panel/i, /w3llstore/i],
    scriptVarPatterns: [/\bw3ll\b/i],
  },
  {
    name: "Greatness",
    htmlPatterns: [/greatness[-_]?phish/i],
    scriptVarPatterns: [/\bgreatnessphish\b/i],
  },
  {
    name: "Caffeine",
    htmlPatterns: [/caffeine[-_]?phish/i],
    scriptVarPatterns: [/\bcaffeinephish\b/i],
  },
  {
    name: "Robin-Banks",
    htmlPatterns: [/robin[-_]?banks/i],
    scriptVarPatterns: [/\brobinbanks\b/i],
  },
  {
    name: "BulletProofPanel",
    selectors: [".bp-panel", "#bp-login"],
    htmlPatterns: [/bp[-_]?panel/i],
  },
  {
    name: "Phish-Hidden-Iframe",
    selectors: ['iframe[style*="display:none"]', 'iframe[style*="visibility:hidden"]', 'iframe[width="0"]', 'iframe[height="0"]'],
  },
  {
    name: "Base64-Form-Action",
    htmlPatterns: [/action\s*=\s*["']data:/i, /action\s*=\s*["']javascript:/i],
  },
  {
    name: "Exfil-Hidden-Form",
    selectors: ['form[style*="display:none"]', 'form[style*="visibility:hidden"]'],
    htmlPatterns: [/<form[^>]*style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)/i],
  },
  {
    name: "Data-Exfil-Iframe",
    htmlPatterns: [/<iframe[^>]*src\s*=\s*["'](?:https?:\/\/[^"']*(?:collect|exfil|log|grab|steal|capture))/i],
  },
  {
    name: "Telegram-Exfil",
    htmlPatterns: [/api\.telegram\.org\/bot/i, /telegram[-_]?bot/i],
    scriptVarPatterns: [/\btelegram_bot\b/i, /\btgbot\b/i],
  },
  {
    name: "Discord-Webhook-Exfil",
    htmlPatterns: [/discord(?:app)?\.com\/api\/webhooks/i],
    scriptVarPatterns: [/\bdiscord_webhook\b/i],
  },
  {
    name: "Suspicious-Meta-Refresh",
    metaPatterns: [{ name: "refresh", contentPattern: /url\s*=\s*(?:data:|javascript:)/i }],
  },
  {
    name: "OTP-Kit",
    selectors: [".otp-phish", "#otp-intercept"],
    htmlPatterns: [/otp[-_]?intercept/i, /otp[-_]?phish/i],
  },
  {
    name: "Modlishka",
    htmlPatterns: [/modlishka/i],
    scriptVarPatterns: [/\bmodlishka\b/i],
  },
  {
    name: "Gophish",
    htmlPatterns: [/gophish/i, /go[-_]?phish/i],
    scriptVarPatterns: [/\bgophish\b/i],
    metaPatterns: [{ name: "generator", contentPattern: /gophish/i }],
  },
  {
    name: "Evilginx",
    htmlPatterns: [/evilginx/i],
    scriptVarPatterns: [/\bevilginx\b/i],
  },
  {
    name: "King-Phisher",
    htmlPatterns: [/king[-_]?phisher/i],
    scriptVarPatterns: [/\bkingphisher\b/i],
  },
  {
    name: "Hidden-Input-Harvester",
    selectors: ['input[type="hidden"][name*="token"]', 'input[type="hidden"][name*="session"]'],
    htmlPatterns: [/harvester/i],
  },
  {
    name: "SocialFish",
    htmlPatterns: [/socialfish/i],
    scriptVarPatterns: [/\bsocialfish\b/i],
  },
  {
    name: "Zphisher",
    htmlPatterns: [/zphisher/i],
    scriptVarPatterns: [/\bzphisher\b/i],
  },
  {
    name: "HiddenEye",
    htmlPatterns: [/hiddeneye/i, /hidden[-_]eye/i],
    scriptVarPatterns: [/\bhiddeneye\b/i],
  },
  {
    name: "Nexphisher",
    htmlPatterns: [/nexphisher/i],
    scriptVarPatterns: [/\bnexphisher\b/i],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if a domain matches any of the brand's known domains */
export function domainMatchesBrand(currentDomain: string, brand: BrandEntry): boolean {
  const current = normalizeHost(currentDomain);
  const currentReg = getRegistrableDomain(current);
  for (let i = 0; i < brand.domains.length; i++) {
    const brandDom = normalizeHost(brand.domains[i] ?? "");
    const brandReg = getRegistrableDomain(brandDom);
    if (current === brandDom || currentReg === brandReg) return true;
    // Allow subdomains of brand domains
    if (current.endsWith("." + brandDom)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Snapshot builder (runs in content script with real DOM)
// ---------------------------------------------------------------------------

/** Build a PageSnapshot from a live Document. Called in content script context. */
export function buildPageSnapshot(doc: Document): PageSnapshot {
  // Password field check
  let hasPassword = false;
  const pwInputs = doc.querySelectorAll('input[type="password"]');
  for (let i = 0; i < pwInputs.length; i++) {
    const input = pwInputs[i] as HTMLInputElement;
    if (input.disabled) continue;
    const style = input.getAttribute("style") || "";
    if (style.includes("display:none") || style.includes("display: none") ||
        style.includes("visibility:hidden") || style.includes("visibility: hidden")) {
      continue;
    }
    hasPassword = true;
    break;
  }

  // Body text
  const body = doc.body;
  const bodyText = body
    ? (body.innerText ?? body.textContent ?? "").slice(0, 5000).toLowerCase()
    : "";

  // HTML snippet
  const htmlSnippet = doc.documentElement.innerHTML.slice(0, 50000);

  // Script text
  const scripts = doc.querySelectorAll("script");
  let scriptText = "";
  const scriptLimit = Math.min(scripts.length, 30);
  for (let i = 0; i < scriptLimit; i++) {
    scriptText += ((scripts[i] as HTMLScriptElement).textContent || "") + " ";
  }
  scriptText = scriptText.slice(0, 30000);

  // Image signals
  const imgs = doc.querySelectorAll("img");
  let imgSignals = "";
  const imgLimit = Math.min(imgs.length, 50);
  for (let i = 0; i < imgLimit; i++) {
    const img = imgs[i] as HTMLImageElement;
    imgSignals += " " + (img.getAttribute("alt") || "").toLowerCase() +
                  " " + (img.getAttribute("src") || "").toLowerCase();
  }

  // Form actions
  const formActions: Array<{ action: string; hasPassword: boolean }> = [];
  const forms = doc.querySelectorAll("form");
  for (let i = 0; i < forms.length; i++) {
    const form = forms[i] as HTMLFormElement;
    const action = (form.getAttribute("action") || "").trim();
    const hasPw = !!form.querySelector('input[type="password"]');
    formActions.push({ action, hasPassword: hasPw });
  }

  // Meta tags
  const metaTags: Array<{ name: string; content: string }> = [];
  const metas = doc.querySelectorAll("meta[name], meta[http-equiv]");
  for (let i = 0; i < metas.length; i++) {
    const meta = metas[i] as HTMLMetaElement;
    const name = (meta.getAttribute("name") || meta.getAttribute("http-equiv") || "").toLowerCase();
    const content = meta.getAttribute("content") || "";
    if (name) metaTags.push({ name, content });
  }

  // Matched selectors (check all kit selectors)
  const matchedSelectors: string[] = [];
  const allSelectors = new Set<string>();
  for (let i = 0; i < KIT_FINGERPRINTS.length; i++) {
    const kit = KIT_FINGERPRINTS[i]!;
    if (kit.selectors) {
      for (let j = 0; j < kit.selectors.length; j++) {
        allSelectors.add(kit.selectors[j]!);
      }
    }
  }
  allSelectors.forEach((sel) => {
    try {
      if (doc.querySelector(sel)) matchedSelectors.push(sel);
    } catch {
      // Invalid selector, skip
    }
  });

  return {
    title: (doc.title || "").toLowerCase(),
    bodyText,
    htmlSnippet,
    scriptText,
    imgSignals,
    hasPasswordField: hasPassword,
    formActions,
    metaTags,
    matchedSelectors,
  };
}

// ---------------------------------------------------------------------------
// Brand detection (pure -- operates on snapshot)
// ---------------------------------------------------------------------------

function detectBrand(snapshot: PageSnapshot, currentDomain: string): BrandEntry | null {
  for (let i = 0; i < BRAND_DB.length; i++) {
    const brand = BRAND_DB[i]!;
    // Skip if current domain belongs to this brand
    if (domainMatchesBrand(currentDomain, brand)) continue;

    // Check title patterns
    for (let j = 0; j < brand.titlePatterns.length; j++) {
      if (brand.titlePatterns[j]!.test(snapshot.title)) return brand;
    }

    // Check visible text for brand name
    const brandLower = brand.name.toLowerCase();
    if (snapshot.bodyText.includes(brandLower)) return brand;

    // Check image signals
    if (snapshot.imgSignals.includes(brandLower)) return brand;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Phishing kit detection (pure -- operates on snapshot)
// ---------------------------------------------------------------------------

function detectPhishingKit(snapshot: PageSnapshot): KitFingerprint | null {
  for (let i = 0; i < KIT_FINGERPRINTS.length; i++) {
    const kit = KIT_FINGERPRINTS[i]!;

    // Check CSS selectors via matchedSelectors
    if (kit.selectors) {
      for (let j = 0; j < kit.selectors.length; j++) {
        if (snapshot.matchedSelectors.indexOf(kit.selectors[j]!) >= 0) return kit;
      }
    }

    // Check HTML patterns
    if (kit.htmlPatterns) {
      for (let j = 0; j < kit.htmlPatterns.length; j++) {
        if (kit.htmlPatterns[j]!.test(snapshot.htmlSnippet)) return kit;
      }
    }

    // Check meta tag patterns
    if (kit.metaPatterns) {
      for (let j = 0; j < kit.metaPatterns.length; j++) {
        const mp = kit.metaPatterns[j]!;
        for (let k = 0; k < snapshot.metaTags.length; k++) {
          const mt = snapshot.metaTags[k]!;
          if (mt.name === mp.name && mp.contentPattern.test(mt.content)) return kit;
        }
      }
    }

    // Check script variable patterns
    if (kit.scriptVarPatterns) {
      for (let j = 0; j < kit.scriptVarPatterns.length; j++) {
        if (kit.scriptVarPatterns[j]!.test(snapshot.scriptText)) return kit;
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Suspicious form action detection (pure -- operates on snapshot)
// ---------------------------------------------------------------------------

export interface SuspiciousFormResult {
  suspicious: boolean;
  reasons: string[];
}

function checkFormActions(snapshot: PageSnapshot, currentDomain: string): SuspiciousFormResult {
  const reasons: string[] = [];
  const currentReg = getRegistrableDomain(normalizeHost(currentDomain));

  for (let i = 0; i < snapshot.formActions.length; i++) {
    const entry = snapshot.formActions[i]!;
    const rawAction = entry.action;
    if (!rawAction) continue;

    const actionLower = rawAction.toLowerCase();

    // data: URI
    if (actionLower.startsWith("data:")) {
      reasons.push("Form action uses a data: URI");
      continue;
    }

    // javascript: URI
    if (actionLower.startsWith("javascript:")) {
      reasons.push("Form action uses a javascript: URI");
      continue;
    }

    // Base64-encoded URL in action
    if (/^[A-Za-z0-9+/=]{20,}$/.test(rawAction) || actionLower.includes("base64")) {
      reasons.push("Form action appears to be base64-encoded");
      continue;
    }

    // Cross-domain form action
    try {
      const actionUrl = new URL(rawAction, "https://" + currentDomain);
      const actionHost = normalizeHost(actionUrl.hostname);
      const actionReg = getRegistrableDomain(actionHost);
      if (actionReg && currentReg && actionReg !== currentReg) {
        if (entry.hasPassword) {
          reasons.push(`Password form submits to different domain: ${actionReg}`);
        }
      }
    } catch {
      if (rawAction.length > 0 && !rawAction.startsWith("#") && !rawAction.startsWith("/")) {
        reasons.push("Form action URL could not be parsed");
      }
    }
  }

  return { suspicious: reasons.length > 0, reasons };
}

// ---------------------------------------------------------------------------
// Main analysis function (pure -- operates on PageSnapshot)
// ---------------------------------------------------------------------------

export function analyzeSnapshot(snapshot: PageSnapshot, currentDomain: string): ContentAnalysisResult {
  const result: ContentAnalysisResult = {
    brandMismatch: false,
    phishingKitMatch: false,
    suspiciousFormAction: false,
    score: 0,
    reasons: [],
  };

  // 1. Brand / domain mismatch
  if (snapshot.hasPasswordField) {
    const brand = detectBrand(snapshot, currentDomain);
    if (brand) {
      result.brandMismatch = true;
      result.brandDetected = brand.name;
      result.score += 45;
      result.reasons.push(
        `Page references "${brand.name}" but domain "${currentDomain}" is not a known ${brand.name} domain`
      );
    }
  }

  // 2. Phishing kit fingerprints
  const kit = detectPhishingKit(snapshot);
  if (kit) {
    result.phishingKitMatch = true;
    result.kitName = kit.name;
    result.score += 40;
    result.reasons.push(`Phishing kit signature detected: ${kit.name}`);
  }

  // 3. Suspicious form actions
  const formCheck = checkFormActions(snapshot, currentDomain);
  if (formCheck.suspicious) {
    result.suspiciousFormAction = true;
    result.score += 25;
    for (let i = 0; i < formCheck.reasons.length; i++) {
      result.reasons.push(formCheck.reasons[i]!);
    }
  }

  // 4. Login form on unrecognizable domain mimicking branded flow
  if (snapshot.hasPasswordField && !result.brandMismatch) {
    const loginSignals = /(?:sign\s*in|log\s*in|password|authenticate|verify\s*(?:your|account)|secure\s*(?:login|access))/i;
    if (loginSignals.test(snapshot.title)) {
      const isKnown = BRAND_DB.some((b) => domainMatchesBrand(currentDomain, b));
      if (!isKnown) {
        result.score += 15;
        result.reasons.push(
          "Login page on unrecognized domain uses branded login flow language"
        );
      }
    }
  }

  result.score = Math.max(0, Math.min(100, result.score));
  return result;
}

/**
 * Convenience entry point: build snapshot from a live Document, then analyze.
 * This is the function called from credential_guard.ts.
 */
export function analyzePageContent(doc: Document, currentDomain: string): ContentAnalysisResult {
  const snapshot = buildPageSnapshot(doc);
  return analyzeSnapshot(snapshot, currentDomain);
}
