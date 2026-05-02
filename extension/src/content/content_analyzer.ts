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

interface BrandEntry {
  readonly brand: string;
  readonly domains: readonly string[];
  readonly titlePatterns: readonly RegExp[];
}

const BRAND_TARGETS: readonly BrandEntry[] = [
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
] as const;

const PHISHING_KIT_SELECTORS: readonly { selector: string; label: string }[] = [
  { selector: '#loginform[action*="data:"]', label: 'Form #loginform with data: action' },
  { selector: 'div#phishing-page', label: 'Element with id "phishing-page"' },
  { selector: 'div#scam-page', label: 'Element with id "scam-page"' },
  { selector: 'input[name="login_xss"]', label: 'Input with suspicious XSS-related name' },
  { selector: 'form[id="fake-login"]', label: 'Form with id "fake-login"' },
  { selector: 'form[id="fakelogin"]', label: 'Form with id "fakelogin"' },
  { selector: 'input[name="vic_pass"]', label: 'Input collecting victim password' },
  { selector: 'input[name="vic_email"]', label: 'Input collecting victim email' },
  { selector: 'input[name="victim"]', label: 'Input named "victim"' },
];

const PHISHING_KIT_META_PATTERNS: readonly { attr: string; pattern: RegExp; label: string }[] = [
  { attr: "name", pattern: /^author$/i, label: "Phishing kit author meta tag" },
  { attr: "content", pattern: /phishing|scampage|cred[s\-_]?harvest/i, label: "Phishing kit meta content" },
];

const PHISHING_KIT_INLINE_PATTERNS: readonly { pattern: RegExp; label: string }[] = [
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

const BRAND_FAVICON_CDNS: readonly { pattern: RegExp; brand: string }[] = [
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

function getPageDomain(): string {
  try {
    return getRegistrableDomain(normalizeHost(location.hostname));
  } catch {
    return "";
  }
}

function domainBelongsToBrand(pageDomain: string, brand: BrandEntry): boolean {
  for (let i = 0; i < brand.domains.length; i++) {
    const brandDomain = brand.domains[i];
    if (!brandDomain) continue;
    const brandReg = getRegistrableDomain(normalizeHost(brandDomain));
    if (brandReg && pageDomain === brandReg) return true;
  }
  return false;
}

function hasPasswordField(): boolean {
  const inputs = document.querySelectorAll('input[type="password"]');
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i] as HTMLInputElement | undefined;
    if (input && !input.disabled) return true;
  }
  return false;
}

function hasLoginForm(): boolean {
  if (hasPasswordField()) return true;
  const forms = document.querySelectorAll("form");
  for (let i = 0; i < forms.length; i++) {
    const form = forms[i];
    if (!form) continue;
    const action = (form.getAttribute("action") || "").toLowerCase();
    if (action.includes("login") || action.includes("signin") || action.includes("auth")) {
      return true;
    }
  }
  return false;
}

function getVisibleText(): string {
  const title = document.title || "";
  const h1s = document.querySelectorAll("h1, h2");
  let headingText = "";
  for (let i = 0; i < h1s.length; i++) {
    const el = h1s[i];
    if (el) headingText += " " + (el.textContent || "");
  }
  return (title + headingText).slice(0, 2000);
}

export function detectBrandMismatch(): ContentSignal[] {
  const signals: ContentSignal[] = [];
  const pageDomain = getPageDomain();
  if (!pageDomain) return signals;

  const isLogin = hasLoginForm();
  if (!isLogin) return signals;

  const visibleText = getVisibleText();
  if (!visibleText) return signals;

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

export function detectSuspiciousFormActions(): ContentSignal[] {
  const signals: ContentSignal[] = [];
  const pageDomain = getPageDomain();
  const forms = document.querySelectorAll("form");

  for (let i = 0; i < forms.length; i++) {
    const form = forms[i];
    if (!form) continue;
    const raw = (form.getAttribute("action") || "").trim();
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
          const method = (form.getAttribute("method") || "").toLowerCase();
          if (method === "post") {
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

export function detectPhishingKitFingerprints(): ContentSignal[] {
  const signals: ContentSignal[] = [];

  for (let i = 0; i < PHISHING_KIT_SELECTORS.length; i++) {
    const entry = PHISHING_KIT_SELECTORS[i];
    if (!entry) continue;
    try {
      if (document.querySelector(entry.selector)) {
        signals.push({
          code: "PHISHING_KIT_SELECTOR",
          label: entry.label,
          score: 50
        });
      }
    } catch {
      // invalid selector
    }
  }

  const metaTags = document.querySelectorAll("meta");
  for (let i = 0; i < metaTags.length; i++) {
    const meta = metaTags[i];
    if (!meta) continue;
    for (let j = 0; j < PHISHING_KIT_META_PATTERNS.length; j++) {
      const mp = PHISHING_KIT_META_PATTERNS[j];
      if (!mp) continue;
      const val = meta.getAttribute(mp.attr) || "";
      if (mp.pattern.test(val) && val.length > 0) {
        if (mp.attr === "name" && mp.pattern.test(val)) {
          const content = meta.getAttribute("content") || "";
          if (/phish|scam|kit|hack/i.test(content)) {
            signals.push({
              code: "PHISHING_KIT_META",
              label: mp.label + `: "${content}"`,
              score: 50
            });
          }
        } else if (mp.attr === "content") {
          signals.push({
            code: "PHISHING_KIT_META",
            label: mp.label,
            score: 50
          });
        }
      }
    }
  }

  const scripts = document.querySelectorAll("script:not([src])");
  for (let i = 0; i < scripts.length; i++) {
    const script = scripts[i];
    if (!script) continue;
    const text = script.textContent || "";
    if (text.length > 50000) continue;
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

export function detectFaviconMismatch(): ContentSignal[] {
  const signals: ContentSignal[] = [];
  const pageDomain = getPageDomain();
  if (!pageDomain) return signals;

  const linkElements = document.querySelectorAll('link[rel*="icon"], link[rel="shortcut icon"]');
  for (let i = 0; i < linkElements.length; i++) {
    const link = linkElements[i] as HTMLLinkElement | undefined;
    if (!link) continue;
    const href = link.getAttribute("href") || "";
    if (!href) continue;

    for (let j = 0; j < BRAND_FAVICON_CDNS.length; j++) {
      const entry = BRAND_FAVICON_CDNS[j];
      if (!entry) continue;
      if (entry.pattern.test(href)) {
        const matchingBrand = BRAND_TARGETS.find(
          (b) => b.brand === entry.brand
        );
        if (matchingBrand && !domainBelongsToBrand(pageDomain, matchingBrand)) {
          signals.push({
            code: "FAVICON_BRAND_MISMATCH",
            label: `Favicon loaded from ${entry.brand} CDN but domain is ${pageDomain}`,
            score: 30
          });
          break;
        }
      }
    }
    if (signals.length > 0) break;
  }

  const imgElements = document.querySelectorAll("img");
  if (signals.length === 0) {
    for (let i = 0; i < imgElements.length && i < 50; i++) {
      const img = imgElements[i] as HTMLImageElement | undefined;
      if (!img) continue;
      const src = img.getAttribute("src") || "";
      if (!src) continue;

      for (let j = 0; j < BRAND_FAVICON_CDNS.length; j++) {
        const entry = BRAND_FAVICON_CDNS[j];
        if (!entry) continue;
        if (entry.pattern.test(src)) {
          const matchingBrand = BRAND_TARGETS.find(
            (b) => b.brand === entry.brand
          );
          if (matchingBrand && !domainBelongsToBrand(pageDomain, matchingBrand)) {
            signals.push({
              code: "LOGO_BRAND_MISMATCH",
              label: `Image loaded from ${entry.brand} CDN but domain is ${pageDomain}`,
              score: 25
            });
            break;
          }
        }
      }
      if (signals.length > 0) break;
    }
  }

  return signals;
}

export function analyzePageContent(): ContentAnalysisResult {
  const signals: ContentSignal[] = [
    ...detectBrandMismatch(),
    ...detectSuspiciousFormActions(),
    ...detectPhishingKitFingerprints(),
    ...detectFaviconMismatch(),
  ];

  let totalScore = 0;
  for (let i = 0; i < signals.length; i++) {
    const s = signals[i];
    if (s) totalScore += s.score;
  }
  totalScore = Math.min(totalScore, 100);

  return { signals, totalScore };
}
