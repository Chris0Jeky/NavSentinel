import { EVENT_LOG_KEY, SUITE_SETTINGS_KEY, getEventLog, getSuiteSettings, setEventAssessment } from "../shared/storage";
import type { EventAssessmentKind } from "../shared/event_assessment";
import { explainJournalReason } from "./evidence_reasons";
import { countExportOmittedExplanations, eventTitle, isHiddenCorrectionReason, filterEvidence, summarizeEvidence, type EvidenceCategory } from "./evidence_model";
import { PROTECTION_CATEGORIES, inProtectionRange, projectProtection, summarizeProtection, type ProtectionEvent, type ProtectionRange } from "./protection_model";
import { EVIDENCE_EXPORT_LIMIT_MESSAGE, prepareEvidenceExport, prepareReviewExport, type EvidenceExportSnapshot } from "./evidence_export";

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const status = byId("status");
const search = byId<HTMLInputElement>("search");
const category = byId<HTMLSelectElement>("category");
const scoredOnly = byId<HTMLInputElement>("scoredOnly");
const activityFilter = byId<HTMLSelectElement>("activityFilter");
const exportButton = byId<HTMLButtonElement>("export");
const reviewButton = byId<HTMLButtonElement>("exportReview");
let exportInvoker = exportButton;
const originalDisclosure = byId("exportDisclosure").textContent;
const refreshButton = byId<HTMLButtonElement>("refresh");
const previous = byId<HTMLButtonElement>("previous");
const next = byId<HTMLButtonElement>("next");
const showLatest = byId<HTMLButtonElement>("showLatest");
const exportDialog = byId<HTMLDialogElement>("exportDialog");
const exportPreview = byId<HTMLTextAreaElement>("exportPreview");
const exportOmissions = byId("exportOmissions");
let preparedExport: EvidenceExportSnapshot | null = null;
let events: ProtectionEvent[] = [];
let visible: ProtectionEvent[] = [];
let range: ProtectionRange = "history";
let snapshotAt = new Date();
let refreshRequested = false;
let revision = 0;
let removedReviewed = false;
let excluded = 0;
let duplicates = 0;
let logLimit = 5000;
let page = 0;
const pageSize = 25;
let rows = new Map<string, HTMLDetailsElement>();

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function keepReadingPosition(update: (reading: Element | null) => void): void {
  const container = byId("events");
  const reading = container.querySelector("details:focus-within") ?? container.querySelector("details[open]");
  const anchor = reading?.contains(document.activeElement) ? document.activeElement : reading;
  const position = anchor?.getBoundingClientRect().top;
  update(reading);
  if (anchor?.isConnected && position !== undefined) window.scrollBy({ top: anchor.getBoundingClientRect().top - position, behavior: "instant" });
}

function createRow(event: ProtectionEvent): HTMLDetailsElement {
  const row = element("details", "", "event");
  const summary = element("summary", "");
  const body = element("div", "", "event-body");
  body.append(element("div", eventTitle(event.kind, event.reasons), "event-title"), element("div", `${event.sourceSite ?? "Source unavailable"} → ${event.destinationSite ?? "Destination unavailable"}`, "event-route"));
  if (event.activity === "corrections") body.append(element("div", event.activityDetail, "activity-context"));
  const time = element("time", new Date(event.timestamp).toLocaleString());
  time.dateTime = event.timestamp;
  summary.append(body, time);
  if (event.score !== undefined) summary.append(element("span", `${event.score} points`, "score"));
  const detail = element("div", "", "details");
  detail.append(element("p", "Recorded observation · No independent consequence verification"));
  detail.append(element("p", event.activityDetail));
  detail.append(element("p", "Timestamp is ahead of this device. Excluded from activity totals and Today.", "future"));
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
      if (isHiddenCorrectionReason(event.activity, code)) continue;
      list.append(element("li", explainJournalReason(code)));
    }
    detail.append(list);
  } else detail.append(element("p", "No recognized signal explanation is available for this entry."));
  const assessment = element("label", "Your assessment", "assessment");
  const select = element("select", "");
  for (const [value, label] of [["", "Not assessed"], ["should-block", "Should block"], ["should-allow", "Should allow"], ["uncertain", "Unsure"]]) {
    const option = element("option", label!);
    option.value = value!;
    select.append(option);
  }
  select.addEventListener("change", async () => {
    const current = events.find(item => item.id === event.id);
    if (!current) return;
    const choice = select.value as EventAssessmentKind | "";
    try {
      await setEventAssessment(current.record, choice || null);
      await refresh();
      status.textContent = choice ? "Assessment saved locally. Protection is unchanged." : "Assessment removed.";
    } catch {
      await refresh();
      status.textContent = "Assessment was not saved. The record may have changed; refresh and try again.";
    }
  });
  assessment.append(select);
  detail.append(assessment);
  row.append(summary, detail);
  return row;
}

function render(preserve = false): void {
  const container = byId("events");
  const focused = document.activeElement;
  const reviewed = [...rows].filter(([, node]) => node.open || node.contains(focused));
  const supported = events.filter(event => inProtectionRange(event, "history", snapshotAt));
  const summary = summarizeEvidence(events);
  byId("total").textContent = String(summary.recorded);
  byId("scored").textContent = String(summary.scored);
  byId("sites").textContent = String(summary.sites);
  const first = supported[0];
  const last = supported.at(-1);
  byId("retention").textContent = `Up to ${logLimit} local records. ${first && last
    ? `Timestamp span: ${new Date(first.timestamp).toLocaleString()} – ${new Date(last.timestamp).toLocaleString()}.`
    : "No supported timestamps in this snapshot."} May include imports and gaps; not lifetime coverage. Today uses this device's date at refresh.`;
  byId("historyQuality").textContent = `${duplicates} duplicate rows collapsed · ${excluded} unreadable rows excluded · ${events.length - supported.length} future-dated rows outside totals. Missing action metadata stays observational; storage-rejected rows are unavailable.`;
  byId("today").hidden = supported.length === 0;
  if (!supported.length) range = "history";
  const counts = summarizeProtection(events, range, snapshotAt);
  for (const key of PROTECTION_CATEGORIES) byId(`${key}Count`).textContent = String(counts[key]);
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
  const matching = new Map(visible.map(event => [event.id, event]));
  const currentPage = visible.slice(page * pageSize, (page + 1) * pageSize);
  const holding = preserve && reviewed.some(([key]) => matching.has(key));
  const shown = holding ? [...rows.keys()].flatMap(key => matching.get(key) ?? []) : currentPage;
  showLatest.hidden = !holding || (shown.length === currentPage.length && shown.every((event, i) => event.id === currentPage[i]?.id));
  byId("results").setAttribute("aria-live", preserve && reviewed.length ? "off" : "polite");
  byId("results").textContent = `${visible.length} of ${events.length} retained events match. Newest timestamp first; ties show later-retained events first. Export includes all matching events, oldest first.`;
  byId("pageLabel").textContent = showLatest.hidden ? `Page ${page + 1} of ${pages}` : "Reading retained events";
  previous.disabled = page === 0;
  next.disabled = page >= pages - 1;
  exportButton.disabled = visible.length === 0;
  reviewButton.disabled = !visible.some(event => event.assessment);
  const wanted = new Set(shown.map(event => event.id));
  if (!preserve) rows.clear();
  for (const [key, node] of rows) if (!wanted.has(key)) { node.remove(); rows.delete(key); }
  if (!rows.size) container.replaceChildren();
  if (!visible.length) container.append(element("p", events.length ? "No events match these filters." : "No retained events. This is not a verdict on browsing safety.", "empty"));
  const nextRows = new Map<string, HTMLDetailsElement>();
  for (const [index, event] of shown.entries()) {
    const row = rows.get(event.id) ?? createRow(event);
    row.querySelector<HTMLSelectElement>(".assessment select")!.value = event.assessment?.kind ?? "";
    row.querySelector(".future")!.toggleAttribute("hidden", inProtectionRange(event, "history", snapshotAt));
    // Moving a focused node also loses focus; leave unchanged nodes attached in place.
    if (container.children[index] !== row) container.insertBefore(row, container.children[index] ?? null);
    nextRows.set(event.id, row);
  }
  rows = nextRows;
  if (preserve && reviewed.some(([key]) => !matching.has(key))) {
    removedReviewed = true;
    status.textContent = "A reviewed event is no longer in this view.";
    if (focused && !focused.isConnected) byId("journal").focus();
  }
}

async function refresh(): Promise<void> {
  if (refreshButton.disabled) { refreshRequested = true; return; }
  refreshButton.disabled = true;
  try {
    const requestedRevision = revision;
    const [log, settings] = await Promise.all([getEventLog(), getSuiteSettings()]);
    // A completed read must not restore content removed by a newer storage event.
    if (requestedRevision !== revision) return;
    keepReadingPosition(reading => {
      ({ events, excluded, duplicates } = projectProtection(log));
      snapshotAt = new Date();
      logLimit = settings.logLimit ?? 5000;
      byId("modes").textContent = `Navigation: ${settings.nav.defaultMode} · Credentials: ${settings.credential.mode} · Automatic overlay cleanup: ${settings.nav.autoDismissOverlays ? "on" : "off"}`;
      render(true);
      if (!reading && !removedReviewed) status.textContent = `Local snapshot refreshed at ${snapshotAt.toLocaleTimeString()}. ${excluded} entries excluded by the evidence format.`;
      removedReviewed = false;
    });
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
for (const key of PROTECTION_CATEGORIES) {
  byId(`${key}Filter`).addEventListener("click", () => {
    resetFilters(); activityFilter.value = key; render(); byId("journal").focus();
  });
}
for (const value of ["history", "today"] as const) byId(value).addEventListener("click", () => { range = value; page = 0; render(); });
globalThis.chrome?.storage?.onChanged?.addListener((changes, area) => {
  if (area !== "local" || !(EVENT_LOG_KEY in changes || SUITE_SETTINGS_KEY in changes)) return;
  revision++;
  if (EVENT_LOG_KEY in changes) keepReadingPosition(() => {
    const log: unknown = changes[EVENT_LOG_KEY]?.newValue;
    ({ events, excluded, duplicates } = projectProtection(Array.isArray(log) ? log : []));
    snapshotAt = new Date();
    render(true);
  });
  void refresh();
});
previous.addEventListener("click", () => { page--; render(); });
next.addEventListener("click", () => { page++; render(); });
showLatest.addEventListener("click", () => { page = 0; render(); byId("journal").focus(); });
refreshButton.addEventListener("click", () => { void refresh(); });
function previewExport(review: boolean): void {
  // Undo the newest-first view; the export projection independently orders it.
  // A failed preparation must not leave an older snapshot downloadable.
  preparedExport = null;
  exportPreview.value = "";
  exportOmissions.hidden = true;
  exportOmissions.textContent = "";
  try {
    preparedExport = (review ? prepareReviewExport : prepareEvidenceExport)(visible.slice().reverse());
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
  exportInvoker = review ? reviewButton : exportButton;
  byId("exportDisclosure").textContent = review
    ? "Assessed portable records and your separate opinions only. No hostnames or scores. Timestamps may reveal activity. Nothing is uploaded."
    : originalDisclosure;
  byId("exportSummary").textContent = `${preparedExport.count} recorded observations · ${preparedExport.bytes.toLocaleString()} bytes · Prepared ${new Date(preparedExport.exportedAt).toLocaleString()}`;
  const reviewed = review ? visible.filter(event => event.assessment) : visible;
  const omitted = countExportOmittedExplanations(reviewed);
  const unsupported = review ? reviewed.length - preparedExport.count : 0;
  exportOmissions.hidden = omitted === 0 && unsupported === 0;
  exportOmissions.textContent = (omitted
    ? `${omitted} record${omitted === 1 ? " includes" : "s include"} explanations that are not part of the portable export.`
    : "") + (unsupported ? ` ${unsupported} assessed record${unsupported === 1 ? "" : "s"} omitted: unsupported event type.` : "");
  exportDialog.showModal();
}
exportButton.addEventListener("click", () => previewExport(false));
reviewButton.addEventListener("click", () => previewExport(true));
byId("cancelExport").addEventListener("click", () => exportDialog.close());
exportDialog.addEventListener("close", () => {
  preparedExport = null;
  exportPreview.value = "";
  exportOmissions.hidden = true;
  exportOmissions.textContent = "";
  (exportInvoker.disabled ? byId("journal") : exportInvoker).focus();
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
