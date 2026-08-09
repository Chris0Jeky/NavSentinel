/**
 * JS behavior monitor — capability-off variant (RI-07).
 *
 * Selected by the build when `capabilities.jsBehaviorInstrumentation` is false in
 * `config/release-profiles.json`, which is the case for every committed profile
 * including the release default (`interaction-only`). Because the bundler aliases
 * `@navsentinel/js-behavior-monitor` to this module, the patch-bearing monitor is
 * never linked into the build: `window.fetch`, `XMLHttpRequest.prototype.open`/
 * `.send`, `navigator.sendBeacon`, `HTMLFormElement.prototype.submit` and the
 * `HTMLInputElement.prototype.value` getter are not wrapped at all — not wrapped
 * and left inert.
 *
 * Navigation, credential and DoubleClickjacking protection are unaffected: they
 * live in `main_guard.ts` / `capture_isolated.ts` and do not route through this
 * module.
 *
 * Enabling the capability requires representative-site compatibility and runtime
 * overhead evidence that does not exist yet (roadmap EV-04).
 *
 * Mirrors `shared/reputation_runtime.disabled.ts`.
 */

import type { JsBehaviorMonitorConfig } from "./js_behavior_monitor.types";

export const jsBehaviorInstrumentationEnabled = false;

/**
 * No-op initializer. Installs nothing and touches no global or prototype.
 */
export function initJsBehaviorMonitor(_config: JsBehaviorMonitorConfig): void {
  // Intentionally empty: the beta capability is off, so no instrumentation is installed.
}
