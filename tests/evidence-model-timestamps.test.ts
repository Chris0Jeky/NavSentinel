import { afterEach, describe, expect, it, vi } from "vitest";
import { projectEvidence } from "../extension/src/evidence/evidence_model";
import type { EventLogEntry } from "../extension/src/shared/storage";

const event = (patch: Partial<EventLogEntry> = {}): EventLogEntry => ({
  id: "id",
  ts: 1_700_000_000_000,
  kind: "nav_click_block",
  site: "example.com",
  ...patch,
});

describe("projectEvidence counts and warns on invalid timestamps", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps valid entries while warning with the singular count for one bad timestamp", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rows = projectEvidence([
      event({ site: "good.test" }),
      event({ ts: Number.NaN, site: "bad.test" }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      timestamp: "2023-11-14T22:13:20.000Z",
      sourceSite: "good.test",
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("excluded 1 entry");
  });

  it("warns once with the plural count for several bad timestamps", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rows = projectEvidence([
      event({ ts: Number.NaN }),
      event({ ts: Number.POSITIVE_INFINITY }),
      event({ site: "good.test" }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.sourceSite).toBe("good.test");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("excluded 2 entries");
  });

  it("stays silent when every timestamp is valid", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rows = projectEvidence([event(), event({ ts: 1_700_000_000_001 })]);

    expect(rows).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();
  });
});
