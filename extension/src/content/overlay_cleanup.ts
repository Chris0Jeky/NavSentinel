import {
  bypassNextRestoredOverlayAttributeBatch,
  classifyOverlayElement,
  isHtmlElementLike,
  type MutationAlert,
} from "./mutation_monitor";

export type OverlaySuppression = () => boolean;

type OverlaySuppressionGroup = {
  active: boolean;
  suppressions: OverlaySuppression[];
  undo: OverlaySuppression;
};

// A page-local ledger keeps independently arriving layers under one Undo. The
// content-script module is recreated on navigation, so this state cannot leak
// into another document.
let activeSuppressionGroup: OverlaySuppressionGroup | null = null;

function appendToSuppressionGroup(
  suppressions: OverlaySuppression[],
): OverlaySuppression | null {
  if (suppressions.length === 0) return null;

  let group = activeSuppressionGroup;
  if (!group || !group.active) {
    group = {
      active: true,
      suppressions: [],
      undo: () => false,
    };
    group.undo = () => {
      if (!group?.active) return false;
      group.active = false;
      if (activeSuppressionGroup === group) activeSuppressionGroup = null;

      let restored = false;
      for (let i = group.suppressions.length - 1; i >= 0; i--) {
        restored = group.suppressions[i]!() || restored;
      }
      group.suppressions.length = 0;
      return restored;
    };
    activeSuppressionGroup = group;
  }

  group.suppressions.push(...suppressions);
  return group.undo;
}

/**
 * Temporarily hide one classified overlay while preserving a narrow Undo path.
 * The element stays in the document so page-owned listeners/state are not torn
 * down. Display is the only page-owned property changed, and Undo restores it
 * only while NavSentinel's exact suppression stamp is still present.
 */
export function suppressOverlayElement(element: Element): OverlaySuppression | null {
  if (!isHtmlElementLike(element) || !element.isConnected) return null;
  if (element === document.body || element === document.documentElement) return null;

  const priorDisplay = element.style.getPropertyValue("display");
  const priorDisplayPriority = element.style.getPropertyPriority("display");
  let active = true;

  element.style.setProperty("display", "none", "important");

  return () => {
    if (!active) return false;
    active = false;

    if (
      !element.isConnected ||
      element.style.getPropertyValue("display") !== "none" ||
      element.style.getPropertyPriority("display") !== "important"
    ) {
      return false;
    }

    bypassNextRestoredOverlayAttributeBatch(element);

    if (priorDisplay) {
      element.style.setProperty("display", priorDisplay, priorDisplayPriority);
    } else {
      element.style.removeProperty("display");
    }

    return true;
  };
}

export function suppressDetectedOverlay(
  alert: Pick<MutationAlert, "type" | "severity" | "element" | "elements">,
  enabled: boolean,
): OverlaySuppression | null {
  if (
    !enabled ||
    (alert.type !== "overlay_detected" && alert.type !== "overlay_injected") ||
    alert.severity !== "high"
  ) {
    return null;
  }
  const suppressions = (alert.elements ?? [alert.element])
    .map(suppressOverlayElement)
    .filter((undo): undo is OverlaySuppression => undo !== null);
  return appendToSuppressionGroup(suppressions);
}

/**
 * Suppress the first high-risk click candidate. `resolvedTarget` covers the
 * anchor fallback used when an isolated-world composed path stops at a host.
 */
export function suppressHighSeverityOverlayInPath(
  path: EventTarget[],
  enabled: boolean,
  resolvedTarget?: Element | null,
): OverlaySuppression | null {
  if (!enabled) return null;

  for (const target of resolvedTarget ? [resolvedTarget, ...path] : path) {
    if (!isHtmlElementLike(target)) continue;
    const classification = classifyOverlayElement(target);
    if (classification?.severity === "high") {
      const suppression = suppressOverlayElement(target);
      return suppression ? appendToSuppressionGroup([suppression]) : null;
    }
  }

  return null;
}

/** Test-only: discard module-local ownership without mutating page state. */
export function _resetOverlaySuppressionGroupForTest(): void {
  activeSuppressionGroup = null;
}
