import { FORM_INTENT_MAX_URL, FORM_INTENT_TTL_MS, sameFormIntent, type FormIntent } from "../shared/form_intent";

// Captured Web-IDL getters preserve branding and avoid form named-property
// clobbering (a control may itself be called `action`, `method`, or `target`).
const formAction = Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, "action")!.get!;
const buttonType = Object.getOwnPropertyDescriptor(HTMLButtonElement.prototype, "type")!.get!;
const inputType = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "type")!.get!;
const buttonForm = Object.getOwnPropertyDescriptor(HTMLButtonElement.prototype, "form")!.get!;
const inputForm = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "form")!.get!;
const implicitSubmissionInput = /^(?:text|search|tel|url|email|password|date|month|week|time|datetime-local|number)$/;

export function submitControlForm(control: HTMLElement): HTMLFormElement | null | false {
  if (control.localName === "button" && buttonType.call(control) === "submit") return buttonForm.call(control);
  if (control.localName === "input" && ["submit", "image"].includes(inputType.call(control))) return inputForm.call(control);
  return false;
}

export function validateFormReceiver(form: HTMLFormElement, submitter?: HTMLElement | null): void {
  formAction.call(form); // Native TypeError on an invalid receiver, with no submit side effect.
  if (submitter === null || submitter === undefined) return;
  const owner = submitControlForm(submitter);
  if (owner === false) throw new TypeError("The specified element is not a submit button.");
  if (owner !== form) throw new DOMException("The submitter is not owned by this form.", "NotFoundError");
}

/** WHATWG form submission attributes: present-empty overrides, missing inherits. */
export function resolveFormIntent(form: HTMLFormElement, submitter?: HTMLElement | null): FormIntent | null {
  validateFormReceiver(form, submitter);
  const doc = form.ownerDocument;
  const view = doc.defaultView;
  if (!view) return null;
  const override = (buttonAttr: string, formAttr: string) =>
    submitter?.getAttribute(buttonAttr) ?? form.getAttribute(formAttr);
  const rawAction = override("formaction", "action");
  if (rawAction && rawAction.length > FORM_INTENT_MAX_URL) return null;
  let actionUrl: string;
  try { actionUrl = new URL(rawAction || doc.URL, rawAction ? doc.baseURI : doc.URL).href; }
  catch { return null; }
  if (actionUrl.length > FORM_INTENT_MAX_URL) return null;
  const rawMethod = (override("formmethod", "method") ?? "").toLowerCase();
  const method = rawMethod === "post" || rawMethod === "dialog" ? rawMethod : "get";
  const rawEnctype = (override("formenctype", "enctype") ?? "").toLowerCase();
  const enctype = rawEnctype === "multipart/form-data" || rawEnctype === "text/plain"
    ? rawEnctype : "application/x-www-form-urlencoded";
  let target = override("formtarget", "target") ?? doc.querySelector("base[target]")?.getAttribute("target") ?? "";
  if (target.length > 1024) return null;
  // The platform's dangling-markup target sanitization selects a new context.
  if (/[\n\r\t<]/.test(target)) target = "_blank";
  const lower = target.toLowerCase();
  const special = lower === "_self" || lower === "_top" || lower === "_parent" || lower === "_blank";
  if (special) target = lower;
  let targetScope: FormIntent[4] = "other";
  if (!target || target === "_self" || (!special && target === view.name)) targetScope = "self";
  else if (target === "_top") targetScope = view === view.top ? "self" : "top";
  else if (target === "_parent") targetScope = view === view.parent ? "self" : view.parent === view.top ? "top" : "other";
  return [actionUrl, method, enctype, target, targetScope];
}

export interface FormBinding {
  form: HTMLFormElement;
  submitter: HTMLElement | null;
  intent: FormIntent;
}

export function clickFormBinding(event: MouseEvent): FormBinding | null {
  for (const node of event.composedPath()) {
    if (!(node instanceof HTMLElement)) continue;
    const form = submitControlForm(node);
    if (!form) continue;
    const intent = resolveFormIntent(form, node);
    return intent ? { form, submitter: node, intent } : null;
  }
  return null;
}

/** Bind only the browser's no-submit-button implicit Enter path. */
export function implicitSubmitBinding(event: KeyboardEvent): FormBinding | null {
  if (event.key !== "Enter" || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return null;
  const input = event.composedPath()[0];
  if (!(input instanceof HTMLInputElement) || input.disabled ||
      !implicitSubmissionInput.test(inputType.call(input))) return null;
  const form = inputForm.call(input) as HTMLFormElement | null;
  if (!form) return null;
  let blockers = 0;
  for (const control of form.elements) {
    if (control instanceof HTMLElement && submitControlForm(control) === form) return null;
    if (control instanceof HTMLInputElement && !control.disabled &&
        implicitSubmissionInput.test(inputType.call(control)) && ++blockers > 1) return null;
  }
  if (blockers !== 1) return null;
  const intent = resolveFormIntent(form, null);
  return intent ? { form, submitter: null, intent } : null;
}

export function formBindingUnchanged(binding: FormBinding): boolean {
  if (!binding.form.isConnected || (binding.submitter &&
      (!binding.submitter.isConnected || submitControlForm(binding.submitter) !== binding.form))) return false;
  try {
    const current = resolveFormIntent(binding.form, binding.submitter);
    return !!current && sameFormIntent(binding.intent, current);
  } catch { return false; }
}

/** A DOM-identity-bound first-attempt gate. Even a mismatch or expiry burns it. */
export class FormAttemptGate {
  private pending: { binding: FormBinding; gestureTime: number; expiresAt: number; attemptId?: string } | null = null;
  capture(binding: FormBinding | null, gestureTime: number, now: number): void {
    this.pending = binding ? { binding, gestureTime, expiresAt: now + FORM_INTENT_TTL_MS } : null;
  }
  authorize(attemptId: string, intent: FormIntent, gestureTime: number, now: number): boolean {
    const pending = this.pending;
    if (!pending || pending.attemptId || pending.gestureTime !== gestureTime || now >= pending.expiresAt ||
        !sameFormIntent(pending.binding.intent, intent) || !formBindingUnchanged(pending.binding)) return false;
    pending.attemptId = attemptId;
    return true;
  }
  revoke(): { attemptId?: string | undefined; gestureTime?: number | undefined } {
    const pending = this.pending;
    this.pending = null;
    return pending ? { attemptId: pending.attemptId, gestureTime: pending.gestureTime } : {};
  }
  clear(): string | undefined { return this.revoke().attemptId; }
  consume(form: HTMLFormElement, submitter: HTMLElement | null, intent: FormIntent, now: number): { allowed: boolean; attemptId?: string | undefined; gestureTime?: number | undefined } {
    const pending = this.pending;
    this.pending = null;
    const allowed = !!pending?.attemptId && now < pending.expiresAt && pending.binding.form === form &&
      (submitter === null || pending.binding.submitter === submitter) &&
      formBindingUnchanged(pending.binding) && sameFormIntent(pending.binding.intent, intent);
    return { allowed, attemptId: pending?.attemptId, gestureTime: pending?.gestureTime };
  }
}
