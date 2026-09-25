import { appendOverlayUserMiss, getEventLog, getSuiteSettings, setOverlayReviewLabel, type EventLogEntry, type OverlayReviewLabel } from "../shared/storage";
import { explainJournalReason } from "./evidence_reasons";
import { eventTitle, filterEvidence, overlayReviewOutcomeLabel, projectEvidence, projectOverlayReviews, summarizeEvidence, type EvidenceCategory, type EvidenceEvent, type OverlayReviewItem } from "./evidence_model";
import { EVIDENCE_EXPORT_LIMIT_MESSAGE, prepareEvidenceExport, type EvidenceExportSnapshot } from "./evidence_export";
import { browserMajorFromUserAgent, OVERLAY_DIAGNOSTIC_LIMIT_MESSAGE, prepareOverlayDiagnosticExport, sanitizeProductVersion, type OverlayDiagnosticSnapshot } from "./overlay_diagnostic_export";

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
const reviewList = byId("reviewList");
const reviewResults = byId("reviewResults");
const reportMissButton = byId<HTMLButtonElement>("reportMiss");
const prepareDiagnosticButton = byId<HTMLButtonElement>("prepareDiagnostic");
const diagnosticDialog = byId<HTMLDialogElement>("diagnosticDialog");
const diagnosticPreview = byId<HTMLTextAreaElement>("diagnosticPreview");
let preparedExport: EvidenceExportSnapshot | null = null;
let preparedDiagnostic: OverlayDiagnosticSnapshot | null = null;
let events: EvidenceEvent[] = [];
let visible: EvidenceEvent[] = [];
let reviewItems: OverlayReviewItem[] = [];
let retainedLog: EventLogEntry[] = [];
let page = 0;
const pageSize = 25;
let statusActionId = 0;
let pendingRefreshes = 0;

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
      for (const code of event.reasons) list.append(element("li", explainJournalReason(code)));
      detail.append(list);
    } else detail.append(element("p", "No recognized signal explanation is available for this entry."));
    row.append(summary, detail);
    container.append(row);
  }
}

function productVersionFromManifest(): string {
  try {
    const manifest = (globalThis as { chrome?: { runtime?: { getManifest?: () => { version?: unknown } } } }).chrome?.runtime?.getManifest?.();
    return sanitizeProductVersion(manifest?.version);
  } catch {
    return "unknown";
  }
}

function browserMajorFromNavigator(): number {
  try {
    return browserMajorFromUserAgent(navigator.userAgent);
  } catch {
    return 0;
  }
}

function diagnosticContext(): { productVersion: unknown; browserMajor: number } {
  return {
    productVersion: productVersionFromManifest(),
    browserMajor: browserMajorFromNavigator(),
  };
}

function renderReview(focus?: { entryId: string; label: OverlayReviewLabel }): void {
  reviewList.replaceChildren();
  prepareDiagnosticButton.disabled = reviewItems.length === 0;
  if (!reviewItems.length) {
    reviewResults.textContent = "No retained overlay cleanup attempts. This is not a verdict on browsing safety.";
    reviewList.append(element("p", "No retained overlay cleanup attempts. Suppressed, reasserted, budget-limited, restored, and reported misses will appear here when they are retained.", "empty"));
    return;
  }
  reviewResults.textContent = `${reviewItems.length} retained overlay cleanup attempts. Oldest first. Labels stay local and clear with behavioural data.`;
  // Newest last in storage order; show newest first for review without mutating the diagnostic order.
  for (const item of reviewItems.slice().reverse()) {
    const row = element("details", "", "event");
    const restoreFocus = item.entryId === focus?.entryId;
    if (restoreFocus) row.open = true;
    const summary = element("summary", "");
    const body = element("div", "", "event-body");
    body.append(
      element("div", overlayReviewOutcomeLabel(item.outcome), "event-title"),
      element("div", `${item.frame === "top" ? "Top frame" : item.frame === "child" ? "Child frame" : "Frame unavailable"} · ${item.coverageBucket} · ${item.stackingBucket}`, "event-route"),
    );
    const time = element("time", new Date(item.timestamp).toLocaleString());
    time.dateTime = item.timestamp;
    summary.append(body, time);
    if (item.label) summary.append(element("span", item.label === "should_block" ? "Should block" : "Should allow", "score"));
    const detail = element("div", "", "details");
    detail.append(element("p", "Local cleanup record · Not a protection rate or safety verdict"));
    detail.append(element("p", `Outcome: ${overlayReviewOutcomeLabel(item.outcome)}`));
    if (item.reasons.length) {
      const list = element("ul", "");
      for (const code of item.reasons) list.append(element("li", explainJournalReason(code)));
      detail.append(list);
    } else detail.append(element("p", "No recognized signal explanation is available for this entry."));
    const labelRow = element("div", "", "review-actions");
    const blockButton = element("button", item.label === "should_block" ? "Labeled: Should block" : "Should block", "secondary");
    blockButton.type = "button";
    blockButton.setAttribute("aria-pressed", item.label === "should_block" ? "true" : "false");
    const allowButton = element("button", item.label === "should_allow" ? "Labeled: Should allow" : "Should allow", "secondary");
    allowButton.type = "button";
    allowButton.setAttribute("aria-pressed", item.label === "should_allow" ? "true" : "false");
    const clearButton = element("button", "Clear label", "secondary");
    clearButton.type = "button";
    clearButton.disabled = item.label === undefined;
    blockButton.addEventListener("click", () => { void labelReviewItem(item.entryId, "should_block"); });
    allowButton.addEventListener("click", () => { void labelReviewItem(item.entryId, "should_allow"); });
    clearButton.addEventListener("click", () => { void labelReviewItem(item.entryId, null); });
    labelRow.append(blockButton, allowButton, clearButton);
    detail.append(labelRow);
    row.append(summary, detail);
    reviewList.append(row);
    if (restoreFocus) (focus.label === "should_allow" ? allowButton : blockButton).focus();
  }
}

async function labelReviewItem(entryId: string, label: OverlayReviewLabel | null): Promise<void> {
  const actionId = ++statusActionId;
  try {
    const ok = await setOverlayReviewLabel(entryId, label);
    if (!ok) {
      if (actionId === statusActionId) status.textContent = "Could not save that label. Refresh the review queue and try again.";
      return;
    }
    await refresh(false, statusActionId, { entryId, label: label ?? "should_block" });
    if (actionId !== statusActionId) return;
    status.textContent = label === null
      ? "Cleared the local label. Nothing was uploaded."
      : "Saved the local label. Nothing was uploaded.";
  } catch {
    if (actionId === statusActionId) status.textContent = "Could not save that label. Refresh the review queue and try again.";
  }
}

async function refresh(
  announceStatus = true,
  actionId = statusActionId,
  reviewFocus?: { entryId: string; label: OverlayReviewLabel },
): Promise<void> {
  if (announceStatus && refreshButton.disabled) return;
  pendingRefreshes += 1;
  refreshButton.disabled = true;
  try {
    const [log, settings] = await Promise.all([getEventLog(), getSuiteSettings()]);
    retainedLog = log;
    events = projectEvidence(log);
    reviewItems = projectOverlayReviews(log);
    const counts = summarizeEvidence(events);
    byId("total").textContent = String(counts.recorded);
    byId("scored").textContent = String(counts.scored);
    byId("sites").textContent = String(counts.sites);
    byId("modes").textContent = `Navigation: ${settings.nav.defaultMode} · Credentials: ${settings.credential.mode} · Automatic overlay cleanup: ${settings.nav.autoDismissOverlays ? "on" : "off"}`;
    if (announceStatus && actionId === statusActionId) {
      status.textContent = `Local snapshot refreshed at ${new Date().toLocaleTimeString()}. ${log.length - events.length} entries excluded by the evidence format.`;
    }
    render();
    renderReview(reviewFocus);
  } catch {
    if (announceStatus && actionId === statusActionId) {
      status.textContent = "Could not refresh local evidence. Any displayed snapshot may be stale. Try Refresh evidence again.";
    }
  } finally {
    pendingRefreshes -= 1;
    if (pendingRefreshes === 0) refreshButton.disabled = false;
  }
}

for (const control of [search, category, scoredOnly]) control.addEventListener("input", () => { page = 0; render(); });
byId("resetFilters").addEventListener("click", () => { search.value = ""; category.value = "all"; scoredOnly.checked = false; page = 0; render(); });
previous.addEventListener("click", () => { page--; render(); });
next.addEventListener("click", () => { page++; render(); });
refreshButton.addEventListener("click", () => {
  const actionId = ++statusActionId;
  void refresh(true, actionId);
});
reportMissButton.addEventListener("click", () => {
  const actionId = ++statusActionId;
  void (async () => {
    try {
      await appendOverlayUserMiss();
      await refresh(false);
      if (actionId !== statusActionId) return;
      status.textContent = "Recorded a local reported miss. Nothing was uploaded.";
      document.getElementById("overlay-review")?.focus({ preventScroll: false });
    } catch {
      if (actionId === statusActionId) status.textContent = "Could not record the reported miss. Try Refresh evidence again.";
    }
  })();
});
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
prepareDiagnosticButton.addEventListener("click", () => {
  preparedDiagnostic = null;
  diagnosticPreview.value = "";
  try {
    preparedDiagnostic = prepareOverlayDiagnosticExport(retainedLog, diagnosticContext(), new Date());
  } catch (error) {
    status.textContent = error instanceof RangeError
      ? OVERLAY_DIAGNOSTIC_LIMIT_MESSAGE
      : "Could not prepare the diagnostic bundle. Refresh and try again.";
    return;
  }
  diagnosticPreview.value = preparedDiagnostic.text;
  byId("diagnosticSummary").textContent = `${preparedDiagnostic.count} diagnostic records · ${preparedDiagnostic.bytes.toLocaleString()} bytes · Prepared ${new Date(preparedDiagnostic.exportedAt).toLocaleString()}`;
  diagnosticDialog.showModal();
});
byId("cancelDiagnostic").addEventListener("click", () => diagnosticDialog.close());
diagnosticDialog.addEventListener("close", () => {
  preparedDiagnostic = null;
  diagnosticPreview.value = "";
  prepareDiagnosticButton.focus();
});
byId("downloadDiagnostic").addEventListener("click", () => {
  if (!preparedDiagnostic) return;
  const snapshot = preparedDiagnostic;
  const url = URL.createObjectURL(new Blob([snapshot.text], { type: "application/json" }));
  const link = element("a", "");
  link.href = url;
  link.download = snapshot.filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  diagnosticDialog.close();
  status.textContent = `Prepared ${snapshot.count} reviewed diagnostic records for download. Nothing was uploaded.`;
});
byId("copyDiagnostic").addEventListener("click", () => {
  void (async () => {
    if (!preparedDiagnostic) return;
    const text = preparedDiagnostic.text;
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = `Copied ${preparedDiagnostic.count} reviewed diagnostic records. Nothing was uploaded.`;
    } catch {
      try {
        diagnosticPreview.focus();
        diagnosticPreview.select();
        const copied = document.execCommand("copy");
        status.textContent = copied
          ? `Copied ${preparedDiagnostic!.count} reviewed diagnostic records. Nothing was uploaded.`
          : "Could not copy the preview. Select the preview text and copy it manually.";
      } catch {
        status.textContent = "Could not copy the preview. Select the preview text and copy it manually.";
      }
    }
  })();
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
