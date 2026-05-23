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
    rollupOptions: {
      input: {
        onboarding: resolve(__dirname, "extension/src/onboarding/onboarding.html")
      }
    }
  },
  server: {
    port: 5174,
    strictPort: true
  }
});
