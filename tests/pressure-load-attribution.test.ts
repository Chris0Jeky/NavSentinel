import { describe, expect, it } from "vitest";
import { minimizeEventUrl } from "../extension/src/shared/storage_impl";
import { attributedCount, pressureLoadGymPath, pressureLoadPath } from "./acceptance/pressure_load_attribution";

const FIXTURE = "/clickfix-06-clipboard-pressure.html";
const ORIGIN = "http://localhost:46200";
const row = (id: string, label: string, extra: Record<string, unknown> = {}) => ({
  id, ts: 1, kind: "clickfix_detected", site: "localhost", pageSite: "localhost",
  // Stored exactly as the product serializer would keep it.
  url: minimizeEventUrl(`${ORIGIN}${pressureLoadPath(label, FIXTURE)}?mode=attack`), ...extra,
});
const scope = (issued: string[], preexisting: string[] = []) => ({
  origin: ORIGIN, host: "localhost", gymPath: FIXTURE, issued: new Set(issued), preexisting: new Set(preexisting),
});

describe("clipboard-pressure per-load attribution (#954)", () => {
  it("routes a labelled load path to its Gym file and nothing else", () => {
    expect(pressureLoadGymPath(pressureLoadPath("load-3", FIXTURE))).toBe(FIXTURE);
    expect(pressureLoadGymPath(FIXTURE)).toBeNull();
    expect(pressureLoadGymPath("/acceptance/pressure-load/load-3/")).toBeNull();
    expect(pressureLoadGymPath("/acceptance/pressure-load/0b4f/clickfix-06-clipboard-pressure.html")).toBeNull();
  });

  it("keeps the load label through the product's event-url minimization", () => {
    expect(minimizeEventUrl(`${ORIGIN}${pressureLoadPath("load-12", FIXTURE)}?mode=attack#x`))
      .toBe(`${ORIGIN}/acceptance/pressure-load/load-12${FIXTURE}`);
  });

  it("does not count a discarded load's late row against the selected attack arm", () => {
    // load-11 was a discarded RETRY attack load; its row lands after load-12's baseline.
    const baseline = [{ id: "old", kind: "clickfix_detected", site: "127.0.0.1" }];
    const after = [...baseline, row("late", "load-11"), row("selected", "load-12")];
    const s = scope(["load-11", "load-12"], ["old"]);
    // Counting by kind alone sees the reviewed false FAIL: +2 instead of +1.
    expect(after.length - baseline.length).toBe(2);
    expect(attributedCount(baseline, "clickfix_detected", new Set(["load-12"]), s)).toBe(0);
    expect(attributedCount(after, "clickfix_detected", new Set(["load-12"]), s)).toBe(1);
    expect(attributedCount(after, "clickfix_detected", new Set(["load-11"]), s)).toBe(1);
  });

  it.each([
    ["no url", { url: undefined }],
    ["an unissued label", { url: `${ORIGIN}${pressureLoadPath("load-99", FIXTURE)}` }],
    ["another origin", { url: `http://127.0.0.1:46200${pressureLoadPath("load-1", FIXTURE)}` }],
    ["another Gym file", { url: `${ORIGIN}${pressureLoadPath("load-1", "/clickfix-03-legit-captcha.html")}` }],
    ["an unlabelled fixture path", { url: `${ORIGIN}${FIXTURE}` }],
    ["a conflicting site", { site: "example.test" }],
    ["a conflicting pageSite", { pageSite: "example.test" }],
  ])("refuses to count when a new row has %s", (_name, override) => {
    expect(() => attributedCount([row("r", "load-1", override)], "clickfix_detected", new Set(["load-1"]), scope(["load-1"])))
      .toThrow(/TEST_INVALID: unattributable clickfix_detected row/);
  });

  it("ignores preexisting rows and other kinds", () => {
    const log = [{ id: "pre", kind: "clickfix_detected" }, { id: "o", kind: "bridge_buffer_overflow", site: "localhost" }];
    expect(attributedCount(log, "clickfix_detected", new Set(["load-1"]), scope(["load-1"], ["pre"]))).toBe(0);
  });
});
