import type { ClickContext, ElementHint } from "../shared/scoring";
import type { Mode } from "../shared/types";

export type DebugInfo = {
  mode: Mode;
  decision: "allow" | "block";
  cds: number;
  reasonCodes: string[];
  ctx: ClickContext;
};

let enabled = false;
let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;
let pre: HTMLPreElement | null = null;

function ensureHost(): void {
  if (host && root && pre) return;

  host = document.createElement("div");
  host.id = "__navsentinel_debug_host";
  host.style.all = "initial";
  host.style.position = "fixed";
  host.style.left = "16px";
  host.style.bottom = "16px";
  host.style.zIndex = "2147483647";
  host.style.pointerEvents = "none";

  root = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = `
    .panel {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11px;
      line-height: 1.4;
      color: #e6e6e6;
      background: rgba(10, 10, 10, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 10px;
      padding: 10px 12px;
      width: 340px;
      white-space: pre-wrap;
    }
  `;
  root.appendChild(style);

  pre = document.createElement("pre");
  pre.className = "panel";
  pre.textContent = "NavSentinel debug enabled...";

  root.appendChild(pre);
  document.documentElement.appendChild(host);
}

function formatElement(h: ElementHint): string {
  const role = h.role ? `/${h.role}` : "";
  return `${h.tag}${role}`;
}

function formatRect(h: ElementHint): string {
  if (!h.rect) return "n/a";
  return `${Math.round(h.rect.w)}x${Math.round(h.rect.h)}`;
}

function formatReasons(reasons: string[]): string {
  return reasons.length ? reasons.join(", ") : "none";
}

export function setDebugEnabled(value: boolean): void {
  enabled = value;
  if (!enabled) {
    if (host) host.remove();
    host = null;
    root = null;
    pre = null;
    return;
  }
  ensureHost();
}

export function updateDebugOverlay(info: DebugInfo): void {
  if (!enabled) return;
  ensureHost();
  if (!pre) return;

  const top = info.ctx.top;
  const under = info.ctx.underlying;

  const lines = [
    "NavSentinel Debug",
    `Mode: ${info.mode}`,
    `Decision: ${info.decision}`,
    `CDS: ${info.cds}`,
    `Reasons: ${formatReasons(info.reasonCodes)}`,
    `Top: ${formatElement(top)} (${formatRect(top)})`,
    `Under: ${under ? `${formatElement(under)} (${formatRect(under)})` : "none"}`,
    `Retargeted: ${info.ctx.retargeted ? "yes" : "no"}`,
    `LegitBackdrop: ${info.ctx.isLegitModalBackdrop ? "yes" : "no"}`,
    `ExplicitNewTab: ${info.ctx.explicitNewTabIntent ? "yes" : "no"}`
  ];

  pre.textContent = lines.join("\n");
}
