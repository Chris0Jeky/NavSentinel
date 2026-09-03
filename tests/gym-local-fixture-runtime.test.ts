// @vitest-environment happy-dom
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";

const helperSource = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "gym", "local-fixture-targets.js"),
  "utf8",
);

function loadFixture(
  url: string,
  initialHref = "https://attacker.example/egress",
  originMode?: "same-loopback" | "alternate-loopback",
) {
  const window = new Window({ url });
  const originModeAttribute = originMode
    ? ` data-navsentinel-local-target-origin="${originMode}"`
    : "";
  window.document.body.innerHTML = `<a id="target" href="${initialHref}" data-navsentinel-local-target="harm" data-navsentinel-scenario="NS-ADV-UI-001"${originModeAttribute}>Target</a>`;
  window.eval(helperSource);
  window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
  return window;
}

type LocalTargetApi = {
  url: (role: "benign" | "harm", scenarioId: string, originMode?: "same-loopback" | "alternate-loopback") => string;
};

function localTargets(window: Window): LocalTargetApi {
  return (window as unknown as { NavSentinelLocalTargets: LocalTargetApi }).NavSentinelLocalTargets;
}

describe("Gym local-fixture target runtime contract", () => {
  it("arms a typed loopback override", () => {
    const target = "http://127.0.0.1:46100/__navsentinel_fake_sink?run_id=123e4567-e89b-42d3-a456-426614174000&scenario_id=NS-ADV-UI-001&role=attack&consequence=wrong-target-navigation&target_id=proof-harm&sentinel=NAVSENTINEL_SENTINEL_DO_NOT_RUN";
    const window = loadFixture(`http://127.0.0.1:5173/level1-basic-opacity.html?harm_target=${encodeURIComponent(target)}`);
    const anchor = window.document.querySelector("#target");

    expect(window.document.documentElement.dataset.navsentinelLocalTargetsReady).toBe("1");
    expect(anchor?.getAttribute("href")).toBe(target);
    expect(anchor?.getAttribute("data-navsentinel-local-target-ready")).toBe("1");
  });

  it("disarms every static target when a non-loopback origin rejects validation", () => {
    const window = loadFixture("https://attacker.example/fixture.html");
    const anchor = window.document.querySelector("#target");

    expect(window.document.documentElement.dataset.navsentinelLocalTargetsReady).toBe("0");
    expect(window.document.documentElement.dataset.navsentinelLocalTargetsError).toBe("non-loopback-fixture-origin");
    expect(anchor?.hasAttribute("href")).toBe(false);
    expect(anchor?.getAttribute("data-navsentinel-local-target-ready")).toBeNull();
  });

  it("uses an explicitly origin-separated loopback for benign targets", () => {
    const window = loadFixture("http://127.0.0.1:5173/level9-legit-video-overlay.html");
    const target = localTargets(window).url("benign", "NS-ADV-UI-004", "alternate-loopback");
    const parsed = new URL(target);

    expect(parsed.hostname).toBe("localhost");
    expect(parsed.origin).not.toBe("http://127.0.0.1:5173");
    expect(parsed.searchParams.get("role")).toBe("benign");
    expect(parsed.searchParams.get("scenario_id")).toBe("NS-ADV-UI-004");
  });

  it.each([
    ["IPv4", "http://127.0.0.1:5173/level5-window-open-popunder.html", "127.0.0.1"],
    ["IPv6", "http://[::1]:5173/level5-window-open-popunder.html", "[::1]"],
  ])("keeps the default harm fallback on its single-family %s Gym origin", (_family, fixtureUrl, hostname) => {
    const window = loadFixture(fixtureUrl);
    const target = new URL(localTargets(window).url("harm", "NS-ADV-WIN-001"));
    const anchor = window.document.querySelector("#target") as unknown as HTMLAnchorElement | null;

    expect(window.document.documentElement.dataset.navsentinelLocalTargetsReady).toBe("1");
    expect(anchor?.href).toContain(`${hostname === "[::1]" ? "[::1]" : hostname}:5173/local-fixture-sink.html`);
    expect(target.hostname).toBe(hostname);
    expect(target.origin).toBe(new URL(fixtureUrl).origin);
    expect(target.pathname).toBe("/local-fixture-sink.html");
    expect(target.searchParams.get("role")).toBe("harm");
    expect(target.searchParams.get("consequence")).toBe("unauthorized-browsing-context");
  });

  it("fails closed when IPv6 cannot provide an alternate loopback origin", () => {
    const window = loadFixture(
      "http://[::1]:5173/level9-legit-video-overlay.html",
      undefined,
      "alternate-loopback",
    );
    const anchor = window.document.querySelector("#target");

    expect(window.document.documentElement.dataset.navsentinelLocalTargetsReady).toBe("0");
    expect(window.document.documentElement.dataset.navsentinelLocalTargetsError)
      .toBe("unsupported-loopback-origin-family");
    expect(anchor?.hasAttribute("href")).toBe(false);
  });

  it("maps WIN-001 to its popup consequence and rejects a generic harm override", () => {
    const validWindow = loadFixture("http://127.0.0.1:5173/level5-window-open-popunder.html");
    const validTarget = new URL(localTargets(validWindow).url("harm", "NS-ADV-WIN-001"));
    expect(validTarget.searchParams.get("consequence")).toBe("unauthorized-browsing-context");

    const genericOverride = new URL("http://127.0.0.1:46100/__navsentinel_fake_sink");
    genericOverride.searchParams.set("run_id", "123e4567-e89b-42d3-a456-426614174000");
    genericOverride.searchParams.set("scenario_id", "NS-ADV-WIN-001");
    genericOverride.searchParams.set("role", "attack");
    genericOverride.searchParams.set("consequence", "wrong-target-navigation");
    genericOverride.searchParams.set("target_id", "popup-harm");
    genericOverride.searchParams.set("sentinel", "NAVSENTINEL_SENTINEL_DO_NOT_RUN");
    const rejectedWindow = loadFixture(
      `http://127.0.0.1:5173/level5-window-open-popunder.html?harm_target=${encodeURIComponent(genericOverride.href)}`,
    );

    expect(() => localTargets(rejectedWindow).url("harm", "NS-ADV-WIN-001"))
      .toThrow("unarmed-local-target");
    expect(rejectedWindow.document.documentElement.dataset.navsentinelLocalTargetsReady).toBe("0");
  });
});
