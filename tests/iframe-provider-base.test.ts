// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
  matchProviderHostSrc,
  type ProviderHostEntry,
} from "../extension/src/shared/iframe_provider";

const TABLE: ProviderHostEntry[] = [{ host: "google.com", pathPrefix: "/recaptcha" }];

describe("matchProviderHostSrc resolves relative src against document.baseURI (#843)", () => {
  afterEach(() => {
    document.head.querySelectorAll("base").forEach((b) => b.remove());
  });

  it("accepts a relative provider src under a provider <base>", () => {
    const base = document.createElement("base");
    base.setAttribute("href", "https://www.google.com/recaptcha/");
    document.head.appendChild(base);
    expect(matchProviderHostSrc("api2/anchor", TABLE)).toBe(true);
  });

  it("rejects a relative src when the base is not a provider", () => {
    const base = document.createElement("base");
    base.setAttribute("href", "https://cdn.evil.example/recaptcha/");
    document.head.appendChild(base);
    expect(matchProviderHostSrc("api2/anchor", TABLE)).toBe(false);
  });
});
