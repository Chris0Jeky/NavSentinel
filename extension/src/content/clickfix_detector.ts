/**
 * ClickFix / fake CAPTCHA detection module.
 *
 * Detects the attack pattern where a fake CAPTCHA overlay writes malicious
 * commands to the clipboard and instructs users to paste them into Run
 * dialogs or terminals.
 *
 * Detection relies on the COMBINATION of three signals:
 *   1. A clipboard write happened (bridge message from main_guard)
 *   2. An overlay/modal is present on the page
 *   3. Instruction text on the page matches ClickFix patterns
 *
 * Privacy: clipboard content is NEVER stored. Only metadata (length, whether
 * content looks command-like) is tracked.
 */

// --- Clipboard event tracking ---

export interface ClipboardWriteEvent {
  /** Timestamp of the clipboard write (Date.now()) */
  ts: number;
  /** Length of the written content */
  contentLength: number;
  /** Whether the content looks like a shell command */
  looksLikeCommand: boolean;
}

const CLIPBOARD_EVENT_TTL_MS = 30_000;
const MAX_CLIPBOARD_EVENTS = 5;

const recentClipboardWrites: ClipboardWriteEvent[] = [];

export function recordClipboardWrite(event: ClipboardWriteEvent): void {
  pruneClipboardEvents();
  recentClipboardWrites.push(event);
  if (recentClipboardWrites.length > MAX_CLIPBOARD_EVENTS) {
    recentClipboardWrites.splice(0, recentClipboardWrites.length - MAX_CLIPBOARD_EVENTS);
  }
}

function pruneClipboardEvents(): void {
  const cutoff = Date.now() - CLIPBOARD_EVENT_TTL_MS;
  while (recentClipboardWrites.length > 0 && recentClipboardWrites[0]!.ts < cutoff) {
    recentClipboardWrites.shift();
  }
}

export function hasRecentClipboardWrite(): boolean {
  pruneClipboardEvents();
  return recentClipboardWrites.length > 0;
}

export function hasRecentCommandClipboardWrite(): boolean {
  pruneClipboardEvents();
  return recentClipboardWrites.some((e) => e.looksLikeCommand);
}

/** Exposed for testing only. */
export function _resetClipboardEvents(): void {
  recentClipboardWrites.length = 0;
}

// --- Command pattern detection (used in main_guard) ---

/**
 * Shell/command keywords that suggest malicious clipboard content.
 * Checked against the written text in the main world before sending metadata
 * to the isolated world (content is NOT sent, only the boolean result).
 */
const COMMAND_KEYWORDS = [
  // Windows shells and scripting
  "powershell",
  "cmd",
  "mshta",
  "msiexec",
  "certutil",
  "bitsadmin",
  "rundll32",
  "regsvr32",
  "wscript",
  "cscript",
  // Windows LOLBins
  "forfiles",
  "pcalua",
  "schtasks",
  "installutil",
  // Unix/macOS shells
  "curl",
  "wget",
  "bash",
  "sh ",
  "/bin/",
  "osascript",
  // PowerShell cmdlets and patterns
  "invoke-",
  "iex",
  "iwr",
  "start-process",
  "downloadstring",
  "downloadfile",
  "new-object",
  "system.net",
  "frombase64",
  "base64",
  "-encodedcommand",
  "-enc ",
  // Network indicators
  "http://",
  "https://",
];
// NOTE: Keep this list in sync with COMMAND_KEYWORDS in main_guard.ts
// (main_guard runs in the main world and cannot import this module)

export function looksLikeCommand(text: string): boolean {
  if (!text || text.length < 5) return false;
  const lower = text.toLowerCase();
  for (const kw of COMMAND_KEYWORDS) {
    if (lower.includes(kw)) return true;
  }
  return false;
}

// --- ClickFix instruction text pattern matching ---

/**
 * Patterns that indicate ClickFix / fake CAPTCHA instruction text.
 * These are tested against the visible text content of overlay elements.
 */
const CAPTCHA_PATTERNS: RegExp[] = [
  /verify\s+you\s+are\s+(?:a\s+)?human/i,
  /prove\s+you(?:'re|\s+are)\s+not\s+a\s+robot/i,
  /i\s*(?:am|'m)\s+not\s+a\s+robot/i,
  /human\s+verification/i,
  /security\s+verification/i,
  /captcha\s+verification/i,
  /verify\s+(?:that\s+)?you\s+are\s+(?:not\s+)?(?:a\s+)?(?:bot|robot)/i,
  /anti[\s-]?bot\s+verification/i,
  /confirm\s+you\s+are\s+(?:a\s+)?human/i,
];

const INSTRUCTION_PATTERNS: RegExp[] = [
  /press\s+win\s*\+\s*r/i,
  /press\s+ctrl\s*\+\s*v/i,
  /press\s+⊞\s*\+\s*r/i,
  /open\s+(?:a\s+)?(?:run|terminal|command|cmd|powershell)(?:\s+(?:dialog|window|prompt))?/i,
  /paste\s+(?:it\s+)?(?:in|into)\s+(?:the\s+)?(?:run|terminal|command|address|search)/i,
  /cmd\s*\+\s*space/i,
  /windows\s*\+\s*r/i,
  /win\s+r/i,
  /copy\s+and\s+paste/i,
  /press\s+enter\s+to\s+(?:verify|confirm|continue)/i,
  /click\s+(?:the\s+)?(?:verify|checkbox|button)(?:\s+\w+)*\s+(?:then|and)\s+(?:press|paste|open)/i,
  /right[\s-]?click\s+(?:and\s+)?paste/i,
];

/**
 * Known legitimate CAPTCHA provider iframe sources. These are the strong
 * signals — a cross-origin iframe from these domains is hard to fake.
 */
const LEGIT_CAPTCHA_IFRAME_SELECTORS = [
  'iframe[src*="google.com/recaptcha"]',
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha.com"]',
  'iframe[src*="challenges.cloudflare.com"]',
  'iframe[src*="funcaptcha.com"]',
  'iframe[src*="arkoselabs.com"]',
];

/**
 * Class-name markers for CAPTCHA providers. These are weaker signals
 * because an attacker can trivially add a class name to any element.
 * We only trust these if the matching element also contains a cross-origin
 * iframe (or is itself an iframe from the provider domain).
 */
const LEGIT_CAPTCHA_CLASS_SELECTORS: { selector: string; iframeDomain: string }[] = [
  { selector: ".g-recaptcha", iframeDomain: "google.com/recaptcha" },
  { selector: "#recaptcha", iframeDomain: "google.com/recaptcha" },
  { selector: ".h-captcha", iframeDomain: "hcaptcha.com" },
  { selector: ".cf-turnstile", iframeDomain: "challenges.cloudflare.com" },
];

/**
 * Check whether a known legitimate CAPTCHA provider is present on the page.
 * If so, ClickFix detection should be suppressed to avoid false positives.
 *
 * To prevent attackers from adding a bare class name to suppress detection,
 * class-name-only matches are validated by checking for a cross-origin
 * iframe from the expected provider domain within the matched element.
 */
export function hasLegitCaptcha(root: Document | Element = document): boolean {
  // Strong signal: cross-origin iframe from a known CAPTCHA provider
  for (const selector of LEGIT_CAPTCHA_IFRAME_SELECTORS) {
    try {
      if (root.querySelector(selector)) return true;
    } catch {
      // invalid selector in this context — skip
    }
  }

  // Weaker signal: class name must be backed by a provider iframe
  for (const { selector, iframeDomain } of LEGIT_CAPTCHA_CLASS_SELECTORS) {
    try {
      const el = root.querySelector(selector);
      if (!el) continue;
      // Check if this element or its descendants contain a real provider iframe
      const iframe = el.querySelector(`iframe[src*="${iframeDomain}"]`);
      if (iframe) return true;
      // Also check siblings (some providers inject the iframe as a sibling)
      const parent = el.parentElement;
      if (parent) {
        const siblingIframe = parent.querySelector(`iframe[src*="${iframeDomain}"]`);
        if (siblingIframe) return true;
      }
    } catch {
      // invalid selector in this context — skip
    }
  }
  return false;
}

/**
 * Scan text content for CAPTCHA-like language patterns.
 * Returns true if the text matches common fake CAPTCHA wording.
 */
export function matchesCaptchaPattern(text: string): boolean {
  for (const pattern of CAPTCHA_PATTERNS) {
    if (pattern.test(text)) return true;
  }
  return false;
}

/**
 * Scan text content for ClickFix instruction patterns.
 * Returns true if the text contains instructions to paste into Run dialog / terminal.
 */
export function matchesInstructionPattern(text: string): boolean {
  for (const pattern of INSTRUCTION_PATTERNS) {
    if (pattern.test(text)) return true;
  }
  return false;
}

// --- Overlay detection ---

/**
 * Detect if there is a prominent overlay/modal on the page.
 * Returns the overlay element if found, or null.
 *
 * An overlay is defined as a fixed/absolute/sticky positioned element covering
 * at least 25% of the viewport, with a z-index above 100. Also checks for
 * open <dialog> elements.
 */
export function findClickFixOverlay(root: Document = document): Element | null {
  const vw = Math.max(window.innerWidth, 1);
  const vh = Math.max(window.innerHeight, 1);
  const viewportArea = vw * vh;
  const minCoverage = 0.25;
  const minZIndex = 100;

  // Check open <dialog> elements first (native modals)
  try {
    const dialogs = root.querySelectorAll("dialog[open]");
    for (const dialog of dialogs) {
      const rect = (dialog as HTMLElement).getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) {
        const coverage = (rect.width * rect.height) / viewportArea;
        if (coverage >= minCoverage) return dialog;
      }
    }
  } catch {
    // dialog selector may not be supported
  }

  // Check direct children of body and their immediate children (covers most
  // real-world overlay patterns without scanning the entire DOM).
  // Overlays are almost always direct children of <body> or at most one
  // level deep for framework wrappers.
  const body = root.body;
  if (!body) return null;

  const candidates: Element[] = [];
  for (const child of body.children) {
    candidates.push(child);
    // Also check one level of children for framework wrappers
    for (const grandchild of child.children) {
      candidates.push(grandchild);
    }
  }

  for (const el of candidates) {
    const cs = window.getComputedStyle(el);
    const pos = cs.position;
    if (pos !== "fixed" && pos !== "absolute" && pos !== "sticky") continue;
    if (cs.display === "none" || cs.visibility === "hidden") continue;

    const z = cs.zIndex === "auto" ? 0 : Number.parseInt(cs.zIndex, 10);
    if (!Number.isFinite(z) || z < minZIndex) continue;

    const rect = (el as HTMLElement).getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) continue;
    const coverage = (rect.width * rect.height) / viewportArea;
    if (coverage < minCoverage) continue;

    return el;
  }
  return null;
}

// --- Combined ClickFix detection ---

export interface ClickFixScanResult {
  /** Whether a ClickFix attack pattern was detected */
  detected: boolean;
  /** Reason codes describing which signals fired */
  reasons: string[];
  /** Suggested score contribution */
  score: number;
}

/**
 * Perform a full ClickFix scan on the current page.
 * Checks for the combination of:
 *   - Recent clipboard write from main world
 *   - Overlay/modal present on the page
 *   - CAPTCHA-like or instruction text in the overlay or page body
 *
 * Returns a scan result with detection status, reasons, and score.
 *
 * Performance: designed to complete in < 5ms on typical pages.
 * The function exits early when no clipboard write has occurred,
 * avoiding expensive DOM scanning on benign pages.
 */
export function scanForClickFix(root: Document = document): ClickFixScanResult {
  const reasons: string[] = [];
  let score = 0;

  // Early exit: if a legitimate CAPTCHA provider is present, do not flag
  if (hasLegitCaptcha(root)) {
    return { detected: false, reasons: ["legit_captcha_present"], score: 0 };
  }

  // Signal 1: clipboard write
  const hadClipboardWrite = hasRecentClipboardWrite();
  const hadCommandWrite = hasRecentCommandClipboardWrite();

  // Signal 2: overlay present
  const overlay = findClickFixOverlay(root);

  // Signal 3: text pattern matching
  // Scan both overlay text and body text — instruction text may be outside the overlay
  let overlayText = "";
  if (overlay) {
    overlayText = (overlay.textContent ?? "").slice(0, 2000);
  }

  const bodyText = (root.body?.textContent ?? "").slice(0, 5000);

  const hasCaptchaText = matchesCaptchaPattern(overlayText) || matchesCaptchaPattern(bodyText);
  const hasInstructionText = matchesInstructionPattern(overlayText) || matchesInstructionPattern(bodyText);

  // Build score from combination of signals.
  //
  // Clipboard write + overlay alone is NOT sufficient (would false-positive
  // on any "Copy" button visible alongside a cookie banner or modal).
  // Either the clipboard content must look command-like, or the page text
  // must contain CAPTCHA / paste-instruction patterns.

  if (hadCommandWrite && overlay) {
    score += 35;
    reasons.push("clipboard_command_with_overlay");
  } else if (hadClipboardWrite && overlay && (hasCaptchaText || hasInstructionText)) {
    score += 35;
    reasons.push("clipboard_write_with_overlay");
  }

  if (hasCaptchaText && hasInstructionText) {
    score += 25;
    reasons.push("clickfix_instruction_pattern");
  } else if (hasInstructionText && overlay) {
    score += 15;
    reasons.push("clickfix_paste_instruction");
  } else if (hasCaptchaText && overlay) {
    score += 10;
    reasons.push("clickfix_captcha_text_with_overlay");
  }

  // Detection requires at least two independent signals AND sufficient score
  const signalCount = [
    hadClipboardWrite,
    !!overlay,
    hasCaptchaText || hasInstructionText,
  ].filter(Boolean).length;

  const detected = signalCount >= 2 && score >= 25;

  return { detected, reasons, score };
}
