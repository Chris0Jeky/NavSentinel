import { describe, expect, it } from "vitest";
import type { EventLogEntry } from "../extension/src/shared/storage";
import { derivePopupCurrentPageRisk } from "../extension/src/popup/popup_current_page_risk";

const NOW = 1_800_000_000_000;
const URL = "https://app.example.test/";
const HOST = "app.example.test";

function row(score: number): EventLogEntry {
  return { id: "candidate", ts: NOW, kind: "nav_click_block", pageSite: HOST, score };
}

describe("Current page numerical evidence boundary", () => {
  // Finite out-of-range scores survive the existing storage/import validator.
  // Non-finite inputs are also refused by the pure selector's numeric bounds.
  it.each([-1, 100.01, 101, Number.MAX_VALUE, NaN, Infinity, -Infinity])(
    "does not let invalid score %s replace valid evidence or hide a scoreless threat",
    (score) => {
      const invalid = Object.freeze(row(score));
      const previous: EventLogEntry = {
        ...row(70), id: "previous", ts: NOW - 1, reasons: ["older-valid"],
      };
      const threat: EventLogEntry = {
        id: "threat", ts: NOW - 2, kind: "nav_reputation_late_warn", pageSite: HOST,
      };
      expect(derivePopupCurrentPageRisk([invalid], URL, NOW).state).toBe("clear");
      expect(derivePopupCurrentPageRisk([previous, invalid], URL, NOW)).toMatchObject({
        state: "scored", tabRisk: 70, reasons: ["older-valid"],
      });
      expect(derivePopupCurrentPageRisk([threat, invalid], URL, NOW)).toMatchObject({
        state: "unscored-threat", threatKind: "nav_reputation_late_warn",
      });
      expect(invalid.score).toBe(score);
    },
  );

  it.each([0, 0.5, 100])("preserves valid score %s without clamping or rounding", (score) => {
    expect(derivePopupCurrentPageRisk([row(score)], URL, NOW)).toMatchObject({
      state: "scored", tabRisk: score,
    });
  });
});
