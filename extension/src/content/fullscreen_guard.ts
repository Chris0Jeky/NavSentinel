/**
 * Tech-support-scam "browser locker" guard (#1171).
 *
 * Scam pages call requestFullscreen() (often with navigator.keyboard.lock()) on
 * a page of scare text and a phone number so the browser looks frozen. On
 * `fullscreenchange`, capture_isolated lazily loads this module; it exits
 * fullscreen only when the fullscreen element carries BOTH scare wording and a
 * phone number. Exiting needs no user activation and releases keyboard lock.
 *
 * Isolated world only. Page text is read here and never stored or sent.
 */

import { appendEvent } from "../shared/storage";
import { showToast } from "./ui_toast";

const MAX_TEXT = 5000;
const MAX_NODES = 2000;
const MAX_EXITS_PER_PAGE = 20;
const NOTIFY_INTERVAL_MS = 10_000;
/** A contained video/canvas covering at least this share of the element is media. */
const MEDIA_SHARE = 0.5;

const MEDIA_TAGS = new Set(["VIDEO", "CANVAS", "IFRAME", "EMBED", "OBJECT"]);
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);

// Weight 2 = specific scam wording; weight 1 = common words (including "do not close", which
// exam and kiosk pages use legitimately). A match needs two distinct weight-2 phrases or a
// total of 3, so one stray phrase beside a support number never triggers.
// All gaps are bounded, so a hostile page cannot trigger catastrophic backtracking.
const SCARE: ReadonlyArray<readonly [RegExp, number]> = [
  [/\byour (?:computer|pc|device|browser|system|windows)\s{1,3}(?:has been|is|was|have been)\s{1,3}(?:locked|blocked|infected|compromised|disabled)/i, 2],
  [/\b(?:virus(?:es)?|malware|spyware|trojan)s?\s{1,3}(?:detected|found|alert|warning)/i, 2],
  [/\bcall\s{1,3}(?:(?:microsoft|windows|apple|google|chrome|security|tech|technical)\s{1,3}){1,2}(?:support|helpline|center|centre|team|department)/i, 2],
  [/\bdo\s{1,3}not\s{1,3}(?:close|restart|shut\s?down|turn\s{1,3}off|ignore)/i, 1],
  [/\byour\s{1,3}(?:personal|banking|financial|private|credit\s{1,3}card)\s{1,3}(?:data|information|details)\s{1,3}(?:is|are)\s{1,3}at\s{1,3}risk/i, 2],
  [/\berror\s{1,3}code/i, 1],
  [/\bfirewall/i, 1],
  [/\b(?:trojan|spyware|pornographic)/i, 1],
];

// US/CA toll-free, UK freephone, and generic +country-code numbers.
const PHONE: readonly RegExp[] = [
  /(?<!\d)(?:\+?1[\s.-]?)?\(?8(?:00|33|44|55|66|77|88)\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/,
  /(?<!\d)0(?:80[08]|900)[\s.-]?\d{3}[\s.-]?\d{3,4}(?!\d)/,
  /\+\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}(?!\d)/,
];

export interface FullscreenVerdict {
  scare: boolean;
  /** Matched signal codes; only meaningful as a finding when `scare` is true. */
  reasons: string[];
}

function area(el: Element): number {
  const r = el.getBoundingClientRect();
  return r.width * r.height;
}

/**
 * True when a contained video/canvas dominates the element (player, slide with video, game).
 *
 * Known heuristic ceiling (residual risk): a locker that lays a full-size transparent
 * canvas under its text is read as media and defeats the guard. Closing that hole would
 * mean judging whether the media is actually visible, which risks exiting real players;
 * revisit if lockers are seen doing this.
 */
function mediaDominated(el: Element): boolean {
  const media = el.querySelectorAll("video,canvas");
  if (!media.length) return false;
  const total = area(el);
  // Unmeasurable layout: stay on the side of not exiting.
  if (!total) return true;
  return Array.from(media).some((m) => area(m) / total >= MEDIA_SHARE);
}

/**
 * Bounded, in-order text of the subtree (open shadow roots included), skipping script/style
 * and display:none subtrees (`hidden` included): a deck's unshown scam-training slide must not
 * count as what the user sees. Only display:none is skipped, since a visibility:hidden or
 * display:contents wrapper can still render its children.
 */
function boundedText(root: Element): string {
  let out = "";
  let nodes = 0;
  const stack: Node[] = [root];
  while (stack.length && out.length < MAX_TEXT && nodes++ < MAX_NODES) {
    const n = stack.pop()!;
    if (n.nodeType === 3) {
      out += `${n.nodeValue ?? ""} `;
      continue;
    }
    if (n.nodeType === 1) {
      const e = n as Element;
      if (SKIP_TAGS.has(e.tagName) || e.hasAttribute("hidden") || getComputedStyle(e).display === "none") continue;
      if (e.shadowRoot) stack.push(e.shadowRoot);
    }
    for (let c = n.lastChild; c; c = c.previousSibling) stack.push(c);
  }
  return out.slice(0, MAX_TEXT).replace(/\s+/g, " ");
}

/**
 * Pure classifier: is `el` (the document's fullscreen element) a scareware
 * locker? Media elements and media-dominated containers never qualify.
 */
export function isScarewareFullscreen(el: Element): FullscreenVerdict {
  const reasons: string[] = [];
  if (MEDIA_TAGS.has(el.tagName) || mediaDominated(el)) return { scare: false, reasons };
  const text = boundedText(el);
  let total = 0;
  let strong = 0;
  for (const [re, w] of SCARE) {
    if (!re.test(text)) continue;
    total += w;
    if (w === 2) strong++;
  }
  if (strong >= 2 || total >= 3) reasons.push("fullscreen_scare_text");
  if (PHONE.some((re) => re.test(text))) reasons.push("fullscreen_phone_number");
  return { scare: reasons.length === 2, reasons };
}

let exits = 0;
let notifiedAt = -Infinity;

/**
 * Called on `fullscreenchange`. Exits fullscreen when the current fullscreen
 * element is scareware (at most 20 exits per page load) and reports whether the
 * caller should surface a notice (at most once per 10 s). Null = left alone.
 */
export function guardFullscreen(now = Date.now()): { reasons: string[]; notify: boolean } | null {
  const el = document.fullscreenElement;
  if (!el || exits >= MAX_EXITS_PER_PAGE) return null;
  const verdict = isScarewareFullscreen(el);
  if (!verdict.scare) return null;
  exits++;
  try {
    void document.exitFullscreen().catch(() => {});
  } catch {
    // exitFullscreen unavailable or threw synchronously; nothing more to do
  }
  const notify = now - notifiedAt >= NOTIFY_INTERVAL_MS;
  if (notify) notifiedAt = now;
  return { reasons: verdict.reasons, notify };
}

/**
 * capture_isolated's fullscreenchange entry point. `markRed` raises the tab icon
 * through capture_isolated's own risk state so it is never downgraded later.
 */
export function onFullscreenChange(markRed: () => void): void {
  const verdict = guardFullscreen();
  if (!verdict?.notify) return;
  markRed();
  void appendEvent({
    kind: "fullscreen_locker_exit",
    site: location.hostname.toLowerCase(),
    url: location.href,
    reasons: verdict.reasons,
  }).catch(() => {});
  showToast({
    message: "Heedline closed a full-screen warning page. Real security companies do not lock your browser or ask you to call them.",
    timeoutMs: 0,
  });
}

/** Test-only: reset per-page counters. */
export function _resetFullscreenGuard(): void {
  exits = 0;
  notifiedAt = -Infinity;
}
