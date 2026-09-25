/**
 * Stable facade for the enabled JS behavior monitor.
 *
 * The core monitor owns signal correlation and MAIN-world API patches. This
 * facade adds first-observed form-action provenance so action or `formaction`
 * retargeting cannot be laundered through MutationObserver callback timing.
 */
import type { JsBehaviorMonitorConfig } from "./js_behavior_monitor.types";
import {
  _resetState as resetCoreState,
  extractOrigin,
  formHasCredentialFields,
  initJsBehaviorMonitor as initCoreMonitor,
  isCrossOriginUrl,
} from "./js_behavior_monitor.core";

export * from "./js_behavior_monitor.core";
export type { JsBehaviorMonitorConfig };

type ActionSnapshot = {
  present: boolean;
  raw: string;
  baseUrl: string;
  documentUrl: string;
};

type SubmitContext = {
  form: HTMLFormElement;
  submitter: HTMLElement | null;
  supplementalSignal: Record<string, unknown> | null;
  coreEmitted: boolean;
};

let _config: JsBehaviorMonitorConfig | null = null;
let _observer: MutationObserver | null = null;
let _beginSubmitListener: ((event: Event) => void) | null = null;
let _endSubmitListener: ((event: Event) => void) | null = null;
let _coreSubmitFn: typeof HTMLFormElement.prototype.submit | null = null;
let _supplementalSubmitFn: typeof HTMLFormElement.prototype.submit | null = null;
let _contexts: SubmitContext[] = [];
let _originalFormActions = new WeakMap<HTMLFormElement, ActionSnapshot>();
let _originalSubmitterActions = new WeakMap<HTMLElement, ActionSnapshot>();

function currentActionSnapshot(element: HTMLElement, attribute: "action" | "formaction"): ActionSnapshot {
  return {
    present: element.hasAttribute(attribute),
    raw: element.getAttribute(attribute) ?? "",
    baseUrl: document.baseURI,
    documentUrl: location.href,
  };
}

function previousActionSnapshot(oldValue: string | null): ActionSnapshot {
  return {
    present: oldValue !== null,
    raw: oldValue ?? "",
    baseUrl: document.baseURI,
    documentUrl: location.href,
  };
}

function recordFormAction(
  form: HTMLFormElement,
  snapshot = currentActionSnapshot(form, "action"),
): void {
  if (!_originalFormActions.has(form)) {
    _originalFormActions.set(form, snapshot);
  }
}

function isPotentialSubmitter(element: HTMLElement): boolean {
  if (element instanceof HTMLButtonElement) return true;
  if (element instanceof HTMLInputElement) {
    return element.type === "submit" || element.type === "image";
  }
  return element.hasAttribute("formaction");
}

function recordSubmitterAction(
  submitter: HTMLElement,
  snapshot = currentActionSnapshot(submitter, "formaction"),
): void {
  if (isPotentialSubmitter(submitter) && !_originalSubmitterActions.has(submitter)) {
    _originalSubmitterActions.set(submitter, snapshot);
  }
}

function recordSelf(element: HTMLElement): void {
  if (element instanceof HTMLFormElement) recordFormAction(element);
  recordSubmitterAction(element);
}

function recordElement(element: HTMLElement): void {
  recordSelf(element);

  const descendants = element.querySelectorAll("form, button, input, [formaction]");
  for (let i = 0; i < descendants.length; i++) {
    const descendant = descendants[i];
    if (descendant instanceof HTMLElement) recordSelf(descendant);
  }
}

function processMutations(mutations: MutationRecord[]): void {
  // Attribute records carry the pre-mutation value. Process them first so an
  // insert/mutate/submit sequence cannot snapshot the hostile current value.
  for (let i = 0; i < mutations.length; i++) {
    const mutation = mutations[i]!;
    if (mutation.type !== "attributes") continue;

    if (
      mutation.attributeName === "action" &&
      mutation.target instanceof HTMLFormElement
    ) {
      recordFormAction(mutation.target, previousActionSnapshot(mutation.oldValue));
    } else if (
      mutation.attributeName === "formaction" &&
      mutation.target instanceof HTMLElement
    ) {
      recordSubmitterAction(mutation.target, previousActionSnapshot(mutation.oldValue));
    }
  }

  for (let i = 0; i < mutations.length; i++) {
    const mutation = mutations[i]!;
    if (mutation.type !== "childList") continue;
    for (let j = 0; j < mutation.addedNodes.length; j++) {
      const node = mutation.addedNodes[j];
      if (node instanceof HTMLElement) recordElement(node);
    }
  }
}

function flushMutations(): void {
  const records = _observer?.takeRecords() ?? [];
  if (records.length > 0) processMutations(records);
}

function resolveAction(snapshot: ActionSnapshot): string {
  // The HTML form algorithm treats an exactly-empty action as the current
  // document. Whitespace is not empty: URL parsing strips it and resolves the
  // result against the document base, which may be cross-origin.
  if (snapshot.raw.length === 0) return snapshot.documentUrl;
  try {
    return new URL(snapshot.raw, snapshot.baseUrl).toString();
  } catch {
    return snapshot.documentUrl;
  }
}

function effectiveAction(
  form: ActionSnapshot,
  submitter: ActionSnapshot | null,
): string {
  return resolveAction(submitter?.present ? submitter : form);
}

function inspectSubmit(
  form: HTMLFormElement,
  submitter: HTMLElement | null,
): Record<string, unknown> | null {
  flushMutations();
  recordFormAction(form);
  if (submitter) recordSubmitterAction(submitter);

  const originalForm = _originalFormActions.get(form)!;
  const currentForm = currentActionSnapshot(form, "action");
  const originalSubmitter = submitter
    ? (_originalSubmitterActions.get(submitter) ?? null)
    : null;
  const currentSubmitter = submitter
    ? currentActionSnapshot(submitter, "formaction")
    : null;

  const originalAction = effectiveAction(originalForm, originalSubmitter);
  const action = effectiveAction(currentForm, currentSubmitter);
  const actionDynamicallyChanged =
    extractOrigin(originalAction) !== extractOrigin(action);
  const hasCredentialFields = formHasCredentialFields(form);
  const isCrossOrigin = isCrossOriginUrl(action);

  if (!((hasCredentialFields && isCrossOrigin) || actionDynamicallyChanged)) {
    return null;
  }

  return {
    ts: Date.now(),
    hasCredentialFields,
    isCrossOrigin,
    actionDynamicallyChanged,
    destinationOrigin: extractOrigin(action),
  };
}

function currentContext(): SubmitContext | null {
  return _contexts.length > 0 ? _contexts[_contexts.length - 1]! : null;
}

function beginContext(form: HTMLFormElement, submitter: HTMLElement | null): SubmitContext {
  const context: SubmitContext = {
    form,
    submitter,
    supplementalSignal: inspectSubmit(form, submitter),
    coreEmitted: false,
  };
  _contexts.push(context);
  return context;
}

function finishContext(context: SubmitContext): void {
  if (context.supplementalSignal && !context.coreEmitted && _config?.mode !== "off") {
    _config?.postSignal("ns-js-form-submit-suspicious", context.supplementalSignal);
  }

  const index = _contexts.lastIndexOf(context);
  if (index >= 0) _contexts.splice(index, 1);
}

function installProvenanceTracking(): void {
  if (_observer) return;

  const existing = document.querySelectorAll("form, button, input, [formaction]");
  for (let i = 0; i < existing.length; i++) {
    const element = existing[i];
    if (element instanceof HTMLElement) recordSelf(element);
  }

  _observer = new MutationObserver(processMutations);
  _observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ["action", "formaction"],
  });

  _beginSubmitListener = (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const submitter = (event as SubmitEvent).submitter;
    beginContext(form, submitter instanceof HTMLElement ? submitter : null);
  };
  document.addEventListener("submit", _beginSubmitListener, true);
}

function installSubmitCompletion(): void {
  if (_endSubmitListener) return;

  _endSubmitListener = (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    const context = currentContext();
    if (context?.form === form) finishContext(context);
  };
  document.addEventListener("submit", _endSubmitListener, true);

  _coreSubmitFn = HTMLFormElement.prototype.submit;
  _supplementalSubmitFn = function (this: HTMLFormElement): void {
    const context = beginContext(this, null);
    try {
      _coreSubmitFn?.call(this);
    } finally {
      finishContext(context);
    }
  };

  try {
    HTMLFormElement.prototype.submit = _supplementalSubmitFn;
  } catch {
    _coreSubmitFn = null;
    _supplementalSubmitFn = null;
  }
}

/** Initialize the enabled monitor with mutation-timing-safe action provenance. */
export function initJsBehaviorMonitor(config: JsBehaviorMonitorConfig): void {
  _config = config;

  if (config.mode !== "off") installProvenanceTracking();

  initCoreMonitor({
    ...config,
    postSignal(type, payload) {
      if (type === "ns-js-form-submit-suspicious") {
        const context = currentContext();
        if (context) {
          context.coreEmitted = true;
          if (context.supplementalSignal) {
            config.postSignal(type, { ...payload, ...context.supplementalSignal });
            return;
          }
        }
      }
      config.postSignal(type, payload);
    },
  });

  if (config.mode !== "off") installSubmitCompletion();
}

/** Reset both provenance and core monitor state. Exposed for tests only. */
export function _resetState(): void {
  if (_supplementalSubmitFn && _coreSubmitFn) {
    try {
      if (HTMLFormElement.prototype.submit === _supplementalSubmitFn) {
        HTMLFormElement.prototype.submit = _coreSubmitFn;
      }
    } catch {
      // Hardened prototypes degrade without preventing core teardown.
    }
  }

  if (_observer) _observer.disconnect();
  if (_beginSubmitListener) {
    document.removeEventListener("submit", _beginSubmitListener, true);
  }
  if (_endSubmitListener) {
    document.removeEventListener("submit", _endSubmitListener, true);
  }

  _config = null;
  _observer = null;
  _beginSubmitListener = null;
  _endSubmitListener = null;
  _coreSubmitFn = null;
  _supplementalSubmitFn = null;
  _contexts = [];
  _originalFormActions = new WeakMap<HTMLFormElement, ActionSnapshot>();
  _originalSubmitterActions = new WeakMap<HTMLElement, ActionSnapshot>();

  resetCoreState();
}
