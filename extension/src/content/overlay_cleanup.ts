import {
  bypassNextRestoredOverlayAttributeBatch,
  classifyOverlayElement,
  isHtmlElementLike,
  type MutationAlert,
} from "./mutation_monitor";

export type OverlaySuppression = () => boolean;

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
  alert: Pick<MutationAlert, "type" | "severity" | "element">,
  enabled: boolean,
): OverlaySuppression | null {
  if (!enabled || alert.type !== "overlay_injected" || alert.severity !== "high") {
    return null;
  }
  return suppressOverlayElement(alert.element);
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
      return suppressOverlayElement(target);
    }
  }

  return null;
}
