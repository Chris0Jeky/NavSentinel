/**
 * Shared types for the JS behavior monitor.
 *
 * Lives in its own module so the capability-off variant
 * (`js_behavior_monitor.disabled.ts`) can type its no-op signature without
 * importing — and therefore without any chance of bundling — the patch-bearing
 * enabled monitor. Mirrors `shared/reputation_runtime.types.ts`.
 */

/** Configuration for the behavior monitor. */
export interface JsBehaviorMonitorConfig {
  /** Whether debug logging is enabled */
  debug: boolean;
  /** Current extension mode */
  mode: "off" | "smart" | "strict";
  /** Function to post signals to the isolated world via the bridge */
  postSignal: (type: string, payload?: Record<string, unknown>) => void;
}
