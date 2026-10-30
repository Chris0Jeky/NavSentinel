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

import { getRegistrableDomain, hostForUrl, normalizeHost } from "../shared/domain";
import { hasVisiblePasswordField, queryPasswordInputs } from "./password_field";

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
  /**
   * Reason text for a pending meta refresh to another registrable domain
   * (#1144). Counted in `score` but kept out of `reasons` so the credential
   * guard can record it under its own reason code.
   */
  offsiteRefresh?: string;
}

/**
 * Minimal snapshot of page content needed for analysis.
 * Built from the real Document in the content script, but can be
 * constructed manually in tests without a DOM environment.
 */
export interface PageSnapshot {
  title: string;
  /** Body text content (head+tail sample over ~5000 chars) */
  bodyText: string;
  /** Full innerHTML of <html> (first ~10000 chars) */
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
  /**
   * Effective document base URL the browser resolves relative URLs against
   * (`document.baseURI`, honoring `<base href>`). Set by buildPageSnapshot;
   * manual snapshots may omit it, in which case relative form actions fall
   * back to resolving against the page domain (legacy behavior — misbinds
   * whenever a base element is present, same class as #650/#778). (#785)
   */
  baseUrl?: string;
  /**
   * `content` of each `<meta http-equiv="refresh">` in document order, at most
   * MAX_REFRESH_METAS + 1 (one past the cap marks unread ones), each sliced to MAX_REFRESH_CONTENT + 1 chars so a longer
   * value is known to be cut. Kept apart from `metaTags`, where name="refresh"
   * (inert metadata) and real directives share one key (#1131).
   */
  refreshContents?: string[];
}

// ---------------------------------------------------------------------------
// Brand database
// ---------------------------------------------------------------------------

export interface BrandEntry {
  name: string;
  domains: string[];
  titlePatterns: RegExp[];
  /**
   * When true, the brand name is a common English word (e.g. "apple",
   * "adobe", "chase") and bodyText-only matches must be suppressed to
   * avoid false positives.  These brands require a title or imgSignals
   * match before bodyText is considered.
   */
  commonWord?: boolean;
}

export const BRAND_DB: ReadonlyArray<BrandEntry> = [
  {
    name: "Google",
    domains: ["google.com", "accounts.google.com", "googleapis.com", "googlemail.com", "gmail.com"],
    titlePatterns: [/\bgoogle\b/i, /\bgmail\b/i, /\bsign\s*in\s*[-–]\s*google/i],
  },
  {
    name: "Microsoft",
    domains: ["microsoft.com", "live.com", "outlook.com", "microsoftonline.com", "office.com", "office365.com"],
    // Brand-specific -- the old generic "sign in to your account" matched any login page.
    titlePatterns: [/\bmicrosoft\b/i, /\boutlook\b/i, /\boffice\s*365\b/i, /\bmicrosoft\b.*sign\s*in|sign\s*in.*\bmicrosoft\b/i],
  },
  {
    name: "Apple",
    domains: ["apple.com", "icloud.com", "appleid.apple.com"],
    titlePatterns: [/\bapple\s*id\b/i, /\bicloud\b/i, /\bsign\s*in.*apple/i],
    commonWord: true,
  },
  {
    name: "Amazon",
    domains: ["amazon.com", "amazon.co.uk", "amazon.de", "amazon.fr", "amazon.co.jp", "amazonaws.com"],
    titlePatterns: [/\bamazon\b/i, /\bamazon\s*sign[\s-]*in\b/i],
  },
  {
    name: "PayPal",
    domains: ["paypal.com", "paypal.me"],
    titlePatterns: [/\bpaypal\b/i, /\blog\s*in\s*to\s*paypal\b/i],
  },
  {
    name: "Netflix",
    domains: ["netflix.com"],
    titlePatterns: [/\bnetflix\b/i, /\bsign\s*in.*netflix/i],
  },
  {
    name: "Facebook",
    domains: ["facebook.com", "fb.com", "facebookcorewwwi.onion"],
    titlePatterns: [/\bfacebook\b/i, /\blog\s*in.*facebook/i],
  },
  {
    name: "Instagram",
    domains: ["instagram.com"],
    titlePatterns: [/\binstagram\b/i, /\blog\s*in.*instagram/i],
  },
  {
    name: "Twitter",
    domains: ["twitter.com", "x.com"],
    titlePatterns: [/\btwitter\b/i, /\b(?:log\s*in|sign\s*in).*(?:twitter|x\.com)/i],
  },
  {
    name: "LinkedIn",
    domains: ["linkedin.com"],
    titlePatterns: [/\blinkedin\b/i, /\bsign\s*in.*linkedin/i],
  },
  {
    name: "Dropbox",
    domains: ["dropbox.com"],
    titlePatterns: [/\bdropbox\b/i, /\bsign\s*in.*dropbox/i],
  },
  {
    name: "Adobe",
    domains: ["adobe.com", "adobelogin.com"],
    titlePatterns: [/\badobe\b/i, /\bsign\s*in.*adobe/i],
    commonWord: true,
  },
  {
    name: "Yahoo",
    domains: ["yahoo.com", "yahooapis.com"],
    titlePatterns: [/\byahoo\b/i, /\bsign\s*in.*yahoo/i],
  },
  {
    name: "Wells Fargo",
    domains: ["wellsfargo.com"],
    titlePatterns: [/\bwells\s*fargo\b/i, /\bsign\s*on.*wells\s*fargo/i],
  },
  {
    name: "Chase",
    domains: ["chase.com"],
    // "chase" alone is a common English word -- require adjacent banking context.
    titlePatterns: [/\bchase\s*(bank|online|\.com)/i, /\bjpmorgan\s*chase\b/i, /\bsign\s*in.*chase\s*(bank|online|\.com)/i],
    commonWord: true,
  },
  {
    name: "Bank of America",
    domains: ["bankofamerica.com", "bofa.com"],
    titlePatterns: [/\bbank\s*of\s*america\b/i, /\bbofa\b/i, /\bsign\s*in.*bank\s*of\s*america/i],
  },
  {
    name: "Citibank",
    domains: ["citibank.com", "citi.com", "citibankonline.com"],
    titlePatterns: [/\bcitibank\b/i, /\bciti\b/i, /\bsign\s*on.*citi/i],
  },
  {
    name: "USPS",
    domains: ["usps.com"],
    titlePatterns: [/\busps\b/i, /\bunited\s*states\s*postal/i],
  },
  {
    name: "DHL",
    domains: ["dhl.com", "dhl.de"],
    titlePatterns: [/\bdhl\b/i, /\bsign\s*in.*dhl/i],
  },
  {
    name: "FedEx",
    domains: ["fedex.com"],
    titlePatterns: [/\bfedex\b/i, /\bsign\s*in.*fedex/i],
  },
];

// ---------------------------------------------------------------------------
// Phishing kit fingerprints
// ---------------------------------------------------------------------------

/**
 * Max chars of innerHTML serialized into the snapshot's htmlSnippet. The two
 * "exfil" htmlPatterns below derive their quantifier ceilings from this so a
 * bounded `{0,HTML_SNIPPET_MAX}` run matches exactly what an unbounded `*` would
 * (every snippet is ≤ this many chars) — keeping the regexes free of the
 * unbounded-quantifier ReDoS shape (#192) with zero detection change, and with
 * no risk of the slice and the bounds silently diverging.
 */
export const HTML_SNIPPET_MAX = 10000;

/**
 * Max chars scanned from `document.title`. `title` has no platform length limit
 * and is fully attacker-controlled, yet detectBrand/analyzeSnapshot run ~60 brand
 * titlePatterns + a loginSignals regex against it on the synchronous credential-
 * submit path, so an unbounded title would blow the documented <50ms budget. The
 * title is reduced via `boundedSample` (full head + short tail) so simple front-
 * padding doesn't push the brand/login text out of the scanned range; a calibrated
 * boundary placement can still evade the title channel (see #401), with the
 * bodyText/imgSignals channels as the backstop.
 */
export const MAX_TITLE_LEN = 1000;

/**
 * Max chars scanned from each `<img>` alt/src attribute. A `data:`-URI src can be
 * multi-MB; bounding each attribute (combined with the 50-image limit) caps the
 * whole signal string at ~50·2·(MAX_IMG_ATTR + a short tail) without an unbounded
 * concat. Reduced via `boundedSample` (full head + short tail) so a long URL path
 * can't bury the brand keyword (e.g. `.../paypal-logo.png`); every image's signal
 * is retained regardless of order (no truncating total cap that could drop a late
 * logo).
 */
export const MAX_IMG_ATTR = 512;

/**
 * Max number of `<form>` elements snapshotted, mirroring the 50-image limit. A
 * page with thousands of forms would otherwise pay a per-form getAttribute +
 * password querySelector + a full checkFormActions scan (URL parse + base64
 * regex) on the synchronous credential-submit path. Forms beyond the cap are not
 * snapshot-scanned for suspicious actions — an accepted bound consistent with the
 * module's other caps. A *credential* form beyond the cap is still covered:
 * credential_guard independently assesses the actual submitting form's own
 * action/formaction destination host at submit time, regardless of this list. (#401)
 */
export const MAX_FORMS = 50;

/**
 * Max chars kept from each form `action`. An `action` attribute has no length
 * limit and is attacker-controlled; a multi-MB action would make the base64
 * regex + URL parse in checkFormActions O(MB) each on the <50ms submit path. A
 * plain head slice (NOT boundedSample — the space boundedSample inserts is not in
 * the base64 alphabet and would defeat the base64-shape heuristic) preserves
 * detection: the scheme+host sit at the front (cross-domain check intact) and a
 * genuine base64 blob truncated to a multiple-of-4 head still satisfies
 * length%4===0 + the strict alphabet. Kept a multiple of 4 for exactly that. (#401)
 */
export const MAX_FORM_ACTION_LEN = 2048;

/**
 * Max chars kept from the concatenated inline-script text. Accumulated with
 * incremental slicing (not concat-then-slice) so multi-MB bundles never
 * materialize as an intermediate string on the synchronous submit path. The
 * output is byte-identical to the old concat-then-slice (same prefix of the
 * same joined sequence) — zero detection change. (#786)
 */
export const SCRIPT_TEXT_MAX = 30000;

/**
 * Max number of `<meta>` elements snapshotted, mirroring the form/image/script
 * count caps. `querySelectorAll` returns document order, so head generator /
 * refresh metas (the only ones any fingerprint reads) are retained; a hostile
 * page padding thousands of metas past the cap only drops unscanned ones.
 * (#786)
 */
export const MAX_METAS = 100;

/**
 * Refresh directives inspected (#1144). Only `http-equiv="refresh"` metas are
 * selected, so inert metas never spend this budget. A later declaration can
 * replace the scheduled one, so a page with more than this many gives no signal.
 */
export const MAX_REFRESH_METAS = 32;

/** Chars of a refresh `content` value parsed (#1144). */
export const MAX_REFRESH_CONTENT = 2048;

/**
 * Max chars of body text scanned for brand signals. Sampled by `sampleBodyText`
 * (single TreeWalker pass: full head + short tail), the same shape as the title
 * channel's boundedSample: a head-only slice let a hostile page bury the
 * brand/login text past the window with front padding, while the added tail
 * only costs `max>>2` extra scanned chars. Content placed precisely in the
 * omitted middle can still evade — inherent to the O(max) budget, backstopped
 * by the title/imgSignals channels.
 */
export const MAX_BODY_TEXT = 5000;

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
    // The substring selectors only match the no-space form `display:none`; a phishing page
    // writing the standard `display: none` (space after the colon), or hiding via inline CSS
    // dimensions `width: 0`/`height: 0` instead of the width/height attributes, evades them
    // entirely (#289). Mirror Exfil-Hidden-Form's HTML_SNIPPET_MAX-bounded fallback so the
    // space and CSS-dimension variants are still caught against the htmlSnippet.
    htmlPatterns: [
      new RegExp(
        String.raw`<iframe[^>]{0,${HTML_SNIPPET_MAX}}style\s*=\s*["'][^"']{0,${HTML_SNIPPET_MAX}}(?:display\s*:\s*none|visibility\s*:\s*hidden|(?:width|height)\s*:\s*0)`,
        "i",
      ),
    ],
  },
  {
    name: "Base64-Form-Action",
    htmlPatterns: [/action\s*=\s*["']data:/i, /action\s*=\s*["']javascript:/i],
  },
  {
    name: "Exfil-Hidden-Form",
    selectors: ['form[style*="display:none"]', 'form[style*="visibility:hidden"]'],
    // Built from HTML_SNIPPET_MAX (see above) so the ceiling can never drift from
    // the htmlSnippet slice: the prior `[^>]*`/`[^"']*` were the unbounded-run
    // shape #192 flagged, and a `{0,HTML_SNIPPET_MAX}` run matches exactly what `*`
    // did for any ≤-cap input — zero detection change, defense-in-depth only.
    htmlPatterns: [
      new RegExp(
        String.raw`<form[^>]{0,${HTML_SNIPPET_MAX}}style\s*=\s*["'][^"']{0,${HTML_SNIPPET_MAX}}(?:display\s*:\s*none|visibility\s*:\s*hidden)`,
        "i",
      ),
    ],
  },
  {
    name: "Data-Exfil-Iframe",
    // Same HTML_SNIPPET_MAX-derived ceiling as Exfil-Hidden-Form. This one has no
    // selector fallback, so the bound is the full snippet cap to avoid any false
    // negative from an attacker-padded src.
    htmlPatterns: [
      new RegExp(
        String.raw`<iframe[^>]{0,${HTML_SNIPPET_MAX}}src\s*=\s*["']https?://[^"']{0,${HTML_SNIPPET_MAX}}(?:collect|exfil|log|grab|steal|capture)`,
        "i",
      ),
    ],
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
    // Standard CSRF tokens and session IDs are normal -- only flag the
    // "harvester" keyword which is specific to phishing kits.
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

/**
 * Bounded sample of an attacker-controlled string for content scanning. Keeps the
 * full first `max` chars — so it never drops anything a plain head-only
 * `slice(0, max)` would have kept — PLUS a short `max>>2`-char tail, so brand/login
 * text pushed toward the front (a hostile `<title>`) or buried at the end of a long
 * URL path is still scanned. This is a bounded sample, not a full scan: content
 * placed precisely past the head boundary with calibrated trailing padding can
 * still land in the omitted middle `[max, len-(max>>2))`. That residual title-
 * channel gap (tracked on #401) is an inherent tradeoff of the O(max) budget and is
 * backstopped by the untouched bodyText/imgSignals detection channels.
 */
export function boundedSample(s: string, max: number): string {
  if (s.length <= max) return s;
  const tailStart = Math.max(max, s.length - (max >> 2));
  return s.slice(0, max) + " " + s.slice(tailStart);
}

/**
 * Tags whose subtree text is never rendered, so `innerText` never includes it.
 * sampleBodyText prunes these subtrees outright — parity with innerText, not a
 * heuristic. Compared case-insensitively: HTML tagName is already uppercase,
 * but inline SVG keeps its case (e.g. `<svg><script>`).
 */
const NON_RENDERED_TAGS: ReadonlySet<string> = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
]);

/**
 * True when a body subtree contributes no visible text and must be pruned from
 * the bodyText sample (#787). Three pruned classes:
 *   - non-rendered tags (script/style/noscript/template) — innerText parity;
 *   - the `hidden` attribute — matches innerText while the UA `[hidden]` rule
 *     applies; the exotic override case (author CSS re-showing a `[hidden]`
 *     subtree) is dropped here, backstopped by the title/img channels (same
 *     tradeoff class as the #401 middle-band gap);
 *   - INLINE display:none / visibility:hidden — the same inline-scope model as
 *     password_field.ts (`element.style` only, never stylesheets): the exact
 *     surface an attacker controls on a static phishing page, and readable
 *     without layout.
 *
 * Deliberately NOT consulted: stylesheets, classes, computed style,
 * `visibility:collapse`, opacity, off-screen positioning. Stylesheet-hidden
 * brand text is therefore INCLUDED (an FP-side gap vs innerText, confined to
 * the weak bodyText-only +10 tier); consulting getComputedStyle per element
 * would reintroduce the layout cost this sampler exists to avoid.
 */
function isPrunedBodyBranch(el: Element): boolean {
  const tag = Object.getOwnPropertyDescriptor(Element.prototype, "tagName")!.get!.call(el) as string;
  if (NON_RENDERED_TAGS.has(tag.toUpperCase())) return true;
  if (Element.prototype.hasAttribute.call(el, "hidden")) return true;
  // Avoid materializing an inline style declaration for every unstyled node.
  if (!Element.prototype.hasAttribute.call(el, "style")) return false;
  // `.style` is absent on non-HTML elements (e.g. inside an XML document);
  // those carry no inline style and cannot be inline-hidden.
  const style = (el as HTMLElement).style;
  if (!style) return false;
  return style.display === "none" || style.visibility === "hidden";
}

/**
 * Bounded body-text sample for brand detection (#787).
 *
 * Replaces the old `body.innerText` + slice: innerText forces a full-document
 * layout plus full-text serialization on the synchronous credential-submit
 * path, then threw all but ~5k chars away. This walks the body's text nodes
 * once with a TreeWalker and keeps a full `max`-char head plus a `max>>2`
 * trailing window, so the output has exactly the boundedSample shape (full
 * head, short tail, single-space join) with O(max) memory, zero layout, and
 * no full-document string ever materialized — a multi-MB text node
 * contributes only slices to the two bounded buffers.
 *
 * Hidden-text semantics: pruned subtrees (see isPrunedBodyBranch) contribute
 * nothing, matching innerText for the inline-hidden and non-rendered cases.
 * Accepted gaps vs innerText, all documented on isPrunedBodyBranch:
 * stylesheet-hidden text is included, `[hidden]` overridden visible by CSS is
 * dropped, block boundaries join with a single space instead of a newline
 * (detection-neutral for substring matching; a multi-word brand split across
 * two blocks may match where innerText's newline would not), and image alt
 * text is excluded here (covered by the imgSignals channel instead).
 *
 * Residual cost: the walk itself visits every text node and element once
 * (property reads only, no layout), so time scales with node count. Any node
 * cap would reopen the calibrated-evasion class the #401/#403 tail closed
 * (an attacker padding N junk nodes fore AND aft of the brand), so none is
 * applied. Case-mapping is left to the caller (buildPageSnapshot lowercases
 * the sample), matching the old sample-then-lowercase ordering so the
 * case-mapping work stays bounded by the sample.
 */
export function sampleBodyText(body: HTMLElement, max: number): string {
  const tailLen = max >> 2;
  const walker = body.ownerDocument!.createTreeWalker(
    body,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode(node: Node): number {
        if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
        // FILTER_REJECT prunes the whole subtree; FILTER_SKIP descends.
        // (The filter never sees the root `body` itself.)
        return isPrunedBodyBranch(node as Element)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_SKIP;
      },
    },
  );

  const headChunks: string[] = [];
  let headLen = 0;
  const tailChunks: string[] = [];
  let tailHeld = 0;
  let tailBase = 0;
  let total = 0;
  let first = true;

  const pushTail = (piece: string): void => {
    // Only the trailing `tailLen` chars of the stream can survive; when one
    // piece already covers them, its head is dropped outright.
    const keep = piece.length > tailLen ? piece.slice(-tailLen) : piece;
    tailChunks.push(keep);
    tailHeld += keep.length;
    // Amortized compaction: each held char moves O(1) times overall.
    if (tailHeld > tailLen * 2) {
      let drop = tailHeld - tailLen;
      while (drop > 0 && tailBase < tailChunks.length) {
        const c = tailChunks[tailBase]!;
        if (c.length <= drop) {
          drop -= c.length;
          tailHeld -= c.length;
          tailBase++;
        } else {
          tailChunks[tailBase] = c.slice(drop);
          tailHeld -= drop;
          drop = 0;
        }
      }
      if (tailBase > 64) {
        tailChunks.splice(0, tailBase);
        tailBase = 0;
      }
    }
  };

  let node = walker.nextNode();
  while (node) {
    const data = node.nodeValue || "";
    if (data) {
      const piece = first ? data : " " + data;
      first = false;
      total += piece.length;
      if (headLen < max) {
        const take = piece.slice(0, max - headLen);
        headChunks.push(take);
        headLen += take.length;
      }
      pushTail(piece);
    }
    node = walker.nextNode();
  }

  if (total <= max) return headChunks.join("");
  const tail = tailChunks.slice(tailBase).join("");
  // The tailLen>0 guard is load-bearing: slice(-0) is slice(0), the whole
  // buffer (#406) — only reachable with a degenerate max<4, but exact here.
  return headChunks.join("") + " " + (tailLen > 0 ? tail.slice(-tailLen) : "");
}

/**
 * Element count above which htmlSnippet comes from a bounded copy instead of
 * serializing the whole document on the synchronous submit path (#1085).
 * ponytail: element count is a proxy for serialization cost; a page with few
 * nodes but a multi-MB text or attribute still takes the innerHTML path. Gate on
 * markup size as well if that shows up in a profile.
 */
export const HTML_FAST_PATH_MAX_ELEMENTS = 10000;

/** First HTML_SNIPPET_MAX chars of the document markup, without serializing a huge DOM. */
function sampleHtml(doc: Document): string {
  const html = doc.documentElement;
  // Counting stops at the threshold, so the gate costs the same on a 200k-element page.
  const walker = doc.createTreeWalker(html, 1); // NodeFilter.SHOW_ELEMENT
  let count = 0;
  while (count <= HTML_FAST_PATH_MAX_ELEMENTS && walker.nextNode()) count++;
  if (count <= HTML_FAST_PATH_MAX_ELEMENTS) return html.innerHTML.slice(0, HTML_SNIPPET_MAX);
  // Huge DOM: shallow-copy nodes in document order into an inert document (no
  // script runs, nothing loads) until the markup passes the cap, then serialize
  // only that copy. Every charge is a lower bound on what the node serializes to
  // (opening tag only, so void elements are not overcharged; escaping only adds),
  // so the copy always covers the real prefix. It differs from the fast path only
  // where innerHTML reaches past childNodes, such as <template> contents.
  const inert = doc.implementation.createHTMLDocument("");
  const out = inert.createElement("html");
  let budget = HTML_SNIPPET_MAX;
  const copy = (from: Node, to: Node): void => {
    for (let n = from.firstChild; n && budget > 0; n = n.nextSibling) {
      budget -= n.nodeValue?.length ?? 0;
      if (n.nodeType === 1) {
        const el = n as Element;
        budget -= el.localName.length + 2;
        for (let i = 0; i < el.attributes.length; i++) {
          const a = el.attributes[i]!;
          budget -= a.name.length + a.value.length + 4;
        }
      }
      copy(n, to.appendChild(inert.importNode(n, false)));
    }
  };
  copy(html, out);
  return out.innerHTML.slice(0, HTML_SNIPPET_MAX);
}

/** Build a PageSnapshot from a live Document. Called in content script context. */
export function buildPageSnapshot(doc: Document): PageSnapshot {
  // Credential-page gate: shared visible-credential-field helper (#196).
  // Inline-hidden (display:none / visibility:hidden) fields are skipped so a
  // hidden honeypot doesn't trip the credential signals (#192).
  const hasPassword = hasVisiblePasswordField(doc);

  // Body text — bounded TreeWalker sample (see sampleBodyText), never a full
  // innerText serialization: innerText forces layout + full-document text
  // serialization on the synchronous submit path (#787).
  const body = doc.body;
  const bodyText = body ? sampleBodyText(body, MAX_BODY_TEXT).toLowerCase() : "";

  // HTML snippet -- limited to HTML_SNIPPET_MAX chars to avoid serializing the
  // entire DOM (the exfil htmlPatterns derive their quantifier bounds from this).
  const htmlSnippet = sampleHtml(doc);

  // Script text -- each script sliced to the remaining budget BEFORE concat,
  // so the intermediate string never exceeds SCRIPT_TEXT_MAX (a concat-then-
  // slice would first materialize the full multi-MB bundle text). Output is
  // identical to the old ordering: the same SCRIPT_TEXT_MAX-char prefix of the
  // same space-joined sequence.
  const scripts = doc.querySelectorAll("script");
  let scriptText = "";
  const scriptLimit = Math.min(scripts.length, 30);
  for (let i = 0; i < scriptLimit; i++) {
    const remaining = SCRIPT_TEXT_MAX - scriptText.length;
    if (remaining <= 0) break;
    scriptText += (((scripts[i] as HTMLScriptElement).textContent || "") + " ").slice(0, remaining);
  }

  // Image signals -- each alt/src is head+tail sampled to ~MAX_IMG_ATTR chars (a
  // multi-MB data:-URI src would otherwise blow the analysis budget). The 50-image
  // limit bounds the total; every image's signal is retained so image order can't
  // drop a brand match (see MAX_IMG_ATTR / boundedSample). Only slice/lowercase
  // present attributes to avoid needless allocations on the hot path.
  const imgs = doc.querySelectorAll("img");
  let imgSignals = "";
  const imgLimit = Math.min(imgs.length, 50);
  for (let i = 0; i < imgLimit; i++) {
    const img = imgs[i] as HTMLImageElement;
    const alt = img.getAttribute("alt");
    const src = img.getAttribute("src");
    imgSignals += " " + (alt ? boundedSample(alt, MAX_IMG_ATTR).toLowerCase() : "") +
                  " " + (src ? boundedSample(src, MAX_IMG_ATTR).toLowerCase() : "");
  }

  // Form actions -- capped at MAX_FORMS, and each action head-sliced to
  // MAX_FORM_ACTION_LEN so a multi-MB action can't blow the analysis budget (see
  // the constants). A plain slice (not boundedSample) is used to keep the base64
  // heuristic's alphabet/length%4 semantics intact.
  const formActions: Array<{ action: string; hasPassword: boolean }> = [];
  const forms = doc.querySelectorAll("form");
  const formLimit = Math.min(forms.length, MAX_FORMS);
  for (let i = 0; i < formLimit; i++) {
    const form = forms[i] as HTMLFormElement;
    // Slice the RAW attribute BEFORE trimming. .trim() scans inward to the
    // whitespace boundary, so trimming first leaves that scan O(len) on the full
    // attacker-controlled string — an action padded with megabytes of leading
    // whitespace would re-open the exact synchronous-DoS the cap closes. Slicing
    // first bounds trim() to O(MAX_FORM_ACTION_LEN). Consequence: meaningful
    // content buried past MAX_FORM_ACTION_LEN of leading whitespace is dropped
    // here (fundamental to any O(cap) bound), so a hostile page could pad a
    // password form's action to evade THIS page-wide cross-domain scan — but
    // credential_guard independently re-resolves the submitting form's real
    // destination host at submit time via `new URL` (which strips whitespace),
    // so the credential path is unaffected. (#407 R1)
    const rawAttr = Element.prototype.getAttribute.call(form, "action") || "";
    const bounded = rawAttr.length > MAX_FORM_ACTION_LEN
      ? rawAttr.slice(0, MAX_FORM_ACTION_LEN)
      : rawAttr;
    const action = bounded.trim();
    const hasPw = queryPasswordInputs(form).length > 0;
    formActions.push({ action, hasPassword: hasPw });
  }

  // Meta tags -- capped like every other channel (document order keeps the
  // head generator/refresh metas the fingerprints read).
  const metaTags: Array<{ name: string; content: string }> = [];
  const metas = doc.querySelectorAll("meta[name], meta[http-equiv]");
  const metaLimit = Math.min(metas.length, MAX_METAS);
  for (let i = 0; i < metaLimit; i++) {
    const meta = metas[i] as HTMLMetaElement;
    const name = (meta.getAttribute("name") || meta.getAttribute("http-equiv") || "").toLowerCase();
    const content = meta.getAttribute("content") || "";
    if (name) metaTags.push({ name, content });
  }

  // Refresh directives -- their own channel. The selector matches the
  // http-equiv keyword exactly and ASCII case-insensitively, as the browser
  // does, so name="refresh" and inert metas never reach the cap.
  const refreshContents: string[] = [];
  const refreshMetas = doc.querySelectorAll('meta[http-equiv="refresh" i][content]');
  // One past the cap, so the analysis knows unread declarations exist.
  const refreshLimit = Math.min(refreshMetas.length, MAX_REFRESH_METAS + 1);
  for (let i = 0; i < refreshLimit; i++) {
    refreshContents.push((refreshMetas[i]!.getAttribute("content") || "").slice(0, MAX_REFRESH_CONTENT + 1));
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
    title: boundedSample(doc.title || "", MAX_TITLE_LEN).toLowerCase(),
    bodyText,
    htmlSnippet,
    scriptText,
    imgSignals,
    hasPasswordField: hasPassword,
    formActions,
    metaTags,
    matchedSelectors,
    baseUrl: doc.baseURI,
    refreshContents,
  };
}

// ---------------------------------------------------------------------------
// Brand detection (pure -- operates on snapshot)
// ---------------------------------------------------------------------------

/** Signal tiers: which evidence channels matched for a brand. */
export interface BrandSignal {
  brand: BrandEntry;
  titleMatch: boolean;
  imgMatch: boolean;
  bodyTextMatch: boolean;
  /** Tiered score contribution:
   *  title+img = 45, title only = 30, bodyText only = 10, img only = 15 */
  score: number;
}

/**
 * Token-boundary substring test for common-word brands in imgSignals (#831).
 * Filenames and URLs ("purchase-logo.png", "pineapple.png") otherwise match
 * "chase"/"apple" mid-word and mint a spurious img-only (+15) signal. The
 * boundary is any non-alphanumeric character rather than `\b`, because
 * JavaScript treats "_" as a word character and "apple_logo.png" must still
 * match. Both inputs are already lowercased.
 */
function matchesWordBoundary(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(haystack);
}

function detectBrand(snapshot: PageSnapshot, currentDomain: string): BrandSignal | null {
  let best: BrandSignal | null = null;

  for (let i = 0; i < BRAND_DB.length; i++) {
    const brand = BRAND_DB[i]!;
    // Skip if current domain belongs to this brand
    if (domainMatchesBrand(currentDomain, brand)) continue;

    let titleMatch = false;
    let imgMatch = false;
    let bodyTextMatch = false;

    // Check title patterns
    for (let j = 0; j < brand.titlePatterns.length; j++) {
      if (brand.titlePatterns[j]!.test(snapshot.title)) {
        titleMatch = true;
        break;
      }
    }

    // Check image signals (favicon / logo src / alt text)
    const brandLower = brand.name.toLowerCase();
    if (brand.commonWord ? matchesWordBoundary(snapshot.imgSignals, brandLower) : snapshot.imgSignals.includes(brandLower)) {
      imgMatch = true;
    }

    // Check visible body text for brand name.
    // For common-word brands (apple, adobe, chase) bodyText alone is
    // suppressed -- they need at least a title or img match first.
    if (snapshot.bodyText.includes(brandLower)) {
      if (!brand.commonWord || titleMatch || imgMatch) {
        bodyTextMatch = true;
      }
    }

    // At least one signal must fire
    if (!titleMatch && !imgMatch && !bodyTextMatch) continue;

    // Tiered scoring
    let score: number;
    if (titleMatch && imgMatch) {
      score = 45; // strongest: title + favicon/logo
    } else if (titleMatch) {
      score = 30; // title only
    } else if (imgMatch) {
      score = 15; // img only
    } else {
      // bodyTextMatch only -- weak signal
      score = 10;
    }

    if (!best || score > best.score) {
      best = { brand, titleMatch, imgMatch, bodyTextMatch, score };
    }
  }

  return best;
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

    // Base64-encoded URL in action. The base64 alphabet shares '/' with URL paths, so the
    // bare charset+length test false-flagged ordinary relative actions like
    // "/loginProcessSubmitFormUser" and "/api/v2/auth/submitCredentials" (#288). Tighten it
    // to genuine base64 shape: a length that is a multiple of 4 (base64 block alignment),
    // the strict alphabet with padding only at the very end, and NOT an absolute path
    // (leading '/') — the form every documented false positive took. A real encoded blob
    // such as the "https://..."-encoding `aHR0cHM6Ly9...` still matches. The explicit
    // "base64" keyword check is retained.
    const looksBase64Action =
      rawAction.length >= 20 &&
      rawAction.length % 4 === 0 &&
      !rawAction.startsWith("/") &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(rawAction);
    if (looksBase64Action || actionLower.includes("base64")) {
      reasons.push("Form action appears to be base64-encoded");
      continue;
    }

    // Cross-domain form action. Relative actions resolve against the observed
    // effective base URL, matching what the browser actually submits to — the
    // page-derived base is only the fallback for snapshots that predate it
    // and misbinds whenever a base element is present (#785).
    const base = snapshot.baseUrl || "https://" + hostForUrl(currentDomain);
    try {
      // Re-bracket an IPv6-literal host so the base URL is valid: currentDomain is
      // an unbracketed registrable domain and "https://::1" would throw (#208 R1).
      const actionUrl = new URL(rawAction, base);
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
// Off-site meta refresh (#1144) (pure -- operates on snapshot)
// ---------------------------------------------------------------------------

const isAsciiSpace = (c: string | undefined): boolean =>
  c === " " || c === "\t" || c === "\n" || c === "\f" || c === "\r";
const isDigit = (c: string | undefined): boolean => c !== undefined && c >= "0" && c <= "9";

/**
 * Lexical part of the HTML "shared declarative refresh steps"
 * (https://html.spec.whatwg.org/multipage/semantics.html#shared-declarative-refresh-steps).
 * Returns undefined when the steps return early (no refresh is scheduled).
 * Otherwise `delay` is the whole seconds (the fraction is ignored) and `url` is
 * null for a refresh of the document's own URL, else the URL string as written.
 * Chrome follows this digit-only grammar, not a decimal parser (probed in
 * Chromium 143, #1241): "1e0", "3e2", "+1", "-1", "0x1" and "Infinity" never
 * schedule, while "1.5", "1." and "1.5.6" run after 1s and ".5" or "0.9" at once.
 * One linear pass, no regex over page text.
 */
export function parseRefreshContent(input: string): { delay: number; url: string | null } | undefined {
  const n = input.length;
  let p = 0;
  while (isAsciiSpace(input[p])) p++;
  const digits = p;
  while (isDigit(input[p])) p++;
  if (p === digits && input[p] !== ".") return undefined;
  const delay = p === digits ? 0 : Number(input.slice(digits, p));
  const r = (url: string | null) => ({ delay, url });
  while (isDigit(input[p]) || input[p] === ".") p++;
  if (p < n) {
    if (input[p] !== ";" && input[p] !== "," && !isAsciiSpace(input[p])) return undefined;
    while (isAsciiSpace(input[p])) p++;
    if (input[p] === ";" || input[p] === ",") p++;
    while (isAsciiSpace(input[p])) p++;
  }
  if (p >= n) return r(null);
  const start = p;
  if (input[p] === "U" || input[p] === "u") {
    p++;
    if (input[p] !== "R" && input[p] !== "r") return r(input.slice(start));
    p++;
    if (input[p] !== "L" && input[p] !== "l") return r(input.slice(start));
    p++;
    while (isAsciiSpace(input[p])) p++;
    if (input[p] !== "=") return r(input.slice(start));
    p++;
    while (isAsciiSpace(input[p])) p++;
  }
  const quote = input[p] === "'" || input[p] === '"' ? input[p++]! : "";
  const end = quote ? input.indexOf(quote, p) : -1;
  return r(end < 0 ? input.slice(p) : input.slice(p, end));
}

/** Chromium's HttpRefreshScheduler ignores delays above INT_MAX seconds. */
const MAX_REFRESH_DELAY = 2147483647;

/**
 * Reported when a credential page's refresh declarations cannot be read in full
 * (more than MAX_REFRESH_METAS, or a value cut at MAX_REFRESH_CONTENT before its
 * target is settled). No real sign-in page needs either, so it fails closed.
 */
const REFRESH_UNREADABLE = "Page refresh tags are too many or too long to check";

/**
 * True when text appended to a refresh URL cut at the length cap cannot change
 * which site it targets: a relative reference whose first characters are final,
 * a non-http(s) scheme, or an http(s) authority already ended by / \ ? or #.
 * Mirrors the WHATWG URL parser's leading C0/space and tab/newline stripping.
 */
function refreshTargetSettled(url: string): boolean {
  let s = url.replace(/[\t\n\r]/g, "");
  let i = 0;
  while (i < s.length && s.charCodeAt(i) <= 32) i++;
  s = s.slice(i);
  const slash = (c: string | undefined) => c === "/" || c === "\\";
  const ended = (authority: string) => /[/\\?#]/.test(authority);
  if (slash(s[0])) return s.length > 1 && (!slash(s[1]) || ended(s.slice(2)));
  const scheme = /^[A-Za-z][A-Za-z0-9+.-]*/.exec(s)?.[0];
  if (!scheme) return true;
  if (scheme.length === s.length) return false; // may still grow into a scheme
  if (s[scheme.length] !== ":" || !/^https?$/i.test(scheme)) return true;
  return ended(s.slice(scheme.length + 1).replace(/^[/\\]+/, ""));
}

/**
 * Registrable domain of the pending refresh target when it leaves the page's
 * site, else null. Selects the refresh Chromium keeps scheduled: in document
 * order, a declaration replaces the scheduled one unless that one is sooner
 * (HttpRefreshScheduler::Schedule); an empty target reloads the document URL,
 * ignoring <base> (Chromium's behaviour; the HTML spec would resolve "" against
 * the base URL), and a javascript: target is refused without replacing
 * (Document::MaybeHandleHttpRefresh). Reads only the current DOM: a refresh
 * from an HTTP header or a meta removed after insertion is not seen.
 */
function offsiteRefreshTarget(snapshot: PageSnapshot, currentDomain: string): string | null {
  const contents = snapshot.refreshContents;
  const currentReg = getRegistrableDomain(normalizeHost(currentDomain));
  if (!snapshot.hasPasswordField || !contents || !currentReg) return null;
  // More declarations than the bound: an unread later one could replace any choice.
  if (contents.length > MAX_REFRESH_METAS) return REFRESH_UNREADABLE;
  const base = snapshot.baseUrl || "https://" + hostForUrl(currentDomain) + "/";
  let scheduledDelay = Infinity;
  let offsite: string | null = null;
  for (let i = 0; i < contents.length; i++) {
    const cut = contents[i]!.length > MAX_REFRESH_CONTENT;
    const parsed = parseRefreshContent(contents[i]!.slice(0, MAX_REFRESH_CONTENT));
    // A cut value that parses as a refresh without a complete target could still
    // be the one scheduled. A value that is only padding so far is undecided too;
    // one that already fails to parse is never scheduled, whatever follows.
    if (cut && (parsed ? !parsed.url : !contents[i]!.trim())) return REFRESH_UNREADABLE;
    if (!parsed || parsed.delay > MAX_REFRESH_DELAY || parsed.delay > scheduledDelay) continue;
    if (!parsed.url) {
      scheduledDelay = parsed.delay;
      offsite = null;
      continue;
    }
    let target: URL;
    try {
      // Slicing can manufacture a different destination ("/" for "//evil.test/",
      // "https://evil.ex" for "https://evil.example/"): trust it only once settled.
      if (cut && !refreshTargetSettled(parsed.url)) return REFRESH_UNREADABLE;
      target = new URL(parsed.url, base);
    } catch {
      if (cut) return REFRESH_UNREADABLE;
      continue; // an unparseable URL schedules nothing
    }
    if (target.protocol === "javascript:") continue;
    scheduledDelay = parsed.delay;
    const targetReg = target.protocol === "http:" || target.protocol === "https:"
      ? getRegistrableDomain(normalizeHost(target.hostname))
      : "";
    offsite = targetReg && targetReg !== currentReg ? targetReg : null;
  }
  return offsite;
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

  // 1. Brand / domain mismatch (tiered scoring)
  if (snapshot.hasPasswordField) {
    const signal = detectBrand(snapshot, currentDomain);
    if (signal) {
      result.brandMismatch = true;
      result.brandDetected = signal.brand.name;
      result.score += signal.score;
      const channels: string[] = [];
      if (signal.titleMatch) channels.push("title");
      if (signal.imgMatch) channels.push("img");
      if (signal.bodyTextMatch) channels.push("bodyText");
      result.reasons.push(
        `Page references "${signal.brand.name}" (${channels.join("+")}) but domain "${currentDomain}" is not a known ${signal.brand.name} domain`
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

  // Credential page with a pending refresh to another site (#1144). Read at
  // submit time: a zero-delay refresh leaves before any submit can happen.
  const refreshTarget = offsiteRefreshTarget(snapshot, currentDomain);
  if (refreshTarget) {
    result.score += 25;
    result.offsiteRefresh = refreshTarget === REFRESH_UNREADABLE
      ? refreshTarget
      : `Page is set to send you to a different site: ${refreshTarget}`;
  }

  // 4. Login form on unrecognizable domain mimicking branded flow
  //    Kept at a very low score (+5) to avoid FPs on small-business login pages.
  if (snapshot.hasPasswordField && !result.brandMismatch) {
    const loginSignals = /(?:sign\s*in|log\s*in|password|authenticate|verify\s*(?:your|account)|secure\s*(?:login|access))/i;
    if (loginSignals.test(snapshot.title)) {
      const isKnown = BRAND_DB.some((b) => domainMatchesBrand(currentDomain, b));
      if (!isKnown) {
        result.score += 5;
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
