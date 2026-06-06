import { describe, expect, it } from "vitest";
import type { EventLogEntry } from "../extension/src/shared/storage";
import {
  derivePopupSiteState,
  derivePopupTabRisk,
  eventIconName,
  formatPopupEventLine,
  getRecentPopupEvents,
  isRiskReducingReason,
  pickSiteRiskEvent,
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

  it("ignores events without a site", () => {
    const log = [
      { id: "1", ts: 1, kind: "suite_config_update" } as EventLogEntry,
      ev("2", "example.com", 60),
    ];
    expect(pickSiteRiskEvent(log, "example.com")?.id).toBe("2");
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
});

describe("derivePopupTabRisk (#205 R1)", () => {
  const ev = (id: string, site: string, score: number): EventLogEntry =>
    ({ id, ts: Number(id), kind: "nav_click_block", site, score, reasons: ["x"] }) as EventLogEntry;

  it("returns the scored same-domain event's risk + reasons", () => {
    const log = [ev("1", "other.com", 90), ev("2", "example.com", 55)];
    expect(derivePopupTabRisk(log, "example.com")).toEqual({ tabRisk: 55, reasons: ["x"] });
  });

  it("returns 0 / no reasons when the active site has only a scoreless alert (no green-gauge-with-orange-chips contradiction)", () => {
    const log: EventLogEntry[] = [
      { id: "1", ts: 1, kind: "mutation_alert", site: "example.com", reasons: ["dom_mutation"] } as EventLogEntry,
    ];
    expect(derivePopupTabRisk(log, "example.com")).toEqual({ tabRisk: 0, reasons: undefined });
  });

  it("returns 0 / no reasons when no event matches the active site", () => {
    expect(derivePopupTabRisk([ev("1", "other.com", 90)], "example.com")).toEqual({
      tabRisk: 0,
      reasons: undefined,
    });
  });
});
