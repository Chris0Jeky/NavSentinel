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

type SubmitContext = {
  form: HTMLFormElement;
  submitter: HTMLElement | null;
  dynamicSignal: Record<string, unknown> | null;
  coreEmitted: boolean;
};

let _config: JsBehaviorMonitorConfig | null = null;
let _observer: MutationObserver | null = null;
let _beginSubmitListener: ((event: Event) => void) | null = null;
let _endSubmitListener: ((event: Event) => void) | null = null;
let _coreSubmitFn: typeof HTMLFormElement.prototype.submit | null = null;
let _supplementalSubmitFn: typeof HTMLFormElement.prototype.submit | null = null;
let _contexts: SubmitContext[] = [];
let _originalFormActions = new WeakMap<HTMLFormElement, string>();
let _originalSubmitterActions = new WeakMap<HTMLElement, string>();

function recordFormAction(
  form: HTMLFormElement,
  action = form.getAttribute("action") ?? "",
): void {
  if (!_originalFormActions.has(form)) {
    _originalFormActions.set(form, action);
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
  action = submitter.getAttribute("formaction") ?? "",
): void {
  if (isPotentialSubmitter(submitter) && !_originalSubmitterActions.has(submitter)) {
    _originalSubmitterActions.set(submitter, action);
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
      recordFormAction(mutation.target, mutation.oldValue ?? "");
    } else if (
      mutation.attributeName === "formaction" &&
      mutation.target instanceof HTMLElement
    ) {
      recordSubmitterAction(mutation.target, mutation.oldValue ?? "");
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

function resolveAction(raw: string): string {
  if (!raw.trim()) return location.href;
  try {
    return new URL(raw, document.baseURI).toString();
  } catch {
    return location.href;
  }
}

function actionOrigin(raw: string): string {
  return raw.trim() ? extractOrigin(raw) : location.origin;
}

function inspectSubmit(
  form: HTMLFormElement,
  submitter: HTMLElement | null,
): Record<string, unknown> | null {
  flushMutations();
  recordFormAction(form);
  if (submitter) recordSubmitterAction(submitter);

  const formAction = form.getAttribute("action") ?? "";
  const submitterOverrides = submitter?.hasAttribute("formaction") ?? false;
  const submitterAction = submitter?.getAttribute("formaction") ?? "";

  const formChanged =
    !submitterOverrides &&
    (_originalFormActions.get(form) ?? "") !== formAction &&
    actionOrigin(_originalFormActions.get(form) ?? "") !== actionOrigin(formAction);
  const submitterChanged =
    !!submitter &&
    (_originalSubmitterActions.get(submitter) ?? "") !== submitterAction &&
    actionOrigin(_originalSubmitterActions.get(submitter) ?? "") !==
      actionOrigin(submitterAction);

  if (!formChanged && !submitterChanged) return null;

  const action = resolveAction(submitterOverrides ? submitterAction : formAction);
  return {
    ts: Date.now(),
    hasCredentialFields: formHasCredentialFields(form),
    isCrossOrigin: isCrossOriginUrl(action),
    actionDynamicallyChanged: true,
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
    dynamicSignal: inspectSubmit(form, submitter),
    coreEmitted: false,
  };
  _contexts.push(context);
  return context;
}

function finishContext(context: SubmitContext): void {
  if (context.dynamicSignal && !context.coreEmitted && _config?.mode !== "off") {
    _config?.postSignal("ns-js-form-submit-suspicious", context.dynamicSignal);
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
          if (context.dynamicSignal) {
            config.postSignal(type, { ...payload, ...context.dynamicSignal });
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
  _originalFormActions = new WeakMap<HTMLFormElement, string>();
  _originalSubmitterActions = new WeakMap<HTMLElement, string>();

  resetCoreState();
}
