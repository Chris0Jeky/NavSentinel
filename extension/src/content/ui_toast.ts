import { registerExtensionOwnedOverlayElement } from "./extension_owned_overlay";

export type ToastAction = {
  label: string;
  onClick: () => void;
};

type ToastOptions = {
  message: string;
  actions?: ToastAction[] | undefined;
  timeoutMs?: number;
  onDismiss?: () => void;
  /** Keep this card beside later warnings until its own action/dismissal. */
  persistent?: boolean;
  /**
   * Opt in to burst coalescing. When several coalescible toasts fire in quick
   * succession on the same page, they collapse into a single small count pill
   * instead of a full card each (reduces dismiss friction on ad-heavy / redirect
   * spam pages). Only set for low-stakes informational block notices — never for
   * interactive prompts or critical safety warnings, which must stay full cards.
   */
  coalesce?: boolean;
  /**
   * Render a low-stakes recovery action as a small status chip. It has no
   * redundant Dismiss control and leaves after two seconds or the next trusted
   * pointer interaction outside the chip. Passive removal never invokes
   * `onDismiss` or any recovery action.
   */
  briefRecovery?: boolean;
};

/** Number of coalescible blocks within the window before collapsing to a pill. */
const COALESCE_THRESHOLD = 3;
/** A coalescible block restarts the count if this long has passed since the last. */
const COALESCE_WINDOW_MS = 8000;
/** Pill auto-removes after this long with no new block. */
const PILL_IDLE_DISMISS_MS = 12000;
const BRIEF_RECOVERY_DISMISS_MS = 2000;

let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;
const controlActions = new WeakMap<EventTarget, () => void>();
const cardRemovers = new WeakMap<HTMLElement, (notifyDismiss?: boolean) => void>();
let nextControlAction = 0;

// --- Burst coalescing state (per page, ephemeral, never persisted) ---
let burstCount = 0;
let burstLastAt = 0;
// The most recent coalesced toast, kept so the pill can expand back into the
// latest prompt's full actions (e.g. Allow once / Always allow on a blocked popup).
let lastCoalescedOpts: ToastOptions | null = null;
let pill: HTMLElement | null = null;
let pillCountEl: HTMLElement | null = null;
let pillIdleTimer = 0;
let lastUrl = "";
let navListenersBound = false;

function isolateInteraction(event: Event): void {
  event.stopPropagation();
  event.stopImmediatePropagation();
  if (event.type === "click" || event.type === "auxclick" || event.type === "contextmenu") {
    event.preventDefault();
  }
}

function bindControl(control: HTMLElement, action: () => void): void {
  control.dataset.nsUiAction = String(++nextControlAction);
  controlActions.set(control, action);
  control.addEventListener("click", action);
}

/** Invoke only a control token delivered by the verified MAIN-world bridge. */
function activateToastControl(id?: string): void {
  if (!root || !id || id.length > 16) return;
  const controls = root.querySelectorAll<HTMLElement>("[data-ns-ui-action]");
  for (let index = 0; index < controls.length; index += 1) {
    const control = controls.item(index);
    if (control.dataset.nsUiAction !== id) continue;
    controlActions.get(control)?.();
    return;
  }
}

function ensureHost() {
  if (host && root) return;

  host = document.createElement("div");
  registerExtensionOwnedOverlayElement(host);
  host.id = "__navsentinel_toast_host";
  host.style.all = "initial";
  host.style.position = "fixed";
  host.style.right = "16px";
  host.style.bottom = "16px";
  host.style.zIndex = "2147483647";
  // Stack multiple notices (e.g. a prompt above the burst pill) without overlap.
  host.style.display = "flex";
  host.style.flexDirection = "column";
  host.style.alignItems = "flex-end";
  host.style.gap = "8px";

  root = host.attachShadow({ mode: "open" });

  // UI events are composed across a shadow boundary by default. The MAIN-world
  // guard consumes trusted input before hostile capture listeners; this root
  // remains the fallback boundary for non-browser unit DOMs.
  for (const type of [
    "pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend",
    "click", "dblclick", "auxclick", "contextmenu", "keydown", "keyup",
  ]) {
    root.addEventListener(type, isolateInteraction);
  }

  const style = document.createElement("style");
  // This literal ships verbatim, so compact CSS avoids consuming the extension size budget.
  style.textContent = `.wrap{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI Variable','Segoe UI',system-ui,sans-serif;width:360px;box-shadow:0 8px 28px rgba(0,0,0,0.4),0 0 0 1px rgba(245,166,35,0.15);border-radius:12px;background:linear-gradient(180deg,#110f13 0%,#08070a 100%);color:#f6efe1;overflow:hidden;border:1px solid #2a2530;animation:ns-slide-up 0.2s ease-out;}@keyframes ns-slide-up{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}.head{display:flex;align-items:center;gap:8px;padding:10px 12px 0;}.head-dot{width:6px;height:6px;border-radius:50%;background:#f5a623;box-shadow:0 0 8px rgba(245,166,35,0.5);animation:pulse 1.6s infinite;}@keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.4;}}.head-label{font-size:9px;text-transform:uppercase;letter-spacing:0.14em;color:#756a5a;font-weight:500;}.body{padding:8px 12px 10px;font-size:13px;line-height:1.4;color:#c4b69c;}.row{display:flex;gap:8px;padding:10px 12px 12px;border-top:1px solid #1c181f;justify-content:flex-end;flex-wrap:wrap;}button{all:unset;cursor:pointer;padding:6px 10px;border-radius:6px;background:rgba(255,255,255,0.05);border:1px solid #2a2530;font-size:11px;font-weight:500;color:#c4b69c;transition:background 0.12s;}button:hover{background:rgba(255,255,255,0.1);}button:focus-visible{outline:2px solid #f5a623;outline-offset:2px;}.danger{background:rgba(208,69,49,0.12);border-color:rgba(208,69,49,0.3);color:#d04531;}.danger:hover{background:rgba(208,69,49,0.2);}.action{background:rgba(245,166,35,0.1);border-color:rgba(245,166,35,0.25);color:#f5a623;}.action:hover{background:rgba(245,166,35,0.18);}.brief-recovery{width:min(280px,calc(100vw - 24px));display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;border-radius:9px;}.brief-recovery .head{padding:0 0 0 10px;}.brief-recovery .head-label{display:none;}.brief-recovery .body{padding:8px 7px;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}.brief-recovery .row{padding:5px 7px 5px 0;border:0;flex-wrap:nowrap;}.brief-recovery button{padding:4px 7px;font-size:10px;}.pill{display:flex;align-items:center;gap:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI Variable','Segoe UI',system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,0.4),0 0 0 1px rgba(245,166,35,0.15);border-radius:999px;background:linear-gradient(180deg,#110f13 0%,#08070a 100%);border:1px solid #2a2530;color:#c4b69c;padding:8px 14px;font-size:13px;cursor:pointer;animation:ns-slide-up 0.2s ease-out;transition:opacity 0.4s ease;opacity:1;}.pill:hover{opacity:1;}.pill.idle{opacity:0.45;}.pill:focus-visible{outline:2px solid #f5a623;outline-offset:2px;}.pill-count{color:#f5a623;font-weight:600;}@media (prefers-reduced-motion:reduce){.wrap,.pill{animation:none;transition:none;}.head-dot{animation:none;}}`;
  root.appendChild(style);

  document.documentElement.appendChild(host);
  bindNavReset();
}

function removeCard(card: HTMLElement, notifyDismiss = false): void {
  const remove = cardRemovers.get(card);
  if (remove) {
    remove(notifyDismiss);
  } else {
    card.remove();
  }
}

function removeFullCards(): void {
  root?.querySelectorAll<HTMLElement>(".wrap:not([data-persistent='true'])")
    .forEach((card) => removeCard(card));
}

/** Render a standard full toast card (the default, non-coalescing behavior). */
function renderFullCard(opts: ToastOptions): void {
  ensureHost();
  if (!root) return;

  removeFullCards();
  if (opts.persistent) {
    root.querySelectorAll<HTMLElement>(".wrap[data-persistent='true']")
      .forEach((card) => removeCard(card));
  }

  const wrap = document.createElement("div");
  wrap.className = opts.briefRecovery ? "wrap brief-recovery" : "wrap";
  wrap.setAttribute("role", opts.briefRecovery ? "status" : "alert");
  if (opts.briefRecovery) {
    wrap.setAttribute("aria-live", "polite");
    wrap.setAttribute("aria-atomic", "true");
    wrap.setAttribute("aria-label", `NavSentinel: ${opts.message}`);
  }
  if (opts.persistent) wrap.dataset.persistent = "true";

  const head = document.createElement("div");
  head.className = "head";
  const dot = document.createElement("span");
  dot.className = "head-dot";
  const label = document.createElement("span");
  label.className = "head-label";
  label.textContent = "NavSentinel";
  head.appendChild(dot);
  head.appendChild(label);

  const body = document.createElement("div");
  body.className = "body";
  body.textContent = opts.message;

  const row = document.createElement("div");
  row.className = "row";

  let actionClicked = false;
  let removed = false;
  let timeout = 0;
  let outsidePointerDown: ((event: PointerEvent) => void) | null = null;
  const remove = (notifyDismiss = false) => {
    if (removed) return;
    removed = true;
    if (timeout) window.clearTimeout(timeout);
    if (outsidePointerDown) {
      document.removeEventListener("pointerdown", outsidePointerDown, true);
    }
    cardRemovers.delete(wrap);
    wrap.remove();
    if (notifyDismiss && !actionClicked && opts.onDismiss) opts.onDismiss();
  };
  cardRemovers.set(wrap, remove);

  const actions = opts.actions ?? [];
  for (const a of actions) {
    const btn = document.createElement("button");
    btn.className = "action";
    btn.textContent = a.label;
    bindControl(btn, () => {
      actionClicked = true;
      try { a.onClick(); } finally {
        remove();
      }
    });
    row.appendChild(btn);
  }

  if (!opts.briefRecovery) {
    const dismiss = document.createElement("button");
    dismiss.className = "danger";
    dismiss.textContent = "Dismiss";
    bindControl(dismiss, () => remove(true));
    row.appendChild(dismiss);
  }
  wrap.appendChild(head);
  wrap.appendChild(body);
  wrap.appendChild(row);

  root.appendChild(wrap);

  if (opts.briefRecovery) {
    outsidePointerDown = (event: PointerEvent) => {
      if (!event.isTrusted || event.composedPath().includes(wrap)) return;
      remove();
    };
    document.addEventListener("pointerdown", outsidePointerDown, true);
  }

  const t = opts.timeoutMs ?? (opts.briefRecovery ? BRIEF_RECOVERY_DISMISS_MS : 4000);
  if (t > 0) {
    timeout = window.setTimeout(() => remove(!opts.briefRecovery), t);
  }
}

// --- Burst coalescing ---

function bindNavReset(): void {
  if (navListenersBound) return;
  navListenersBound = true;
  lastUrl = location.href;
  const reset = () => resetBurst();
  window.addEventListener("popstate", reset);
  window.addEventListener("pagehide", reset);
  window.addEventListener("hashchange", reset);
}

/** A navigation starts a clean slate so a new page never inherits a stale count. */
function maybeResetOnNavigation(): void {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    resetBurst();
  }
}

function resetBurst(): void {
  burstCount = 0;
  burstLastAt = 0;
  lastCoalescedOpts = null;
  dismissPill();
}

/**
 * Expand the pill back into the latest blocked prompt as a full card, carrying
 * its actions (Allow once / Always allow) so a wrongly-blocked popup can still be
 * allowed. Acting on it — or dismissing — clears the whole burst.
 */
function buildExpandedOpts(): ToastOptions {
  const latest = lastCoalescedOpts;
  const earlier = Math.max(0, burstCount - 1);
  const base = latest?.message ?? "Blocked navigations";
  const message = earlier > 0 ? `${base}  ·  +${earlier} more blocked` : base;
  const wrap = (a: ToastAction): ToastAction => ({
    label: a.label,
    onClick: () => { try { a.onClick(); } finally { resetBurst(); } },
  });
  return {
    message,
    ...(latest?.actions ? { actions: latest.actions.map(wrap) } : {}),
    onDismiss: () => { try { latest?.onDismiss?.(); } finally { resetBurst(); } },
  };
}

function dismissPill(): void {
  if (pillIdleTimer) {
    window.clearTimeout(pillIdleTimer);
    pillIdleTimer = 0;
  }
  pill?.remove();
  pill = null;
  pillCountEl = null;
}

function pluralNavigations(n: number): string {
  const shown = n > 99 ? "99+" : String(n);
  return n === 1 ? "1 navigation" : `${shown} navigations`;
}

function schedulePillIdleDismiss(): void {
  if (pillIdleTimer) window.clearTimeout(pillIdleTimer);
  pill?.classList.remove("idle");
  pillIdleTimer = window.setTimeout(() => {
    // First fade, then remove, so the user gets a final glimpse.
    pill?.classList.add("idle");
    pillIdleTimer = window.setTimeout(() => resetBurst(), 600);
  }, PILL_IDLE_DISMISS_MS);
}

function showOrUpdatePill(): void {
  ensureHost();
  if (!root) return;
  removeFullCards();

  if (!pill) {
    pill = document.createElement("div");
    pill.className = "pill";
    pill.setAttribute("role", "status");
    pill.setAttribute("aria-live", "polite");
    pill.setAttribute("aria-atomic", "true");
    pill.tabIndex = 0;

    const dot = document.createElement("span");
    dot.className = "head-dot";
    const text = document.createElement("span");
    text.append("NavSentinel blocked ");
    pillCountEl = document.createElement("span");
    pillCountEl.className = "pill-count";
    text.appendChild(pillCountEl);

    pill.appendChild(dot);
    pill.appendChild(text);

    const expand = () => {
      const expanded = buildExpandedOpts();
      dismissPill(); // swap the pill for the full card; acting/dismissing resets
      renderFullCard(expanded);
    };
    bindControl(pill, expand);
    pill.addEventListener("keydown", (e) => {
      if (e instanceof KeyboardEvent && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        expand();
      }
    });

    root.appendChild(pill);
  }

  if (pillCountEl) pillCountEl.textContent = pluralNavigations(burstCount);
  pill.setAttribute("aria-label", `NavSentinel blocked ${pluralNavigations(burstCount)}. Activate for details.`);
  schedulePillIdleDismiss();
}

function handleCoalescible(opts: ToastOptions): void {
  const now = Date.now();
  maybeResetOnNavigation();

  if (burstLastAt > 0 && now - burstLastAt <= COALESCE_WINDOW_MS) {
    burstCount += 1;
  } else {
    // Window expired (or first block): start a fresh burst.
    burstCount = 1;
    dismissPill();
  }
  burstLastAt = now;
  lastCoalescedOpts = opts;

  if (burstCount >= COALESCE_THRESHOLD) {
    showOrUpdatePill();
  } else {
    renderFullCard(opts);
  }
}

export function showToast(opts: ToastOptions) {
  if (opts.coalesce) {
    handleCoalescible(opts);
    return;
  }
  renderFullCard(opts);
}

/** Show the bounded, low-stakes recovery surface for automatic overlay cleanup. */
export function showOverlayCleanupToast(onUndo: () => void): void {
  showToast({
    message: "Overlay hidden; still watching.",
    actions: [{ label: "Undo", onClick: onUndo }],
    persistent: true,
    briefRecovery: true,
  });
}

/** Dismiss the cleanup card, or activate one verified token when supplied. */
export function controlToast(id?: string): void {
  if (id) {
    activateToastControl(id);
    return;
  }
  root?.querySelectorAll<HTMLElement>(".wrap[data-persistent='true']")
    .forEach((card) => removeCard(card));
}

/** Test-only: clear burst/pill state between cases. */
export function _resetToastBurstState(): void {
  resetBurst();
}
