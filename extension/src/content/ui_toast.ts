export type ToastAction = {
  label: string;
  onClick: () => void;
};

type ToastOptions = {
  message: string;
  actions?: ToastAction[];
  timeoutMs?: number;
  onDismiss?: () => void;
  /**
   * Opt in to burst coalescing. When several coalescible toasts fire in quick
   * succession on the same page, they collapse into a single small count pill
   * instead of a full card each (reduces dismiss friction on ad-heavy / redirect
   * spam pages). Only set for low-stakes informational block notices — never for
   * interactive prompts or critical safety warnings, which must stay full cards.
   */
  coalesce?: boolean;
};

/** Number of coalescible blocks within the window before collapsing to a pill. */
const COALESCE_THRESHOLD = 3;
/** A coalescible block restarts the count if this long has passed since the last. */
const COALESCE_WINDOW_MS = 8000;
/** Pill auto-removes after this long with no new block. */
const PILL_IDLE_DISMISS_MS = 12000;

let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;

// --- Burst coalescing state (per page, ephemeral, never persisted) ---
let burstCount = 0;
let burstLastAt = 0;
let lastBlockMessage = "";
let pill: HTMLElement | null = null;
let pillCountEl: HTMLElement | null = null;
let pillIdleTimer = 0;
let lastUrl = "";
let navListenersBound = false;

function ensureHost() {
  if (host && root) return;

  host = document.createElement("div");
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

  const style = document.createElement("style");
  style.textContent = `
    .wrap {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif;
      width: 360px;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(245, 166, 35, 0.15);
      border-radius: 12px;
      background: linear-gradient(180deg, #110f13 0%, #08070a 100%);
      color: #f6efe1;
      overflow: hidden;
      border: 1px solid #2a2530;
      animation: ns-slide-up 0.2s ease-out;
    }
    @keyframes ns-slide-up {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .head {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px 0;
    }
    .head-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #f5a623;
      box-shadow: 0 0 8px rgba(245, 166, 35, 0.5);
      animation: pulse 1.6s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    .head-label {
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: #756a5a;
      font-weight: 500;
    }
    .body {
      padding: 8px 12px 10px;
      font-size: 13px;
      line-height: 1.4;
      color: #c4b69c;
    }
    .row {
      display: flex;
      gap: 8px;
      padding: 10px 12px 12px;
      border-top: 1px solid #1c181f;
      justify-content: flex-end;
      flex-wrap: wrap;
    }
    button {
      all: unset;
      cursor: pointer;
      padding: 6px 10px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid #2a2530;
      font-size: 11px;
      font-weight: 500;
      color: #c4b69c;
      transition: background 0.12s;
    }
    button:hover { background: rgba(255, 255, 255, 0.1); }
    button:focus-visible { outline: 2px solid #f5a623; outline-offset: 2px; }
    .danger { background: rgba(208, 69, 49, 0.12); border-color: rgba(208, 69, 49, 0.3); color: #d04531; }
    .danger:hover { background: rgba(208, 69, 49, 0.2); }
    .action { background: rgba(245, 166, 35, 0.1); border-color: rgba(245, 166, 35, 0.25); color: #f5a623; }
    .action:hover { background: rgba(245, 166, 35, 0.18); }
    .pill {
      display: flex;
      align-items: center;
      gap: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(245, 166, 35, 0.15);
      border-radius: 999px;
      background: linear-gradient(180deg, #110f13 0%, #08070a 100%);
      border: 1px solid #2a2530;
      color: #c4b69c;
      padding: 8px 14px;
      font-size: 13px;
      cursor: pointer;
      animation: ns-slide-up 0.2s ease-out;
      transition: opacity 0.4s ease;
      opacity: 1;
    }
    .pill:hover { opacity: 1; }
    .pill.idle { opacity: 0.45; }
    .pill:focus-visible { outline: 2px solid #f5a623; outline-offset: 2px; }
    .pill-count { color: #f5a623; font-weight: 600; }
    @media (prefers-reduced-motion: reduce) {
      .wrap, .pill { animation: none; transition: none; }
      .head-dot { animation: none; }
    }
  `;
  root.appendChild(style);

  document.documentElement.appendChild(host);
  bindNavReset();
}

function removeFullCards(): void {
  root?.querySelectorAll(".wrap").forEach((n) => n.remove());
}

/** Render a standard full toast card (the default, non-coalescing behavior). */
function renderFullCard(opts: ToastOptions): void {
  ensureHost();
  if (!root) return;

  removeFullCards();

  const wrap = document.createElement("div");
  wrap.className = "wrap";
  wrap.setAttribute("role", "alert");

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
  let dismissed = false;

  const dismiss = document.createElement("button");
  dismiss.className = "danger";
  dismiss.textContent = "Dismiss";
  dismiss.addEventListener("click", () => {
    if (dismissed) return;
    dismissed = true;
    wrap.remove();
    if (!actionClicked && opts.onDismiss) {
      opts.onDismiss();
    }
  });

  const actions = opts.actions ?? [];
  for (const a of actions) {
    const btn = document.createElement("button");
    btn.className = "action";
    btn.textContent = a.label;
    btn.addEventListener("click", () => {
      actionClicked = true;
      try { a.onClick(); } finally { wrap.remove(); }
    });
    row.appendChild(btn);
  }

  row.appendChild(dismiss);
  wrap.appendChild(head);
  wrap.appendChild(body);
  wrap.appendChild(row);

  root.appendChild(wrap);

  const t = opts.timeoutMs ?? 4000;
  if (t > 0) {
    window.setTimeout(() => {
      if (wrap.parentNode) {
        wrap.remove();
        if (!actionClicked && opts.onDismiss) {
          opts.onDismiss();
        }
      }
    }, t);
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
  lastBlockMessage = "";
  dismissPill();
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

    const expand = () => renderFullCard({
      message: `${lastBlockMessage} …and ${burstCount - 1} earlier blocked.`,
      onDismiss: () => resetBurst(),
    });
    pill.addEventListener("click", expand);
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
  lastBlockMessage = opts.message;

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

/** Test-only: clear burst/pill state between cases. */
export function _resetToastBurstState(): void {
  resetBurst();
}
