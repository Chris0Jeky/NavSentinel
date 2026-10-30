import { describe, expect, it } from "vitest";
import type { EventLogEntry } from "../extension/src/shared/storage";
import { createEvidenceExport, MAX_EVIDENCE_EVENTS } from "../extension/src/evidence/evidence_model";
import { projectProtection, summarizeProtection } from "../extension/src/evidence/protection_model";

const now = new Date(2026, 9, 29, 12);
const row = (id: string, patch: Partial<EventLogEntry> = {}): EventLogEntry => ({ id, ts: now.getTime() - 1000, kind: "nav_click_block", ...patch });
const zeros = { overlays: 0, clicks: 0, redirects: 0, warnings: 0, corrections: 0 };

describe("deduplicated retained protection activity", () => {
  it("maps cleanup, clicks, popup/redirect decisions and warnings into disjoint categories", () => {
    const { events } = projectProtection([
      row("settle", { kind: "mutation_alert", reasons: ["overlay_detected"], extra: { overlayAutoDismissed: true } }),
      row("injected", { kind: "mutation_alert", reasons: ["overlay_injected"], extra: { overlayAutoDismissed: true } }),
      row("cleanup-click", { extra: { overlayAutoDismissed: true } }), row("click"),
      row("popup", { kind: "nav_blank_prompt" }), row("redirect", { kind: "nav_rollback" }),
      row("paste", { kind: "cred_paste_warn" }), row("clickfix", { kind: "clickfix_detected" }),
      row("reputation", { kind: "nav_reputation_late_warn" }),
    ]);
    expect(summarizeProtection(events, "history", now)).toEqual({ overlays: 3, clicks: 1, redirects: 2, warnings: 3, corrections: 0 });
    expect(events.map(event => event.activity)).toEqual(["overlays", "overlays", "overlays", "clicks", "redirects", "redirects", "warnings", "warnings", "warnings"]);
  });

  it("uses the last valid retained row of an existing ID, even when it is a correction", () => {
    const snapshot = projectProtection([
      row("same", { kind: "nav_blank_prompt", extra: { overlayAutoDismissed: true } }), row("same"),
      row("same", { kind: "mutation_alert", reasons: ["overlay_cleanup_undo"], extra: { restored: true } }),
      row("same", { ts: NaN }),
    ]);
    expect(snapshot).toMatchObject({ duplicates: 2, excluded: 1 });
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.events[0]?.activityDetail).toContain("Restoration was reported successful");
    expect(summarizeProtection(snapshot.events, "history", now)).toEqual({ ...zeros, corrections: 1 });
  });

  it("keeps failed and legacy Undo separate from interventions and trust choices", () => {
    const events = projectProtection([
      row("failed", { kind: "mutation_alert", reasons: ["overlay_cleanup_undo"], extra: { restored: false, overlayAutoDismissed: true } }),
      row("unknown", { kind: "mutation_alert", reasons: ["overlay_cleanup_undo"] }),
      row("setting", { kind: "mutation_alert", reasons: ["overlay_cleanup_setting_off"], extra: { restored: true } }),
      ...(["nav_allowlist_add", "nav_allowlist_remove", "cred_submit_allow_once", "cred_trust_domain", "cred_untrust_domain"] as const).map(kind => row(kind, { kind })),
    ]).events;
    expect(summarizeProtection(events, "history", now)).toEqual({ ...zeros, corrections: 8 });
    expect(events[0]?.activityDetail).toContain("not confirmed");
    expect(events[1]?.activityDetail).toContain("unavailable");
  });

  it("does not inflate cleanup counts with follow-ups, contradictory metadata or detection-only observations", () => {
    const events = projectProtection([
      ...["reasserted", "already_hidden", "restored"].map(action => row(action, { kind: "mutation_alert", reasons: ["overlay_detected"], extra: { overlayAutoDismissed: true, overlayCleanupOutcome: action } })),
      row("budget", { kind: "mutation_alert", reasons: ["overlay_detected"], extra: { overlayAutoDismissed: true, overlayCleanupOutcome: "budget_exhausted" } }),
      row("legacy", { kind: "mutation_alert", reasons: ["overlay_detected"] }),
      row("ambiguous", { kind: "mutation_alert", reasons: ["overlay_detected", "overlay_injected"], extra: { overlayAutoDismissed: true } }),
      row("invented", { kind: "mutation_alert", reasons: ["overlay_invented"], extra: { severity: "high" } }),
      row("actual-warning", { kind: "mutation_alert", reasons: ["overlay_injected"], extra: { severity: "high" } }),
      ...(["dblclickjack_detected", "pushstate_abuse", "cred_submit_prompt", "cred_form_evaluated", "nav_silent_allow", "bridge_buffer_overflow", "suite_config_update"] as const).map(kind => row(kind, { kind })),
    ]).events;
    expect(summarizeProtection(events, "history", now)).toEqual({ ...zeros, warnings: 2 });
    expect(events.slice(0, 4).map(event => event.activity)).toEqual(["other", "other", "other", "warnings"]);
    expect(events[6]?.activity).toBe("other");
    expect(events.filter(event => event.activity === "other")).toHaveLength(13);
  });

  it("uses local midnight, excludes future timestamps, and preserves imported chronology", () => {
    const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
    const { events, excluded } = projectProtection([
      row("future", { ts: now.getTime() + 1 }), row("midnight", { ts: midnight.getTime() }),
      row("yesterday", { ts: midnight.getTime() - 1 }), row("invalid", { ts: 1e30 }),
    ]);
    expect(excluded).toBe(1);
    expect(summarizeProtection(events, "today", now)).toEqual({ ...zeros, clicks: 1 });
    expect(summarizeProtection(events, "history", now)).toEqual({ ...zeros, clicks: 2 });
    expect(events.map(event => Date.parse(event.timestamp))).toEqual([midnight.getTime() - 1, midnight.getTime(), now.getTime() + 1]);
  });

  it("bounds the same local source and ignores malformed rows without inventing identities", () => {
    const malformed: unknown[] = [null, {}, row(""), row("bad", { extra: [] as unknown as Record<string, unknown> }), row("nan", { ts: NaN })];
    expect(projectProtection(malformed)).toEqual({ events: [], excluded: 5, duplicates: 0 });
    const snapshot = projectProtection(Array.from({ length: MAX_EVIDENCE_EVENTS + 2 }, (_, i) => row(`fixture-${i}`, { ts: i })));
    expect(snapshot.events).toHaveLength(MAX_EVIDENCE_EVENTS);
    expect(snapshot.excluded).toBe(2);
    expect(snapshot.events[0]?.timestamp).toBe(new Date(2).toISOString());
    expect(summarizeProtection([], "history", now)).toEqual(zeros);
  });

  it("keeps display categories and correction metadata out of the existing evidence export", () => {
    const events = projectProtection([row("private-id", { kind: "mutation_alert", reasons: ["overlay_cleanup_undo"], extra: { restored: false, password: "private" }, url: "https://fictional.test/private?token=private" })]).events;
    const exported = createEvidenceExport(events, now);
    expect(exported).toMatchObject({ format: "navsentinel-evidence", schema: 1 });
    expect(Object.keys(exported.events[0]!).sort()).toEqual(["destinationSite", "id", "kind", "outcome", "reasons", "sourceSite", "timestamp"]);
    expect(JSON.stringify(exported)).not.toMatch(/activity|Detail|restored|password|private|url|token/);
  });
});
