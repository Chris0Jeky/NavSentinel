import {
  bypassNextRestoredOverlayAttributeBatch,
  classifyOverlayElement,
  isOverlayCleanupCandidateEligible,
  isHtmlElementLike,
  resumeOverlayCleanupForElement,
  type MutationAlert,
} from "./mutation_monitor";

export type OverlaySuppression = () => boolean;

export type OverlayCleanupAction =
  | "suppressed"
  | "reasserted"
  | "already_hidden"
  | "budget_exhausted";

export interface OverlayCleanupResult {
  action: OverlayCleanupAction;
  undo: OverlaySuppression;
  activeCount: number;
}

type ElementSuppression = {
  element: HTMLElement;
  priorDisplay: string;
  priorDisplayPriority: string;
  active: boolean;
  undo: OverlaySuppression;
};

type OverlaySuppressionGroup = {
  active: boolean;
  records: ElementSuppression[];
  undo: OverlaySuppression;
};

/** Hard page-local bound: replacements cannot grow the Undo ledger forever. */
export const MAX_ACTIVE_OVERLAY_SUPPRESSIONS = 128;

let activeSuppressionGroup: OverlaySuppressionGroup | null = null;
let suppressionByElement = new WeakMap<Element, ElementSuppression>();

function isExactSuppressionStamp(element: HTMLElement): boolean {
  return element.style.getPropertyValue("display") === "none" &&
    element.style.getPropertyPriority("display") === "important";
}

function createElementSuppression(element: HTMLElement): ElementSuppression {
  const record: ElementSuppression = {
    element,
    priorDisplay: element.style.getPropertyValue("display"),
    priorDisplayPriority: element.style.getPropertyPriority("display"),
    active: true,
    undo: () => false,
  };

  record.undo = () => {
    if (!record.active) return false;
    record.active = false;
    if (suppressionByElement.get(element) === record) {
      suppressionByElement.delete(element);
    }

    if (!element.isConnected || !isExactSuppressionStamp(element)) return false;

    bypassNextRestoredOverlayAttributeBatch(element);
    if (record.priorDisplay) {
      element.style.setProperty(
        "display",
        record.priorDisplay,
        record.priorDisplayPriority,
      );
    } else {
      element.style.removeProperty("display");
    }
    return true;
  };

  suppressionByElement.set(element, record);
  element.style.setProperty("display", "none", "important");
  return record;
}

function reconcileElement(element: Element): {
  record: ElementSuppression;
  action: Exclude<OverlayCleanupAction, "budget_exhausted">;
} | null {
  if (!isHtmlElementLike(element) || !element.isConnected) return null;
  if (element === document.body || element === document.documentElement) return null;

  const existing = suppressionByElement.get(element);
  if (existing?.active) {
    if (isExactSuppressionStamp(existing.element)) {
      return { record: existing, action: "already_hidden" };
    }
    existing.element.style.setProperty("display", "none", "important");
    return { record: existing, action: "reasserted" };
  }

  return { record: createElementSuppression(element), action: "suppressed" };
}

function createSuppressionGroup(): OverlaySuppressionGroup {
  const group: OverlaySuppressionGroup = {
    active: true,
    records: [],
    undo: () => false,
  };
  group.undo = () => {
    if (!group.active) return false;
    group.active = false;
    if (activeSuppressionGroup === group) activeSuppressionGroup = null;

    let restored = false;
    for (let index = group.records.length - 1; index >= 0; index -= 1) {
      restored = group.records[index]!.undo() || restored;
    }
    group.records.length = 0;
    return restored;
  };
  activeSuppressionGroup = group;
  return group;
}

/**
 * Hide or re-hide a classified overlay batch under one stable Undo action.
 * Repeated style rewrites reuse the original restoration record; replacement
 * nodes join the same bounded page-local group.
 */
export function reconcileDetectedOverlay(
  alert: Pick<MutationAlert, "type" | "severity" | "element" | "elements">,
  enabled: boolean,
  force = false,
): OverlayCleanupResult | null {
  if (
    !enabled ||
    (alert.type !== "overlay_detected" && alert.type !== "overlay_injected") ||
    alert.severity !== "high"
  ) {
    return null;
  }

  const elements = Array.from(new Set(alert.elements ?? [alert.element]))
    .filter((element) => force || isOverlayCleanupCandidateEligible(element));
  if (force) elements.forEach(resumeOverlayCleanupForElement);
  let group = activeSuppressionGroup?.active ? activeSuppressionGroup : null;
  let reasserted = false;
  let suppressed = false;
  let budgetExhausted = false;

  for (const element of elements) {
    const existing = suppressionByElement.get(element);
    if ((!existing || !existing.active) &&
        (group?.records.length ?? 0) >= MAX_ACTIVE_OVERLAY_SUPPRESSIONS) {
      budgetExhausted = true;
      continue;
    }

    const result = reconcileElement(element);
    if (!result) continue;
    group ??= createSuppressionGroup();
    if (!group.records.includes(result.record)) group.records.push(result.record);
    if (result.action === "suppressed") suppressed = true;
    if (result.action === "reasserted") reasserted = true;
  }

  if (!group) return null;
  const action: OverlayCleanupAction = budgetExhausted
    ? "budget_exhausted"
    : suppressed
      ? "suppressed"
      : reasserted
        ? "reasserted"
        : "already_hidden";
  return {
    action,
    undo: group.undo,
    activeCount: group.records.length,
  };
}

/**
 * Temporarily hide one element while preserving its exact pre-cleanup display.
 * Repeated calls reassert the same suppression rather than stacking restore
 * closures that could replay stale page state.
 */
export function suppressOverlayElement(element: Element): OverlaySuppression | null {
  return reconcileElement(element)?.record.undo ?? null;
}

export function suppressDetectedOverlay(
  alert: Pick<MutationAlert, "type" | "severity" | "element" | "elements">,
  enabled: boolean,
): OverlaySuppression | null {
  return reconcileDetectedOverlay(alert, enabled)?.undo ?? null;
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
    if (classification?.severity !== "high") continue;
    return reconcileDetectedOverlay({
      type: "overlay_injected",
      severity: "high",
      element: target,
    }, true, true)?.undo ?? null;
  }

  return null;
}

/** Restore the current page-local cleanup group, for Undo or opt-out. */
export function restoreActiveOverlaySuppressions(): boolean {
  return activeSuppressionGroup?.undo() ?? false;
}

/** Test-only: discard module-local ownership without mutating page state. */
export function _resetOverlaySuppressionGroupForTest(): void {
  activeSuppressionGroup = null;
  suppressionByElement = new WeakMap();
}
