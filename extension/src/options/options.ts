import type { Mode } from "../shared/types";
import type { CredMode, EventLogEntry, SuiteSettings } from "../shared/storage";
import { classifyEventTone } from "../shared/event_tone";
import { icon, logoSentinel } from "../shared/icons";
import {
  addTrustedDomainWithResult,
  appendEvent,
  clearEventLog,
  clearPromptOutcomes,
  clearTrustedDomains,
  exportAll,
  getEventLog,
  getPromptOutcomes,
  getSuiteSettings,
  getTrustedDomains,
  importAll,
  removeTrustedDomain,
  updateSuiteSettings,
  type PromptOutcomeEntry
} from "../shared/storage";
import { clearAdaptiveScores } from "../shared/adaptive_scoring";
import {
  clearAllowlist,
  getAllowlist,
  removeAllowlistEntry,
  type Allowlist
} from "../shared/allowlist";
import {
  clearDomainProfiles,
  getTopSuspiciousDomains,
  type DomainProfile,
} from "../shared/domain_profile";

// Icons
document.getElementById("logoSlot")!.innerHTML = logoSentinel(30, true);
document.getElementById("downloadIcon")!.innerHTML = icon("download", 13);
document.getElementById("navShieldIcon")!.innerHTML = icon("shield", 14);
document.getElementById("navChartIcon")!.innerHTML = icon("chart", 14);
document.getElementById("navListIcon")!.innerHTML = icon("list", 14);
document.getElementById("navLockIcon")!.innerHTML = icon("lock", 14);
document.getElementById("navGlobeIcon")!.innerHTML = icon("globe", 14);
document.getElementById("sidebarLockIcon")!.innerHTML = icon("lock", 12, "var(--ns-green)");

// Version
const versionEl = document.getElementById("version") as HTMLSpanElement;
versionEl.textContent = `v${chrome.runtime.getManifest().version}`;

// DOM references
const navModeSeg = document.getElementById("navModeSeg") as HTMLDivElement;
const navDebugEl = document.getElementById("navDebug") as HTMLButtonElement;
const navDnrEl = document.getElementById("navDnrEnabled") as HTMLButtonElement;
const credModeSeg = document.getElementById("credModeSeg") as HTMLDivElement;
const blockHttpEl = document.getElementById("blockHttpPasswordSubmit") as HTMLButtonElement;
const warnPasteEl = document.getElementById("warnOnPaste") as HTMLButtonElement;
const promptUntrustedEl = document.getElementById("promptOnUntrustedDomain") as HTMLButtonElement;
const promptMediumEl = document.getElementById("promptOnMediumRisk") as HTMLButtonElement;
const mediumThresholdEl = document.getElementById("mediumRiskThreshold") as HTMLInputElement;
const similarityEnabledEl = document.getElementById("similarityEnabled") as HTMLButtonElement;
const similarityMaxDistEl = document.getElementById("similarityMaxDistance") as HTMLInputElement;
const logLimitEl = document.getElementById("logLimit") as HTMLInputElement;
const logUsageEl = document.getElementById("logUsage") as HTMLSpanElement;
const allowlistEl = document.getElementById("allowlist") as HTMLDivElement;
const clearAllowlistBtn = document.getElementById("clearAllowlist") as HTMLButtonElement;
const trustedInputEl = document.getElementById("trustedInput") as HTMLInputElement;
const addTrustedBtn = document.getElementById("addTrusted") as HTMLButtonElement;
const clearTrustedBtn = document.getElementById("clearTrusted") as HTMLButtonElement;
const trustedListEl = document.getElementById("trustedList") as HTMLDivElement;
const eventLogEl = document.getElementById("eventLog") as HTMLDivElement;
const refreshLogBtn = document.getElementById("refreshLog") as HTMLButtonElement;
const clearLogBtn = document.getElementById("clearLog") as HTMLButtonElement;
const exportBtn = document.getElementById("exportBtn") as HTMLButtonElement;
const importFileEl = document.getElementById("importFile") as HTMLInputElement;
const statusEl = document.getElementById("status") as HTMLSpanElement;
const saveBtn = document.getElementById("save") as HTMLButtonElement;
const saveStatusEl = document.getElementById("saveStatus") as HTMLSpanElement;
const statTotalEl = document.getElementById("statTotal") as HTMLDivElement;
const statAllowRateEl = document.getElementById("statAllowRate") as HTMLDivElement;
const statBlockRateEl = document.getElementById("statBlockRate") as HTMLDivElement;
const statTrustRateEl = document.getElementById("statTrustRate") as HTMLDivElement;
const statDismissRateEl = document.getElementById("statDismissRate") as HTMLDivElement;
const statAvgScoreAllowEl = document.getElementById("statAvgScoreAllow") as HTMLDivElement;
const statAvgScoreBlockEl = document.getElementById("statAvgScoreBlock") as HTMLDivElement;
const refreshStatsBtn = document.getElementById("refreshStats") as HTMLButtonElement;
const clearStatsBtn = document.getElementById("clearStats") as HTMLButtonElement;
const topDomainsEl = document.getElementById("topDomains") as HTMLDivElement;
const domainProfilesEl = document.getElementById("domainProfiles") as HTMLDivElement;
const refreshProfilesBtn = document.getElementById("refreshProfiles") as HTMLButtonElement;
const clearProfilesBtn = document.getElementById("clearProfiles") as HTMLButtonElement;
const sidebarNav = document.getElementById("sidebarNav") as HTMLElement;

// Sidebar navigation
sidebarNav.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".nav-btn");
  if (!btn) return;
  const section = btn.dataset.section;
  if (!section) return;

  for (const b of Array.from(sidebarNav.querySelectorAll<HTMLButtonElement>(".nav-btn"))) {
    b.classList.toggle("active", b === btn);
  }

  const panes = document.querySelectorAll<HTMLElement>(".pane");
  for (const pane of Array.from(panes)) {
    pane.hidden = pane.id !== `pane-${section}`;
  }
});

// Segmented control helpers
function setSegValue(seg: HTMLDivElement, value: string): void {
  for (const btn of Array.from(seg.querySelectorAll<HTMLButtonElement>(".seg-btn"))) {
    btn.setAttribute("aria-pressed", String(btn.dataset.value === value.toLowerCase()));
  }
}

function getSegValue(seg: HTMLDivElement): string {
  for (const btn of Array.from(seg.querySelectorAll<HTMLButtonElement>(".seg-btn"))) {
    if (btn.getAttribute("aria-pressed") === "true") return btn.dataset.value ?? "smart";
  }
  return "smart";
}

navModeSeg.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".seg-btn");
  if (btn) setSegValue(navModeSeg, btn.dataset.value ?? "smart");
});

credModeSeg.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".seg-btn");
  if (btn) setSegValue(credModeSeg, btn.dataset.value ?? "smart");
});

// Toggle helpers
function setToggle(el: HTMLButtonElement, checked: boolean): void {
  el.setAttribute("aria-checked", String(checked));
}

function getToggle(el: HTMLButtonElement): boolean {
  return el.getAttribute("aria-checked") === "true";
}

function initToggle(el: HTMLButtonElement): void {
  el.addEventListener("click", () => {
    setToggle(el, !getToggle(el));
  });
}

initToggle(navDebugEl);
initToggle(navDnrEl);
initToggle(blockHttpEl);
initToggle(warnPasteEl);
initToggle(promptUntrustedEl);
initToggle(promptMediumEl);
initToggle(similarityEnabledEl);

// Status flash
const statusTimers = new WeakMap<HTMLElement, number>();

function flashStatus(
  el: HTMLElement,
  message: string,
  tone: "success" | "warning" | "error" = "success"
): void {
  const existing = statusTimers.get(el);
  if (existing !== undefined) window.clearTimeout(existing);
  el.textContent = message;
  el.dataset.tone = tone;
  const timer = window.setTimeout(() => {
    el.textContent = "";
    delete el.dataset.tone;
    statusTimers.delete(el);
  }, 1400);
  statusTimers.set(el, timer);
}

// Rendering functions
function renderAllowlist(list: Allowlist): void {
  allowlistEl.innerHTML = "";
  const sites = Object.keys(list).sort();
  clearAllowlistBtn.disabled = sites.length === 0;

  if (sites.length === 0) {
    const empty = document.createElement("div");
    empty.className = "list-empty";
    empty.textContent = "No allowlist entries yet.";
    allowlistEl.appendChild(empty);
    return;
  }

  for (const site of sites) {
    const siteRow = document.createElement("div");
    siteRow.className = "list-site";

    const title = document.createElement("div");
    title.className = "list-site-title";
    title.textContent = site;

    const hostList = document.createElement("div");
    hostList.className = "list-hosts";

    for (const host of (list[site] ?? []).slice().sort()) {
      const hostRow = document.createElement("div");
      hostRow.className = "list-host";

      const hostLabel = document.createElement("span");
      hostLabel.className = "list-host-label";
      hostLabel.textContent = host;

      const removeBtn = document.createElement("button");
      removeBtn.className = "btn btn--xs btn--danger";
      removeBtn.textContent = "Remove";
      removeBtn.setAttribute("aria-label", `Remove ${host} from allowlist`);
      removeBtn.addEventListener("click", async () => {
        await removeAllowlistEntry(site, host);
        try {
          await appendEvent({ kind: "nav_allowlist_remove", site, destHost: host });
        } catch (e) { console.warn("[NavSentinel] event log append failed (nav_allowlist_remove):", e); }
        await refreshAllowlist();
        flashStatus(saveStatusEl, "Allowlist updated.");
      });

      hostRow.appendChild(hostLabel);
      hostRow.appendChild(removeBtn);
      hostList.appendChild(hostRow);
    }

    siteRow.appendChild(title);
    siteRow.appendChild(hostList);
    allowlistEl.appendChild(siteRow);
  }
}

async function refreshAllowlist(): Promise<void> {
  renderAllowlist(await getAllowlist());
}

function renderTrusted(domains: string[]): void {
  trustedListEl.innerHTML = "";
  const list = (domains ?? []).slice().sort();
  clearTrustedBtn.disabled = list.length === 0;

  if (list.length === 0) {
    const empty = document.createElement("div");
    empty.className = "list-empty";
    empty.textContent = "No trusted domains yet.";
    trustedListEl.appendChild(empty);
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "list-hosts";
  for (const domain of list) {
    const row = document.createElement("div");
    row.className = "list-host";

    const label = document.createElement("span");
    label.className = "list-host-label";
    label.textContent = domain;

    const removeBtn = document.createElement("button");
    removeBtn.className = "btn btn--xs btn--danger";
    removeBtn.textContent = "Remove";
    removeBtn.setAttribute("aria-label", `Remove ${domain} from trusted`);
    removeBtn.addEventListener("click", async () => {
      await removeTrustedDomain(domain);
      try {
        await appendEvent({ kind: "cred_untrust_domain", site: domain });
      } catch (e) { console.warn("[NavSentinel] event log append failed (cred_untrust_domain):", e); }
      await refreshTrusted();
      flashStatus(saveStatusEl, "Trusted list updated.");
    });

    row.appendChild(label);
    row.appendChild(removeBtn);
    wrap.appendChild(row);
  }

  trustedListEl.appendChild(wrap);
}

async function refreshTrusted(): Promise<void> {
  renderTrusted(await getTrustedDomains());
}

function fmtTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function renderEventLog(log: EventLogEntry[]): void {
  eventLogEl.innerHTML = "";
  const list = (log ?? []).slice().reverse();
  logUsageEl.textContent = `${list.length}/${logLimitEl.value || "300"}`;

  if (list.length === 0) {
    const empty = document.createElement("div");
    empty.className = "list-empty";
    empty.textContent = "No events yet.";
    eventLogEl.appendChild(empty);
    return;
  }

  for (const event of list) {
    const tone = classifyEventTone(event.kind);
    const row = document.createElement("div");
    row.className = "event-row-opt";

    const badge = document.createElement("span");
    badge.className = `event-badge event-badge--${tone}`;
    badge.textContent = event.kind;

    const meta = document.createElement("span");
    meta.className = "event-meta";
    const parts: string[] = [];
    if (event.site) parts.push(event.site);
    if (event.destHost) parts.push(`→ ${event.destHost}`);
    if (typeof event.score === "number") parts.push(`score=${event.score}`);
    if (event.reasons?.length) {
      parts.push(event.reasons.slice(0, 4).join(", "));
    }
    meta.textContent = parts.join(" · ");

    const time = document.createElement("span");
    time.className = "event-time-opt";
    time.textContent = fmtTime(event.ts);

    row.appendChild(badge);
    row.appendChild(meta);
    row.appendChild(time);
    eventLogEl.appendChild(row);
  }
}

async function refreshEventLog(): Promise<void> {
  renderEventLog(await getEventLog());
}

function pct(n: number, total: number): string {
  if (total === 0) return "--";
  return `${((n / total) * 100).toFixed(1)}%`;
}

function avg(entries: PromptOutcomeEntry[]): string {
  if (entries.length === 0) return "--";
  const sum = entries.reduce((a, e) => a + e.score, 0);
  return (sum / entries.length).toFixed(1);
}

function renderStats(outcomes: PromptOutcomeEntry[]): void {
  const total = outcomes.length;
  const allows = outcomes.filter((e) => e.outcome === "allow_once" || e.outcome === "always_allow");
  const blocks = outcomes.filter((e) => e.outcome === "block" || e.outcome === "cancel");
  const trusts = outcomes.filter((e) => e.outcome === "trust");
  const dismisses = outcomes.filter((e) => e.outcome === "dismiss");

  statTotalEl.textContent = String(total);
  statAllowRateEl.textContent = pct(allows.length, total);
  statBlockRateEl.textContent = pct(blocks.length, total);
  statTrustRateEl.textContent = pct(trusts.length, total);
  statDismissRateEl.textContent = pct(dismisses.length, total);
  statAvgScoreAllowEl.textContent = avg(allows);
  statAvgScoreBlockEl.textContent = avg(blocks);

  const domainCounts = new Map<string, number>();
  for (const e of outcomes) {
    domainCounts.set(e.domain, (domainCounts.get(e.domain) ?? 0) + 1);
  }
  const top5 = [...domainCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  topDomainsEl.innerHTML = "";
  if (top5.length === 0) {
    const empty = document.createElement("div");
    empty.className = "list-empty";
    empty.textContent = "No prompt outcomes recorded yet.";
    topDomainsEl.appendChild(empty);
    return;
  }

  for (const [domain, count] of top5) {
    const row = document.createElement("div");
    row.className = "profile-row";
    const head = document.createElement("div");
    head.className = "profile-head";
    const name = document.createElement("span");
    name.className = "profile-domain";
    name.textContent = domain;
    const stats = document.createElement("span");
    stats.className = "profile-stats";
    stats.textContent = `${count} prompt${count === 1 ? "" : "s"}`;
    head.appendChild(name);
    head.appendChild(stats);
    row.appendChild(head);
    topDomainsEl.appendChild(row);
  }
}

async function refreshStats(): Promise<void> {
  renderStats(await getPromptOutcomes());
}

function renderDomainProfiles(profiles: DomainProfile[]): void {
  domainProfilesEl.innerHTML = "";

  if (profiles.length === 0) {
    const empty = document.createElement("div");
    empty.className = "list-empty";
    empty.textContent = "No domain profiles recorded yet.";
    domainProfilesEl.appendChild(empty);
    return;
  }

  for (const p of profiles) {
    const avgNRS = p.visits > 0 ? (p.totalNRS / p.visits).toFixed(1) : "0";
    const row = document.createElement("div");
    row.className = "profile-row";

    const head = document.createElement("div");
    head.className = "profile-head";
    const name = document.createElement("span");
    name.className = "profile-domain";
    name.textContent = p.domain;
    const stats = document.createElement("span");
    stats.className = "profile-stats";
    stats.textContent = `visits=${p.visits} avgNRS=${avgNRS} triggers=${p.triggerCount}`;
    head.appendChild(name);
    head.appendChild(stats);

    row.appendChild(head);

    const topFactors = Object.entries(p.factors)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k, v]) => `${k}(${v})`)
      .join(", ");
    if (topFactors) {
      const factors = document.createElement("div");
      factors.className = "profile-factors";
      factors.textContent = topFactors;
      row.appendChild(factors);
    }

    domainProfilesEl.appendChild(row);
  }
}

async function refreshDomainProfiles(): Promise<void> {
  renderDomainProfiles(await getTopSuspiciousDomains(10));
}

function getInt(el: HTMLInputElement, fallback: number): number {
  const n = Number(el.value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

async function init(): Promise<void> {
  const s = await getSuiteSettings();
  setSegValue(navModeSeg, s.nav.defaultMode);
  setToggle(navDebugEl, s.nav.debug);
  setToggle(navDnrEl, s.nav.dnrEnabled);
  setSegValue(credModeSeg, s.credential.mode);
  setToggle(blockHttpEl, s.credential.blockHttpPasswordSubmit);
  setToggle(warnPasteEl, s.credential.warnOnPaste);
  setToggle(promptUntrustedEl, s.credential.promptOnUntrustedDomain);
  setToggle(promptMediumEl, s.credential.promptOnMediumRisk);
  mediumThresholdEl.value = String(s.credential.mediumRiskThreshold);
  setToggle(similarityEnabledEl, s.credential.similarity.enabled);
  similarityMaxDistEl.value = String(s.credential.similarity.maxDistance);
  logLimitEl.value = String(s.logLimit);
  await refreshAllowlist();
  await refreshTrusted();
  await refreshEventLog();
  await refreshStats();
  await refreshDomainProfiles();
}

saveBtn.addEventListener("click", async () => {
  try {
    const nav = {
      defaultMode: getSegValue(navModeSeg) as Mode,
      debug: getToggle(navDebugEl),
      dnrEnabled: getToggle(navDnrEl)
    };
    const credential = {
      mode: getSegValue(credModeSeg) as CredMode,
      promptOnUntrustedDomain: getToggle(promptUntrustedEl),
      promptOnMediumRisk: getToggle(promptMediumEl),
      mediumRiskThreshold: getInt(mediumThresholdEl, 40),
      blockHttpPasswordSubmit: getToggle(blockHttpEl),
      warnOnPaste: getToggle(warnPasteEl),
      similarity: {
        enabled: getToggle(similarityEnabledEl),
        maxDistance: getInt(similarityMaxDistEl, 2)
      }
    };
    const logLimit = getInt(logLimitEl, 300);

    await updateSuiteSettings({ nav, credential, logLimit } satisfies Partial<SuiteSettings>);
    try {
      await appendEvent({ kind: "suite_config_update", extra: { nav, credential, logLimit } });
    } catch (e) { console.warn("[NavSentinel] event log append failed (suite_config_update):", e); }
    flashStatus(saveStatusEl, "Saved.");
  } catch (e) {
    console.warn("[NavSentinel] settings save failed:", e);
    flashStatus(saveStatusEl, "Save failed.", "error");
  }
});

clearAllowlistBtn.addEventListener("click", async () => {
  await clearAllowlist();
  try {
    await appendEvent({ kind: "nav_allowlist_remove", extra: { cleared: true } });
  } catch (e) { console.warn("[NavSentinel] event log append failed (nav_allowlist_remove):", e); }
  await refreshAllowlist();
  flashStatus(saveStatusEl, "Allowlist cleared.");
});

addTrustedBtn.addEventListener("click", async () => {
  const result = await addTrustedDomainWithResult(trustedInputEl.value);
  if (!result) {
    flashStatus(saveStatusEl, "Enter a valid domain.", "warning");
    return;
  }
  const { normalized } = result;
  trustedInputEl.value = "";
  try {
    await appendEvent({ kind: "cred_trust_domain", site: normalized });
  } catch (e) { console.warn("[NavSentinel] event log append failed (cred_trust_domain):", e); }
  await refreshTrusted();
  flashStatus(saveStatusEl, "Trusted domain added.");
});

clearTrustedBtn.addEventListener("click", async () => {
  await clearTrustedDomains();
  try {
    await appendEvent({ kind: "cred_untrust_domain", extra: { cleared: true } });
  } catch (e) { console.warn("[NavSentinel] event log append failed (cred_untrust_domain):", e); }
  await refreshTrusted();
  flashStatus(saveStatusEl, "Trusted list cleared.");
});

refreshLogBtn.addEventListener("click", async () => {
  await refreshEventLog();
  flashStatus(statusEl, "Refreshed.");
});

clearLogBtn.addEventListener("click", async () => {
  await clearEventLog();
  await refreshEventLog();
  flashStatus(statusEl, "Cleared.");
});

exportBtn.addEventListener("click", async () => {
  const payload = await exportAll();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `navsentinel-suite-export-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  flashStatus(statusEl, "Exported.");
});

importFileEl.addEventListener("change", async () => {
  const f = importFileEl.files?.[0];
  if (!f) return;
  try {
    await importAll(JSON.parse(await f.text()));
    await init();
    flashStatus(statusEl, "Imported.");
  } catch (e) {
    console.warn("[NavSentinel] import failed:", e);
    flashStatus(statusEl, "Import failed.", "error");
  } finally {
    importFileEl.value = "";
  }
});

refreshStatsBtn.addEventListener("click", async () => {
  await refreshStats();
  flashStatus(statusEl, "Stats refreshed.");
});

clearStatsBtn.addEventListener("click", async () => {
  await clearPromptOutcomes();
  await clearAdaptiveScores();
  await refreshStats();
  flashStatus(statusEl, "Stats cleared.");
});

refreshProfilesBtn.addEventListener("click", async () => {
  await refreshDomainProfiles();
  flashStatus(statusEl, "Profiles refreshed.");
});

clearProfilesBtn.addEventListener("click", async () => {
  await clearDomainProfiles();
  await refreshDomainProfiles();
  flashStatus(statusEl, "Domain profiles cleared.");
});

void init();
