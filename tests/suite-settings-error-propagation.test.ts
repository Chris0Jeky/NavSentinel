import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("suite-settings worker error propagation (#891)", () => {
  it("surfaces a structured worker rejection to the extension-page caller", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: false, error: "invalid" });
    vi.stubGlobal("chrome", {
      runtime: { sendMessage },
    } as unknown as typeof globalThis.chrome);

    const { updateSuiteSettings } = await import("../extension/src/shared/storage");

    await expect(
      updateSuiteSettings({ nav: { debug: true } })
    ).rejects.toThrow("invalid");
    expect(sendMessage).toHaveBeenCalledWith({
      type: "ns-suite-settings-update",
      patch: { nav: { debug: true } },
    });
  });

  it("keeps the rejection reason at the service-worker message boundary", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "extension/src/sw/sw.ts"),
      "utf8"
    );
    const start = source.indexOf('type === "ns-suite-settings-update"');
    const end = source.indexOf("if (isBehaviouralResetMessage", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const handler = source.slice(start, end);
    expect(handler).toMatch(
      /\.catch\(\(error\)\s*=>\s*sendResponse\?\.\(\{\s*ok:\s*false,\s*error:/s
    );
    expect(handler).not.toContain(".catch(() => sendResponse?.())");
  });
});
