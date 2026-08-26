import {
  classifyOverlayElement,
  type MutationAlert,
} from "./mutation_monitor";

export interface OverlaySuppression {
  element: HTMLElement;
  restore: () => boolean;
}

/**
 * Temporarily hide one classified overlay while preserving a narrow Undo path.
 * The element stays in the document so page-owned listeners/state are not torn
 * down, and only the properties this function changes are restored.
 */
export function suppressOverlayElement(element: Element): OverlaySuppression | null {
  if (!(element instanceof HTMLElement) || !element.isConnected) return null;
  if (element === document.body || element === document.documentElement) return null;
  if (element.id.startsWith("__navsentinel_")) return null;

  const priorDisplay = element.style.getPropertyValue("display");
  const priorDisplayPriority = element.style.getPropertyPriority("display");
  const hadHidden = element.hasAttribute("hidden");
  const priorHiddenValue = element.getAttribute("hidden");
  const hadAriaHidden = element.hasAttribute("aria-hidden");
  const priorAriaHidden = element.getAttribute("aria-hidden");
  let active = true;

  element.hidden = true;
  element.setAttribute("aria-hidden", "true");
  element.style.setProperty("display", "none", "important");

  return {
    element,
    restore: () => {
      if (!active) return false;
      active = false;

      if (priorDisplay) {
        element.style.setProperty("display", priorDisplay, priorDisplayPriority);
      } else {
        element.style.removeProperty("display");
      }

      if (hadHidden) {
        element.setAttribute("hidden", priorHiddenValue ?? "");
      } else {
        element.removeAttribute("hidden");
      }

      if (hadAriaHidden) {
        element.setAttribute("aria-hidden", priorAriaHidden ?? "");
      } else {
        element.removeAttribute("aria-hidden");
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

  const visited = new Set<Element>();
  for (const target of path) {
    if (!(target instanceof Element) || visited.has(target)) continue;
    visited.add(target);
    const classification = classifyOverlayElement(target);
    if (classification?.severity === "high") {
      return suppressOverlayElement(target);
    }
  }

  return null;
}
