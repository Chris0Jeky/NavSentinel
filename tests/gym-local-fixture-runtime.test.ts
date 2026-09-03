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
  bindings: Array<{
    targetRole: "harm" | "benign";
    scenarioId: string;
    originMode: "same-loopback" | "alternate-loopback";
    source: { kind: "fallback" } | { kind: "armed-sink"; href: string };
  }> = [],
  targetRole: "harm" | "benign" = "harm",
  scenarioId = "NS-ADV-UI-001",
) {
  const window = new Window({ url });
  const originModeAttribute = originMode
    ? ` data-navsentinel-local-target-origin="${originMode}"`
    : "";
  window.document.body.innerHTML = `<a id="target" href="${initialHref}" data-navsentinel-local-target="${targetRole}" data-navsentinel-scenario="${scenarioId}"${originModeAttribute}>Target</a>`;
  if (bindings.length > 0) {
    const fixture = new URL(url);
    const resolver = Object.freeze({
      resolve(targetRole: string, scenarioId: string, requestedOriginMode: string) {
        if (window.location.origin !== fixture.origin || window.location.pathname !== fixture.pathname) {
          return Object.freeze({ status: "document-mismatch" });
        }
        const binding = bindings.find((candidate) =>
          candidate.targetRole === targetRole && candidate.scenarioId === scenarioId &&
          candidate.originMode === requestedOriginMode,
        );
        return binding
          ? Object.freeze(binding.source.kind === "armed-sink"
            ? { status: "resolved", kind: "armed-sink", href: binding.source.href }
            : { status: "resolved", kind: "fallback" })
          : Object.freeze({ status: "unbound" });
      },
    });
    Object.defineProperty(window, "NavSentinelFixtureTargetBootstrap", {
      value: resolver,
      writable: false,
      configurable: false,
    });
  }
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
  it("arms a typed loopback bootstrap result", () => {
    const target = "http://127.0.0.1:46100/__navsentinel_fake_sink?run_id=123e4567-e89b-42d3-a456-426614174000&scenario_id=NS-ADV-UI-001&role=attack&consequence=wrong-target-navigation&target_id=proof-harm&sentinel=NAVSENTINEL_SENTINEL_DO_NOT_RUN";
    const window = loadFixture("http://127.0.0.1:5173/level1-basic-opacity.html", undefined, undefined, [{
      targetRole: "harm", scenarioId: "NS-ADV-UI-001", originMode: "same-loopback",
      source: { kind: "armed-sink", href: target },
    }]);
    const anchor = window.document.querySelector("#target");

    expect(window.document.documentElement.dataset.navsentinelLocalTargetsReady).toBe("1");
    expect(anchor?.getAttribute("href")).toBe(target);
    expect(anchor?.getAttribute("data-navsentinel-local-target-ready")).toBe("1");
  });

  it("arms a host-separated sink from an exact alternate-loopback bootstrap key", () => {
    const target = "http://127.0.0.2:46100/__navsentinel_fake_sink?run_id=123e4567-e89b-42d3-a456-426614174000&scenario_id=NS-ADV-UI-001&role=attack&consequence=wrong-target-navigation&target_id=proof-harm&sentinel=NAVSENTINEL_SENTINEL_DO_NOT_RUN";
    const window = loadFixture("http://127.0.0.1:5173/level1-basic-opacity.html", undefined, "alternate-loopback", [{
      targetRole: "harm", scenarioId: "NS-ADV-UI-001", originMode: "alternate-loopback",
      source: { kind: "armed-sink", href: target },
    }]);
    const anchor = window.document.querySelector("#target");

    expect(window.document.documentElement.dataset.navsentinelLocalTargetsReady).toBe("1");
    expect(anchor?.getAttribute("href")).toBe(target);
    expect(anchor?.getAttribute("data-navsentinel-local-target-ready")).toBe("1");
  });

  it("arms the maintainer-headed level9 benign target only through its alternate-loopback binding", () => {
    const target = "http://127.0.0.2:46100/__navsentinel_fake_sink?run_id=123e4567-e89b-42d3-a456-426614174000&scenario_id=NS-ADV-UI-004&role=benign&consequence=benign-navigation&target_id=level9-benign&sentinel=NAVSENTINEL_SENTINEL_DO_NOT_RUN";
    const window = loadFixture("http://127.0.0.1:5173/level9-legit-video-overlay.html", undefined, "alternate-loopback", [{
      targetRole: "benign", scenarioId: "NS-ADV-UI-004", originMode: "alternate-loopback",
      source: { kind: "armed-sink", href: target },
    }], "benign", "NS-ADV-UI-004");

    expect(window.document.documentElement.dataset.navsentinelLocalTargetsReady).toBe("1");
    expect(window.document.querySelector("#target")?.getAttribute("href")).toBe(target);
  });

  it("disarms every static target when a non-loopback origin rejects validation", () => {
    const window = loadFixture("https://attacker.example/fixture.html");
    const anchor = window.document.querySelector("#target");

    expect(window.document.documentElement.dataset.navsentinelLocalTargetsReady).toBe("0");
    expect(window.document.documentElement.dataset.navsentinelLocalTargetsError).toBe("non-loopback-fixture-origin");
    expect(anchor?.hasAttribute("href")).toBe(false);
    expect(anchor?.getAttribute("data-navsentinel-local-target-ready")).toBeNull();
  });

  it("fails closed and leaves static anchors disarmed when the bootstrap is unbound", () => {
    const window = loadFixture("http://127.0.0.1:5173/level1-basic-opacity.html", undefined, undefined, [{
      targetRole: "benign", scenarioId: "NS-ADV-UI-001", originMode: "same-loopback",
      source: { kind: "fallback" },
    }]);
    const anchor = window.document.querySelector("#target");

    expect(window.document.documentElement.dataset.navsentinelLocalTargetsReady).toBe("0");
    expect(window.document.documentElement.dataset.navsentinelLocalTargetsError).toBe("bootstrap-target-unbound");
    expect(anchor?.hasAttribute("href")).toBe(false);
  });

  it("fails closed when a resolver is bound to another exact document", () => {
    const window = new Window({ url: "http://127.0.0.1:5173/level1-basic-opacity.html" });
    window.document.body.innerHTML = '<a id="target" href="https://attacker.example/egress" data-navsentinel-local-target="harm" data-navsentinel-scenario="NS-ADV-UI-001">Target</a>';
    Object.defineProperty(window, "NavSentinelFixtureTargetBootstrap", {
      value: Object.freeze({ resolve: () => Object.freeze({ status: "document-mismatch" }) }),
      writable: false,
      configurable: false,
    });
    window.eval(helperSource);
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"));

    expect(window.document.documentElement.dataset.navsentinelLocalTargetsError).toBe("bootstrap-document-mismatch");
    expect(window.document.querySelector("#target")?.hasAttribute("href")).toBe(false);
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

  it("maps WIN-001 to its popup consequence and rejects legacy query authority", () => {
    const validWindow = loadFixture("http://127.0.0.1:5173/level5-window-open-popunder.html");
    const validTarget = new URL(localTargets(validWindow).url("harm", "NS-ADV-WIN-001"));
    expect(validTarget.searchParams.get("consequence")).toBe("unauthorized-browsing-context");

    const genericOverride = "http://127.0.0.1:46100/__navsentinel_fake_sink?run_id=123e4567-e89b-42d3-a456-426614174000&scenario_id=NS-ADV-WIN-001&role=attack&consequence=unauthorized-browsing-context&target_id=popup-harm&sentinel=NAVSENTINEL_SENTINEL_DO_NOT_RUN";
    const rejectedWindow = loadFixture(
      `http://127.0.0.1:5173/level5-window-open-popunder.html?harm_target=${encodeURIComponent(genericOverride)}`,
      undefined,
      undefined,
      [{
        targetRole: "harm", scenarioId: "NS-ADV-WIN-001", originMode: "same-loopback",
        source: { kind: "armed-sink", href: genericOverride },
      }],
    );

    expect(() => localTargets(rejectedWindow).url("harm", "NS-ADV-WIN-001"))
      .toThrow("legacy-target-override-rejected");
    expect(rejectedWindow.document.documentElement.dataset.navsentinelLocalTargetsReady).toBe("0");
  });
});
