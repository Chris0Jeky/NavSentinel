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

function loadFixture(url: string, initialHref = "https://attacker.example/egress") {
  const window = new Window({ url });
  window.document.body.innerHTML = `<a id="target" href="${initialHref}" data-navsentinel-local-target="harm" data-navsentinel-scenario="NS-ADV-UI-001">Target</a>`;
  window.eval(helperSource);
  window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
  return window;
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
});
