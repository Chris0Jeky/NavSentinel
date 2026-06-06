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
  updateSuiteSettings
} from "../shared/storage";
import {
  derivePopupSiteState,
  derivePopupTabRisk,
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
const eventsEl = document.getElementById("events") as HTMLDivElement;
const eventCountEl = document.getElementById("eventCount") as HTMLSpanElement;
const signalsEl = document.getElementById("signals") as HTMLDivElement;
const shieldArcEl = document.getElementById("shieldArc") as HTMLDivElement;
const refreshBtn = document.getElementById("refreshBtn") as HTMLButtonElement;
const openOptions = document.getElementById("openOptions") as HTMLButtonElement;

logoSlot.innerHTML = logoSentinel(32, false);
document.getElementById("gearIcon")!.innerHTML = icon("gear", 14);
document.getElementById("navIcon")!.innerHTML = icon("shield", 11, "var(--ns-cyan)");
document.getElementById("credIcon")!.innerHTML = icon("key", 11, "var(--ns-green)");
document.getElementById("lockIcon")!.innerHTML = icon("lock", 11, "var(--ns-green)");
document.getElementById("chevronIcon")!.innerHTML = icon("chevron", 10, "var(--ns-cyan)");

function renderShieldArc(value: number, size = 42): string {
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  const col = value >= 70 ? "var(--ns-red)" : value >= 40 ? "var(--ns-orange)" : "var(--ns-green)";
  return `<svg aria-hidden="true" width="${size}" height="${size}" style="transform:rotate(-90deg)">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="3"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${col}" stroke-width="3"
            stroke-dasharray="${(value / 100) * c} ${c}" stroke-linecap="round"
            style="transition:stroke-dasharray 0.4s ease-out"/>
  </svg>
  <span aria-hidden="true" class="ns-mono" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:${col};transform:rotate(90deg)">${value}</span>`;
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
  eventCountEl.textContent = String(log.length);

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
  const { tabRisk, reasons } = derivePopupTabRisk(log, siteState.registrableDomain);
  shieldArcEl.style.position = "relative";
  shieldArcEl.innerHTML = renderShieldArc(tabRisk);
  shieldArcEl.setAttribute("aria-label", `Tab risk score: ${tabRisk}`);
  renderSignals(reasons);
}

function getPopupSnapshot(): PopupSnapshot {
  const events = Array.from(eventsEl.querySelectorAll(".event-row"))
    .map((node) => node.textContent?.replace(/\s+/g, " ").trim() ?? "")
    .filter(Boolean);

  return {
    credMode: getSegValue(credSeg),
    events,
    navMode: getSegValue(navSeg),
    site: siteEl.textContent?.trim() ?? "",
    trustStatus: trustStatusEl.textContent?.trim() ?? ""
  };
}

async function setNavMode(mode: Mode): Promise<void> {
  setSegValue(navSeg, mode);
  await updateSuiteSettings({ nav: { defaultMode: mode } });
  try {
    await appendEvent({ kind: "suite_config_update", extra: { navMode: mode } });
  } catch (e) {
    console.warn("[NavSentinel] event log append failed (suite_config_update):", e);
  }
  await refreshUi();
}

async function setCredMode(mode: CredMode): Promise<void> {
  setSegValue(credSeg, mode);
  await updateSuiteSettings({ credential: { mode } });
  try {
    await appendEvent({ kind: "suite_config_update", extra: { credMode: mode } });
  } catch (e) {
    console.warn("[NavSentinel] event log append failed (suite_config_update):", e);
  }
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
