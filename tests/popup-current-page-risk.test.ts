import { describe, expect, it } from "vitest";
import type { EventLogEntry } from "../extension/src/shared/storage";
import {
  POPUP_CURRENT_PAGE_MAX_EVENT_AGE_MS,
  derivePopupCurrentPageRisk,
} from "../extension/src/popup/popup_current_page_risk";

const NOW = 1_800_000_000_000;

function scored(
  id: string,
  host: string,
  score: number,
  ageMs = 0,
): EventLogEntry {
  return {
    id,
    ts: NOW - ageMs,
    kind: "nav_click_block",
    pageSite: host,
    site: host,
    score,
    reasons: [`score-${score}`],
  };
}

function lateWarn(
  id: string,
  host: string,
  ageMs = 0,
): EventLogEntry {
  return {
    id,
    ts: NOW - ageMs,
    kind: "nav_reputation_late_warn",
    pageSite: host,
    site: "child.other.test",
    reasons: ["late_async_child_frame"],
  };
}

describe("derivePopupCurrentPageRisk (#215)", () => {
  it("does not let a sibling subdomain drive the Current page gauge", () => {
    const log = [
      scored("mail", "mail.example.com", 35, 2_000),
      scored("docs", "docs.example.com", 95, 1_000),
    ];

    expect(derivePopupCurrentPageRisk(log, "https://mail.example.com/inbox", NOW)).toEqual({
      tabRisk: 35,
      reasons: ["score-35"],
      state: "scored",
      threatKind: undefined,
    });
  });

  it("selects the newest scored event for the exact active host", () => {
    const log = [
      scored("old", "app.example.com", 80, 5_000),
      scored("new", "app.example.com", 20, 1_000),
    ];

    expect(derivePopupCurrentPageRisk(log, "https://app.example.com/", NOW).tabRisk).toBe(20);
  });

  it("uses browser-derived pageSite rather than the emitting child-frame host", () => {
    const childEvent: EventLogEntry = {
      id: "child",
      ts: NOW - 1_000,
      kind: "nav_click_block",
      pageSite: "portal.example.test",
      site: "frame.other.test",
      score: 72,
      reasons: ["child_frame_navigation"],
    };

    expect(
      derivePopupCurrentPageRisk([childEvent], "https://portal.example.test/account", NOW).tabRisk,
    ).toBe(72);
    expect(
      derivePopupCurrentPageRisk([childEvent], "https://frame.other.test/", NOW).state,
    ).toBe("clear");
  });

  it("falls back to an exact legacy site association when pageSite is absent", () => {
    const legacy: EventLogEntry = {
      id: "legacy",
      ts: NOW - 1_000,
      kind: "nav_click_block",
      site: "legacy.example.test",
      score: 60,
    };

    expect(
      derivePopupCurrentPageRisk([legacy], "https://legacy.example.test/path", NOW).tabRisk,
    ).toBe(60);
  });

  it("falls back to the legacy host when an imported pageSite is malformed", () => {
    const imported: EventLogEntry = {
      id: "imported",
      ts: NOW - 1_000,
      kind: "nav_click_block",
      pageSite: "https://wrong.example/path?token=secret",
      site: "valid.example.test",
      score: 55,
    };

    expect(
      derivePopupCurrentPageRisk([imported], "https://valid.example.test/", NOW).tabRisk,
    ).toBe(55);
  });

  it("accepts evidence exactly at the recency boundary", () => {
    const event = scored(
      "boundary",
      "fresh.example.test",
      40,
      POPUP_CURRENT_PAGE_MAX_EVENT_AGE_MS,
    );

    expect(
      derivePopupCurrentPageRisk([event], "https://fresh.example.test/", NOW).state,
    ).toBe("scored");
  });

  it("ignores evidence older than the recency boundary", () => {
    const event = scored(
      "stale",
      "stale.example.test",
      90,
      POPUP_CURRENT_PAGE_MAX_EVENT_AGE_MS + 1,
    );

    expect(
      derivePopupCurrentPageRisk([event], "https://stale.example.test/", NOW),
    ).toEqual({
      tabRisk: 0,
      reasons: undefined,
      state: "clear",
      threatKind: undefined,
    });
  });

  it("ignores future-dated imported evidence", () => {
    const future = scored("future", "future.example.test", 99);
    future.ts = NOW + 1;

    expect(
      derivePopupCurrentPageRisk([future], "https://future.example.test/", NOW).state,
    ).toBe("clear");
  });

  it.each([
    "",
    "not a url",
    "about:blank",
    "chrome://extensions/",
    "data:text/html,<h1>test</h1>",
  ])("stays clear when the active tab has no ordinary web hostname: %s", (url) => {
    expect(derivePopupCurrentPageRisk([scored("event", "example.com", 90)], url, NOW).state).toBe(
      "clear",
    );
  });

  it("keeps a scored event authoritative over a newer scoreless threat", () => {
    const log = [
      scored("score", "secure.example.test", 80, 5_000),
      lateWarn("alert", "secure.example.test", 1_000),
    ];

    expect(
      derivePopupCurrentPageRisk(log, "https://secure.example.test/", NOW),
    ).toEqual({
      tabRisk: 80,
      reasons: ["score-80"],
      state: "scored",
      threatKind: undefined,
    });
  });

  it("surfaces an exact-host unscored threat when no scored event exists", () => {
    expect(
      derivePopupCurrentPageRisk(
        [lateWarn("alert", "secure.example.test", 1_000)],
        "https://secure.example.test/",
        NOW,
      ),
    ).toEqual({
      tabRisk: 0,
      reasons: ["late_async_child_frame"],
      state: "unscored-threat",
      threatKind: "nav_reputation_late_warn",
    });
  });

  it("canonicalizes IP hosts consistently", () => {
    const event = scored("ip", "127.000.000.001", 45, 1_000);

    expect(derivePopupCurrentPageRisk([event], "http://127.0.0.1:8080/", NOW).tabRisk).toBe(45);
  });
});
