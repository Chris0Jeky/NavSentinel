import { describe, expect, it } from "vitest";
import type { EventLogEntry, UnscoredThreatKind } from "../extension/src/shared/storage";
import { UNSCORED_THREAT_KINDS } from "../extension/src/shared/storage";
import {
  derivePopupSiteState,
  derivePopupTabRisk,
  describeUnscoredThreat,
  eventIconName,
  formatPopupEventLine,
  getRecentPopupEvents,
  isRiskReducingReason,
  isUnscoredThreatEvent,
  pickSiteRiskEvent,
  pickSiteUnscoredThreatEvent,
  signalChipClass
} from "../extension/src/popup/popup_model";

describe("derivePopupSiteState", () => {
  it("derives trusted registrable-domain state from the active tab url", () => {
    const state = derivePopupSiteState("https://login.example.com/account", ["example.com"]);

    expect(state).toEqual({
      siteLabel: "example.com",
      registrableDomain: "example.com",
      isTrusted: true,
      trustStatus: "Trusted for credential submits.",
      canTrust: false,
      canUntrust: true
    });
  });

  it("derives untrusted state for domain not in trusted list", () => {
    const state = derivePopupSiteState("https://login.example.com/", ["other.com"]);

    expect(state).toEqual({
      siteLabel: "example.com",
      registrableDomain: "example.com",
      isTrusted: false,
      trustStatus: "Not trusted (credential prompts may appear).",
      canTrust: true,
      canUntrust: false
    });
  });

  it("preserves IP hosts and allows trust actions", () => {
    const state = derivePopupSiteState("http://127.0.0.1:5173/demo", []);
    expect(state).toMatchObject({
      siteLabel: "127.0.0.1",
      registrableDomain: "127.0.0.1",
      canTrust: true,
      canUntrust: false
    });
  });

  it("returns (no host) and disables trust for empty URL", () => {
    const state = derivePopupSiteState("", []);
    expect(state).toMatchObject({
      siteLabel: "(no host)",
      registrableDomain: "",
      isTrusted: false,
      canTrust: false,
      canUntrust: false
    });
  });

  it("handles malformed URL gracefully", () => {
    const state = derivePopupSiteState("not a valid url", []);
    expect(state.siteLabel).toBe("(no host)");
    expect(state.registrableDomain).toBe("");
    expect(state.canTrust).toBe(false);
    expect(state.canUntrust).toBe(false);
  });

  it("handles chrome:// URL — hostname resolves but not a real domain", () => {
    const state = derivePopupSiteState("chrome://extensions/", []);
    expect(state.siteLabel).toBe("extensions");
    expect(state.isTrusted).toBe(false);
  });

  it("handles about:blank URL", () => {
    const state = derivePopupSiteState("about:blank", []);
    expect(state.siteLabel).toBe("(no host)");
    expect(state.registrableDomain).toBe("");
    expect(state.canTrust).toBe(false);
  });

  it("handles data: URI", () => {
    const state = derivePopupSiteState("data:text/html,<h1>hi</h1>", []);
    expect(state.canTrust).toBe(false);
  });

  it("handles trusted IP address", () => {
    const state = derivePopupSiteState("http://192.168.1.1/admin", ["192.168.1.1"]);
    expect(state.isTrusted).toBe(true);
    expect(state.canUntrust).toBe(true);
    expect(state.canTrust).toBe(false);
  });

  it("uses registrable domain for subdomain matching", () => {
    const state = derivePopupSiteState("https://sub.deep.example.com/", ["example.com"]);
    expect(state.isTrusted).toBe(true);
    expect(state.registrableDomain).toBe("example.com");
  });

  it("handles empty trusted domains array", () => {
    const state = derivePopupSiteState("https://example.com/", []);
    expect(state.isTrusted).toBe(false);
    expect(state.canTrust).toBe(true);
  });

  it("handles URL with port number", () => {
    const state = derivePopupSiteState("http://example.com:8080/app", []);
    expect(state.registrableDomain).toBe("example.com");
    expect(state.canTrust).toBe(true);
  });

  it("handles co.uk two-part TLD", () => {
    const state = derivePopupSiteState("https://shop.example.co.uk/", ["example.co.uk"]);
    expect(state.registrableDomain).toBe("example.co.uk");
    expect(state.isTrusted).toBe(true);
  });
});

describe("getRecentPopupEvents", () => {
  const makeEvents = (count: number): EventLogEntry[] =>
    Array.from({ length: count }, (_, index) => ({
      id: `evt-${index}`,
      ts: index,
      kind: "suite_config_update" as const,
    })) as EventLogEntry[];

  it("returns the newest events first with default limit of 8", () => {
    const events = makeEvents(10);
    const recent = getRecentPopupEvents(events);

    expect(recent).toHaveLength(8);
    expect(recent[0]?.id).toBe("evt-9");
    expect(recent[7]?.id).toBe("evt-2");
  });

  it("excludes silent-decision events so routine allows don't crowd the recent-signals feed (#236)", () => {
    const log: EventLogEntry[] = [
      { id: "loud-1", ts: 1, kind: "nav_click_block" } as EventLogEntry,
      { id: "silent-1", ts: 2, kind: "nav_silent_allow", score: 10 } as EventLogEntry,
      { id: "silent-2", ts: 3, kind: "cred_form_evaluated", score: 5 } as EventLogEntry,
      { id: "loud-2", ts: 4, kind: "cred_submit_prompt" } as EventLogEntry,
    ];
    // Only the loud events remain, newest-first; silent allows never displace them.
    expect(getRecentPopupEvents(log, 5).map((e) => e.id)).toEqual(["loud-2", "loud-1"]);
  });

  it("returns no events when limit is zero", () => {
    expect(getRecentPopupEvents(makeEvents(3), 0)).toEqual([]);
  });

  it("returns no events when limit is negative", () => {
    expect(getRecentPopupEvents(makeEvents(3), -4)).toEqual([]);
  });

  it("returns all events when fewer than limit", () => {
    const events = makeEvents(3);
    const recent = getRecentPopupEvents(events, 10);
    expect(recent).toHaveLength(3);
    expect(recent[0]?.id).toBe("evt-2");
    expect(recent[2]?.id).toBe("evt-0");
  });

  it("returns exactly limit events when count equals limit", () => {
    const events = makeEvents(5);
    const recent = getRecentPopupEvents(events, 5);
    expect(recent).toHaveLength(5);
  });

  it("handles empty event log", () => {
    expect(getRecentPopupEvents([], 8)).toEqual([]);
  });

  it("truncates fractional limit", () => {
    const events = makeEvents(5);
    const recent = getRecentPopupEvents(events, 2.9);
    expect(recent).toHaveLength(2);
  });

  it("defaults to 8 for NaN limit", () => {
    const events = makeEvents(10);
    const recent = getRecentPopupEvents(events, NaN);
    expect(recent).toHaveLength(8);
  });

  it("defaults to 8 for Infinity limit", () => {
    const events = makeEvents(10);
    const recent = getRecentPopupEvents(events, Infinity);
    expect(recent).toHaveLength(8);
  });

  it("returns single event for limit 1", () => {
    const events = makeEvents(5);
    const recent = getRecentPopupEvents(events, 1);
    expect(recent).toHaveLength(1);
    expect(recent[0]?.id).toBe("evt-4");
  });

  it("skips corrupted entries while filtering silent decisions", () => {
    const events = [
      { id: "loud-1", ts: 1, kind: "nav_click_block" },
      null,
      { id: "silent-1", ts: 2, kind: "nav_silent_allow" },
      undefined,
      { id: "loud-2", ts: 3, kind: "cred_submit_prompt" },
    ] as unknown as EventLogEntry[];

    expect(getRecentPopupEvents(events, 5).map((e) => e.id)).toEqual(["loud-2", "loud-1"]);
  });
});

describe("formatPopupEventLine", () => {
  const formatTime = (ts: number) => `${ts}s`;

  it("formats event with site and score", () => {
    const line = formatPopupEventLine(
      { id: "evt", ts: 10, kind: "nav_click_block", site: "example.com", score: 72 },
      () => "10:00:00"
    );
    expect(line).toBe("10:00:00 | nav_click_block | example.com | score=72");
  });

  it("formats event without site or score", () => {
    const line = formatPopupEventLine(
      { id: "evt", ts: 5, kind: "suite_config_update" } as EventLogEntry,
      formatTime
    );
    expect(line).toBe("5s | suite_config_update");
  });

  it("formats event with site but no score", () => {
    const line = formatPopupEventLine(
      { id: "evt", ts: 5, kind: "nav_reputation_late_warn", site: "test.com" } as EventLogEntry,
      formatTime
    );
    expect(line).toBe("5s | nav_reputation_late_warn | test.com");
  });

  it("formats event with score but no site", () => {
    const line = formatPopupEventLine(
      { id: "evt", ts: 5, kind: "nav_click_block", score: 95 } as EventLogEntry,
      formatTime
    );
    expect(line).toBe("5s | nav_click_block | score=95");
  });

  it("formats event with score of 0", () => {
    const line = formatPopupEventLine(
      { id: "evt", ts: 0, kind: "nav_click_block", score: 0 } as EventLogEntry,
      formatTime
    );
    expect(line).toBe("0s | nav_click_block | score=0");
  });

  it("treats empty string site as absent", () => {
    const line = formatPopupEventLine(
      { id: "evt", ts: 1, kind: "nav_click_block", site: "", score: 50 } as EventLogEntry,
      formatTime
    );
    expect(line).toBe("1s | nav_click_block | score=50");
  });

  it("uses the provided formatTime function", () => {
    const line = formatPopupEventLine(
      { id: "evt", ts: 1716480000000, kind: "nav_click_block" } as EventLogEntry,
      (ts) => new Date(ts).toISOString()
    );
    expect(line).toContain("2024-05-23");
  });
});

describe("signalChipClass (#205)", () => {
  it("classifies risk-reducing reason codes as ok (green)", () => {
    for (const r of [
      "nrs_allowlisted",
      "nrs_user_activation_active",
      "nrs_explicit_new_tab_intent",
      "nrs_opener_previously_allowed",
      "keyboard_activation",
      "legit_captcha_present",
      "legit_modal_backdrop",
    ]) {
      expect(signalChipClass(r)).toBe("signal-chip--ok");
    }
  });

  it("classifies threat/neutral reason codes as warn (orange)", () => {
    for (const r of [
      "clickfix_command_with_overlay",
      "nav_anomaly",
      "high_entropy_subdomain",
      "reputation_unknown",
    ]) {
      expect(signalChipClass(r)).toBe("signal-chip--warn");
    }
  });

  it("treats empty input as a warning", () => {
    expect(signalChipClass("")).toBe("signal-chip--warn");
  });
});

describe("isRiskReducingReason (#205 R1: exact predicate, mirrors buildPlainMessage)", () => {
  it("matches the risk-reducing reason codes the toast filters out", () => {
    for (const r of [
      "nrs_allowlisted",
      "nrs_user_activation_active",
      "nrs_explicit_new_tab_intent",
      "nrs_opener_previously_allowed",
      "keyboard_activation",
      "legit_captcha_present",
      "legit_modal_backdrop",
    ]) {
      expect(isRiskReducingReason(r)).toBe(true);
    }
  });

  it("does NOT green a risk-increasing code that merely contains a token (startsWith/exact, not substring)", () => {
    // user_activation is matched EXACTLY, keyboard_/legit_ via startsWith — so a
    // hypothetical spoof/fake variant stays a warning (no false reassurance).
    expect(isRiskReducingReason("spoofed_user_activation")).toBe(false);
    expect(isRiskReducingReason("fake_legit_overlay")).toBe(false);
    expect(isRiskReducingReason("no_keyboard_activation")).toBe(false);
    expect(isRiskReducingReason("clickfix_command_with_overlay")).toBe(false);
  });
});

describe("eventIconName (#205)", () => {
  it("maps credential events to the key glyph", () => {
    expect(eventIconName("cred_prompt_shown")).toBe("key");
  });

  it("maps suite/config events to the gear glyph", () => {
    expect(eventIconName("suite_config_update")).toBe("gear");
  });

  it("maps navigation-toned events, including threat alerts, to the shield glyph", () => {
    expect(eventIconName("nav_click_block")).toBe("shield");
    // Threat alerts are navigation-toned and must not show a settings gear.
    expect(eventIconName("clickfix_detected")).toBe("shield");
    expect(eventIconName("mutation_alert")).toBe("shield");
  });
});

describe("pickSiteRiskEvent (#205)", () => {
  const ev = (id: string, site: string, score: number): EventLogEntry =>
    ({ id, ts: Number(id), kind: "nav_click_block", site, score }) as EventLogEntry;

  it("returns the most recent event matching the active registrable domain", () => {
    const log = [
      ev("1", "example.com", 80),
      ev("2", "other.com", 90),
      ev("3", "sub.example.com", 40),
    ];
    const picked = pickSiteRiskEvent(log, "example.com");
    // sub.example.com reduces to example.com and is the most recent match.
    expect(picked?.id).toBe("3");
    expect(picked?.score).toBe(40);
  });

  it("returns null when no event matches the active site (no other-site risk shown)", () => {
    const log = [ev("1", "other.com", 90), ev("2", "evil.test", 95)];
    expect(pickSiteRiskEvent(log, "example.com")).toBeNull();
  });

  it("returns null for an empty registrable domain", () => {
    expect(pickSiteRiskEvent([ev("1", "example.com", 80)], "")).toBeNull();
  });

  it("ignores events without a site even when they are the most recent scored entry (#214 R2)", () => {
    const log: EventLogEntry[] = [
      ev("2", "example.com", 60),
      // Most recent AND scored, but NO site — must be skipped by the site guard,
      // not merely by the scoreless check. A removed site guard would return "1".
      { id: "1", ts: 3, kind: "nav_click_block", score: 50 } as EventLogEntry,
    ];
    expect(pickSiteRiskEvent(log, "example.com")?.id).toBe("2");
  });

  it("selects a score-0 event (0 is a real score, not 'scoreless') (#214 R2)", () => {
    const log: EventLogEntry[] = [
      { id: "1", ts: 1, kind: "nav_click_block", site: "example.com", score: 0, reasons: ["x"] } as EventLogEntry,
    ];
    expect(pickSiteRiskEvent(log, "example.com")?.id).toBe("1");
  });

  it("handles an empty log", () => {
    expect(pickSiteRiskEvent([], "example.com")).toBeNull();
  });

  it("skips scoreless events so a later scoreless alert can't mask an earlier scored block (#205 R1)", () => {
    const log: EventLogEntry[] = [
      ev("1", "example.com", 80),
      // A later same-domain scoreless threat alert (e.g. mutation_alert) must not win.
      { id: "2", ts: 2, kind: "mutation_alert", site: "example.com", reasons: ["dom_mutation"] } as EventLogEntry,
    ];
    const picked = pickSiteRiskEvent(log, "example.com");
    expect(picked?.id).toBe("1");
    expect(picked?.score).toBe(80);
  });

  it("skips silent-decision nav_silent_allow events so a routine silent allow can't mask an earlier scored block (#236)", () => {
    const log: EventLogEntry[] = [
      ev("1", "example.com", 80), // earlier real block
      // Later, scored, same-domain — but a silent allow. Must NOT win the gauge.
      { id: "2", ts: 2, kind: "nav_silent_allow", site: "example.com", score: 12, reasons: ["nrs_new_tab_window"] } as EventLogEntry,
    ];
    const picked = pickSiteRiskEvent(log, "example.com");
    expect(picked?.id).toBe("1");
    expect(picked?.score).toBe(80);
  });

  it("skips silent-decision cred_form_evaluated events in the gauge (#236)", () => {
    const log: EventLogEntry[] = [
      ev("1", "example.com", 70),
      { id: "2", ts: 2, kind: "cred_form_evaluated", site: "example.com", score: 5, reasons: ["x"] } as EventLogEntry,
    ];
    expect(pickSiteRiskEvent(log, "example.com")?.id).toBe("1");
  });

  it("returns null when the only same-domain scored events are silent decisions (#236)", () => {
    const log: EventLogEntry[] = [
      { id: "1", ts: 1, kind: "nav_silent_allow", site: "example.com", score: 10 } as EventLogEntry,
    ];
    expect(pickSiteRiskEvent(log, "example.com")).toBeNull();
  });

  it("ignores corrupted entries when picking the active-site risk event", () => {
    const log = [
      null,
      { id: "1", ts: 1, kind: "nav_silent_allow", site: "example.com", score: 10 },
      undefined,
      { id: "2", ts: 2, kind: "nav_click_block", site: "example.com", score: 80 },
    ] as unknown as EventLogEntry[];

    expect(pickSiteRiskEvent(log, "example.com")?.id).toBe("2");
  });
});

describe("derivePopupTabRisk (#205 R1)", () => {
  const ev = (id: string, site: string, score: number): EventLogEntry =>
    ({ id, ts: Number(id), kind: "nav_click_block", site, score, reasons: ["x"] }) as EventLogEntry;

  it("returns the scored same-domain event's risk + reasons", () => {
    const log = [ev("1", "other.com", 90), ev("2", "example.com", 55)];
    expect(derivePopupTabRisk(log, "example.com")).toEqual({
      tabRisk: 55,
      reasons: ["x"],
      state: "scored",
      threatKind: undefined,
    });
  });

  it("stays clear for a low/unknown-severity mutation_alert — only high severity is a threat (#219)", () => {
    // The mutation monitor downgrades known-benign DOM churn to low severity, so
    // this must NOT warn (the over-warning failure mode).
    const log: EventLogEntry[] = [
      { id: "1", ts: 1, kind: "mutation_alert", site: "example.com", reasons: ["dom_mutation"] } as EventLogEntry,
    ];
    expect(derivePopupTabRisk(log, "example.com")).toEqual({
      tabRisk: 0,
      reasons: undefined,
      state: "clear",
      threatKind: undefined,
    });
  });

  it("returns 0 / no reasons when no event matches the active site", () => {
    expect(derivePopupTabRisk([ev("1", "other.com", 90)], "example.com")).toEqual({
      tabRisk: 0,
      reasons: undefined,
      state: "clear",
      threatKind: undefined,
    });
  });

  it("treats a score-0 event as a real scored event — surfaces tabRisk 0 WITH its reasons (#214 R2)", () => {
    // Guards the typeof-vs-truthiness distinction: a truthiness skip (`if (!ev.score)`)
    // would wrongly drop this scored event and return reasons: undefined.
    const log: EventLogEntry[] = [
      { id: "1", ts: 1, kind: "nav_click_block", site: "example.com", score: 0, reasons: ["x"] } as EventLogEntry,
    ];
    expect(derivePopupTabRisk(log, "example.com")).toEqual({
      tabRisk: 0,
      reasons: ["x"],
      state: "scored",
      threatKind: undefined,
    });
  });
});

describe("unscored-threat gauge state (#219)", () => {
  const scored = (id: string, site: string, score: number): EventLogEntry =>
    ({ id, ts: Number(id), kind: "nav_click_block", site, score, reasons: ["x"] }) as EventLogEntry;

  const lateWarn = (id: string, site: string): EventLogEntry =>
    ({
      id,
      ts: Number(id),
      kind: "nav_reputation_late_warn",
      site,
      destHost: "evil.example",
      reasons: ["late_async_child_frame"],
    }) as EventLogEntry;

  const highMutation = (id: string, site: string): EventLogEntry =>
    ({
      id,
      ts: Number(id),
      kind: "mutation_alert",
      site,
      reasons: ["overlay_injected"],
      extra: { severity: "high", details: "x" },
    }) as EventLogEntry;

  describe("isUnscoredThreatEvent", () => {
    it("accepts the enumerated scoreless threat kinds", () => {
      expect(isUnscoredThreatEvent(lateWarn("1", "example.com"))).toBe(true);
      expect(isUnscoredThreatEvent(highMutation("1", "example.com"))).toBe(true);
      expect(
        isUnscoredThreatEvent({ id: "1", ts: 1, kind: "nav_rollback", site: "example.com" } as EventLogEntry),
      ).toBe(true);
      expect(
        isUnscoredThreatEvent({ id: "1", ts: 1, kind: "nav_blank_prompt", site: "example.com" } as EventLogEntry),
      ).toBe(true);
    });

    it("rejects scoreless events that are not threats (the over-warning guard)", () => {
      for (const kind of ["nav_allowlist_add", "nav_allowlist_remove", "suite_config_update", "cred_trust_domain"]) {
        expect(
          isUnscoredThreatEvent({ id: "1", ts: 1, kind, site: "example.com" } as unknown as EventLogEntry),
          `${kind} must not warn`,
        ).toBe(false);
      }
    });

    it("rejects a mutation_alert that is not high severity", () => {
      for (const severity of ["low", "medium", undefined]) {
        expect(
          isUnscoredThreatEvent({
            id: "1",
            ts: 1,
            kind: "mutation_alert",
            site: "example.com",
            extra: severity === undefined ? {} : { severity },
          } as unknown as EventLogEntry),
          `severity=${String(severity)} must not warn`,
        ).toBe(false);
      }
    });

    it("rejects a threat kind that carries a score — the scored path owns it", () => {
      expect(
        isUnscoredThreatEvent({
          id: "1",
          ts: 1,
          kind: "nav_blank_prompt",
          site: "example.com",
          score: 42,
        } as EventLogEntry),
      ).toBe(false);
    });

    it("tolerates corrupted entries", () => {
      expect(isUnscoredThreatEvent(null as unknown as EventLogEntry)).toBe(false);
      expect(isUnscoredThreatEvent({} as EventLogEntry)).toBe(false);
    });
  });

  describe("pickSiteUnscoredThreatEvent", () => {
    it("matches by registrable domain, newest first", () => {
      const log = [lateWarn("1", "www.example.com"), highMutation("2", "app.example.com")];
      expect(pickSiteUnscoredThreatEvent(log, "example.com")?.id).toBe("2");
    });

    it("ignores other domains and an empty domain", () => {
      expect(pickSiteUnscoredThreatEvent([lateWarn("1", "other.com")], "example.com")).toBeNull();
      expect(pickSiteUnscoredThreatEvent([lateWarn("1", "example.com")], "")).toBeNull();
    });
  });

  describe("derivePopupTabRisk", () => {
    it("does NOT present a clear/green gauge when the only same-domain event is a scoreless threat alert", () => {
      // The acceptance criterion of #219, one case per enumerated threat kind.
      const kinds = [
        lateWarn("1", "example.com"),
        highMutation("1", "example.com"),
        { id: "1", ts: 1, kind: "nav_rollback", site: "example.com" } as EventLogEntry,
        { id: "1", ts: 1, kind: "nav_blank_prompt", site: "example.com" } as EventLogEntry,
      ];
      for (const entry of kinds) {
        const risk = derivePopupTabRisk([entry], "example.com");
        expect(risk.state, `${entry.kind} should drive the unscored-threat gauge`).toBe("unscored-threat");
        expect(risk.threatKind).toBe(entry.kind);
        // No synthetic score is invented — the gauge state carries the meaning.
        expect(risk.tabRisk).toBe(0);
      }
    });

    it("surfaces the threat's own reason codes as signals", () => {
      expect(derivePopupTabRisk([lateWarn("1", "example.com")], "example.com").reasons).toEqual([
        "late_async_child_frame",
      ]);
    });

    it("keeps a SCORED event winning even when a scoreless alert is newer", () => {
      const log = [scored("1", "example.com", 80), lateWarn("2", "example.com")];
      expect(derivePopupTabRisk(log, "example.com")).toEqual({
        tabRisk: 80,
        reasons: ["x"],
        state: "scored",
        threatKind: undefined,
      });
    });

    it("keeps a SCORED event winning when the scoreless alert is older", () => {
      const log = [highMutation("1", "example.com"), scored("2", "example.com", 80)];
      expect(derivePopupTabRisk(log, "example.com").state).toBe("scored");
      expect(derivePopupTabRisk(log, "example.com").tabRisk).toBe(80);
    });

    it("does not let another domain's scoreless threat leak onto this site", () => {
      expect(derivePopupTabRisk([lateWarn("1", "other.com")], "example.com").state).toBe("clear");
    });
  });

  describe("describeUnscoredThreat", () => {
    it("describes every enumerated threat kind honestly (recorded, not scored)", () => {
      for (const kind of UNSCORED_THREAT_KINDS) {
        const text = describeUnscoredThreat(kind as UnscoredThreatKind);
        expect(text, `${kind} needs a description`).toBeTruthy();
        // No description may claim a score/rating exists for this state.
        expect(text.toLowerCase()).not.toMatch(/(score|rating|risk level)/);
      }
    });
  });
});
