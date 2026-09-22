import { FormAttemptGate, clickFormBinding, implicitSubmitBinding, resolveFormIntent, type FormBinding } from "./form_intent";
import { FORM_INTENT_TTL_MS, isFormIntent, isHttpFormIntent, sameFormIntent, type FormIntent } from "../shared/form_intent";

interface Dependencies {
  enabled: () => boolean;
  post: (type: string, payload?: Record<string, unknown>) => void;
  reject: () => void;
}
interface BlockedForm { intent: FormIntent; expiresAt: number; approved: boolean }

/** Isolated-world authority. No MAIN message by itself can approve a form replay. */
export class ChildFormAuthority {
  private gate = new FormAttemptGate();
  private currentId: string | undefined;
  private gestureTime = -1;
  private blocked = new Map<string, BlockedForm>();
  private replay: { intent: FormIntent; expiresAt: number } | null = null;
  constructor(private deps: Dependencies) {
    window.addEventListener("keydown", event => {
      const binding = deps.enabled() && event.isTrusted ? implicitSubmitBinding(event) : null;
      if (!binding) return;
      this.invalid();
      this.approveBinding(binding, event.timeStamp);
    }, true);
  }

  private id(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("");
  }
  private cancel(id = this.currentId, submitted?: number): void {
    if (!id || id !== this.currentId) return;
    if (!submitted) {
      this.currentId = undefined;
      this.gate.clear();
      this.replay = null;
    }
    void chrome.runtime.sendMessage({ type: "ns-form-intent-cancel", attemptId: id, s: submitted }).catch(() => {});
  }
  reset(): void {
    this.invalid();
    this.blocked.clear();
  }
  private arm(attemptId: string, formIntent: FormIntent): Promise<boolean> {
    this.currentId = attemptId;
    return chrome.runtime.sendMessage({ type: "ns-form-intent", attemptId, formIntent, issuedAt: Date.now() })
      .then(reply => reply?.ok === true, () => false);
  }
  private approveBinding(binding: FormBinding, gestureTime: number): FormIntent {
    const { intent } = binding;
    if (!isHttpFormIntent(intent)) return intent;
    const attemptId = this.id();
    const now = Date.now();
    this.gestureTime = gestureTime;
    this.gate.capture(binding, gestureTime, now);
    this.gate.authorize(attemptId, intent, gestureTime, now);
    void this.arm(attemptId, intent).then(ok => { if (!ok) this.cancel(attemptId); });
    this.deps.post("ns-allow-form", { attemptId, formIntent: intent, gestureTime });
    return intent;
  }
  /** Called only after the existing synchronous click policy decided allow. */
  approvedClick(event: MouseEvent): FormIntent | null {
    this.invalid();
    if (!this.deps.enabled() || !event.isTrusted) return null;
    const binding = clickFormBinding(event);
    return binding ? this.approveBinding(binding, event.timeStamp) : null;
  }
  recordBlocked(data: { id?: string; kind?: string; formIntent?: unknown }): void {
    if (!this.deps.enabled() || !data.id || data.id.length > 128 ||
        !["form_submit", "form_request_submit"].includes(data.kind ?? "") || !isFormIntent(data.formIntent)) return;
    const now = Date.now();
    for (const [id, entry] of this.blocked) if (entry.expiresAt <= now) this.blocked.delete(id);
    if (this.blocked.size >= 256) this.blocked.delete(this.blocked.keys().next().value!);
    this.blocked.set(data.id, { intent: data.formIntent, expiresAt: now + 5000, approved: false });
  }
  /** User-owned action path; suppress generic ns-allow-nav for a form action. */
  approveAction(id: string): boolean {
    const entry = this.blocked.get(id);
    if (!entry) return false;
    if (entry.expiresAt > Date.now() && this.deps.enabled()) entry.approved = true;
    return true;
  }
  handleBridge(data: { type?: string; id?: string; attemptId?: string; gestureTime?: number; s?: number; formIntent?: unknown }): boolean {
    if (data.type === "ns-form-replay-rejected") { this.deps.reject(); return true; }
    if (data.type === "ns-form-intent-cancel") {
      if (data.s === 1) this.cancel(data.attemptId, 1);
      else if (data.attemptId === this.currentId || data.gestureTime === this.gestureTime) this.cancel();
      return true;
    }
    if (data.type !== "ns-form-replay-request") return false;
    const entry = data.id ? this.blocked.get(data.id) : undefined;
    if (data.id) this.blocked.delete(data.id);
    if (!entry?.approved || entry.expiresAt <= Date.now() || !this.deps.enabled() ||
        !isFormIntent(data.formIntent) || !sameFormIntent(entry.intent, data.formIntent) || !isHttpFormIntent(entry.intent)) {
      this.deps.post("ns-form-replay-ready", { id: data.id, ok: false });
      return true;
    }
    this.cancel();
    const attemptId = this.id();
    void this.arm(attemptId, entry.intent).then(ok => {
      const fresh = ok && this.currentId === attemptId && this.deps.enabled() && entry.expiresAt > Date.now();
      if (fresh) this.replay = { intent: entry.intent, expiresAt: Date.now() + FORM_INTENT_TTL_MS };
      else this.cancel(attemptId);
      this.deps.post("ns-form-replay-ready", { id: data.id, attemptId, ok: fresh });
    });
    return true;
  }
  invalid(): void {
    this.cancel();
  }
  /** Native default submits share the same tuple/identity gate as wrappers. */
  submit(event: SubmitEvent): void {
    if (!this.deps.enabled() || !(event.target instanceof HTMLFormElement)) return;
    let intent: FormIntent | null = null;
    try { intent = resolveFormIntent(event.target, event.submitter); } catch { /* fail closed below */ }
    if (intent && (intent[4] === "self" || intent[1] === "dialog")) {
      this.invalid();
      return;
    }
    const spent = intent ? this.gate.consume(event.target, event.submitter, intent, Date.now()) : { allowed: false };
    const replay = this.replay;
    this.replay = null;
    if (event.isTrusted && intent && (spent.allowed || replay && replay.expiresAt > Date.now() && sameFormIntent(replay.intent, intent))) {
      // A capture listener runs before the page's submit listeners. They may
      // still cancel this event and start a different form navigation with the
      // same URL. Report a source submission only after dispatch has settled.
      const attemptId = this.currentId;
      setTimeout(() => this.cancel(attemptId, event.defaultPrevented ? undefined : 1), 0);
      return;
    }
    this.cancel();
    event.preventDefault();
    event.stopImmediatePropagation();
    this.deps.reject();
  }
}
