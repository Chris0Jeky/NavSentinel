# Snippets By Topic

All snippets are pulled from `HistoryDump.txt` and grouped by topic for quick access.

## MV3 skeleton (minimal)
### Minimal file layout (MV3 skeleton)
```text
phantom-click-guard/
  extension/
    manifest.json
    sw.js                       # service worker (background)
    content/
      capture_isolated.js        # always runs, document_start (intent model, blocking default nav)
      main_guard.js              # optional MAIN-world (patch primitives) if CSP allows
      ui_toast.js                # in-page UI (optional)
      styles.css                 # toast styles
    options/
      options.html
      options.js
    rules/
      dnr_static.json            # optional starter ruleset
  gym/
    level1-basic-opacity.html
    level2-moving-target.html
    level3-instant-injection.html
    level4-visual-mimicry.html
    level5-window-open-popunder.html
    level6-programmatic-click.html
    level7-legit-modal-backdrop.html
    level8-legit-oauth-popup.html
    level9-legit-video-overlay.html
  docs/
    spec-gesture-tokens.md
    heuristics.md
    testing.md
```

### Minimal manifest.json (MV3 skeleton)
```json
{
  "name": "Phantom Click Guard (Dev)",
  "description": "Blocks deceptive click overlays and unwanted popups using JIT gesture correlation.",
  "version": "0.1.0",
  "manifest_version": 3,

  "permissions": ["storage", "declarativeNetRequest", "scripting"],
  "host_permissions": ["http://*/*", "https://*/*"],

  "background": {
    "service_worker": "sw.js",
    "type": "module"
  },

  "content_scripts": [
    {
      "matches": ["http://*/*", "https://*/*"],
      "js": ["content/capture_isolated.js"],
      "run_at": "document_start"
    },
    {
      "matches": ["http://*/*", "https://*/*"],
      "js": ["content/main_guard.js"],
      "run_at": "document_start",
      "world": "MAIN"
    }
  ],

  "options_ui": {
    "page": "options/options.html",
    "open_in_tab": true
  },

  "web_accessible_resources": [
    {
      "resources": ["content/styles.css"],
      "matches": ["http://*/*", "https://*/*"]
    }
  ]
}
```

## Repo skeleton and layout
### Repo skeleton (TS build, MV3 output)
```text
navsentinel/
  extension/
    public/
      manifest.json
      icons/
    src/
      sw/sw.ts
      content/capture_isolated.ts
      content/main_guard.ts
      content/ui_toast.ts
      options/options.html
      options/options.ts
      shared/
        types.ts
        siteKeys.ts
        stateMachine.ts
        scoring.ts
        decision.ts
        storage.ts
    dist/                   # build output
  gym/                      # your 1-9 HTML levels from earlier
  tests/
    e2e/
      navsentinel.spec.ts
  docs/
    spec-gesture-tokens.md
    heuristics.md
    testing.md
  package.json
  tsconfig.json
  vite.config.ts (or esbuild.mjs)
```

### Folder layout (initial stage)
```text
navsentinel/
  extension/
    manifest.json
    src/
      sw/sw.ts
      content/capture_isolated.ts
      content/main_guard.ts
      content/ui_toast.ts
      content/styles.css
      shared/types.ts
      shared/scoring.ts
      shared/stateMachine.ts
      shared/storage.ts
      options/options.html
      options/options.ts
      options/options.css
  gym/
    (levels 1-9 from earlier)
  tests/
    e2e/navsentinel.spec.ts
  docs/
    proposal.md
    spec-gesture-tokens.md
    heuristics.md
    testing.md
  vite.config.ts
  tsconfig.json
  package.json
```

## Tooling and configuration
### package.json (scripts section)
```json
{
  "name": "navsentinel",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "watch": "vite build --watch",
    "test": "vitest run",
    "test:e2e": "playwright test"
  },
  "devDependencies": {
    "@crxjs/vite-plugin": "^2.3.0",
    "@types/chrome": "^0.0.260",
    "playwright": "^1.49.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

### vite.config.ts (root)
```ts
import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./extension/manifest.json";

export default defineConfig({
  root: "extension",
  plugins: [crx({ manifest })],
  build: {
    outDir: "dist",
    emptyOutDir: true
  },
  server: {
    port: 5174,
    strictPort: true
  }
});
```

### tsconfig.json (root)
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "resolveJsonModule": true,
    "types": ["chrome"],
    "skipLibCheck": true
  },
  "include": ["extension/src", "tests", "vite.config.ts"]
}
```

### extension/manifest.json
```json
{
  "manifest_version": 3,
  "name": "NavSentinel (Dev)",
  "version": "0.1.0",
  "description": "Navigation Intent Firewall: blocks deceptive click overlays and unwanted user-gesture popups.",
  "permissions": ["storage"],
  "host_permissions": ["<all_urls>"],

  "background": {
    "service_worker": "src/sw/sw.ts",
    "type": "module"
  },

  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["src/content/capture_isolated.ts"],
      "run_at": "document_start",
      "world": "ISOLATED",
      "all_frames": true
    },
    {
      "matches": ["<all_urls>"],
      "js": ["src/content/main_guard.ts"],
      "run_at": "document_start",
      "world": "MAIN",
      "all_frames": true
    }
  ],

  "options_ui": {
    "page": "src/options/options.html",
    "open_in_tab": true
  }
}
```

## Shared core types and state
### extension/src/shared/types.ts
```ts
export type Mode = "off" | "smart" | "strict";

export type GestureType = "pointer" | "keyboard";

export interface GestureToken {
  id: string;
  createdAt: number;
  expiresAt: number;
  type: GestureType;
  frameKey: string;
  siteKey: string;
  mode: Mode;

  pointer?: {
    x: number;
    y: number;
    button: number;
    ctrl: boolean;
    shift: boolean;
    alt: boolean;
    meta: boolean;
  };

  cds: number;
  reasonCodes: string[];
}

export type NavKind =
  | "window_open"
  | "anchor_blank"
  | "anchor_same"
  | "location"
  | "form";

export interface NavigationAttempt {
  ts: number;
  kind: NavKind;
  url?: string;
  target?: string;
}

export interface Decision {
  action: "allow" | "block" | "prompt";
  nrs: number;
  reasonCodes: string[];
  gtId?: string;
}
```

### extension/src/shared/stateMachine.ts
```ts
import type { GestureToken, Mode } from "./types";

let activeToken: GestureToken | null = null;

export function getActiveToken(): GestureToken | null {
  if (!activeToken) return null;
  if (performance.now() > activeToken.expiresAt) {
    activeToken = null;
    return null;
  }
  return activeToken;
}

export function setActiveToken(t: GestureToken): void {
  activeToken = t;
}

export function makeToken(params: {
  siteKey: string;
  frameKey: string;
  mode: Mode;
  pointer?: GestureToken["pointer"];
  cds: number;
  reasonCodes: string[];
}): GestureToken {
  const now = performance.now();
  const id = `${Math.floor(now)}-${Math.random().toString(16).slice(2)}`;
  return {
    id,
    createdAt: now,
    expiresAt: now + 800,
    type: params.pointer ? "pointer" : "keyboard",
    siteKey: params.siteKey,
    frameKey: params.frameKey,
    mode: params.mode,
    pointer: params.pointer,
    cds: params.cds,
    reasonCodes: params.reasonCodes
  };
}
```

### extension/src/shared/scoring.ts (stub)
```ts
export function computeCDS(): { cds: number; reasonCodes: string[] } {
  // Stage 1: observe-only. Implement real heuristics in Stage 2.
  return { cds: 0, reasonCodes: [] };
}
```

### extension/src/shared/storage.ts
```ts
import type { Mode } from "./types";

export interface Settings {
  defaultMode: Mode;
}

const KEY = "navsentinel:settings";

export async function getSettings(): Promise<Settings> {
  const res = await chrome.storage.local.get(KEY);
  return (res[KEY] as Settings)  { defaultMode: "smart" };
}

export async function setSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: s });
}
```

## Content scripts
### extension/src/content/capture_isolated.ts
```ts
import { computeCDS } from "../shared/scoring";
import { getSettings } from "../shared/storage";
import { makeToken, setActiveToken } from "../shared/stateMachine";

function siteKeyFromLocation(): string {
  // Stage 1: simple hostname. Later: registrable domain (eTLD+1).
  return location.hostname;
}

function frameKey(): string {
  // Stage 1: basic. Later: stable frame lineage if needed.
  return window.top === window ? "top" : "frame";
}

window.addEventListener(
  "pointerdown",
  async (e) => {
    if (!(e instanceof PointerEvent)) return;

    const settings = await getSettings();
    const { cds, reasonCodes } = computeCDS();

    const token = makeToken({
      siteKey: siteKeyFromLocation(),
      frameKey: frameKey(),
      mode: settings.defaultMode,
      pointer: {
        x: e.clientX,
        y: e.clientY,
        button: e.button,
        ctrl: e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey,
        meta: e.metaKey
      },
      cds,
      reasonCodes
    });

    setActiveToken(token);
    // Stage 1: log only
    // eslint-disable-next-line no-console
    console.debug("[NavSentinel] token", token);
  },
  true
);
```

### extension/src/content/main_guard.ts
```ts
// Stage 1: minimal indicator that MAIN world script ran.
// Later: patch window.open / location.assign / etc.
(() => {
  (window as any).__navsentinelMainGuard = true;
})();
```

### extension/src/content/dom_builder.ts
```ts
import type { ClickContext, ElementHint } from "../shared/scoring";

// ---- types for captured events ----

export interface DownCapture {
  ts: number;
  x: number;
  y: number;
  button: number;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;

  stack: Element[];
  top: Element | null;
}

export interface ClickCapture {
  ts: number;
  x: number;
  y: number;

  stack: Element[];
  top: Element | null;
}

// ---- perf-conscious helpers ----

const WS_RE = /\s/;

function approxNonWhitespaceTextLen(el: Element, cap = 80): number {
  // Prefer textContent (no layout). Avoid trim() on large strings.
  const s = el.textContent;
  if (!s) return 0;
  let count = 0;
  for (let i = 0; i < s.length && count < cap; i++) {
    if (!WS_RE.test(s[i])) count++;
  }
  return count;
}

function attrLen(el: Element, name: string, cap = 80): number {
  const v = el.getAttribute(name);
  if (!v) return 0;
  return Math.min(v.length, cap);
}

function isInteractiveCheap(el: Element): boolean {
  const tag = el.tagName;
  if (tag === "A" || tag === "BUTTON") return true;
  const role = (el.getAttribute("role")  "").toLowerCase();
  if (role === "button" || role === "link") return true;

  // onclick attribute is a decent cheap hint; property access can be noisy in some frameworks
  if (el.getAttribute("onclick")) return true;

  return false;
}

function firstUnderlyingCandidate(stack: Element[], top: Element | null): Element | null {
  if (!top) return null;
  for (const el of stack) {
    if (el === top) continue;
    // choose the first "more intentful" interactive element underneath
    if (isInteractiveCheap(el)) return el;
  }
  return null;
}

function readRect(el: Element): { w: number; h: number } | undefined {
  // getBoundingClientRect can trigger layout but is usually acceptable once per click
  const r = (el as HTMLElement).getBoundingClientRect?.();
  if (!r) return undefined;
  return { w: Math.max(0, r.width), h: Math.max(0, r.height) };
}

function readStyleHints(el: Element): Partial<ElementHint> {
  const cs = window.getComputedStyle(el as Element);
  const z = cs.zIndex === "auto" ? 0 : Number.parseInt(cs.zIndex, 10);

  return {
    opacity: Number.parseFloat(cs.opacity),
    display: cs.display,
    visibility: cs.visibility as any,
    pointerEvents: cs.pointerEvents,
    position: cs.position,
    zIndex: Number.isFinite(z) ? z : 0,
    cursor: cs.cursor
  };
}

function buildElementHint(el: Element, opts: { wantStyle: boolean; wantRect: boolean }): ElementHint {
  const tag = el.tagName;
  const role = el.getAttribute("role")  undefined;

  const hint: ElementHint = {
    tag,
    role,
    hasOnClick: !!el.getAttribute("onclick"),
    textLength: approxNonWhitespaceTextLen(el),
    ariaLabelLength: attrLen(el, "aria-label"),
    titleLength: attrLen(el, "title")
  };

  if (tag === "A") {
    const t = (el as HTMLAnchorElement).target;
    hint.targetBlank = t === "_blank";
  }

  if (opts.wantRect) hint.rect = readRect(el);
  if (opts.wantStyle) Object.assign(hint, readStyleHints(el));

  // Cheap cursor hint fallback: if it's interactive and has no name, cursor is useful;
  // but cursor requires computedStyle so we only attach it when wantStyle=true.
  return hint;
}

function detectLegitModalBackdrop(top: Element | null, stack: Element[], viewport: { w: number; h: number }): boolean {
  if (!top) return false;

  // If the top covers most of viewport, is non-interactive, and a dialog-like element is underneath, treat as legit backdrop.
  const topRect = readRect(top);
  if (!topRect) return false;

  const ratio = (topRect.w * topRect.h) / (viewport.w * viewport.h);
  if (ratio < 0.35) return false;

  if (isInteractiveCheap(top)) return false;

  // Look for dialog markers underneath
  for (const el of stack) {
    if (el === top) continue;
    const role = (el.getAttribute("role")  "").toLowerCase();
    if (role === "dialog") return true;
    if ((el.getAttribute("aria-modal")  "").toLowerCase() === "true") return true;
  }
  return false;
}

// ---- exported capture/build functions ----

export function capturePointerDown(e: PointerEvent): DownCapture {
  const x = e.clientX;
  const y = e.clientY;
  const stack = document.elementsFromPoint(x, y);

  return {
    ts: performance.now(),
    x,
    y,
    button: e.button,
    ctrl: e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
    meta: e.metaKey,
    stack,
    top: stack[0]  null
  };
}

export function captureClick(e: MouseEvent): ClickCapture {
  const x = e.clientX;
  const y = e.clientY;
  const stack = document.elementsFromPoint(x, y);

  return {
    ts: performance.now(),
    x,
    y,
    stack,
    top: stack[0]  null
  };
}

export function buildClickContextFromEvents(params: {
  down: DownCapture | null;
  click: ClickCapture;
}): ClickContext {
  const viewport = { w: window.innerWidth, h: window.innerHeight };

  const downTop = params.down?.top  null;
  const clickTop = params.click.top  null;

  const retargeted = !!(downTop && clickTop && downTop !== clickTop);

  // Explicit new-tab intent: middle click OR ctrl/cmd click.
  const explicitNewTabIntent =
    (params.down?.button === 1) || !!(params.down?.ctrl || params.down?.meta);

  const topEl = clickTop  downTop  params.click.stack[0]  document.documentElement;

  // Underlying candidate: first interactive underneath top
  const underEl = firstUnderlyingCandidate(params.click.stack, topEl);

  // Decide whether we need expensive reads:
  // Read style/rect for top if it might be an overlay or interactive.
  const topCheapInteractive = isInteractiveCheap(topEl);
  const needTopRect = true;
  const needTopStyle = topCheapInteractive || true; // you can tighten this later

  // For underlying, only read rect/style if it exists and is interactive
  const needUnder = !!underEl && isInteractiveCheap(underEl);
  const needUnderRect = needUnder;
  const needUnderStyle = false; // keep very light; can enable later if needed

  const top = buildElementHint(topEl, { wantRect: needTopRect, wantStyle: needTopStyle });
  const underlying = underEl
    ? buildElementHint(underEl, { wantRect: needUnderRect, wantStyle: needUnderStyle })
    : undefined;

  const isLegitModalBackdrop = detectLegitModalBackdrop(topEl, params.click.stack, viewport);

  const ctx: ClickContext = {
    viewport,
    top,
    underlying,
    retargeted,
    input: "pointer",
    explicitNewTabIntent,
    isLegitModalBackdrop
  };

  return ctx;
}
```

### Wire dom_builder into capture_isolated.ts
```ts
import { capturePointerDown, captureClick, buildClickContextFromEvents } from "./dom_builder";
import { computeCDS } from "../shared/scoring";
import { showToast } from "./ui_toast";

let lastDown: ReturnType<typeof capturePointerDown> | null = null;

window.addEventListener("pointerdown", (e) => {
  lastDown = capturePointerDown(e);
}, true);

window.addEventListener("click", (e) => {
  const click = captureClick(e);
  const ctx = buildClickContextFromEvents({ down: lastDown, click });
  const { cds, reasonCodes } = computeCDS(ctx);

  if (cds >= 70) {
    e.preventDefault();
    e.stopImmediatePropagation();
    showToast({ message: `Blocked deceptive click (CDS=${cds})`, timeoutMs: 4000 });
    // console.debug(reasonCodes);
  }
}, true);
```

## Service worker and options UI
### extension/src/sw/sw.ts
```ts
chrome.runtime.onInstalled.addListener(() => {
  // Stage 1: no-op. Later: initialize defaults, register DNR rules, etc.
});
```

### extension/src/options/options.html
```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>NavSentinel Options</title>
    <link rel="stylesheet" href="./options.css" />
  </head>
  <body>
    <h1>NavSentinel</h1>
    <p>Default mode:</p>
    <select id="mode">
      <option value="off">Off</option>
      <option value="smart">Smart</option>
      <option value="strict">Strict</option>
    </select>
    <button id="save">Save</button>
    <p id="status"></p>

    <script type="module" src="./options.ts"></script>
  </body>
</html>
```

### extension/src/options/options.ts
```ts
import { getSettings, setSettings } from "../shared/storage";
import type { Mode } from "../shared/types";

const modeEl = document.getElementById("mode") as HTMLSelectElement;
const statusEl = document.getElementById("status") as HTMLParagraphElement;
const saveBtn = document.getElementById("save") as HTMLButtonElement;

async function init() {
  const s = await getSettings();
  modeEl.value = s.defaultMode;
}

saveBtn.addEventListener("click", async () => {
  const m = modeEl.value as Mode;
  await setSettings({ defaultMode: m });
  statusEl.textContent = "Saved.";
  setTimeout(() => (statusEl.textContent = ""), 1000);
});

init();
```

### extension/src/options/options.css
```css
body {
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  margin: 24px;
  max-width: 720px;
}
h1 {
  margin: 0 0 12px 0;
}
select,
button {
  padding: 8px 10px;
  margin-right: 8px;
}
```

### extension/src/content/ui_toast.ts
```ts
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

  const actions = opts.actions  [];
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

  const t = opts.timeoutMs  4000;
  if (t > 0) {
    window.setTimeout(() => wrap.remove(), t);
  }
}
```

## Scoring implementation and tests
### extension/src/shared/scoring.ts (CDS v1)
```ts
// extension/src/shared/scoring.ts
export interface RectHint {
  w: number;
  h: number;
}

export interface ElementHint {
  tag: string; // uppercase like "A", "DIV", "BUTTON"
  role?: string; // e.g., "button", "link"
  hasOnClick?: boolean;
  cursor?: string; // e.g., "pointer"
  textLength?: number; // visible-ish text length (approx)
  ariaLabelLength?: number;
  titleLength?: number;

  targetBlank?: boolean;

  opacity?: number; // 0..1
  display?: string; // e.g., "none"
  visibility?: "visible" | "hidden";
  pointerEvents?: string; // e.g., "none"
  position?: string; // "fixed" | "absolute" | ...
  zIndex?: number;

  rect?: RectHint;
}

export interface ClickContext {
  viewport: { w: number; h: number };

  // Topmost element that received the click (or would, absent blocking)
  top: ElementHint;

  // A plausible underlying "intended" element (next best hit-test target)
  underlying?: ElementHint;

  // Whether pointerdown top and click top differ (retargeting)
  retargeted?: boolean;

  // User input style (if known)
  input?: "pointer" | "keyboard";

  // Strong hints from DOM analysis (optional; set by the builder)
  isLegitModalBackdrop?: boolean;

  // Explicit user intent to open new tab (often ctrl/cmd click or middle click)
  explicitNewTabIntent?: boolean;
}

export interface CDSResult {
  cds: number;
  reasonCodes: string[];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function num(x: number | undefined, fallback = 0): number {
  return Number.isFinite(x) ? (x as number) : fallback;
}

function accessibleNameLen(h: ElementHint): number {
  return (
    num(h.textLength) +
    num(h.ariaLabelLength) +
    num(h.titleLength)
  );
}

function isInteractive(h: ElementHint): boolean {
  const tag = h.tag;
  const role = (h.role  "").toLowerCase();
  if (tag === "A" || tag === "BUTTON") return true;
  if (role === "link" || role === "button") return true;
  if (h.hasOnClick) return true;
  if ((h.cursor  "").toLowerCase() === "pointer") return true;
  return false;
}

function coverRatio(h: ElementHint, viewport: { w: number; h: number }): number {
  const r = h.rect;
  if (!r || viewport.w <= 0 || viewport.h <= 0) return 0;
  const area = Math.max(0, r.w) * Math.max(0, r.h);
  const vArea = viewport.w * viewport.h;
  if (vArea <= 0) return 0;
  return area / vArea;
}

function isEffectivelyInvisible(h: ElementHint): boolean {
  const display = (h.display  "").toLowerCase();
  const vis = (h.visibility  "visible").toLowerCase();
  const opacity = num(h.opacity, 1);

  if (display === "none") return true;
  if (vis === "hidden") return true;
  if (opacity < 0.08) return true;

  const r = h.rect;
  if (r && (r.w <= 2 || r.h <= 2)) return true; // near-zero hit area
  return false;
}

function hasClickThroughPointerEvents(h: ElementHint): boolean {
  const pe = (h.pointerEvents  "").toLowerCase();
  return pe !== "none";
}

function isOverlayLike(h: ElementHint, viewport: { w: number; h: number }): boolean {
  const ratio = coverRatio(h, viewport);
  const pos = (h.position  "").toLowerCase();
  const z = num(h.zIndex, 0);
  const name = accessibleNameLen(h);

  // overlay-like: large + positioned + high z-index + low/no identity
  if (ratio > 0.35 && (pos === "fixed" || pos === "absolute") && z >= 9999) return true;
  if (ratio > 0.35 && name === 0) return true;
  if (ratio > 0.50) return true;
  return false;
}

function looksIntentful(h: ElementHint): boolean {
  const name = accessibleNameLen(h);
  if (name > 0) return true;
  // Buttons without text are rarer, but still plausible; keep conservative
  if (h.tag === "BUTTON") return true;
  const role = (h.role  "").toLowerCase();
  if (role === "button") return true;
  return false;
}

export function computeCDS(ctx: ClickContext): CDSResult {
  const reasons: string[] = [];
  let score = 0;

  const top = ctx.top;
  const under = ctx.underlying;
  const v = ctx.viewport;

  const topInteractive = isInteractive(top);
  const topNameLen = accessibleNameLen(top);
  const topCover = coverRatio(top, v);

  const add = (reason: string, delta: number) => {
    score += delta;
    reasons.push(reason);
  };

  // --- Core deception signals ---
  if (ctx.retargeted) add("retargeted_target_mismatch", 20);

  if (topInteractive && topNameLen === 0) add("empty_accessible_name", 15);

  if (topInteractive && topCover > 0.35) add("overlay_large_interactive", 30);

  const pos = (top.position  "").toLowerCase();
  const z = num(top.zIndex, 0);
  if ((pos === "fixed" || pos === "absolute") && z >= 9999) add("high_z_overlay", 15);

  if (topInteractive && isEffectivelyInvisible(top) && hasClickThroughPointerEvents(top)) {
    add("invisible_but_clickable", 25);
  }

  if (under && isInteractive(under) && looksIntentful(under) && isOverlayLike(top, v)) {
    add("intent_mismatch_under_interactive", 35);
  }

  // Mild "no-affordance but clickable" signal
  if (
    topInteractive &&
    (top.cursor  "").toLowerCase() === "pointer" &&
    topNameLen === 0 &&
    num(top.opacity, 1) < 0.2
  ) {
    add("cursor_pointer_no_affordance", 10);
  }

  // --- Legitimate mitigations (reduce false positives) ---
  if (ctx.input === "keyboard") add("keyboard_activation", -10);

  if (ctx.explicitNewTabIntent) add("explicit_new_tab_intent", -30);

  if (ctx.isLegitModalBackdrop) add("legit_modal_backdrop", -20);

  // Clamp to a stable range for thresholds
  const cds = clamp(score, 0, 100);

  return { cds, reasonCodes: reasons };
}
```

### Minimal integration example
```ts
import { showToast } from "./ui_toast";
import { computeCDS } from "../shared/scoring";

// ...
const { cds, reasonCodes } = computeCDS(ctx);
if (mode !== "off" && cds >= 70) {
  e.preventDefault();
  e.stopImmediatePropagation();
  showToast({
    message: `NavSentinel blocked a deceptive click (CDS=${cds}).`,
    actions: [
      { label: "Allow once", onClick: () => {/* stage 3 */} }
    ]
  });
}
```

### extension/src/shared/scoring.test.ts
```ts
import { describe, it, expect } from "vitest";
import { computeCDS, type ClickContext } from "./scoring";

function baseCtx(): ClickContext {
  return {
    viewport: { w: 1000, h: 800 },
    top: { tag: "DIV", rect: { w: 100, h: 40 }, opacity: 1, visibility: "visible" }
  };
}

describe("computeCDS", () => {
  it("flags fullscreen invisible interactive overlay with an intentful underlying button", () => {
    const ctx: ClickContext = {
      viewport: { w: 1000, h: 800 },
      retargeted: false,
      input: "pointer",
      top: {
        tag: "A",
        targetBlank: true,
        rect: { w: 1000, h: 800 },
        opacity: 0.01,
        visibility: "visible",
        display: "block",
        pointerEvents: "auto",
        position: "fixed",
        zIndex: 999999,
        cursor: "pointer",
        textLength: 0,
        ariaLabelLength: 0,
        titleLength: 0
      },
      underlying: {
        tag: "BUTTON",
        rect: { w: 180, h: 60 },
        opacity: 1,
        cursor: "pointer",
        textLength: 4, // "Play"
        ariaLabelLength: 0,
        titleLength: 0
      }
    };

    const r = computeCDS(ctx);
    expect(r.cds).toBeGreaterThanOrEqual(80);
    expect(r.reasonCodes).toContain("overlay_large_interactive");
    expect(r.reasonCodes).toContain("invisible_but_clickable");
    expect(r.reasonCodes).toContain("intent_mismatch_under_interactive");
  });

  it("treats a non-interactive modal backdrop as low risk by default", () => {
    const ctx: ClickContext = {
      viewport: { w: 1000, h: 800 },
      input: "pointer",
      top: {
        tag: "DIV",
        rect: { w: 1000, h: 800 },
        opacity: 0.4,
        position: "fixed",
        zIndex: 9999,
        cursor: "default",
        textLength: 0
      },
      isLegitModalBackdrop: true
    };

    const r = computeCDS(ctx);
    expect(r.cds).toBeLessThan(30);
    expect(r.reasonCodes).toContain("legit_modal_backdrop");
  });

  it("penalizes retargeting (pointerdown target mismatch)", () => {
    const ctx = baseCtx();
    ctx.retargeted = true;
    ctx.top = {
      tag: "A",
      rect: { w: 900, h: 700 },
      opacity: 0.2,
      position: "fixed",
      zIndex: 20000,
      cursor: "pointer",
      textLength: 0
    };

    const r = computeCDS(ctx);
    expect(r.reasonCodes).toContain("retargeted_target_mismatch");
    expect(r.cds).toBeGreaterThanOrEqual(20);
  });

  it("reduces risk when explicit new-tab intent is present", () => {
    const ctx: ClickContext = {
      viewport: { w: 1000, h: 800 },
      input: "pointer",
      explicitNewTabIntent: true,
      top: {
        tag: "A",
        rect: { w: 320, h: 24 },
        opacity: 1,
        cursor: "pointer",
        textLength: 10
      }
    };

    const r = computeCDS(ctx);
    expect(r.reasonCodes).toContain("explicit_new_tab_intent");
    expect(r.cds).toBe(0); // clamped
  });
});
```

## Gym HTML (Levels 1-9)
### Level 1 - basic invisible overlay anchor
```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Level 1 - Basic Opacity Overlay</title>
  <style>
    body { font-family: sans-serif; padding: 24px; }
    #play { padding: 16px 20px; font-size: 18px; }
    #trap {
      position: fixed; inset: 0;
      opacity: 0.01; /* visually imperceptible */
      z-index: 999999;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <h1>Level 1: Invisible overlay anchor</h1>
  <p>Click the Play button. A trap anchor covers the whole page.</p>

  <button id="play">Play</button>

  <a id="trap" href="https://example.com" target="_blank" rel="noreferrer"></a>
</body>
</html>
```

### Level 2 - moving overlay follows mouse
```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Level 2 - Moving Target Overlay</title>
  <style>
    body { font-family: sans-serif; padding: 24px; height: 200vh; }
    #realBtn { padding: 16px 20px; font-size: 18px; }
    #trap {
      position: fixed;
      width: 220px; height: 80px;
      opacity: 0.01;
      z-index: 999999;
      cursor: pointer;
      transform: translate(-9999px, -9999px);
    }
  </style>
</head>
<body>
  <h1>Level 2: Overlay follows mouse</h1>
  <p>Move your mouse, then click the real button.</p>

  <button id="realBtn">Real Button</button>

  <a id="trap" href="https://example.org" target="_blank" rel="noreferrer"></a>

  <script>
    const trap = document.getElementById('trap');
    window.addEventListener('mousemove', (e) => {
      trap.style.transform = `translate(${e.clientX - 110}px, ${e.clientY - 40}px)`;
    });
  </script>
</body>
</html>
```

### Level 3 - instant injection on pointerdown
```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Level 3 - Instant Injection</title>
  <style>
    body { font-family: sans-serif; padding: 24px; }
    #target { padding: 16px 20px; font-size: 18px; }
    .trap {
      position: fixed; inset: 0;
      opacity: 0.01;
      z-index: 999999;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <h1>Level 3: Trap injected right before click</h1>
  <button id="target">Click me</button>

  <script>
    const btn = document.getElementById('target');

    btn.addEventListener('pointerdown', () => {
      const a = document.createElement('a');
      a.className = 'trap';
      a.href = 'https://example.net';
      a.target = '_blank';
      a.rel = 'noreferrer';
      document.body.appendChild(a);

      // remove shortly after to evade naive scanners
      setTimeout(() => a.remove(), 150);
    });
  </script>
</body>
</html>
```

### Level 4 - visual mimicry (fake download)
```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Level 4 - Visual Mimicry</title>
  <style>
    body { font-family: sans-serif; padding: 24px; }
    .card { border: 1px solid #ccc; padding: 18px; width: 420px; }
    .download {
      display: inline-block;
      padding: 14px 18px;
      background: #2a6;
      color: white;
      border-radius: 10px;
      font-size: 18px;
      user-select: none;
      position: relative;
    }
    /* trap anchor is positioned over the "download" */
    #trap {
      position: absolute;
      inset: 0;
      opacity: 0.01;
      cursor: pointer;
    }
  </style>
</head>
<body>
  <h1>Level 4: Fake download button</h1>
  <div class="card">
    <p>Click "Download". The visual button is a div; the anchor on top goes elsewhere.</p>
    <div class="download">
      Download
      <a id="trap" href="https://example.edu" target="_blank" rel="noreferrer"></a>
    </div>
  </div>
</body>
</html>
```

### Level 5 - window.open popunder handler
```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Level 5 - window.open Abuse</title>
  <style>
    body { font-family: sans-serif; padding: 24px; }
    #area { border: 2px dashed #999; padding: 28px; margin-top: 14px; }
  </style>
</head>
<body>
  <h1>Level 5: Any click triggers window.open</h1>
  <p>Click inside the box. A new tab opens.</p>

  <div id="area">Click area</div>

  <script>
    document.getElementById('area').addEventListener('click', () => {
      const w = window.open('https://example.com/?ad=1', '_blank', 'noopener,noreferrer');
      // popunder-ish behavior: try to refocus this page
      window.focus();
      if (w) { try { w.blur(); } catch (e) {} }
    });
  </script>
</body>
</html>
```

### Level 6 - programmatic click chain
```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Level 6 - Programmatic Click</title>
  <style>
    body { font-family: sans-serif; padding: 24px; }
    #real { padding: 16px 20px; font-size: 18px; }
    #hiddenLink { position: fixed; left: -9999px; top: -9999px; }
  </style>
</head>
<body>
  <h1>Level 6: Programmatic element.click()</h1>
  <p>Click "Continue". The site triggers a hidden link click.</p>

  <button id="real">Continue</button>
  <a id="hiddenLink" href="https://example.org/?forced=1" target="_blank" rel="noreferrer">Hidden</a>

  <script>
    document.getElementById('real').addEventListener('click', () => {
      // abuse: programmatic click on a hidden link
      document.getElementById('hiddenLink').click();
    });
  </script>
</body>
</html>
```

### Level 7 - legit modal backdrop
```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Level 7 - Legit Modal Backdrop</title>
  <style>
    body { font-family: sans-serif; padding: 24px; }
    #open { padding: 14px 18px; font-size: 18px; }
    #backdrop {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.4);
      display: none;
    }
    #modal {
      position: fixed; left: 50%; top: 50%;
      transform: translate(-50%, -50%);
      background: white; padding: 18px; border-radius: 12px;
      width: 420px;
      display: none;
    }
    #close { padding: 10px 14px; }
  </style>
</head>
<body>
  <h1>Level 7: Legit modal overlay</h1>
  <button id="open">Open modal</button>

  <div id="backdrop"></div>
  <div id="modal">
    <h2>Modal</h2>
    <p>This overlay is legitimate. Clicking backdrop closes.</p>
    <button id="close">Close</button>
  </div>

  <script>
    const open = document.getElementById('open');
    const backdrop = document.getElementById('backdrop');
    const modal = document.getElementById('modal');
    const close = document.getElementById('close');

    function show(v) {
      backdrop.style.display = v ? 'block' : 'none';
      modal.style.display = v ? 'block' : 'none';
    }
    open.onclick = () => show(true);
    close.onclick = () => show(false);
    backdrop.onclick = () => show(false);
  </script>
</body>
</html>
```

### Level 8 - legit OAuth popup
```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Level 8 - Legit OAuth Popup</title>
  <style>
    body { font-family: sans-serif; padding: 24px; }
    #signin { padding: 16px 20px; font-size: 18px; }
  </style>
</head>
<body>
  <h1>Level 8: Legit "Sign in" popup</h1>
  <p>This mimics a common legit case: a deliberate popup for auth.</p>
  <button id="signin">Sign in</button>

  <script>
    document.getElementById('signin').addEventListener('click', () => {
      window.open('https://example.com/?oauth=1', 'oauth', 'popup,width=520,height=640');
    });
  </script>
</body>
</html>
```

### Level 9 - legit video overlay controls
```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Level 9 - Legit Video Overlay</title>
  <style>
    body { font-family: sans-serif; padding: 24px; }
    #player {
      width: 560px; height: 315px;
      background: #111; color: #eee;
      position: relative;
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    #overlayBtn {
      position: absolute;
      left: 50%; top: 50%;
      transform: translate(-50%, -50%);
      padding: 14px 18px;
      border-radius: 999px;
      background: rgba(255,255,255,0.15);
      cursor: pointer;
      user-select: none;
    }
    #status { margin-top: 12px; }
  </style>
</head>
<body>
  <h1>Level 9: Legit overlay controls</h1>
  <div id="player">
    <div id="overlayBtn">Play</div>
  </div>
  <div id="status">Status: paused</div>

  <p>Also a normal visible link: <a href="https://example.org" target="_blank" rel="noreferrer">Open docs</a></p>

  <script>
    let playing = false;
    const status = document.getElementById('status');
    document.getElementById('overlayBtn').addEventListener('click', () => {
      playing = !playing;
      status.textContent = 'Status: ' + (playing ? 'playing' : 'paused');
    });
  </script>
</body>
</html>
```

## Commands
### Run the Gym locally (simple HTTP server)
```bash
cd gym
python -m http.server 5173
```

### Create the repo
```bash
mkdir navsentinel
cd navsentinel
npm init -y
```

### Install dependencies
```bash
npm i -D vite typescript @crxjs/vite-plugin
npm i -D vitest @types/chrome
npm i -D playwright
```

### Run the Gym locally (repro step)
```bash
cd gym
python -m http.server 5173
```

### Build the extension
```bash
npm run build
```

### Run unit tests
```bash
npm run test
```
