import { describe, expect, it } from "vitest";
import { nowMs } from "../extension/src/content/main_clock";

describe("main_clock", () => {
  it("is immune to a post-initialization Date.now overwrite (#756)", () => {
    const realNow = Date.now;
    const before = realNow();
    Date.now = () => 12345;
    try {
      expect(Date.now()).toBe(12345);
      expect(nowMs()).toBeGreaterThanOrEqual(before);
      expect(nowMs()).not.toBe(12345);
    } finally {
      Date.now = realNow;
    }
    expect(Date.now).toBe(realNow);
  });
});
