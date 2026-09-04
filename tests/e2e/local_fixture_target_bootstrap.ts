import type { Page } from "@playwright/test";
import type { FixtureTargetBootstrap } from "./proving_ground_fake_sink";

/**
 * Installs one immutable, page-scoped fixture-target resolver before navigation.
 * It changes only one frozen, non-writable Window resolver; it does not inject
 * input, events, navigation, document-node mutation, product calls, or decisions.
 */
export async function installFixtureTargetBootstrap(
  page: Page,
  bootstrap: FixtureTargetBootstrap,
): Promise<void> {
  await page.addInitScript((configuredBootstrap) => {
    const bootstrap = Object.freeze({
      fixtureOrigin: configuredBootstrap.fixtureOrigin,
      fixturePath: configuredBootstrap.fixturePath,
      bindings: Object.freeze(configuredBootstrap.bindings.map((binding) => Object.freeze({
        targetRole: binding.targetRole,
        scenarioId: binding.scenarioId,
        originMode: binding.originMode,
        source: Object.freeze({ ...binding.source }),
      }))),
    });
    const resolver = Object.freeze({
      resolve(targetRole: string, scenarioId: string, originMode: string) {
        if (location.origin !== bootstrap.fixtureOrigin || location.pathname !== bootstrap.fixturePath) {
          return Object.freeze({ status: "document-mismatch" as const });
        }
        const binding = bootstrap.bindings.find((candidate) =>
          candidate.targetRole === targetRole &&
          candidate.scenarioId === scenarioId &&
          candidate.originMode === originMode,
        );
        if (!binding) return Object.freeze({ status: "unbound" as const });
        return Object.freeze(binding.source.kind === "armed-sink"
          ? { status: "resolved" as const, kind: "armed-sink" as const, href: binding.source.href }
          : { status: "resolved" as const, kind: "fallback" as const });
      },
    });
    Object.defineProperty(window, "NavSentinelFixtureTargetBootstrap", {
      value: resolver,
      writable: false,
      configurable: false,
      enumerable: false,
    });
  }, bootstrap);
}
