import { MaintainerHeadedError } from "./receipt";

export type MaintainerReadinessMarkers = {
  capture: string | null;
  bridge: string | null;
  ui_guard: string | null;
};

type MaintainerReadinessPage = {
  waitForFunction: (
    pageFunction: (expectedGuard: string) => boolean,
    expectedGuard: string,
    options: { timeout: number },
  ) => Promise<unknown>;
  evaluate: <T>(pageFunction: () => T) => Promise<T>;
};

const readMarkers = (): MaintainerReadinessMarkers => ({
  capture: document.documentElement.getAttribute("data-navsentinel-capture-ready"),
  bridge: document.documentElement.getAttribute("data-navsentinel-bridge-ready"),
  ui_guard: document.documentElement.getAttribute("data-navsentinel-ui-guard"),
});

const markersMatch = (markers: MaintainerReadinessMarkers, expectedGuard: string): boolean =>
  markers.capture === "1" && markers.bridge === "1" && markers.ui_guard === expectedGuard;

/**
 * Runner-local readiness check. It deliberately does not reuse the shared E2E
 * helper because that helper dismisses onboarding pages in the attached context.
 */
export async function waitForMaintainerReadiness(
  page: MaintainerReadinessPage,
  expectedGuard: string,
  timeout = 15_000,
): Promise<MaintainerReadinessMarkers> {
  try {
    await page.waitForFunction(
      (guard) => {
        const root = document.documentElement;
        return root.getAttribute("data-navsentinel-capture-ready") === "1" &&
          root.getAttribute("data-navsentinel-bridge-ready") === "1" &&
          root.getAttribute("data-navsentinel-ui-guard") === guard;
      },
      expectedGuard,
      { timeout },
    );
  } catch (error) {
    const code = error instanceof Error && error.name === "TimeoutError"
      ? "readiness-wait-timeout"
      : "readiness-wait-evaluation-failed";
    throw new MaintainerHeadedError("extension_readiness", code);
  }

  let markers: MaintainerReadinessMarkers;
  try {
    markers = await page.evaluate(readMarkers);
  } catch {
    throw new MaintainerHeadedError("extension_readiness", "readiness-marker-evaluation-failed");
  }
  if (!markersMatch(markers, expectedGuard)) {
    throw new MaintainerHeadedError("extension_readiness", "readiness-marker-mismatch");
  }
  return markers;
}
