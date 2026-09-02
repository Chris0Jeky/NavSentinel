import type { CredMode, EventLogEntry } from "../shared/storage";
import type { Mode } from "../shared/types";
import { classifyEventTone } from "../shared/event_tone";
import { icon, logoSentinel } from "../shared/icons";
import { getSegValue, initSegKeyboard, setSegValue } from "../shared/seg_control";
import {
  POPUP_TEST_CRED_MODES,
  POPUP_TEST_NAV_MODES,
  type PopupSnapshot,
  type PopupTestMessage
} from "../shared/popup_test";
import {
  addTrustedDomain,
  appendEvent,
  getEventLog,
  getSuiteSettings,
  getTrustedDomains,
  removeTrustedDomain,
  SILENT_DECISION_KINDS,
  updateSuiteSettings
} from "../shared/storage";
import {
  derivePopupSiteState,
  derivePopupTabRisk,
  describeUnscoredThreat,
  eventIconName,
  getRecentPopupEvents,
  signalChipClass
} from "./popup_model";

const logoSlot = document.getElementById("logoSlot") as HTMLDivElement;
const versionEl = document.getElementById("version") as HTMLSpanElement;
const siteEl = document.getElementById("site") as HTMLSpanElement;
const trustDot = document.getElementById("trustDot") as HTMLSpanElement;
const trustStatusEl = document.getElementById("trustStatus") as HTMLSpanElement;
const trustBtn = document.getElementById("trustBtn") as HTMLButtonElement;
const untrustBtn = document.getElementById("untrustBtn") as HTMLButtonElement;
const navSeg = document.getElementById("navSeg") as HTMLDivElement;
const credSeg = document.getElementById("credSeg") as HTMLDivElement;
const autoDismiss = document.getElementById("autoDismiss") as HTMLInputElement;
const eventsEl = document.getElementById("events") as HTMLDivElement;
const eventCountEl = document.getElementById("eventCount") as HTMLSpanElement;
const signalsEl = document.getElementById("signals") as HTMLDivElement;
const shieldArcEl = document.getElementById("shieldArc") as HTMLDivElement;
const gaugeNoteEl = document.getElementById("gaugeNote") as HTMLDivElement;
const refreshBtn = document.getElementById("refreshBtn") as HTMLButtonElement;
const openOptions = document.getElementById("openOptions") as HTMLButtonElement;

logoSlot.innerHTML = logoSentinel(32, false);
document.getElementById("gearIcon")!.innerHTML = icon("gear", 14);
document.getElementById("navIcon")!.innerHTML = icon("shield", 11, "var(--ns-cyan)");
document.getElementById("credIcon")!.innerHTML = icon("key", 11, "var(--ns-green)");
document.getElementById("lockIcon")!.innerHTML = icon("lock", 11, "var(--ns-green)");
document.getElementById("chevronIcon")!.innerHTML = icon("chevron", 10, "var(--ns-cyan)");

/**
 * The gauge ring, shared by both gauge states: a dim full-circle track plus one
 * stroked circle over it. Every state draws the identical two-circle geometry and
 * differs only in stroke colour, dash pattern and cap, so this is one template
 * rather than a near-copy per state — the popup chunk is budgeted at 10KB
 * (scripts/check-perf-budget.mjs) and a duplicated ring template costs ~0.5KB of it.
 *
 * Emitted without inter-tag whitespace. The previous multi-line template left a
 * literal newline+indent text node between `</svg>` and the centre `<span>`, which
 * rendered as a stray space next to the inline SVG; the drawn ring is unchanged.
 */
function ringSvg(size: number, stroke: string, dasharray: string, cap: string): string {
  const mid = size / 2;
  const circle = `cx="${mid}" cy="${mid}" r="${mid - 4}" fill="none" stroke-width="3"`;
  return `<svg aria-hidden="true" width="${size}" height="${size}" style="transform:rotate(-90deg)"><circle ${circle} stroke="rgba(255,255,255,0.06)"/><circle ${circle} stroke="${stroke}" stroke-dasharray="${dasharray}" stroke-linecap="${cap}" style="transition:stroke-dasharray 0.4s ease-out"/></svg>`;
}

function renderShieldArc(value: number, size = 42): string {
  const c = 2 * Math.PI * (size / 2 - 4);
  const col = value >= 70 ? "var(--ns-red)" : value >= 40 ? "var(--ns-orange)" : "var(--ns-green)";
  return `${ringSvg(size, col, `${(value / 100) * c} ${c}`, "round")}<span aria-hidden="true" class="ns-mono" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:${col};transform:rotate(90deg)">${value}</span>`;
}

/**
 * Gauge for the unscored-threat state (#219): the same ring drawn as a broken
 * (evenly dashed) full circle plus "!", rather than a filled arc plus a numeral,
 * because there is no score to draw. Never renders a number — inventing one would
 * put an unmeasured value into a surface whose numbers are measurements. The centre
 * mark is styled by a CSS class rather than an inline style, so unlike the scored
 * numeral it costs almost nothing in the JS chunk.
 */
function renderUnscoredArc(size = 42): string {
  const dash = (2 * Math.PI * (size / 2 - 4)) / 24;
  return `${ringSvg(size, "var(--ns-purple)", `${dash} ${dash}`, "butt")}<span aria-hidden="true" class="shield-arc-mark--unscored">!</span>`;
}

function severityClass(score: number): string {
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

function severityLabel(score: number): string {
  if (score >= 70) return "high";
  if (score >= 40) return "med";
  return "low";
}

function eventLabel(kind: string): string {
  return kind.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

async function getActiveTabUrl(): Promise<string> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.url ?? "";
}

function fmtTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function renderEvents(log: EventLogEntry[]): void {
  const list = getRecentPopupEvents(log, 5);
  // Count notable events only, to match the filtered feed: silent-decision
  // events (#236) are excluded from the popup surfaces (they remain in the
  // options audit log). Otherwise the count would inflate while the feed shows
  // nothing new.
  eventCountEl.textContent = String(log.filter((e) => e?.kind && !SILENT_DECISION_KINDS.has(e.kind)).length);

  if (list.length === 0) {
    eventsEl.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No events yet.";
    eventsEl.appendChild(empty);
    return;
  }

  eventsEl.innerHTML = "";
  for (const event of list) {
    const eventKind = typeof event.kind === "string" ? event.kind : "unknown";
    const tone = classifyEventTone(eventKind);
    const score = typeof event.score === "number" ? event.score : 0;

    const row = document.createElement("div");
    row.className = "event-row";

    const iconBox = document.createElement("div");
    iconBox.className = `event-icon-box event-icon-box--${tone}`;
    const iconColor = tone === "navigation" ? "var(--ns-cyan)" : tone === "credential" ? "var(--ns-green)" : "var(--ns-orange)";
    iconBox.innerHTML = icon(eventIconName(eventKind), 12, iconColor);
    row.appendChild(iconBox);

    const body = document.createElement("div");
    body.className = "event-body";
    const title = document.createElement("div");
    title.className = "event-title";
    title.textContent = eventLabel(eventKind);
    body.appendChild(title);
    const sub = document.createElement("div");
    sub.className = "event-sub";
    sub.textContent = `${event.site || "—"} · ${fmtTime(event.ts)}`;
    body.appendChild(sub);
    row.appendChild(body);

    if (score > 0) {
      const scoreEl = document.createElement("div");
      scoreEl.className = `event-score event-score--${severityClass(score)}`;
      scoreEl.innerHTML = `<div class="event-score-val">${score}</div><div class="event-score-label">${severityLabel(score)}</div>`;
      row.appendChild(scoreEl);
    }

    eventsEl.appendChild(row);
  }
}

function renderSignals(reasons: string[] | undefined): void {
  signalsEl.innerHTML = "";
  if (!reasons || reasons.length === 0) return;

  const label = document.createElement("span");
  label.className = "signals-label";
  label.textContent = "signals";
  signalsEl.appendChild(label);

  for (const r of reasons.slice(0, 5)) {
    const chip = document.createElement("span");
    chip.className = `signal-chip ${signalChipClass(r)}`;
    chip.textContent = r;
    signalsEl.appendChild(chip);
  }
}

async function refreshUi(): Promise<void> {
  const settings = await getSuiteSettings();
  setSegValue(navSeg, settings.nav.defaultMode);
  setSegValue(credSeg, settings.credential.mode);
  autoDismiss.checked = settings.nav.autoDismissOverlays;

  const url = await getActiveTabUrl();
  const trusted = await getTrustedDomains();
  const siteState = derivePopupSiteState(url, trusted);
  siteEl.textContent = siteState.siteLabel;

  if (siteState.isTrusted) {
    trustStatusEl.textContent = "trusted";
    trustStatusEl.dataset.state = "trusted";
    trustDot.className = "status-dot status-dot--trusted";
  } else if (siteState.registrableDomain) {
    trustStatusEl.textContent = "observing";
    trustStatusEl.dataset.state = "";
    trustDot.className = "status-dot status-dot--observed";
  } else {
    trustStatusEl.textContent = "—";
    trustStatusEl.dataset.state = "";
    trustDot.className = "status-dot";
  }

  trustBtn.disabled = !siteState.canTrust;
  untrustBtn.disabled = !siteState.canUntrust;
  trustBtn.hidden = siteState.isTrusted;
  untrustBtn.hidden = !siteState.isTrusted;
  trustBtn.setAttribute("aria-label", siteState.registrableDomain ? `Trust ${siteState.siteLabel}` : "Trust this site");
  untrustBtn.setAttribute("aria-label", siteState.registrableDomain ? `Untrust ${siteState.siteLabel}` : "Untrust this site");

  const log = await getEventLog();
  renderEvents(log);

  // Scope the "Current page" gauge/signals to the ACTIVE site's most recent scored
  // event (not log[last], which is global). See derivePopupTabRisk. (#205)
  const { tabRisk, reasons, state, threatKind } = derivePopupTabRisk(log, siteState.registrableDomain);
  shieldArcEl.style.position = "relative";
  if (state === "unscored-threat" && threatKind) {
    // No score exists for this site, so the gauge must not read as a measured 0
    // (safe) nor as a scored high. Say exactly what happened instead. (#219)
    // One sentence drives both surfaces: the aria-label then cannot drift from the
    // visible note, and the string is built (and shipped) once rather than twice.
    const note = `Threat alert recorded, no risk score — ${describeUnscoredThreat(threatKind)}.`;
    shieldArcEl.innerHTML = renderUnscoredArc();
    shieldArcEl.setAttribute("aria-label", note);
    gaugeNoteEl.textContent = note;
    gaugeNoteEl.hidden = false;
  } else {
    shieldArcEl.innerHTML = renderShieldArc(tabRisk);
    shieldArcEl.setAttribute("aria-label", `Tab risk score: ${tabRisk}`);
    gaugeNoteEl.textContent = "";
    gaugeNoteEl.hidden = true;
  }
  renderSignals(reasons);
}

function getPopupSnapshot(): PopupSnapshot {
  const events = Array.from(eventsEl.querySelectorAll(".event-row"))
    .map((node) => node.textContent?.replace(/\s+/g, " ").trim() ?? "")
    .filter(Boolean);
  const tabRiskMatch = /^Tab risk score: (\d+)$/.exec(shieldArcEl.getAttribute("aria-label") ?? "");

  return {
    autoDismissOverlays: autoDismiss.checked,
    credMode: getSegValue(credSeg),
    events,
    eventIconPaths: Array.from(
      eventsEl.querySelectorAll<HTMLDivElement>(".event-icon-box"),
      (node) => node.querySelector("svg path")?.getAttribute("d") ?? ""
    ),
    navMode: getSegValue(navSeg),
    signalChipClasses: Array.from(signalsEl.querySelectorAll(".signal-chip"), (node) => node.className),
    site: siteEl.textContent?.trim() ?? "",
    tabRisk: tabRiskMatch ? Number(tabRiskMatch[1]) : null,
    trustStatus: trustStatusEl.textContent?.trim() ?? ""
  };
}

async function recordConfig(extra: Record<string, unknown>): Promise<void> {
  try {
    await appendEvent({ kind: "suite_config_update", extra });
  } catch (e) {
    console.warn("[NavSentinel] event log append failed (suite_config_update):", e);
  }
}

async function setNavMode(mode: Mode): Promise<void> {
  setSegValue(navSeg, mode);
  await updateSuiteSettings({ nav: { defaultMode: mode } });
  await recordConfig({ navMode: mode });
  await refreshUi();
}

async function setCredMode(mode: CredMode): Promise<void> {
  setSegValue(credSeg, mode);
  await updateSuiteSettings({ credential: { mode } });
  await recordConfig({ credMode: mode });
  await refreshUi();
}

async function trustCurrentSite(): Promise<void> {
  const url = await getActiveTabUrl();
  const reg = derivePopupSiteState(url, []).registrableDomain;
  if (!reg) return;

  await addTrustedDomain(reg);
  try {
    await appendEvent({ kind: "cred_trust_domain", site: reg });
  } catch (e) {
    console.warn("[NavSentinel] event log append failed (cred_trust_domain):", e);
  }
  await refreshUi();
}

async function untrustCurrentSite(): Promise<void> {
  const url = await getActiveTabUrl();
  const reg = derivePopupSiteState(url, []).registrableDomain;
  if (!reg) return;

  await removeTrustedDomain(reg);
  try {
    await appendEvent({ kind: "cred_untrust_domain", site: reg });
  } catch (e) {
    console.warn("[NavSentinel] event log append failed (cred_untrust_domain):", e);
  }
  await refreshUi();
}


navSeg.addEventListener("click", async (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".seg-btn");
  if (!btn || btn.getAttribute("aria-checked") === "true") return;
  await setNavMode(btn.dataset.value as Mode);
});

credSeg.addEventListener("click", async (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".seg-btn");
  if (!btn || btn.getAttribute("aria-checked") === "true") return;
  await setCredMode(btn.dataset.value as CredMode);
});

autoDismiss.addEventListener("change", () => {
  void updateSuiteSettings({ nav: { autoDismissOverlays: autoDismiss.checked } });
});

initSegKeyboard(navSeg);
initSegKeyboard(credSeg);

trustBtn.addEventListener("click", async () => {
  await trustCurrentSite();
});

untrustBtn.addEventListener("click", async () => {
  await untrustCurrentSite();
});

refreshBtn.addEventListener("click", async () => {
  await refreshUi();
});

openOptions.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

function isTrustedPopupTestSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id) {
    return false;
  }

  if (sender.tab) {
    return false;
  }

  const extensionBaseUrl = chrome.runtime.getURL("");
  if (typeof sender.url === "string") {
    return sender.url.startsWith(extensionBaseUrl);
  }

  if (typeof sender.origin === "string") {
    return sender.origin === new URL(extensionBaseUrl).origin;
  }

  return true;
}

function parsePopupModeValue(
  value: unknown,
  validValues: readonly string[],
  label: string
): Mode | CredMode {
  if (typeof value !== "string" || !validValues.includes(value)) {
    throw new Error(`Invalid ${label} value: ${String(value)}`);
  }

  return value as Mode | CredMode;
}

chrome.runtime.onMessage.addListener((message: PopupTestMessage, sender, sendResponse) => {
  if (!message || message.type !== "ns_popup_test" || !isTrustedPopupTestSender(sender)) {
    return undefined;
  }

  void (async () => {
    try {
      if (message.action === "snapshot") {
        await refreshUi();
        sendResponse({ ok: true, snapshot: getPopupSnapshot() });
        return;
      }

      if (message.action === "click") {
        switch (message.target) {
          case "trustBtn":
            await trustCurrentSite();
            break;
          case "untrustBtn":
            await untrustCurrentSite();
            break;
          case "refreshBtn":
            await refreshUi();
            break;
          case "openOptions":
            chrome.runtime.openOptionsPage();
            break;
          case "autoDismiss":
            autoDismiss.click();
            break;
          default:
            throw new Error("Unknown popup target");
        }
        sendResponse({ ok: true, snapshot: getPopupSnapshot() });
        return;
      }

      if (message.action === "select") {
        switch (message.target) {
          case "navMode":
            await setNavMode(parsePopupModeValue(message.value, POPUP_TEST_NAV_MODES, "navMode") as Mode);
            break;
          case "credMode":
            await setCredMode(
              parsePopupModeValue(message.value, POPUP_TEST_CRED_MODES, "credMode") as CredMode
            );
            break;
          default:
            throw new Error("Unknown popup select target");
        }
        sendResponse({ ok: true, snapshot: getPopupSnapshot() });
        return;
      }

      throw new Error("Unsupported popup test action");
    } catch (error) {
      sendResponse({
        error: error instanceof Error ? error.message : String(error),
        ok: false
      });
    }
  })();

  return true;
});

versionEl.textContent = chrome.runtime.getManifest().version;
void refreshUi();
void import("./pending_decisions");
