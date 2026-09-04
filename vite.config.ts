import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./extension/manifest.json";
import {
  configureManifestForProfile,
  resolveReleaseProfile,
  serializeReleaseProfileReceipt,
  type ReleaseProfile,
} from "./scripts/release-profile.mjs";

const profile = resolveReleaseProfile();
const profiledManifest = configureManifestForProfile(manifest, profile);

function profileAssets(selectedProfile: ReleaseProfile): Plugin {
  return {
    name: "navsentinel-release-profile-assets",
    apply: "build",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "navsentinel-profile.json",
        source: serializeReleaseProfileReceipt(selectedProfile),
      });
    },
    writeBundle() {
      if (!selectedProfile.capabilities.reputation) {
        rmSync(resolve(__dirname, "extension/dist/reputation_data.bin"), { force: true });
      }
    },
  };
}

export default defineConfig({
  root: "extension",
  resolve: {
    alias: {
      "@navsentinel/reputation-runtime": resolve(
        __dirname,
        profile.capabilities.reputation
          ? "extension/src/shared/reputation_runtime.enabled.ts"
          : "extension/src/shared/reputation_runtime.disabled.ts",
      ),
      "@navsentinel/child-reputation": resolve(
        __dirname,
        profile.capabilities.reputation
          ? "extension/src/content/child_reputation.enabled.ts"
          : "extension/src/content/child_reputation.disabled.ts",
      ),
      // RI-07: with the capability off (every committed profile) the patch-bearing
      // monitor is never linked, so fetch / XHR / sendBeacon / password-value
      // prototypes are not wrapped at all rather than wrapped and left inert.
      "@navsentinel/js-behavior-monitor": resolve(
        __dirname,
        profile.capabilities.jsBehaviorInstrumentation
          ? "extension/src/content/js_behavior_monitor.ts"
          : "extension/src/content/js_behavior_monitor.disabled.ts",
      ),
    },
  },
  plugins: [profileAssets(profile), crx({ manifest: profiledManifest })],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        onboarding: resolve(__dirname, "extension/src/onboarding/onboarding.html")
      },
      output: {
        // Chrome MV3 module workers require static imports. Keep the pending-decision
        // runtime out of the 25 KiB worker entry without turning it into import().
        codeSplitting: {
          groups: [
            {
              name: "pending-decision-runtime",
              test: /[\\/]src[\\/](?:shared[\\/]pending_decision|sw[\\/]pending_decision_(?:handlers|store))\.ts$/,
              entriesAware: true,
              priority: 10
            },
            {
              // Research reputation is shared by the content script and service
              // worker. Keep it out of the already capped capture entry without
              // changing runtime ordering or linking it into release builds.
              name: "reputation-runtime",
              test: /[\\/]src[\\/]shared[\\/](?:reputation|reputation_runtime\.enabled)\.ts$/,
              entriesAware: true,
              priority: 9
            },
            {
              name: "child-reputation",
              test: /[\\/]src[\\/]content[\\/]child_reputation\.enabled\.ts$/,
              entriesAware: false,
              priority: 8
            },
            {
              name: "modifier-navigation",
              test: /[\\/]src[\\/]content[\\/]modifier_navigation\.ts$/,
              entriesAware: false,
              priority: 7
            }
          ]
        }
      }
    }
  },
  server: {
    port: 5174,
    strictPort: true
  }
});
