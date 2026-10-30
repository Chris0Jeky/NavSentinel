import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./extension/manifest.json" with { type: "json" };
// @ts-expect-error Build helpers are plain ESM and intentionally ship without runtime TypeScript.
import { INLINE_STYLE_OR_XML_SPACE, WHITESPACE_SENSITIVE_HTML } from "./scripts/packaged-html.mjs";
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
        rmSync(resolve(import.meta.dirname, "extension/dist/reputation_data.bin"), { force: true });
      }
    },
  };
}

/**
 * Strip source indentation from built extension pages. Vite does not minify HTML,
 * and a newline followed by spaces collapses to the same whitespace as a bare
 * newline in rendering, except in whitespace-sensitive markup, so pages with any
 * (the packaged Options compactor's guard: pre, textarea, style, svg, inline
 * style=, ...) are left untouched. CSS `white-space: pre*` on these pages is not
 * checked here; keep it off them or skip the page. Frees total-dist budget.
 */
function stripHtmlIndentation(): Plugin {
  return {
    name: "navsentinel-strip-html-indentation",
    transformIndexHtml: {
      order: "post",
      handler: (html) =>
        WHITESPACE_SENSITIVE_HTML.test(html) || INLINE_STYLE_OR_XML_SPACE.test(html) ? html : html.replace(/\n[ \t]+/g, "\n").replace(/\n{2,}/g, "\n"),
    },
  };
}

export default defineConfig({
  root: "extension",
  resolve: {
    alias: {
      "@navsentinel/reputation-runtime": resolve(
        import.meta.dirname,
        profile.capabilities.reputation
          ? "extension/src/shared/reputation_runtime.enabled.ts"
          : "extension/src/shared/reputation_runtime.disabled.ts",
      ),
      // RI-07: with the capability off (every committed profile) the patch-bearing
      // monitor is never linked, so fetch / XHR / sendBeacon / password-value
      // prototypes are not wrapped at all rather than wrapped and left inert.
      "@navsentinel/js-behavior-monitor": resolve(
        import.meta.dirname,
        profile.capabilities.jsBehaviorInstrumentation
          ? "extension/src/content/js_behavior_monitor.ts"
          : "extension/src/content/js_behavior_monitor.disabled.ts",
      ),
    },
  },
  plugins: [profileAssets(profile), crx({ manifest: profiledManifest }), stripHtmlIndentation()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Content scripts share a hostile page DOM: head can be absent, and preload
    // links expose extension module URLs. Keep lazy loading as native import().
    modulePreload: false,
    rolldownOptions: {
      input: {
        onboarding: resolve(import.meta.dirname, "extension/src/onboarding/onboarding.html"),
        evidence: resolve(import.meta.dirname, "extension/src/evidence/evidence.html")
      },
      output: {
        // CRXJS 3 names manifest entries from their full relative paths. Keep
        // the three measured content entries stable without renaming shared chunks.
        chunkFileNames: ({ facadeModuleId, name }) => {
          const modulePath = facadeModuleId?.replaceAll("\\", "/").split(/[?#]/, 1)[0];
          const contentEntry = modulePath?.match(
            /(?:^|\/)src\/content\/(capture_isolated|main_guard|credential_guard)\.ts$/,
          ) ?? name.match(/^src-content-(capture_isolated|main_guard|credential_guard)\.ts$/);
          return contentEntry
            ? `assets/${contentEntry[1]}.ts-[hash].js`
            : "assets/[name]-[hash].js";
        },
        // Chrome MV3 module workers require static imports. Keep the pending-decision
        // runtime out of the 25 KiB worker entry without turning it into import().
        codeSplitting: {
          groups: [
            {
              // The worker broker adds a consumer to this shared module (#976).
              // Keep it separate from OAuth/reputation instead of letting the
              // automatic grouping fuse unrelated code under the OAuth budget.
              // This remains a static import and is covered by total-dist limits.
              name: "smart_defaults",
              test: /[\\/]src[\\/]shared[\\/]smart_defaults\.ts$/,
              entriesAware: false,
              priority: 10
            },
            {
              // Keep Options presentation/operation helpers separate as the
              // settings editor grows; total-dist budget still covers both.
              name: "options-model",
              test: /[\\/]src[\\/]options[\\/]options_model\.ts$/,
              entriesAware: true,
              priority: 10
            },
            {
              // (#820) Pin the toast UI to its own single shared chunk:
              // password_field is now shared across the same entries, and
              // without this the splitter fuses both into one chunk, tripping
              // the ui_toast perf-budget MISS. Deliberately NOT entriesAware
              // (unlike the groups above): the pre-existing shape is one
              // entry-independent `ui_toast-<hash>.js`, which the budget globs.
              name: "ui_toast",
              test: /[\\/]src[\\/]content[\\/]ui_toast\.ts$/,
              entriesAware: false,
              priority: 10
            },
            {
              // Shared by credential and toast approvals. Keep its static import
              // independent of toast presentation; total-dist still bounds it.
              name: "ui_action_visibility",
              test: /[\\/]src[\\/]content[\\/]ui_action_visibility\.ts$/,
              entriesAware: false,
              priority: 20
            },
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
