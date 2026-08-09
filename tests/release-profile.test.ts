import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  configureManifestForProfile,
  createReleaseProfileReceipt,
  resolveReleaseProfile,
} from "../scripts/release-profile.mjs";
import { inspectBuiltReleaseProfile } from "../scripts/check-release-profile.mjs";
import { JS_BEHAVIOR_INSTRUMENTATION_SENTINEL } from "../extension/src/content/js_behavior_monitor";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeDist(profileName: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-profile-"));
  tempDirs.push(dir);
  const profile = resolveReleaseProfile(profileName);
  fs.writeFileSync(
    path.join(dir, "navsentinel-profile.json"),
    `${JSON.stringify(createReleaseProfileReceipt(profile), null, 2)}\n`,
  );
  const manifest = configureManifestForProfile({
    manifest_version: 3,
  }, profile);
  fs.writeFileSync(path.join(dir, "manifest.json"), `${JSON.stringify(manifest)}\n`);
  fs.writeFileSync(path.join(dir, "runtime.js"), "console.log('profile test');\n");
  return dir;
}

function makeValidTestBloom(): Uint8Array {
  const bytes = new Uint8Array(17);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x424c4f4d, true);
  view.setUint32(4, 1, true);
  view.setUint32(8, 1, true);
  view.setUint32(12, 8, true);
  return bytes;
}

describe("release profiles", () => {
  it("defaults to the release-eligible interaction-only profile", () => {
    const profile = resolveReleaseProfile("");
    expect(profile.id).toBe("interaction-only");
    expect(profile.releaseEligible).toBe(true);
    expect(profile.capabilities.reputation).toBe(false);
    expect(profile.capabilities.jsBehaviorInstrumentation).toBe(false);
  });

  it("leaves js-behavior instrumentation off in every committed profile", () => {
    for (const id of ["interaction-only", "research-reputation"]) {
      expect(resolveReleaseProfile(id).capabilities.jsBehaviorInstrumentation).toBe(false);
    }
  });

  it("rejects a built bundle that still links js-behavior instrumentation", () => {
    // The literal is duplicated in scripts/check-release-profile.mjs (a plain .mjs
    // build script that cannot import TypeScript); this asserts the two agree, so a
    // rename in the monitor cannot silently turn the dist check into a no-op.
    expect(JS_BEHAVIOR_INSTRUMENTATION_SENTINEL).toBe("ns-js-behavior-instrumentation-v1");
    const dist = makeDist("interaction-only");
    fs.writeFileSync(
      path.join(dist, "runtime.js"),
      `console.debug('${JS_BEHAVIOR_INSTRUMENTATION_SENTINEL} installing');\n`,
    );
    expect(() => inspectBuiltReleaseProfile(dist)).toThrow(/still links it/i);
  });

  it("rejects unknown profiles instead of falling back", () => {
    expect(() => resolveReleaseProfile("typo-profile")).toThrow(/unknown release profile/i);
  });

  it("adds only reputation to the manifest for the research profile", () => {
    const base = {
      manifest_version: 3,
      web_accessible_resources: [
        { resources: ["brand_templates.json", "reputation_data.bin"], matches: ["<all_urls>"] },
      ],
    };
    const interaction = configureManifestForProfile(base, resolveReleaseProfile("interaction-only"));
    const research = configureManifestForProfile(base, resolveReleaseProfile("research-reputation"));
    expect(interaction.web_accessible_resources).toBeUndefined();
    expect(research.web_accessible_resources[0]?.resources).toEqual([
      "reputation_data.bin",
    ]);
    expect(base.web_accessible_resources[0]?.resources).toContain("reputation_data.bin");
  });

  it("accepts a reputation-free interaction-only artifact as release eligible", () => {
    const dist = makeDist("interaction-only");
    const result = inspectBuiltReleaseProfile(dist, { requireReleaseEligible: true });
    expect(result.profile.id).toBe("interaction-only");
    expect(result.hasReputationAsset).toBe(false);
    expect(result.hasBrandTemplatesAsset).toBe(false);
  });

  it("rejects reputation loaders from an interaction-only bundle", () => {
    const dist = makeDist("interaction-only");
    fs.writeFileSync(path.join(dist, "runtime.js"), "fetch('reputation_data.bin');\n");
    expect(() => inspectBuiltReleaseProfile(dist)).toThrow(/reputation asset loader/i);
  });

  it("rejects a retired visual-simulation asset or manifest exposure", () => {
    const dist = makeDist("interaction-only");
    fs.writeFileSync(path.join(dist, "brand_templates.json"), "{}\n");
    expect(() => inspectBuiltReleaseProfile(dist)).toThrow(/retired visual-simulation/i);

    fs.rmSync(path.join(dist, "brand_templates.json"));
    const manifestPath = path.join(dist, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.web_accessible_resources = [
      { resources: ["brand_templates.json"], matches: ["<all_urls>"] },
    ];
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
    expect(() => inspectBuiltReleaseProfile(dist)).toThrow(/retired visual-simulation/i);
  });

  it("rejects retired visual-simulation bundle code", () => {
    const dist = makeDist("interaction-only");
    fs.writeFileSync(path.join(dist, "runtime.js"), "chrome.runtime.sendMessage({ type: 'ns-capture-viewport' });\n");
    expect(() => inspectBuiltReleaseProfile(dist)).toThrow(/retired visual-simulation code/i);
  });

  it.each([
    ["Safe Browsing comparison", "<p>Claims Safe\nBrowsing coverage.</p>"],
    ["known-bad domain protection", "<p>Blocks known-\nbad domains.</p>"],
    ["known malicious domain protection", "<p>Blocks known malicious\ndomains.</p>"],
    ["reputation protection", "<p>Includes reputation protection.</p>"],
    ["browser-visibility superiority", "<p>Browsers can’t see this.</p>"],
    ["extension superiority", "<p>Catches what other extensions\nmiss.</p>"],
    ["exclusive extension capability", "<p>The only browser\nextension that protects you.</p>"],
  ])("rejects %s claims from interaction-only UI", (label, claim) => {
    const dist = makeDist("interaction-only");
    const onboardingDir = path.join(dist, "src", "onboarding");
    fs.mkdirSync(onboardingDir, { recursive: true });
    fs.writeFileSync(path.join(onboardingDir, "onboarding.html"), `${claim}\n`);
    expect(() => inspectBuiltReleaseProfile(dist)).toThrow(`prohibited ${label} claim`);
  });

  it("accepts the explicit research artifact but rejects it for release packaging", () => {
    const dist = makeDist("research-reputation");
    fs.writeFileSync(path.join(dist, "reputation_data.bin"), makeValidTestBloom());
    const result = inspectBuiltReleaseProfile(dist);
    expect(result.profile.capabilities.reputation).toBe(true);
    expect(() => inspectBuiltReleaseProfile(dist, { requireReleaseEligible: true })).toThrow(
      /not release eligible/i,
    );
  });
});
