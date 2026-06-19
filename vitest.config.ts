import { defineConfig } from "vitest/config";

export default defineConfig({
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
