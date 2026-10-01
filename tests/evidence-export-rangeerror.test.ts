// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const mocks = vi.hoisted(() => ({ getEventLog: vi.fn(), getSuiteSettings: vi.fn() }));
vi.mock("../extension/src/shared/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../extension/src/shared/storage")>()),
  ...mocks,
}));

const html = readFileSync(resolve("extension/src/evidence/evidence.html"), "utf8");
const get = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

describe("evidence export failure message discriminates the size guard's own RangeError", () => {
  beforeEach(async () => {
    vi.resetModules();
    document.documentElement.innerHTML = html;
    localStorage.clear();
    mocks.getEventLog
      .mockReset()
      .mockResolvedValue([
        {
          id: "private-1",
          ts: 1700000000000,
          kind: "nav_click_block",
          site: "source.test",
          destHost: "target.test",
          reasons: ["no_accessible_name"],
        },
      ]);
    mocks.getSuiteSettings
      .mockReset()
      .mockResolvedValue({
        nav: { defaultMode: "smart", autoDismissOverlays: false },
        credential: { mode: "smart" },
      });
    await import("../extension/src/evidence/evidence");
    await vi.waitFor(() => expect(get("total").textContent).toBe("1"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the generic failure message for a non-guard RangeError", () => {
    // Simulate a RangeError that is NOT the export-size guard (e.g. stack
    // exhaustion while serializing): the 8 MiB guidance must not appear, since
    // narrowing filters cannot help. Pre-fix, any RangeError earned it.
    vi.spyOn(JSON, "stringify").mockImplementationOnce(() => {
      throw new RangeError("Maximum call stack size exceeded");
    });
    get("export").click();

    expect(get("status").textContent).toBe(
      "Could not prepare local evidence. Refresh the journal and try again.",
    );
    expect(get("status").textContent).not.toContain("8 MiB");
    expect(get<HTMLTextAreaElement>("exportPreview").value).toBe("");
    expect(get<HTMLDialogElement>("exportDialog").open).toBe(false);
  });

  it("still shows the 8 MiB message for the size guard's own RangeError", () => {
    const text = "x".repeat(8 * 1024 * 1024 + 1);
    vi.spyOn(JSON, "stringify").mockReturnValueOnce(text);
    get("export").click();

    expect(get("status").textContent).toContain("exceeds 8 MiB");
  });
});
