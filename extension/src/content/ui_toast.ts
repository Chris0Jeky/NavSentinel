export type ToastAction = {
  label: string;
  onClick: () => void;
};

type ToastOptions = {
  message: string;
  actions?: ToastAction[];
  timeoutMs?: number;
  onDismiss?: () => void;
};

let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;

function ensureHost() {
  if (host && root) return;

  host = document.createElement("div");
  host.id = "__navsentinel_toast_host";
  host.style.all = "initial";
  host.style.position = "fixed";
  host.style.right = "16px";
  host.style.bottom = "16px";
  host.style.zIndex = "2147483647";

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
  `;
  root.appendChild(style);

  document.documentElement.appendChild(host);
}

export function showToast(opts: ToastOptions) {
  ensureHost();
  if (!root) return;

  root.querySelectorAll(".wrap").forEach((n) => n.remove());

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
