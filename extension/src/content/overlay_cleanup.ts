import {
  bypassNextRestoredOverlayAttributeBatch,
  classifyOverlayElement,
  isHtmlElementLike,
  type MutationAlert,
} from "./mutation_monitor";

export interface OverlaySuppression {
  element: HTMLElement;
  restore: () => boolean;
}

function containsAccessibleDialog(element: HTMLElement): boolean {
  return element.matches('[role="dialog"], [role="alertdialog"], [aria-modal="true"]') ||
    element.querySelector('[role="dialog"], [role="alertdialog"], [aria-modal="true"]') !== null;
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
  // A high-z-index wrapper around a properly marked dialog is a common benign
  // modal shape. Prefer a cleanup miss to hiding an accessible dialog.
  if (containsAccessibleDialog(element)) return null;

  const priorDisplay = element.style.getPropertyValue("display");
  const priorDisplayPriority = element.style.getPropertyPriority("display");
  let active = true;

  element.style.setProperty("display", "none", "important");

  return {
    element,
    restore: () => {
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
    },
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

export function suppressHighSeverityOverlayInPath(
  path: EventTarget[],
  enabled: boolean,
): OverlaySuppression | null {
  if (!enabled) return null;

  const visited = new Set<EventTarget>();
  for (const target of path) {
    if (visited.has(target) || !isHtmlElementLike(target)) continue;
    visited.add(target);
    const classification = classifyOverlayElement(target);
    if (classification?.severity === "high") {
      return suppressOverlayElement(target);
    }
  }

  return null;
}
