import { getRegistrableDomain, normalizeHost } from "../shared/domain";
import {
  checkBrandMismatch,
  checkFormActions,
  checkPhishingKitSelectors,
  checkPhishingKitMeta,
  checkInlineScripts,
  checkFaviconMismatch,
  computeContentScore,
} from "./content_analyzer_model";
import type { ContentAnalysisResult, FormInfo } from "./content_analyzer_model";

export type { ContentSignal, ContentAnalysisResult } from "./content_analyzer_model";

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

function getPageDomain(): string {
  try {
    return getRegistrableDomain(normalizeHost(location.hostname));
  } catch {
    return "";
  }
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
  const headings = document.querySelectorAll("h1, h2");
  let headingText = "";
  for (let i = 0; i < headings.length; i++) {
    const el = headings[i];
    if (el) headingText += " " + (el.textContent || "");
  }
  return (title + headingText).slice(0, 2000);
}

function collectForms(): FormInfo[] {
  const result: FormInfo[] = [];
  const forms = document.querySelectorAll("form");
  for (let i = 0; i < forms.length; i++) {
    const form = forms[i];
    if (!form) continue;
    result.push({
      action: form.getAttribute("action") || "",
      method: (form.getAttribute("method") || "").toLowerCase()
    });
  }
  return result;
}

function collectMatchedSelectors(): string[] {
  const matched: string[] = [];
  for (let i = 0; i < PHISHING_KIT_SELECTORS.length; i++) {
    const entry = PHISHING_KIT_SELECTORS[i];
    if (!entry) continue;
    try {
      if (document.querySelector(entry.selector)) {
        matched.push(entry.label);
      }
    } catch {
      // invalid selector
    }
  }
  return matched;
}

function collectMetaTags(): { name: string; content: string }[] {
  const result: { name: string; content: string }[] = [];
  const metas = document.querySelectorAll("meta");
  for (let i = 0; i < metas.length; i++) {
    const meta = metas[i];
    if (!meta) continue;
    result.push({
      name: meta.getAttribute("name") || "",
      content: meta.getAttribute("content") || ""
    });
  }
  return result;
}

function collectInlineScripts(): string[] {
  const result: string[] = [];
  const scripts = document.querySelectorAll("script:not([src])");
  for (let i = 0; i < scripts.length; i++) {
    const script = scripts[i];
    if (!script) continue;
    result.push(script.textContent || "");
  }
  return result;
}

function collectFaviconHrefs(): string[] {
  const result: string[] = [];
  const links = document.querySelectorAll('link[rel*="icon"], link[rel="shortcut icon"]');
  for (let i = 0; i < links.length; i++) {
    const link = links[i] as HTMLLinkElement | undefined;
    if (!link) continue;
    const href = link.getAttribute("href") || "";
    if (href) result.push(href);
  }
  return result;
}

function collectImgSrcs(): string[] {
  const result: string[] = [];
  const imgs = document.querySelectorAll("img");
  for (let i = 0; i < imgs.length && i < 50; i++) {
    const img = imgs[i] as HTMLImageElement | undefined;
    if (!img) continue;
    const src = img.getAttribute("src") || "";
    if (src) result.push(src);
  }
  return result;
}

export function analyzePageContent(): ContentAnalysisResult {
  const pageDomain = getPageDomain();
  const signals = [
    ...checkBrandMismatch(pageDomain, hasLoginForm(), getVisibleText()),
    ...checkFormActions(pageDomain, collectForms()),
    ...checkPhishingKitSelectors(collectMatchedSelectors()),
    ...checkPhishingKitMeta(collectMetaTags()),
    ...checkInlineScripts(collectInlineScripts()),
    ...checkFaviconMismatch(pageDomain, collectFaviconHrefs(), collectImgSrcs()),
  ];
  return computeContentScore(signals);
}
