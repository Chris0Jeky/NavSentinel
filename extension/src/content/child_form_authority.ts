import { FormAttemptGate, clickFormBinding, resolveFormIntent } from "./form_intent";
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
  private generation = 0;
  private blocked = new Map<string, BlockedForm>();
  private replay: { intent: FormIntent; expiresAt: number } | null = null;
  constructor(private deps: Dependencies) {}

  private id(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("");
  }
  private cancel(id = this.currentId): void {
    if (!id || id !== this.currentId) return;
    this.currentId = undefined;
    this.gate.clear();
    this.replay = null;
    void chrome.runtime.sendMessage({ type: "ns-form-intent-cancel", attemptId: id }).catch(() => {});
  }
  reset(): void {
    this.generation++;
    this.cancel();
    this.gate.clear();
    this.blocked.clear();
    this.replay = null;
  }
  private arm(attemptId: string, formIntent: FormIntent): Promise<boolean> {
    this.currentId = attemptId;
    return chrome.runtime.sendMessage({ type: "ns-form-intent", attemptId, formIntent, issuedAt: Date.now() })
      .then(reply => reply?.ok === true, () => false);
  }
  /** Called only after the existing synchronous click policy decided allow. */
  approvedClick(event: MouseEvent): FormIntent | null {
    this.generation++;
    this.cancel();
    this.gate.clear();
    if (!this.deps.enabled() || !event.isTrusted) return null;
    const binding = clickFormBinding(event);
    if (!binding) return null;
    const { intent } = binding;
    if (!isHttpFormIntent(intent)) return intent;
    const attemptId = this.id();
    const now = Date.now();
    this.gestureTime = event.timeStamp;
    this.gate.capture(binding, event.timeStamp, now);
    this.gate.authorize(attemptId, intent, event.timeStamp, now);
    void this.arm(attemptId, intent).then(ok => { if (!ok) this.cancel(attemptId); });
    this.deps.post("ns-allow-form", { attemptId, formIntent: intent, gestureTime: event.timeStamp });
    return intent;
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
  handleBridge(data: { type?: string; id?: string; attemptId?: string; gestureTime?: number; formIntent?: unknown }): boolean {
    if (data.type === "ns-form-replay-rejected") { this.deps.reject(); return true; }
    if (data.type === "ns-form-intent-cancel") {
      if (data.attemptId === this.currentId || (data.gestureTime !== undefined && data.gestureTime === this.gestureTime)) this.cancel();
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
    const generation = ++this.generation;
    void this.arm(attemptId, entry.intent).then(ok => {
      const fresh = ok && generation === this.generation && this.deps.enabled() && entry.expiresAt > Date.now();
      if (fresh) this.replay = { intent: entry.intent, expiresAt: Date.now() + FORM_INTENT_TTL_MS };
      else this.cancel(attemptId);
      this.deps.post("ns-form-replay-ready", { id: data.id, attemptId, ok: fresh });
    });
    return true;
  }
  invalid(): void {
    this.generation++;
    this.cancel();
    this.gate.clear();
    this.replay = null;
  }
  /** Native default submits share the same tuple/identity gate as wrappers. */
  submit(event: SubmitEvent): void {
    if (!this.deps.enabled() || !(event.target instanceof HTMLFormElement)) return;
    let intent: FormIntent | null = null;
    try { intent = resolveFormIntent(event.target, event.submitter); } catch { /* fail closed below */ }
    if (intent && (intent.targetScope === "self" || intent.method === "dialog")) {
      this.cancel();
      this.gate.clear();
      return;
    }
    const spent = intent ? this.gate.consume(event.target, event.submitter, intent, Date.now()) : { allowed: false };
    const replay = this.replay;
    this.replay = null;
    if (event.isTrusted && intent && (spent.allowed || (replay && replay.expiresAt > Date.now() && sameFormIntent(replay.intent, intent)))) return;
    this.cancel();
    event.preventDefault();
    event.stopImmediatePropagation();
    this.deps.reject();
  }
}
