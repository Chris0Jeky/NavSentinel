import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@navsentinel/reputation-runtime": resolve(
        __dirname,
        "extension/src/shared/reputation_runtime.disabled.ts",
      ),
      // Matches the release default: every committed profile leaves
      // `capabilities.jsBehaviorInstrumentation` false. Tests that exercise the
      // instrumentation itself import `content/js_behavior_monitor` by path.
      "@navsentinel/js-behavior-monitor": resolve(
        __dirname,
        "extension/src/content/js_behavior_monitor.disabled.ts",
      ),
    },
  },
  test: {
    root: ".",
    include: ["extension/src/**/*.test.ts", "tests/**/*.test.ts"],
    // The happy-dom a11y tests inject the real popup/options HTML (with
    // `<link rel="stylesheet">` and `<script src>`) into the document. Without this,
    // happy-dom resolves those relative hrefs against its default base and tries to
    // FETCH them, which is refused (nothing is served) and prints unhandled
    // ECONNREFUSED / NetworkError stack traces to stderr — pure noise that buries real
    // failures and makes a (rejected) network attempt in the unit lane, against the
    // local-first posture. Disabling external resource loading keeps the lane
    // network-free and the output clean; it does not affect DOM/ARIA assertions
    // (only file FETCHING is disabled, not markup or inline styles). (#198)
    //
    // NOTE: these settings only apply to tests that select `@vitest-environment
    // happy-dom` (there is no global `environment` here). A future jsdom/other-env
    // test would need its own resource-disabling. This is also why suppressing
    // resource loads globally is safe rather than risky: the extension is local-first
    // — production code only ever fetches bundled `chrome.runtime.getURL(...)` assets
    // or `data:` URLs, never external network — so a test needing a real network
    // response would mock fetch, not rely on happy-dom loading it.
    environmentOptions: {
      happyDOM: {
        settings: {
          disableCSSFileLoading: true,
          disableJavaScriptFileLoading: true,
          // Resolve a disabled resource load as success instead of throwing a
          // NotSupportedError — otherwise tests that parse HTML with external
          // <link>/<script> (e.g. via DOMParser) just trade the ECONNREFUSED for a
          // logged NotSupportedError. With this, the disabled load is silent. (#198)
          handleDisabledFileLoadingAsSuccess: true,
          // Prevent <iframe src> from navigating (fetching) its page — the
          // mutation-monitor / clickfix tests inject external iframes to exercise
          // detection, not to load them. (disableIframePageLoading is deprecated for
          // this.) (#198)
          navigation: {
            disableChildFrameNavigation: true,
            disableChildPageNavigation: true,
          },
        },
      },
    },
  },
});
