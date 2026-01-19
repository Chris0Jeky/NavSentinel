// extension/src/content/ui_toast.ts

export type ToastAction = {
  label: string;
  onClick: () => void;
};

type ToastOptions = {
  message: string;
  actions?: ToastAction[];
  timeoutMs?: number; // 0 disables auto-dismiss
};

let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;

function ensureHost() {
  if (host && root) return;

  host = document.createElement("div");
  host.id = "__navsentinel_toast_host";
  host.style.all = "initial"; // reduce CSS bleed
  host.style.position = "fixed";
  host.style.right = "16px";
  host.style.bottom = "16px";
  host.style.zIndex = "2147483647";

  root = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    .wrap {
      font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      width: 360px;
      box-shadow: 0 8px 28px rgba(0,0,0,0.18);
      border-radius: 14px;
      background: rgba(20,20,20,0.92);
      color: white;
      overflow: hidden;
    }
    .body { padding: 12px 12px 10px 12px; font-size: 13px; line-height: 1.35; }
    .row {
      display: flex;
      gap: 8px;
      padding: 10px 12px 12px 12px;
      border-top: 1px solid rgba(255,255,255,0.12);
      justify-content: flex-end;
      flex-wrap: wrap;
    }
    button {
      all: unset;
      cursor: pointer;
      padding: 7px 10px;
      border-radius: 10px;
      background: rgba(255,255,255,0.10);
      font-size: 12px;
    }
    button:hover { background: rgba(255,255,255,0.18); }
    .danger { background: rgba(255, 80, 80, 0.18); }
    .danger:hover { background: rgba(255, 80, 80, 0.26); }
  `;
  root.appendChild(style);

  document.documentElement.appendChild(host);
}

export function showToast(opts: ToastOptions) {
  ensureHost();
  if (!root) return;

  // Clear previous toast (simple policy: one toast at a time)
  root.querySelectorAll(".wrap").forEach((n) => n.remove());

  const wrap = document.createElement("div");
  wrap.className = "wrap";

  const body = document.createElement("div");
  body.className = "body";
  body.textContent = opts.message;

  const row = document.createElement("div");
  row.className = "row";

  const dismiss = document.createElement("button");
  dismiss.className = "danger";
  dismiss.textContent = "Dismiss";
  dismiss.addEventListener("click", () => wrap.remove());

  const actions = opts.actions ?? [];
  for (const a of actions) {
    const btn = document.createElement("button");
    btn.textContent = a.label;
    btn.addEventListener("click", () => {
      try { a.onClick(); } finally { wrap.remove(); }
    });
    row.appendChild(btn);
  }

  row.appendChild(dismiss);
  wrap.appendChild(body);
  wrap.appendChild(row);

  root.appendChild(wrap);

  const t = opts.timeoutMs ?? 4000;
  if (t > 0) {
    window.setTimeout(() => wrap.remove(), t);
  }
}
