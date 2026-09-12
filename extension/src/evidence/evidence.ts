import { getEventLog, getSuiteSettings } from "../shared/storage";
import { explainReasonCode } from "../shared/explanations";
import { eventTitle, filterEvidence, projectEvidence, summarizeEvidence, type EvidenceCategory, type EvidenceEvent } from "./evidence_model";
import { EVIDENCE_EXPORT_LIMIT_MESSAGE, prepareEvidenceExport, type EvidenceExportSnapshot } from "./evidence_export";

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const status = byId("status");
const search = byId<HTMLInputElement>("search");
const category = byId<HTMLSelectElement>("category");
const scoredOnly = byId<HTMLInputElement>("scoredOnly");
const exportButton = byId<HTMLButtonElement>("export");
const refreshButton = byId<HTMLButtonElement>("refresh");
const previous = byId<HTMLButtonElement>("previous");
const next = byId<HTMLButtonElement>("next");
const exportDialog = byId<HTMLDialogElement>("exportDialog");
const exportPreview = byId<HTMLTextAreaElement>("exportPreview");
let preparedExport: EvidenceExportSnapshot | null = null;
let events: EvidenceEvent[] = [];
let visible: EvidenceEvent[] = [];
let page = 0;
const pageSize = 25;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function render(): void {
  visible = filterEvidence(events, search.value, category.value as EvidenceCategory, scoredOnly.checked);
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
    const time = element("time", new Date(event.timestamp).toLocaleString());
    time.dateTime = event.timestamp;
    summary.append(body, time);
    if (event.score !== undefined) summary.append(element("span", `${event.score} points`, "score"));
    const detail = element("div", "", "details");
    detail.append(element("p", "Recorded observation · No independent consequence verification"));
    detail.append(element("p", `Event code: ${event.kind}`));
    if (event.score !== undefined) detail.append(element("p", "Score is a heuristic ranking, not a probability or protection rate."));
    if (event.reasons.length) {
      const list = element("ul", "");
      for (const code of event.reasons) list.append(element("li", explainReasonCode(code)));
      detail.append(list);
    } else detail.append(element("p", "No recognized signal explanation is available for this entry."));
    row.append(summary, detail);
    container.append(row);
  }
}

async function refresh(): Promise<void> {
  if (refreshButton.disabled) return;
  refreshButton.disabled = true;
  try {
    const [log, settings] = await Promise.all([getEventLog(), getSuiteSettings()]);
    events = projectEvidence(log);
    const counts = summarizeEvidence(events);
    byId("total").textContent = String(counts.recorded);
    byId("scored").textContent = String(counts.scored);
    byId("sites").textContent = String(counts.sites);
    byId("modes").textContent = `Navigation: ${settings.nav.defaultMode} · Credentials: ${settings.credential.mode} · Automatic overlay cleanup: ${settings.nav.autoDismissOverlays ? "on" : "off"}`;
    status.textContent = `Local snapshot refreshed at ${new Date().toLocaleTimeString()}. ${log.length - events.length} entries excluded by the evidence format.`;
    render();
  } catch {
    status.textContent = "Could not refresh local evidence. Any displayed snapshot may be stale. Try Refresh evidence again.";
  } finally { refreshButton.disabled = false; }
}

for (const control of [search, category, scoredOnly]) control.addEventListener("input", () => { page = 0; render(); });
byId("resetFilters").addEventListener("click", () => { search.value = ""; category.value = "all"; scoredOnly.checked = false; page = 0; render(); });
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
    status.textContent = error instanceof RangeError
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
