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
