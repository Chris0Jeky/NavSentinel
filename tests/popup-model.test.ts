import { describe, expect, it } from "vitest";
import type { EventLogEntry } from "../extension/src/shared/storage";
import {
  derivePopupSiteState,
  formatPopupEventLine,
  getRecentPopupEvents
} from "../extension/src/popup/popup_model";

describe("popup model", () => {
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

  it("preserves ip hosts and disables trust actions when no host exists", () => {
    expect(derivePopupSiteState("http://127.0.0.1:5173/demo", [])).toMatchObject({
      siteLabel: "127.0.0.1",
      registrableDomain: "127.0.0.1",
      canTrust: true,
      canUntrust: false
    });

    expect(derivePopupSiteState("", [])).toMatchObject({
      siteLabel: "(no host)",
      registrableDomain: "",
      canTrust: false,
      canUntrust: false
    });
  });

  it("returns the newest popup events first and caps the list", () => {
    const events = Array.from({ length: 10 }, (_, index) => ({
      id: `evt-${index}`,
      ts: index,
      kind: "suite_config_update"
    })) as EventLogEntry[];

    const recent = getRecentPopupEvents(events);

    expect(recent).toHaveLength(8);
    expect(recent[0]?.id).toBe("evt-9");
    expect(recent[7]?.id).toBe("evt-2");
  });

  it("returns no popup events when the requested limit is zero or negative", () => {
    const events = Array.from({ length: 3 }, (_, index) => ({
      id: `evt-${index}`,
      ts: index,
      kind: "suite_config_update"
    })) as EventLogEntry[];

    expect(getRecentPopupEvents(events, 0)).toEqual([]);
    expect(getRecentPopupEvents(events, -4)).toEqual([]);
  });

  it("formats popup event lines with optional site and score fields", () => {
    const line = formatPopupEventLine(
      {
        id: "evt",
        ts: 10,
        kind: "nav_click_block",
        site: "example.com",
        score: 72
      },
      () => "10:00:00"
    );

    expect(line).toBe("10:00:00 | nav_click_block | example.com | score=72");
  });
});
