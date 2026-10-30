import path from "node:path";
import { describe, expect, it } from "vitest";
import { selectBrandedChrome } from "./branded/branded-chrome-selector.cjs";

describe("branded Chrome launch selection", () => {
  it.each([
    [undefined, {}],
    ["1", { channel: "chrome" }],
    ["true", { channel: "chrome" }],
    ["0", {}],
    ["false", {}],
    ["", {}],
    [" \t ", {}],
    [" ./custom Chrome/chrome.exe ", { executablePath: path.resolve("./custom Chrome/chrome.exe") }],
  ])("selects %j consistently for either arm", (selector, expected) => {
    expect(selectBrandedChrome(selector)).toEqual(expected);
  });
});
