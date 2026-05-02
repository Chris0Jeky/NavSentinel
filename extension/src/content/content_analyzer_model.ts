import { getRegistrableDomain, normalizeHost } from "../shared/domain";

export interface ContentSignal {
  code: string;
  label: string;
  score: number;
}

export interface ContentAnalysisResult {
  signals: ContentSignal[];
  totalScore: number;
}

export interface BrandEntry {
  readonly brand: string;
  readonly domains: readonly string[];
  readonly titlePatterns: readonly RegExp[];
}

export const BRAND_TARGETS: readonly BrandEntry[] = [
  { brand: "Google", domains: ["google.com", "gmail.com", "accounts.google.com"], titlePatterns: [/\bgoogle\b/i, /\bgmail\b/i] },
  { brand: "Apple", domains: ["apple.com", "icloud.com", "appleid.apple.com"], titlePatterns: [/\bapple\b/i, /\bicloud\b/i, /\bapple\s*id\b/i] },
  { brand: "Microsoft", domains: ["microsoft.com", "live.com", "outlook.com", "microsoftonline.com"], titlePatterns: [/\bmicrosoft\b/i, /\boutlook\b/i, /\bhotmail\b/i] },
  { brand: "Amazon", domains: ["amazon.com", "amazon.co.uk", "amazon.de", "amazon.co.jp"], titlePatterns: [/\bamazon\b/i] },
  { brand: "PayPal", domains: ["paypal.com"], titlePatterns: [/\bpaypal\b/i] },
  { brand: "Netflix", domains: ["netflix.com"], titlePatterns: [/\bnetflix\b/i] },
  { brand: "Facebook", domains: ["facebook.com", "fb.com"], titlePatterns: [/\bfacebook\b/i, /\bmeta\b/i] },
  { brand: "Instagram", domains: ["instagram.com"], titlePatterns: [/\binstagram\b/i] },
  { brand: "WhatsApp", domains: ["whatsapp.com", "web.whatsapp.com"], titlePatterns: [/\bwhatsapp\b/i] },
  { brand: "Twitter/X", domains: ["twitter.com", "x.com"], titlePatterns: [/\btwitter\b/i] },
  { brand: "LinkedIn", domains: ["linkedin.com"], titlePatterns: [/\blinkedin\b/i] },
  { brand: "Dropbox", domains: ["dropbox.com"], titlePatterns: [/\bdropbox\b/i] },
  { brand: "Chase", domains: ["chase.com"], titlePatterns: [/\bchase\b/i] },
  { brand: "Wells Fargo", domains: ["wellsfargo.com"], titlePatterns: [/\bwells\s*fargo\b/i] },
  { brand: "Bank of America", domains: ["bankofamerica.com"], titlePatterns: [/\bbank\s*of\s*america\b/i] },
  { brand: "USPS", domains: ["usps.com"], titlePatterns: [/\busps\b/i] },
  { brand: "DHL", domains: ["dhl.com"], titlePatterns: [/\bdhl\b/i] },
  { brand: "FedEx", domains: ["fedex.com"], titlePatterns: [/\bfedex\b/i] },
  { brand: "Spotify", domains: ["spotify.com"], titlePatterns: [/\bspotify\b/i] },
  { brand: "Steam", domains: ["steampowered.com", "store.steampowered.com"], titlePatterns: [/\bsteam\b/i] },
  { brand: "Discord", domains: ["discord.com", "discordapp.com"], titlePatterns: [/\bdiscord\b/i] },
  { brand: "GitHub", domains: ["github.com"], titlePatterns: [/\bgithub\b/i] },
  { brand: "Yahoo", domains: ["yahoo.com"], titlePatterns: [/\byahoo\b/i] },
  { brand: "Coinbase", domains: ["coinbase.com"], titlePatterns: [/\bcoinbase\b/i] },
  { brand: "Binance", domains: ["binance.com"], titlePatterns: [/\bbinance\b/i] },
];

export const PHISHING_KIT_INLINE_PATTERNS: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /document\.location\s*=\s*['"]data:/i, label: "Script redirects to data: URI" },
  { pattern: /atob\s*\(\s*['"][A-Za-z0-9+/=]{20,}['"]\s*\)/i, label: "Base64 decoding of long payload" },
  { pattern: /\.telegram\.org\/bot/i, label: "Exfiltration to Telegram bot" },
  { pattern: /\.sendKeys|exfil|grabber|stealer/i, label: "Credential exfiltration pattern" },
  { pattern: /result\.php\?/i, label: "Common phishing kit result endpoint" },
  { pattern: /next\.php\?/i, label: "Common phishing kit next endpoint" },
  { pattern: /post\.php\?/i, label: "Common phishing kit post endpoint" },
  { pattern: /login_double/i, label: "Double-login phishing kit pattern" },
  { pattern: /getElementById\s*\(\s*['"]email['"]\s*\)\s*\.value/i, label: "Direct email field value exfiltration" },
];

export const BRAND_FAVICON_CDNS: readonly { pattern: RegExp; brand: string }[] = [
  { pattern: /google\.com\/favicon/i, brand: "Google" },
  { pattern: /gstatic\.com\/.*favicon/i, brand: "Google" },
  { pattern: /apple\.com\/.*favicon/i, brand: "Apple" },
  { pattern: /microsoft\.com\/.*favicon/i, brand: "Microsoft" },
  { pattern: /paypal\.com\/.*favicon/i, brand: "PayPal" },
  { pattern: /facebook\.com\/.*favicon/i, brand: "Facebook" },
  { pattern: /netflix\.com\/.*favicon/i, brand: "Netflix" },
  { pattern: /amazon\.com\/.*favicon/i, brand: "Amazon" },
  { pattern: /linkedin\.com\/.*favicon/i, brand: "LinkedIn" },
  { pattern: /dropbox\.com\/.*favicon/i, brand: "Dropbox" },
  { pattern: /github\.com\/.*favicon/i, brand: "GitHub" },
];

export function domainBelongsToBrand(pageDomain: string, brand: BrandEntry): boolean {
  for (let i = 0; i < brand.domains.length; i++) {
    const brandDomain = brand.domains[i];
    if (!brandDomain) continue;
    const brandReg = getRegistrableDomain(normalizeHost(brandDomain));
    if (brandReg && pageDomain === brandReg) return true;
  }
  return false;
}

export function checkBrandMismatch(
  pageDomain: string,
  hasLogin: boolean,
  visibleText: string
): ContentSignal[] {
  const signals: ContentSignal[] = [];
  if (!pageDomain || !hasLogin || !visibleText) return signals;

  for (let i = 0; i < BRAND_TARGETS.length; i++) {
    const brand = BRAND_TARGETS[i];
    if (!brand) continue;
    if (domainBelongsToBrand(pageDomain, brand)) continue;

    for (let j = 0; j < brand.titlePatterns.length; j++) {
      const pattern = brand.titlePatterns[j];
      if (!pattern) continue;
      if (pattern.test(visibleText)) {
        signals.push({
          code: "BRAND_DOMAIN_MISMATCH",
          label: `Login page references ${brand.brand} but domain is ${pageDomain}`,
          score: 40
        });
        break;
      }
    }
    if (signals.length > 0) break;
  }

  return signals;
}

export interface FormInfo {
  action: string;
  method: string;
}

export function checkFormActions(
  pageDomain: string,
  forms: readonly FormInfo[]
): ContentSignal[] {
  const signals: ContentSignal[] = [];

  for (let i = 0; i < forms.length; i++) {
    const form = forms[i];
    if (!form) continue;
    const raw = form.action.trim();
    if (!raw) continue;

    const lower = raw.toLowerCase();

    if (lower.startsWith("data:")) {
      signals.push({
        code: "FORM_ACTION_DATA_URI",
        label: "Form action uses a data: URI",
        score: 45
      });
      continue;
    }

    if (lower.startsWith("javascript:")) {
      signals.push({
        code: "FORM_ACTION_JAVASCRIPT",
        label: "Form action uses a javascript: URI",
        score: 35
      });
      continue;
    }

    const b64Match = raw.match(/[A-Za-z0-9+/=]{60,}/);
    if (b64Match) {
      signals.push({
        code: "FORM_ACTION_BASE64",
        label: "Form action contains base64-encoded URL",
        score: 40
      });
      continue;
    }

    if (pageDomain && raw.startsWith("http")) {
      try {
        const actionUrl = new URL(raw);
        const actionDomain = getRegistrableDomain(normalizeHost(actionUrl.hostname));
        if (actionDomain && actionDomain !== pageDomain) {
          if (form.method === "post") {
            signals.push({
              code: "FORM_ACTION_CROSS_DOMAIN_POST",
              label: `Form POSTs to different domain: ${actionDomain}`,
              score: 25
            });
          }
        }
      } catch {
        // malformed URL
      }
    }
  }

  return signals;
}

export function checkPhishingKitSelectors(
  matchedSelectors: readonly string[]
): ContentSignal[] {
  const signals: ContentSignal[] = [];
  for (let i = 0; i < matchedSelectors.length; i++) {
    const label = matchedSelectors[i];
    if (!label) continue;
    signals.push({
      code: "PHISHING_KIT_SELECTOR",
      label,
      score: 50
    });
  }
  return signals;
}

export function checkPhishingKitMeta(
  metaTags: readonly { name: string; content: string }[]
): ContentSignal[] {
  const signals: ContentSignal[] = [];
  for (let i = 0; i < metaTags.length; i++) {
    const meta = metaTags[i];
    if (!meta) continue;
    if (/^author$/i.test(meta.name) && /phish|scam|kit|hack/i.test(meta.content)) {
      signals.push({
        code: "PHISHING_KIT_META",
        label: `Phishing kit author meta tag: "${meta.content}"`,
        score: 50
      });
    }
    if (/phishing|scampage|cred[s\-_]?harvest/i.test(meta.content)) {
      signals.push({
        code: "PHISHING_KIT_META",
        label: "Phishing kit meta content",
        score: 50
      });
    }
  }
  return signals;
}

export function checkInlineScripts(
  scriptTexts: readonly string[]
): ContentSignal[] {
  const signals: ContentSignal[] = [];
  for (let i = 0; i < scriptTexts.length; i++) {
    const text = scriptTexts[i];
    if (!text || text.length > 50000) continue;
    for (let j = 0; j < PHISHING_KIT_INLINE_PATTERNS.length; j++) {
      const pat = PHISHING_KIT_INLINE_PATTERNS[j];
      if (!pat) continue;
      if (pat.pattern.test(text)) {
        signals.push({
          code: "PHISHING_KIT_SCRIPT",
          label: pat.label,
          score: 45
        });
      }
    }
  }
  return signals;
}

export function checkFaviconMismatch(
  pageDomain: string,
  faviconHrefs: readonly string[],
  imgSrcs: readonly string[]
): ContentSignal[] {
  const signals: ContentSignal[] = [];
  if (!pageDomain) return signals;

  for (let i = 0; i < faviconHrefs.length; i++) {
    const href = faviconHrefs[i];
    if (!href) continue;
    for (let j = 0; j < BRAND_FAVICON_CDNS.length; j++) {
      const entry = BRAND_FAVICON_CDNS[j];
      if (!entry) continue;
      if (entry.pattern.test(href)) {
        const matchingBrand = BRAND_TARGETS.find((b) => b.brand === entry.brand);
        if (matchingBrand && !domainBelongsToBrand(pageDomain, matchingBrand)) {
          signals.push({
            code: "FAVICON_BRAND_MISMATCH",
            label: `Favicon loaded from ${entry.brand} CDN but domain is ${pageDomain}`,
            score: 30
          });
          return signals;
        }
      }
    }
  }

  for (let i = 0; i < imgSrcs.length && i < 50; i++) {
    const src = imgSrcs[i];
    if (!src) continue;
    for (let j = 0; j < BRAND_FAVICON_CDNS.length; j++) {
      const entry = BRAND_FAVICON_CDNS[j];
      if (!entry) continue;
      if (entry.pattern.test(src)) {
        const matchingBrand = BRAND_TARGETS.find((b) => b.brand === entry.brand);
        if (matchingBrand && !domainBelongsToBrand(pageDomain, matchingBrand)) {
          signals.push({
            code: "LOGO_BRAND_MISMATCH",
            label: `Image loaded from ${entry.brand} CDN but domain is ${pageDomain}`,
            score: 25
          });
          return signals;
        }
      }
    }
  }

  return signals;
}

export function computeContentScore(signals: readonly ContentSignal[]): ContentAnalysisResult {
  let totalScore = 0;
  for (let i = 0; i < signals.length; i++) {
    const s = signals[i];
    if (s) totalScore += s.score;
  }
  totalScore = Math.min(totalScore, 100);
  return { signals: [...signals], totalScore };
}
