import { createRequire } from "node:module";

/**
 * The default E2E lanes (smoke, regression, phase2) on the installed branded
 * Google Chrome instead of Playwright's bundled Chromium. Set
 * NAVSENTINEL_REALISTIC_CHROME=1 to also remove Playwright's realism-distorting
 * switches (back/forward cache, popup blocker, background throttling, sandbox),
 * or NAVSENTINEL_BRANDED_CHROME=<chrome path> to pick another Chrome build.
 * See tests/branded/branded-chrome-preload.cjs.
 */
process.env.NAVSENTINEL_BRANDED_CHROME ??= "1";
createRequire(import.meta.url)("./tests/branded/branded-chrome-preload.cjs");

export { default } from "./playwright.config";
