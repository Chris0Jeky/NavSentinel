import type { CredMode, EventLogEntry } from "../shared/storage";
import type { Mode } from "../shared/types";
import { classifyEventTone } from "../shared/event_tone";
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
  getRecentPopupEvents
} from "./popup_model";

const siteEl = document.getElementById("site") as HTMLDivElement;
const trustStatusEl = document.getElementById("trustStatus") as HTMLDivElement;
const trustBtn = document.getElementById("trustBtn") as HTMLButtonElement;
const untrustBtn = document.getElementById("untrustBtn") as HTMLButtonElement;
const navModeEl = document.getElementById("navMode") as HTMLSelectElement;
const credModeEl = document.getElementById("credMode") as HTMLSelectElement;
const eventsEl = document.getElementById("events") as HTMLDivElement;
const refreshBtn = document.getElementById("refreshBtn") as HTMLButtonElement;
const openOptions = document.getElementById("openOptions") as HTMLAnchorElement;

async function getActiveTabUrl(): Promise<string> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.url ?? "";
}

function fmtTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return "";
  }
}

function formatEventKind(kind: string): string {
  return kind.replace(/_/g, " ");
}

function buildEventDetail(event: EventLogEntry): string {
  const parts: string[] = [];
  if (event.site) parts.push(`site ${event.site}`);
  if (event.destHost) parts.push(`dest ${event.destHost}`);
  if (typeof event.score === "number") parts.push(`score ${event.score}`);
  if (event.reasons?.length) {
    parts.push(
      `signals ${event.reasons.slice(0, 3).join(", ")}${event.reasons.length > 3 ? "..." : ""}`
    );
  }
  return parts.join(" • ");
}

function renderEvents(log: EventLogEntry[]): void {
  const list = getRecentPopupEvents(log, 6);
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
    const card = document.createElement("article");
    card.className = "event-card";
    card.dataset.tone = classifyEventTone(event.kind);

    const head = document.createElement("div");
    head.className = "event-head";

    const kind = document.createElement("div");
    kind.className = "event-kind";
    kind.textContent = formatEventKind(event.kind);

    const time = document.createElement("div");
    time.className = "event-time mono";
    time.textContent = fmtTime(event.ts);

    head.appendChild(kind);
    head.appendChild(time);
    card.appendChild(head);

    const detail = buildEventDetail(event);
    if (detail) {
      const body = document.createElement("div");
      body.className = "event-detail";
      body.textContent = detail;
      card.appendChild(body);
    }

    eventsEl.appendChild(card);
  }
}

async function refreshUi(): Promise<void> {
  const settings = await getSuiteSettings();
  navModeEl.value = settings.nav.defaultMode;
  credModeEl.value = settings.credential.mode;

  const url = await getActiveTabUrl();
  const trusted = await getTrustedDomains();
  const siteState = derivePopupSiteState(url, trusted);
  siteEl.textContent = siteState.siteLabel;
  trustStatusEl.textContent = siteState.trustStatus;
  trustStatusEl.dataset.state = siteState.isTrusted
    ? "trusted"
    : siteState.registrableDomain
      ? "caution"
      : "neutral";
  trustBtn.disabled = !siteState.canTrust;
  untrustBtn.disabled = !siteState.canUntrust;

  renderEvents(await getEventLog());
}

navModeEl.addEventListener("change", async () => {
  const m = navModeEl.value as Mode;
  await updateSuiteSettings({ nav: { defaultMode: m } });
  try {
    await appendEvent({ kind: "suite_config_update", extra: { navMode: m } });
  } catch {
    // ignore
  }
  await refreshUi();
});

credModeEl.addEventListener("change", async () => {
  const m = credModeEl.value as CredMode;
  await updateSuiteSettings({ credential: { mode: m } });
  try {
    await appendEvent({ kind: "suite_config_update", extra: { credMode: m } });
  } catch {
    // ignore
  }
  await refreshUi();
});

trustBtn.addEventListener("click", async () => {
  const url = await getActiveTabUrl();
  const reg = derivePopupSiteState(url, []).registrableDomain;
  if (!reg) return;

  await addTrustedDomain(reg);
  try {
    await appendEvent({ kind: "cred_trust_domain", site: reg });
  } catch {
    // ignore
  }
  await refreshUi();
});

untrustBtn.addEventListener("click", async () => {
  const url = await getActiveTabUrl();
  const reg = derivePopupSiteState(url, []).registrableDomain;
  if (!reg) return;

  await removeTrustedDomain(reg);
  try {
    await appendEvent({ kind: "cred_untrust_domain", site: reg });
  } catch {
    // ignore
  }
  await refreshUi();
});

refreshBtn.addEventListener("click", async () => {
  await refreshUi();
});

openOptions.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

void refreshUi();
