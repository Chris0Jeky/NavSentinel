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
