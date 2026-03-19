import type { Mode } from "../shared/types";
import type { CredMode, EventLogEntry, SuiteSettings } from "../shared/storage";
import {
  addTrustedDomainWithResult,
  appendEvent,
  clearEventLog,
  clearTrustedDomains,
  exportAll,
  getEventLog,
  getSuiteSettings,
  getTrustedDomains,
  importAll,
  removeTrustedDomain,
  updateSuiteSettings
} from "../shared/storage";
import {
  clearAllowlist,
  getAllowlist,
  removeAllowlistEntry,
  type Allowlist
} from "../shared/allowlist";
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

function flashStatus(el: HTMLElement, message: string): void {
  el.textContent = message;
  window.setTimeout(() => {
    el.textContent = "";
  }, 1400);
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
    flashStatus(saveStatusEl, "Save failed.");
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
    flashStatus(saveStatusEl, "Enter a valid domain.");
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
    flashStatus(statusEl, "Import failed.");
  } finally {
    importFileEl.value = "";
  }
});

void init();
