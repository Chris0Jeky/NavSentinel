import { resolve } from "node:path";
import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./extension/manifest.json";

export default defineConfig({
  root: "extension",
  plugins: [crx({ manifest })],
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
