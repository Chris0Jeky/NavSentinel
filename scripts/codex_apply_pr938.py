from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match in {path}, found {count}")
    path.write_text(text.replace(old, new, 1))


source = ROOT / "extension/src/content/mutation_monitor.ts"

replace_once(
    source,
    'type FormMethod = "get" | "post";',
    'type FormMethod = "get" | "post" | "dialog";',
    "preserve dialog method",
)

replace_once(
    source,
    '''  /** Submit-control type immediately after this mutation. */
  controlType: string | null;
  /** Owning form state immediately after this mutation. */''',
    '''  /** Submit-control type immediately after this mutation. */
  controlType: string | null;
  /** Type immediately before a `type` mutation; null for other attributes. */
  previousControlType: string | null;
  /** Owning form state immediately after this mutation. */''',
    "previous submit-control type",
)

replace_once(
    source,
    '''function normalizeFormMethod(value: string | null): FormMethod {
  return value !== null && value.toLowerCase() === "post" ? "post" : "get";
}''',
    '''function normalizeFormMethod(value: string | null): FormMethod {
  const normalized = value?.toLowerCase();
  if (normalized === "post" || normalized === "dialog") return normalized;
  return "get";
}''',
    "method normalization",
)

replace_once(
    source,
    '''function captureAttributeTransitionSnapshots(records: MutationRecord[]): void {''',
    '''function withoutAttributeOldValue(record: MutationRecord): MutationRecord {
  if (record.type !== "attributes" || record.oldValue === null) return record;
  return {
    type: record.type,
    target: record.target,
    addedNodes: record.addedNodes,
    removedNodes: record.removedNodes,
    previousSibling: record.previousSibling,
    nextSibling: record.nextSibling,
    attributeName: record.attributeName,
    attributeNamespace: record.attributeNamespace,
    oldValue: null,
  } as MutationRecord;
}

/**
 * Reconstruct each authority transition, then return queue-safe records that no
 * longer retain arbitrary page-controlled `oldValue` strings through the debounce.
 */
function captureAttributeTransitionSnapshots(records: MutationRecord[]): MutationRecord[] {''',
    "sanitize queued attribute records",
)

replace_once(
    source,
    '''      currentValue: state.get(record.attributeName) ?? null,
      controlType: state.get("type") ?? null,
      ownerAction: ownerState?.get("action") ?? "",''',
    '''      currentValue: state.get(record.attributeName) ?? null,
      controlType: state.get("type") ?? null,
      previousControlType:
        record.attributeName === "type" && typeof record.oldValue === "string"
          ? record.oldValue
          : null,
      ownerAction: ownerState?.get("action") ?? "",''',
    "capture previous type",
)

replace_once(
    source,
    '''    state.set(record.attributeName, typeof record.oldValue === "string" ? record.oldValue : null);
  }
}

function transitionFor(record: MutationRecord, target: Element): AttributeTransitionSnapshot {''',
    '''    state.set(record.attributeName, typeof record.oldValue === "string" ? record.oldValue : null);
  }

  return records.map((record) => {
    const queued = withoutAttributeOldValue(record);
    if (queued !== record) {
      const transition = attributeTransitionSnapshots.get(record);
      if (transition) attributeTransitionSnapshots.set(queued, transition);
    }
    return queued;
  });
}

function transitionFor(record: MutationRecord, target: Element): AttributeTransitionSnapshot {''',
    "return sanitized records",
)

replace_once(
    source,
    '''    currentValue: record.attributeName ? target.getAttribute(record.attributeName) : null,
    controlType: target.getAttribute("type"),
    ownerAction: owner?.getAttribute("action") ?? "",''',
    '''    currentValue: record.attributeName ? target.getAttribute(record.attributeName) : null,
    controlType: target.getAttribute("type"),
    previousControlType:
      record.attributeName === "type" && typeof record.oldValue === "string"
        ? record.oldValue
        : null,
    ownerAction: owner?.getAttribute("action") ?? "",''',
    "fallback previous type",
)

replace_once(
    source,
    '''function seedSubmitterAuthorityAfterTypeChange(
  target: Element,
  transition: AttributeTransitionSnapshot,
): void {
  if (!isSubmitControlAt(target, transition.currentValue)) return;
  if (!originalSubmitterActions.has(target)) {
    originalSubmitterActions.set(
      target,
      effectiveSubmitterAction(transition.submitterAction, transition.ownerAction),
    );
  }
  if (!originalSubmitterMethods.has(target)) {
    originalSubmitterMethods.set(
      target,
      effectiveSubmitterMethod(transition.submitterMethod, transition.ownerMethod),
    );
  }
}''',
    '''/**
 * A page may stage inert overrides and make them authoritative only by changing
 * the control to submit-capable. Compare that activation with the owner's safe
 * authority rather than silently adopting the staged values as a new baseline.
 */
function checkSubmitterAuthorityAfterTypeChange(
  target: Element,
  transition: AttributeTransitionSnapshot,
): void {
  if (!isSubmitControlAt(target, transition.currentValue)) return;
  if (isSubmitControlAt(target, transition.previousControlType)) return;

  const currentAction = effectiveSubmitterAction(
    transition.submitterAction,
    transition.ownerAction,
  );
  const originalAction = originalSubmitterActions.get(target) ?? transition.ownerAction;
  originalSubmitterActions.set(target, originalAction);
  if (currentAction !== originalAction) {
    const crossDomain = currentAction ? isCrossDomain(currentAction) : false;
    const boundedCurrent = boundedDetailValue(currentAction);
    const boundedOriginal = boundedDetailValue(originalAction);
    const detail = crossDomain
      ? `Submitter formaction changed to cross-domain URL: "${boundedCurrent}" (was "${boundedOriginal}")`
      : `Submitter formaction changed: "${boundedCurrent}" (was "${boundedOriginal}")`;
    pushAlert({
      type: "form_action_changed",
      severity: crossDomain ? "high" : "medium",
      element: target,
      details: detail,
      timestamp: Date.now(),
    });
  }

  const currentMethod = effectiveSubmitterMethod(
    transition.submitterMethod,
    transition.ownerMethod,
  );
  const originalMethod = originalSubmitterMethods.get(target) ?? transition.ownerMethod;
  originalSubmitterMethods.set(target, originalMethod);
  if (originalMethod === "post" && currentMethod === "get") {
    pushAlert({
      type: "form_method_changed",
      severity: "medium",
      element: target,
      details: "Form submission method downgraded from POST to GET after page load (type activation)",
      timestamp: Date.now(),
    });
  }
}''',
    "detect staged submitter authority",
)

replace_once(
    source,
    '''  if (record.attributeName === "type") {
    seedSubmitterAuthorityAfterTypeChange(target, transition);''',
    '''  if (record.attributeName === "type") {
    checkSubmitterAuthorityAfterTypeChange(target, transition);''',
    "type activation call",
)

replace_once(
    source,
    '''function onMutations(records: MutationRecord[]): void {
  captureAttributeTransitionSnapshots(records);
  processOverlayCleanupRecords(records);
  scheduleOverlayCleanupRescan();
  for (const r of records) {
    pendingMutations.push(r);
  }''',
    '''function onMutations(records: MutationRecord[]): void {
  const queuedRecords = captureAttributeTransitionSnapshots(records);
  processOverlayCleanupRecords(records);
  scheduleOverlayCleanupRescan();
  for (const record of queuedRecords) {
    pendingMutations.push(record);
  }''',
    "queue sanitized records",
)

replace_once(
    source,
    '''export function _getPendingMutationCountForTesting(): number {
  return pendingMutations.length;
}

/**
 * Exposed for testing only: synchronously deliver records queued by the primary''',
    '''export function _getPendingMutationCountForTesting(): number {
  return pendingMutations.length;
}

/** Exposed for testing only: queued attribute records must not retain raw old values. */
export function _getPendingAttributeOldValuesForTesting(): Array<string | null> {
  return pendingMutations
    .filter((record) => record.type === "attributes")
    .map((record) => record.oldValue);
}

/**
 * Exposed for testing only: synchronously deliver records queued by the primary''',
    "old-value test seam",
)

reason_test = ROOT / "tests/evidence-reasons.test.ts"
replace_once(
    reason_test,
    'expect(VOCABULARY.mutation).toEqual(["overlay_detected", "overlay_injected", "form_action_changed", "password_injected", "suspicious_iframe"]);',
    'expect(VOCABULARY.mutation).toEqual(["overlay_detected", "overlay_injected", "form_action_changed", "form_method_changed", "password_injected", "suspicious_iframe"]);',
    "mutation reason vocabulary",
)

authority_test = ROOT / "tests/mutation-monitor-form-authority.test.ts"
replace_once(
    authority_test,
    '''  _feedMutationRecordsForTesting,
  _getPendingMutationCountForTesting,''',
    '''  _feedMutationRecordsForTesting,
  _getPendingAttributeOldValuesForTesting,
  _getPendingMutationCountForTesting,''',
    "old-value test import",
)

replace_once(
    authority_test,
    '''    attributeName,
    oldValue,''',
    '''    attributeName,
    attributeNamespace: null,
    oldValue,''',
    "synthetic record namespace",
)

replace_once(
    authority_test,
    '''  it("does not reinterpret an inert override after a control becomes submit-capable", async () => {
    const form = document.createElement("form");
    const button = document.createElement("button");
    button.type = "button";
    form.appendChild(button);
    document.body.appendChild(form);

    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (alert) => alerts.push(alert));

    button.setAttribute("formaction", "https://evil.example/collect");
    button.type = "submit";
    _feedMutationRecordsForTesting([
      attributeRecord(button, "formaction", null),
      attributeRecord(button, "type", "button"),
    ]);
    await drainQueuedMutations();

    expect(alerts.filter((alert) => alert.type === "form_action_changed")).toHaveLength(0);
  });''',
    '''  it("detects a hostile override staged while inert and activated by type change", async () => {
    const form = document.createElement("form");
    form.setAttribute("action", "/checkout");
    const button = document.createElement("button");
    button.type = "button";
    form.appendChild(button);
    document.body.appendChild(form);

    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (alert) => alerts.push(alert));

    button.setAttribute("formaction", "https://evil.example/collect");
    button.type = "submit";
    _feedMutationRecordsForTesting([
      attributeRecord(button, "formaction", null),
      attributeRecord(button, "type", "button"),
    ]);
    await drainQueuedMutations();

    const actionAlerts = alerts.filter((alert) => alert.type === "form_action_changed");
    expect(actionAlerts).toHaveLength(1);
    expect(actionAlerts[0]!.severity).toBe("high");
  });

  it("detects a staged POST-to-GET downgrade when an inert control becomes a submitter", async () => {
    const form = document.createElement("form");
    form.method = "post";
    const button = document.createElement("button");
    button.type = "button";
    form.appendChild(button);
    document.body.appendChild(form);

    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (alert) => alerts.push(alert));

    button.setAttribute("formmethod", "get");
    button.type = "submit";
    _feedMutationRecordsForTesting([
      attributeRecord(button, "formmethod", null),
      attributeRecord(button, "type", "button"),
    ]);
    await drainQueuedMutations();

    const methodAlerts = formMethodAlerts(alerts);
    expect(methodAlerts).toHaveLength(1);
    expect(methodAlerts[0]!.details).toContain("type activation");
  });''',
    "staged override regressions",
)

replace_once(
    authority_test,
    '''  it("ignores formaction and formmethod churn on non-submit controls", async () => {''',
    '''  it("does not describe the valid dialog method as a GET downgrade", async () => {
    const form = document.createElement("form");
    form.method = "post";
    document.body.appendChild(form);

    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (alert) => alerts.push(alert));

    form.setAttribute("method", "dialog");
    _feedMutationRecordsForTesting([attributeRecord(form, "method", "post")]);
    await drainQueuedMutations();

    expect(formMethodAlerts(alerts)).toHaveLength(0);
  });

  it("does not describe formmethod=dialog as a GET downgrade", async () => {
    const form = document.createElement("form");
    form.method = "post";
    const button = document.createElement("button");
    button.type = "submit";
    form.appendChild(button);
    document.body.appendChild(form);

    const alerts: MutationAlert[] = [];
    startMutationMonitor(document, (alert) => alerts.push(alert));

    button.setAttribute("formmethod", "dialog");
    _feedMutationRecordsForTesting([attributeRecord(button, "formmethod", null)]);
    await drainQueuedMutations();

    expect(formMethodAlerts(alerts)).toHaveLength(0);
  });

  it("ignores formaction and formmethod churn on non-submit controls", async () => {''',
    "dialog regressions",
)

replace_once(
    authority_test,
    '''  it("registers a human-readable explanation for method downgrades", () => {''',
    '''  it("does not retain raw page-controlled oldValue strings in the debounced queue", () => {
    const form = document.createElement("form");
    document.body.appendChild(form);
    startMutationMonitor(document, () => {});

    form.setAttribute("action", "/next");
    _feedMutationRecordsForTesting([
      attributeRecord(form, "action", `https://evil.example/${"x".repeat(5000)}`),
    ]);

    expect(_getPendingAttributeOldValuesForTesting()).toEqual([null]);
  });

  it("registers a human-readable explanation for method downgrades", () => {''',
    "old-value retention regression",
)

print("Applied PR #938 security corrections")
