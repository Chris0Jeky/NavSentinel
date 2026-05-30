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
let activeDispose: (() => void) | null = null;

function listFocusable(rootNode: ParentNode): HTMLElement[] {
  return Array.from(
    rootNode.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => !el.hasAttribute("disabled") && el.tabIndex >= 0);
}

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
    :host, * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif; }
    .overlay {
      pointer-events: auto;
      position: fixed;
      inset: 0;
      background: rgba(3, 2, 6, 0.75);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      animation: fade-in 0.15s ease-out;
    }
    @keyframes fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes scale-in {
      from { opacity: 0; transform: scale(0.96) translateY(8px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }
    .card {
      width: min(720px, 96vw);
      max-height: min(82vh, 820px);
      overflow: auto;
      background: linear-gradient(180deg, #110f13, #08070a);
      color: #f6efe1;
      border-radius: 14px;
      border: 1px solid #2a2530;
      box-shadow: 0 18px 60px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(245, 166, 35, 0.08);
      animation: scale-in 0.2s ease-out;
    }
    .header {
      padding: 18px 20px;
      border-bottom: 1px solid #1c181f;
      position: relative;
      overflow: hidden;
    }
    .header::before {
      content: "";
      position: absolute;
      inset: 0;
      background: radial-gradient(ellipse at top left, rgba(245, 166, 35, 0.06), transparent 60%);
      pointer-events: none;
    }
    .header-row {
      display: flex;
      align-items: center;
      gap: 10px;
      position: relative;
    }
    .header-icon {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: rgba(208, 69, 49, 0.12);
      border: 1px solid rgba(208, 69, 49, 0.25);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .header-icon svg {
      width: 16px;
      height: 16px;
      stroke: #d04531;
      fill: none;
      stroke-width: 1.6;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .title {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
      letter-spacing: -0.01em;
      color: #f6efe1;
    }
    .subtitle {
      margin-top: 8px;
      font-size: 12px;
      line-height: 1.45;
      color: #c4b69c;
      position: relative;
    }
    .body { padding: 16px 20px 12px; }
    .kv {
      display: grid;
      grid-template-columns: 130px 1fr;
      gap: 6px 12px;
      margin-bottom: 14px;
    }
    .k {
      color: #756a5a;
      font-size: 11px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .v {
      font-size: 12px;
      font-family: 'SF Mono', 'Cascadia Code', 'JetBrains Mono', Menlo, Consolas, monospace;
      word-break: break-word;
      color: #f6efe1;
    }
    .reasons {
      margin-top: 10px;
      border-top: 1px dashed #1c181f;
      padding-top: 12px;
    }
    .reasons-title {
      font-size: 10px;
      color: #756a5a;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      font-weight: 500;
    }
    ul { margin: 0; padding-left: 0; list-style: none; }
    li {
      font-size: 11.5px;
      line-height: 1.4;
      margin-bottom: 6px;
      color: #c4b69c;
      padding-left: 14px;
      position: relative;
    }
    li::before {
      content: "";
      position: absolute;
      left: 0;
      top: 7px;
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: #ed7a31;
    }
    .footer {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
      padding: 14px 20px 18px;
      border-top: 1px solid #1c181f;
      background: rgba(0, 0, 0, 0.2);
    }
    button {
      all: unset;
      cursor: pointer;
      padding: 8px 14px;
      border-radius: 7px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid #2a2530;
      font-size: 11.5px;
      font-weight: 500;
      color: #c4b69c;
      transition: background 0.12s, transform 0.1s;
    }
    button:hover { background: rgba(255, 255, 255, 0.1); transform: translateY(-1px); }
    button:focus-visible { outline: 2px solid #f5a623; outline-offset: 2px; }
    .primary {
      background: rgba(122, 183, 135, 0.12);
      border-color: rgba(122, 183, 135, 0.3);
      color: #7ab787;
    }
    .primary:hover { background: rgba(122, 183, 135, 0.2); }
    .danger {
      background: rgba(208, 69, 49, 0.12);
      border-color: rgba(208, 69, 49, 0.3);
      color: #d04531;
    }
    .danger:hover { background: rgba(208, 69, 49, 0.2); }
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

  if (activeDispose) {
    activeDispose();
  }
  removeModal();

  return new Promise((resolve) => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overlay = document.createElement("div");
    overlay.className = "overlay";

    const card = document.createElement("div");
    card.className = "card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.tabIndex = -1;

    const titleId = "__sentinelsuite_cred_modal_title__";
    const bodyId = "__sentinelsuite_cred_modal_body__";
    card.setAttribute("aria-labelledby", titleId);
    card.setAttribute("aria-describedby", bodyId);

    const header = document.createElement("div");
    header.className = "header";

    const headerRow = document.createElement("div");
    headerRow.className = "header-row";

    const iconBox = document.createElement("div");
    iconBox.className = "header-icon";
    iconBox.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3 L22 20 H2 Z"/><line x1="12" y1="10" x2="12" y2="14"/><circle cx="12" cy="17" r="0.5" fill="#d04531"/></svg>';

    const title = document.createElement("h2");
    title.className = "title";
    title.id = titleId;
    title.textContent = spec.title;

    headerRow.appendChild(iconBox);
    headerRow.appendChild(title);
    header.appendChild(headerRow);

    if (spec.subtitle) {
      const sub = document.createElement("div");
      sub.className = "subtitle";
      sub.textContent = spec.subtitle;
      header.appendChild(sub);
    }

    const body = document.createElement("div");
    body.className = "body";
    body.id = bodyId;

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

    function done(actionId: string): void {
      window.removeEventListener("keydown", onKeyDown, true);
      activeDispose = null;
      removeModal();
      previouslyFocused?.focus();
      resolve(actionId);
    }

    activeDispose = () => {
      window.removeEventListener("keydown", onKeyDown, true);
      activeDispose = null;
      resolve(outside);
    };

    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.preventDefault();
        done(outside);
        return;
      }

      if (e.key === "Tab") {
        const focusable = listFocusable(card);
        if (focusable.length === 0) {
          e.preventDefault();
          card.focus();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) {
          e.preventDefault();
          card.focus();
          return;
        }
        const active =
          activeRoot.activeElement instanceof HTMLElement
            ? activeRoot.activeElement
            : document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
        if (!active || !focusable.includes(active)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
          return;
        }
        if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
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
      const firstFocusable = listFocusable(card)[0];
      if (firstFocusable) {
        firstFocusable.focus();
      } else {
        card.focus();
      }
    }, 0);
  });
}
