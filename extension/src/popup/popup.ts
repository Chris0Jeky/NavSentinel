import type { CredMode, EventLogEntry } from "../shared/storage";
import type { Mode } from "../shared/types";
import {
  addTrustedDomain,
  appendEvent,
  getEventLog,
  getSuiteSettings,
  getTrustedDomains,
  removeTrustedDomain,
  updateSuiteSettings
} from "../shared/storage";
import { getRegistrableDomain, normalizeHost } from "../shared/domain";

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

function renderEvents(log: EventLogEntry[]): void {
  const list = (log ?? []).slice(-8).reverse();
  if (list.length === 0) {
    eventsEl.textContent = "No events yet.";
    return;
  }

  eventsEl.innerHTML = "";
  for (const event of list) {
    const row = document.createElement("div");
    row.className = "event";
    const site = event.site ? ` | ${event.site}` : "";
    const score = typeof event.score === "number" ? ` | score=${event.score}` : "";
    row.textContent = `${fmtTime(event.ts)} | ${event.kind}${site}${score}`;
    eventsEl.appendChild(row);
  }
}

async function refreshUi(): Promise<void> {
  const settings = await getSuiteSettings();
  navModeEl.value = settings.nav.defaultMode;
  credModeEl.value = settings.credential.mode;

  const url = await getActiveTabUrl();
  let host = "";
  try {
    host = url ? new URL(url).hostname : "";
  } catch {
    host = "";
  }

  host = normalizeHost(host);
  const reg = host ? getRegistrableDomain(host) : "";
  siteEl.textContent = reg || host || "(no host)";

  const trusted = await getTrustedDomains();
  const isTrusted = !!(reg && trusted.includes(reg));
  trustStatusEl.textContent = isTrusted
    ? "Trusted for credential submits."
    : "Not trusted (credential prompts may appear).";

  trustBtn.disabled = isTrusted || !reg;
  untrustBtn.disabled = !isTrusted || !reg;

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
  let host = "";
  try {
    host = url ? new URL(url).hostname : "";
  } catch {
    host = "";
  }
  host = normalizeHost(host);
  const reg = host ? getRegistrableDomain(host) : "";
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
  let host = "";
  try {
    host = url ? new URL(url).hostname : "";
  } catch {
    host = "";
  }
  host = normalizeHost(host);
  const reg = host ? getRegistrableDomain(host) : "";
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
