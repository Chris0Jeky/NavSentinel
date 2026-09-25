import { afterEach, describe, expect, it, vi } from "vitest";

const originalDateNow = Object.getOwnPropertyDescriptor(Date, "now");

afterEach(() => {
  if (originalDateNow) Object.defineProperty(Date, "now", originalDateNow);
  vi.resetModules();
});

describe("mainWorldNowMs", () => {
  it("keeps the initialization-captured clock after the page replaces Date.now", async () => {
    Object.defineProperty(Date, "now", {
      configurable: true,
      writable: true,
      value: () => 123_456,
    });
    vi.resetModules();
    const { mainWorldNowMs } = await import("../extension/src/content/main_world_clock");

    Object.defineProperty(Date, "now", {
      configurable: true,
      writable: true,
      value: () => 999_999,
    });

    expect(mainWorldNowMs()).toBe(123_456);
  });
});
