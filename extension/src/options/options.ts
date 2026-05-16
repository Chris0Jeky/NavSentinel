import type { Mode } from "../shared/types";
import type { CredMode, EventLogEntry, SuiteSettings } from "../shared/storage";
import { classifyEventTone } from "../shared/event_tone";
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
const navModeEl = document.getElementById("navMode") as HTMLSelectElement;
const navDebugEl = document.getElementById("navDebug") as HTMLInputElement;
const navDnrEl = document.getElementById("navDnrEnabled") as HTMLInputElement;
const credModeEl = document.getElementById("credMode") as HTMLSelectElement;
const blockHttpEl = document.getElementById("blockHttpPasswordSubmit") as HTMLInputElement;
const warnPasteEl = document.getElementById("warnOnPaste") as HTMLInputElement;
const promptUntrustedEl = document.getElementById("promptOnUntrustedDomain") as HTMLInputElement;
const promptMediumEl = document.getElementById("promptOnMediumRisk") as HTMLInputElement;
const mediumThresholdEl = document.getElementById("mediumRiskThreshold") as HTMLInputElement;
const similarityEnabledEl = document.getElementById("similarityEnabled") as HTMLInputElement;
const similarityMaxDistEl = document.getElementById("similarityMaxDistance") as HTMLInputElement;
const logLimitEl = document.getElementById("logLimit") as HTMLInputElement;
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
const statusTimers = new WeakMap<HTMLElement, number>();

function flashStatus(
  el: HTMLElement,
  message: string,
  tone: "success" | "warning" | "error" = "success"
): void {
  const existing = statusTimers.get(el);
  if (existing !== undefined) {
    window.clearTimeout(existing);
  }
  el.textContent = message;
  el.dataset.tone = tone;
  const timer = window.setTimeout(() => {
    el.textContent = "";
    delete el.dataset.tone;
    statusTimers.delete(el);
  }, 1400);
  statusTimers.set(el, timer);
}

function renderAllowlist(list: Allowlist): void {
  allowlistEl.innerHTML = "";
  const sites = Object.keys(list).sort();
  clearAllowlistBtn.disabled = sites.length === 0;

  if (sites.length === 0) {
    const empty = document.createElement("div");
    empty.className = "allowlist-empty";
    empty.textContent = "No allowlist entries yet.";
    allowlistEl.appendChild(empty);
    return;
  }

  for (const site of sites) {
    const siteRow = document.createElement("div");
    siteRow.className = "allowlist-site";

    const title = document.createElement("div");
    title.className = "allowlist-site-title mono";
    title.textContent = site;

    const hostList = document.createElement("div");
    hostList.className = "allowlist-hosts";

    for (const host of (list[site] ?? []).slice().sort()) {
      const hostRow = document.createElement("div");
      hostRow.className = "allowlist-host";

      const hostLabel = document.createElement("span");
      hostLabel.className = "mono";
      hostLabel.textContent = host;

      const removeBtn = document.createElement("button");
      removeBtn.textContent = "Remove";
      removeBtn.setAttribute("aria-label", `Remove ${host} from allowlist`);
      removeBtn.addEventListener("click", async () => {
        await removeAllowlistEntry(site, host);
        try {
          await appendEvent({ kind: "nav_allowlist_remove", site, destHost: host });
        } catch {
          // ignore
        }
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
    empty.className = "allowlist-empty";
    empty.textContent = "No trusted domains yet.";
    trustedListEl.appendChild(empty);
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "allowlist-hosts";
  for (const domain of list) {
    const row = document.createElement("div");
    row.className = "allowlist-host";

    const label = document.createElement("span");
    label.className = "mono";
    label.textContent = domain;

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "Remove";
    removeBtn.setAttribute("aria-label", `Remove ${domain} from trusted`);
    removeBtn.addEventListener("click", async () => {
      await removeTrustedDomain(domain);
      try {
        await appendEvent({ kind: "cred_untrust_domain", site: domain });
      } catch {
        // ignore
      }
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

  if (list.length === 0) {
    const empty = document.createElement("div");
    empty.className = "allowlist-empty";
    empty.textContent = "No events yet.";
    eventLogEl.appendChild(empty);
    return;
  }

  for (const event of list) {
    const row = document.createElement("div");
    row.className = "event";
    row.dataset.tone = classifyEventTone(event.kind);

    const head = document.createElement("div");
    head.className = "event-head";

    const badge = document.createElement("span");
    badge.className = "badge mono";
    badge.textContent = event.kind;

    const time = document.createElement("span");
    time.className = "event-time mono";
    time.textContent = fmtTime(event.ts);

    head.appendChild(badge);
    head.appendChild(time);

    const meta = document.createElement("div");
    meta.className = "mono";
    const parts: string[] = [];
    if (event.site) parts.push(`site=${event.site}`);
    if (event.destHost) parts.push(`dest=${event.destHost}`);
    if (typeof event.score === "number") parts.push(`score=${event.score}`);
    if (event.reasons?.length) {
      parts.push(
        `reasons=${event.reasons.slice(0, 6).join(",")}${event.reasons.length > 6 ? "..." : ""}`
      );
    }
    meta.textContent = parts.join(" | ");

    row.appendChild(head);
    if (meta.textContent) row.appendChild(meta);
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

  // Top 5 domains
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
    empty.className = "allowlist-empty";
    empty.textContent = "No prompt outcomes recorded yet.";
    topDomainsEl.appendChild(empty);
    return;
  }

  const heading = document.createElement("div");
  heading.style.fontWeight = "700";
  heading.style.marginBottom = "8px";
  heading.textContent = "Top prompted domains";
  topDomainsEl.appendChild(heading);

  for (const [domain, count] of top5) {
    const row = document.createElement("div");
    row.className = "event-head";
    const badge = document.createElement("span");
    badge.className = "badge mono";
    badge.textContent = domain;
    const countSpan = document.createElement("span");
    countSpan.className = "event-time mono";
    countSpan.textContent = `${count} prompt${count === 1 ? "" : "s"}`;
    row.appendChild(badge);
    row.appendChild(countSpan);
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
    empty.className = "allowlist-empty";
    empty.textContent = "No domain profiles recorded yet.";
    domainProfilesEl.appendChild(empty);
    return;
  }

  for (const p of profiles) {
    const row = document.createElement("div");
    row.className = "event";
    const avgNRS = p.visits > 0 ? (p.totalNRS / p.visits).toFixed(1) : "0";

    const head = document.createElement("div");
    head.className = "event-head";

    const badge = document.createElement("span");
    badge.className = "badge mono";
    badge.textContent = p.domain;

    const meta = document.createElement("span");
    meta.className = "event-time mono";
    meta.textContent = `visits=${p.visits} avgNRS=${avgNRS} triggers=${p.triggerCount}`;

    head.appendChild(badge);
    head.appendChild(meta);

    const details = document.createElement("div");
    details.className = "mono";
    const topFactors = Object.entries(p.factors)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k, v]) => `${k}(${v})`)
      .join(", ");
    if (topFactors) {
      details.textContent = `top factors: ${topFactors}`;
    }

    row.appendChild(head);
    if (details.textContent) row.appendChild(details);
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
  navModeEl.value = s.nav.defaultMode;
  navDebugEl.checked = s.nav.debug;
  navDnrEl.checked = s.nav.dnrEnabled;
  credModeEl.value = s.credential.mode;
  blockHttpEl.checked = s.credential.blockHttpPasswordSubmit;
  warnPasteEl.checked = s.credential.warnOnPaste;
  promptUntrustedEl.checked = s.credential.promptOnUntrustedDomain;
  promptMediumEl.checked = s.credential.promptOnMediumRisk;
  mediumThresholdEl.value = String(s.credential.mediumRiskThreshold);
  similarityEnabledEl.checked = s.credential.similarity.enabled;
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
      defaultMode: navModeEl.value as Mode,
      debug: navDebugEl.checked,
      dnrEnabled: navDnrEl.checked
    };
    const credential = {
      mode: credModeEl.value as CredMode,
      promptOnUntrustedDomain: promptUntrustedEl.checked,
      promptOnMediumRisk: promptMediumEl.checked,
      mediumRiskThreshold: getInt(mediumThresholdEl, 40),
      blockHttpPasswordSubmit: blockHttpEl.checked,
      warnOnPaste: warnPasteEl.checked,
      similarity: {
        enabled: similarityEnabledEl.checked,
        maxDistance: getInt(similarityMaxDistEl, 2)
      }
    };
    const logLimit = getInt(logLimitEl, 300);

    await updateSuiteSettings({ nav, credential, logLimit } satisfies Partial<SuiteSettings>);
    try {
      await appendEvent({ kind: "suite_config_update", extra: { nav, credential, logLimit } });
    } catch {
      // ignore
    }
    flashStatus(saveStatusEl, "Saved.");
  } catch {
    flashStatus(saveStatusEl, "Save failed.", "error");
  }
});

clearAllowlistBtn.addEventListener("click", async () => {
  await clearAllowlist();
  try {
    await appendEvent({ kind: "nav_allowlist_remove", extra: { cleared: true } });
  } catch {
    // ignore
  }
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
  } catch {
    // ignore
  }
  await refreshTrusted();
  flashStatus(saveStatusEl, "Trusted domain added.");
});

clearTrustedBtn.addEventListener("click", async () => {
  await clearTrustedDomains();
  try {
    await appendEvent({ kind: "cred_untrust_domain", extra: { cleared: true } });
  } catch {
    // ignore
  }
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
  } catch {
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
