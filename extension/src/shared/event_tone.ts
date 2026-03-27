import type { EventKind } from "./storage";

export type EventTone = "navigation" | "credential" | "config";

export function classifyEventTone(kind: EventKind | string): EventTone {
  if (typeof kind !== "string") return "navigation";
  if (kind.startsWith("cred_")) return "credential";
  if (kind.startsWith("suite_")) return "config";
  return "navigation";
}
