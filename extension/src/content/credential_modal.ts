export type ModalActionKind = "primary" | "danger" | "neutral";

export type ModalAction = {
  id: string;
  label: string;
  kind?: ModalActionKind;
};

export type ModalSpec = {
  title: string;
  subtitle?: string;
  kv?: { k: string; v: string }[];
  reasons?: string[];
  actions: ModalAction[];
  outsideAction?: string;
};

let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;

function ensureHost(): void {
  if (host && root) return;
  host = document.createElement("div");
  host.id = "__sentinelsuite_cred_modal_host__";
  host.style.all = "initial";
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.zIndex = "2147483647";
  host.style.pointerEvents = "none";

  root = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host, * { box-sizing: border-box; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; }
    .overlay { pointer-events: auto; position: fixed; inset: 0; background: rgba(0, 0, 0, 0.55); display: flex; align-items: center; justify-content: center; padding: 24px; }
    .card { width: min(760px, 96vw); max-height: min(82vh, 820px); overflow: auto; background: rgba(17, 17, 17, 0.98); color: #f5f5f5; border-radius: 14px; border: 1px solid rgba(255, 255, 255, 0.16); box-shadow: 0 18px 60px rgba(0, 0, 0, 0.45); }
    .header { padding: 16px 18px; border-bottom: 1px solid rgba(255, 255, 255, 0.1); }
    .title { font-size: 16px; font-weight: 700; letter-spacing: 0.2px; }
    .subtitle { margin-top: 6px; font-size: 13px; line-height: 1.35; color: rgba(255, 255, 255, 0.8); }
    .body { padding: 14px 18px 10px; }
    .kv { display: grid; grid-template-columns: 140px 1fr; gap: 8px 10px; margin-bottom: 12px; }
    .k { color: rgba(255, 255, 255, 0.7); font-size: 12px; }
    .v { font-size: 12px; word-break: break-word; }
    .reasons { margin-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.1); padding-top: 10px; }
    .reasons-title { font-size: 12px; color: rgba(255, 255, 255, 0.75); margin-bottom: 8px; }
    ul { margin: 0; padding-left: 18px; }
    li { font-size: 12px; line-height: 1.35; margin-bottom: 6px; color: rgba(255, 255, 255, 0.9); }
    .footer { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; padding: 12px 18px 16px; border-top: 1px solid rgba(255, 255, 255, 0.1); background: rgba(255, 255, 255, 0.03); }
    button { all: unset; cursor: pointer; padding: 8px 12px; border-radius: 11px; background: rgba(255, 255, 255, 0.1); font-size: 12px; border: 1px solid rgba(255, 255, 255, 0.1); }
    button:hover { background: rgba(255, 255, 255, 0.16); }
    .primary { background: rgba(120, 200, 255, 0.18); border-color: rgba(120, 200, 255, 0.22); }
    .primary:hover { background: rgba(120, 200, 255, 0.26); }
    .danger { background: rgba(255, 80, 80, 0.16); border-color: rgba(255, 80, 80, 0.22); }
    .danger:hover { background: rgba(255, 80, 80, 0.24); }
  `;
  root.appendChild(style);
  document.documentElement.appendChild(host);
}

function removeModal(): void {
  if (!root) return;
  root.querySelectorAll(".overlay").forEach((n) => n.remove());
}

export function showCredentialModal(spec: ModalSpec): Promise<string> {
  ensureHost();
  if (!root) return Promise.resolve(spec.outsideAction ?? "cancel");
  const activeRoot = root;

  removeModal();

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "overlay";

    const card = document.createElement("div");
    card.className = "card";

    const header = document.createElement("div");
    header.className = "header";
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = spec.title;
    header.appendChild(title);

    if (spec.subtitle) {
      const sub = document.createElement("div");
      sub.className = "subtitle";
      sub.textContent = spec.subtitle;
      header.appendChild(sub);
    }

    const body = document.createElement("div");
    body.className = "body";

    if (spec.kv?.length) {
      const kv = document.createElement("div");
      kv.className = "kv";
      for (const row of spec.kv) {
        const k = document.createElement("div");
        k.className = "k";
        k.textContent = row.k;
        const v = document.createElement("div");
        v.className = "v";
        v.textContent = row.v;
        kv.appendChild(k);
        kv.appendChild(v);
      }
      body.appendChild(kv);
    }

    if (spec.reasons?.length) {
      const wrap = document.createElement("div");
      wrap.className = "reasons";
      const rt = document.createElement("div");
      rt.className = "reasons-title";
      rt.textContent = "Signals";
      wrap.appendChild(rt);

      const ul = document.createElement("ul");
      for (const reason of spec.reasons) {
        const li = document.createElement("li");
        li.textContent = reason;
        ul.appendChild(li);
      }
      wrap.appendChild(ul);
      body.appendChild(wrap);
    }

    const footer = document.createElement("div");
    footer.className = "footer";
    const outside = spec.outsideAction ?? "cancel";

    function cleanup(): void {
      window.removeEventListener("keydown", onKeyDown, true);
    }

    function done(actionId: string): void {
      cleanup();
      removeModal();
      resolve(actionId);
    }

    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.preventDefault();
        done(outside);
      }
    }

    window.addEventListener("keydown", onKeyDown, true);
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) done(outside);
    });

    for (const action of spec.actions) {
      const btn = document.createElement("button");
      btn.textContent = action.label;
      const kind = action.kind ?? "neutral";
      if (kind === "primary") btn.classList.add("primary");
      if (kind === "danger") btn.classList.add("danger");
      btn.addEventListener("click", () => done(action.id));
      footer.appendChild(btn);
    }

    card.appendChild(header);
    card.appendChild(body);
    card.appendChild(footer);
    overlay.appendChild(card);
    activeRoot.appendChild(overlay);

    window.setTimeout(() => {
      const firstBtn = footer.querySelector("button") as HTMLButtonElement | null;
      firstBtn?.focus();
    }, 0);
  });
}
