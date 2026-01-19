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
