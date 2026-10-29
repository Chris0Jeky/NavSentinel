import { EVENT_LOG_KEY, SUITE_SETTINGS_KEY, getEventLog, getSuiteSettings } from "../shared/storage";
import { explainJournalReason } from "./evidence_reasons";
import { eventTitle, filterEvidence, summarizeEvidence, type EvidenceCategory } from "./evidence_model";
import { PROTECTION_CATEGORIES, inProtectionRange, projectProtection, summarizeProtection, type ProtectionCategory, type ProtectionEvent, type ProtectionRange } from "./protection_model";
import { EVIDENCE_EXPORT_LIMIT_MESSAGE, prepareEvidenceExport, type EvidenceExportSnapshot } from "./evidence_export";

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const status = byId("status");
const search = byId<HTMLInputElement>("search");
const category = byId<HTMLSelectElement>("category");
const scoredOnly = byId<HTMLInputElement>("scoredOnly");
const activityFilter = byId<HTMLSelectElement>("activityFilter");
const exportButton = byId<HTMLButtonElement>("export");
const refreshButton = byId<HTMLButtonElement>("refresh");
const previous = byId<HTMLButtonElement>("previous");
const next = byId<HTMLButtonElement>("next");
const exportDialog = byId<HTMLDialogElement>("exportDialog");
const exportPreview = byId<HTMLTextAreaElement>("exportPreview");
let preparedExport: EvidenceExportSnapshot | null = null;
let events: ProtectionEvent[] = [];
let visible: ProtectionEvent[] = [];
let range: ProtectionRange = "history";
let snapshotAt = new Date();
let refreshRequested = false;
let page = 0;
const pageSize = 25;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function render(): void {
  const supported = events.filter(event => inProtectionRange(event, "history", snapshotAt));
  byId("today").hidden = supported.length === 0;
  if (!supported.length) range = "history";
  const counts = summarizeProtection(events, range, snapshotAt);
  for (const key of Object.keys(PROTECTION_CATEGORIES) as ProtectionCategory[]) byId(`${key}Count`).textContent = String(counts[key]);
  for (const value of ["today", "history"]) byId(value).setAttribute("aria-pressed", String(range === value));
  byId("activity-title").textContent = range === "today" ? "Today in your retained history" : "Retained local history";
  const interventions = counts.overlays + counts.clicks + counts.redirects;
  byId("activity").dataset.recorded = String(interventions > 0);
  byId("milestone").textContent = interventions > 0 ? "Activity recorded, ready to review"
    : counts.corrections > 0 ? "Your choices are part of the record"
      : events.length ? "Observations ready to review" : "No retained activity yet";
  const scoped = events.filter(event =>
    (range === "history" || inProtectionRange(event, range, snapshotAt)) &&
    (activityFilter.value === "all" || (event.activity === activityFilter.value && inProtectionRange(event, range, snapshotAt)))
  );
  visible = filterEvidence(scoped, search.value, category.value as EvidenceCategory, scoredOnly.checked);
  const pages = Math.max(1, Math.ceil(visible.length / pageSize));
  page = Math.min(page, pages - 1);
  byId("results").textContent = `${visible.length} of ${events.length} retained events match. Newest timestamp first; ties show later-retained events first. Export includes all matching events, oldest first.`;
  byId("pageLabel").textContent = `Page ${page + 1} of ${pages}`;
  previous.disabled = page === 0;
  next.disabled = page >= pages - 1;
  exportButton.disabled = visible.length === 0;
  const container = byId("events");
  container.replaceChildren();
  if (!visible.length) container.append(element("p", events.length ? "No events match these filters." : "No retained events. This is not a verdict on browsing safety.", "empty"));
  for (const event of visible.slice(page * pageSize, (page + 1) * pageSize)) {
    const row = element("details", "", "event");
    const summary = element("summary", "");
    const body = element("div", "", "event-body");
    body.append(element("div", eventTitle(event.kind), "event-title"), element("div", `${event.sourceSite ?? "Source unavailable"} → ${event.destinationSite ?? "Destination unavailable"}`, "event-route"));
    if (event.activity === "corrections") body.append(element("div", event.activityDetail, "activity-context"));
    const time = element("time", new Date(event.timestamp).toLocaleString());
    time.dateTime = event.timestamp;
    summary.append(body, time);
    if (event.score !== undefined) summary.append(element("span", `${event.score} points`, "score"));
    const detail = element("div", "", "details");
    detail.append(element("p", "Recorded observation · No independent consequence verification"));
    detail.append(element("p", event.activityDetail));
    if (!inProtectionRange(event, "history", snapshotAt)) detail.append(element("p", "Timestamp is ahead of this device. Excluded from activity totals and Today."));
    if (event.activity === "corrections") {
      const recovery = element("a", "Review protection settings and trust choices");
      recovery.href = "../options/options.html";
      detail.append(recovery);
    }
    detail.append(element("p", `Event code: ${event.kind}`));
    if (event.score !== undefined) detail.append(element("p", "Score is a heuristic ranking, not a probability or protection rate."));
    if (event.reasons.length) {
      const list = element("ul", "");
      for (const code of event.reasons) {
        // The fixed legacy explanation assumes success; use the recorded result above.
        if (event.activity === "corrections" && (code === "overlay_cleanup_undo" || code === "overlay_cleanup_setting_off")) continue;
        list.append(element("li", explainJournalReason(code)));
      }
      detail.append(list);
    } else detail.append(element("p", "No recognized signal explanation is available for this entry."));
    row.append(summary, detail);
    container.append(row);
  }
}

async function refresh(): Promise<void> {
  if (refreshButton.disabled) { refreshRequested = true; return; }
  refreshButton.disabled = true;
  try {
    const [log, settings] = await Promise.all([getEventLog(), getSuiteSettings()]);
    const projection = projectProtection(log);
    events = projection.events;
    snapshotAt = new Date();
    const counts = summarizeEvidence(events);
    byId("total").textContent = String(counts.recorded);
    byId("scored").textContent = String(counts.scored);
    byId("sites").textContent = String(counts.sites);
    const supported = events.filter(event => inProtectionRange(event, "history", snapshotAt));
    const first = supported[0];
    const last = supported.at(-1);
    byId("retention").textContent = `Up to ${settings.logLimit ?? 5000} local records. ${first && last
      ? `Supported timestamps: ${new Date(first.timestamp).toLocaleString()} – ${new Date(last.timestamp).toLocaleString()}.`
      : "No supported timestamps in this snapshot."} May include imports. This is a record limit, not continuous coverage or a lifetime total. Today uses this device's local date at refresh.`;
    byId("historyQuality").textContent = `${projection.duplicates} duplicate rows collapsed · ${projection.excluded} unreadable rows excluded · ${events.length - supported.length} future-dated rows outside the totals. Legacy records without action metadata remain observations; malformed rows rejected by storage are unavailable.`;
    byId("modes").textContent = `Navigation: ${settings.nav.defaultMode} · Credentials: ${settings.credential.mode} · Automatic overlay cleanup: ${settings.nav.autoDismissOverlays ? "on" : "off"}`;
    status.textContent = `Local snapshot refreshed at ${snapshotAt.toLocaleTimeString()}. ${projection.excluded} entries excluded by the evidence format.`;
    render();
  } catch {
    status.textContent = "Could not refresh local evidence. Any displayed snapshot may be stale. Try Refresh evidence again.";
  } finally {
    refreshButton.disabled = false;
    if (refreshRequested) { refreshRequested = false; void refresh(); }
  }
}

for (const control of [search, category, scoredOnly, activityFilter]) control.addEventListener("input", () => { page = 0; render(); });
function resetFilters(): void { search.value = ""; category.value = "all"; activityFilter.value = "all"; scoredOnly.checked = false; page = 0; }
byId("resetFilters").addEventListener("click", () => { resetFilters(); render(); });
for (const key of Object.keys(PROTECTION_CATEGORIES) as ProtectionCategory[]) {
  byId(`${key}Filter`).addEventListener("click", () => {
    resetFilters(); activityFilter.value = key; render(); byId("journal").focus();
  });
}
for (const value of ["history", "today"] as const) byId(value).addEventListener("click", () => { range = value; page = 0; render(); });
globalThis.chrome?.storage?.onChanged?.addListener((changes, area) => {
  if (area === "local" && (EVENT_LOG_KEY in changes || SUITE_SETTINGS_KEY in changes)) void refresh();
});
previous.addEventListener("click", () => { page--; render(); });
next.addEventListener("click", () => { page++; render(); });
refreshButton.addEventListener("click", () => { void refresh(); });
exportButton.addEventListener("click", () => {
  // Undo the newest-first view; the export projection independently orders it.
  // A failed preparation must not leave an older snapshot downloadable.
  preparedExport = null;
  exportPreview.value = "";
  try {
    preparedExport = prepareEvidenceExport(visible.slice().reverse());
  } catch (error) {
    // Only the export-size guard's own RangeError earns the 8 MiB message: any
    // other RangeError (e.g. stack exhaustion while serializing) must not send
    // the user narrowing filters that cannot help.
    status.textContent = error instanceof RangeError && error.message === EVIDENCE_EXPORT_LIMIT_MESSAGE
      ? EVIDENCE_EXPORT_LIMIT_MESSAGE
      : "Could not prepare local evidence. Refresh the journal and try again.";
    return;
  }
  exportPreview.value = preparedExport.text;
  byId("exportSummary").textContent = `${preparedExport.count} recorded observations · ${preparedExport.bytes.toLocaleString()} bytes · Prepared ${new Date(preparedExport.exportedAt).toLocaleString()}`;
  exportDialog.showModal();
});
byId("cancelExport").addEventListener("click", () => exportDialog.close());
exportDialog.addEventListener("close", () => {
  preparedExport = null;
  exportPreview.value = "";
  exportButton.focus();
});
byId("downloadExport").addEventListener("click", () => {
  if (!preparedExport) return;
  // Download exactly the bytes reviewed, even if time or the journal has changed.
  const snapshot = preparedExport;
  const url = URL.createObjectURL(new Blob([snapshot.text], { type: "application/json" }));
  const link = element("a", "");
  link.href = url;
  link.download = snapshot.filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  exportDialog.close();
  status.textContent = `Prepared ${snapshot.count} reviewed, minimized events for download. Nothing was uploaded.`;
});
const theme = byId<HTMLSelectElement>("theme");
const themes = new Set(["forest", "paper", "midnight"]);
try {
  const saved = localStorage.getItem("ns-evidence-theme");
  if (saved && themes.has(saved)) theme.value = saved;
} catch { /* Appearance persistence is optional; the page remains usable. */ }
document.documentElement.dataset.theme = theme.value;
theme.addEventListener("change", () => {
  if (!themes.has(theme.value)) return;
  document.documentElement.dataset.theme = theme.value;
  try { localStorage.setItem("ns-evidence-theme", theme.value); } catch { status.textContent = "Appearance changed for this visit; this browser could not save it."; }
});
void refresh();
