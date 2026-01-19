import type { Mode } from "./types";

export interface Settings {
  defaultMode: Mode;
}

const KEY = "navsentinel:settings";

export async function getSettings(): Promise<Settings> {
  const res = await chrome.storage.local.get(KEY);
  return (res[KEY] as Settings) ?? { defaultMode: "smart" };
}

export async function setSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({ [KEY]: s });
}
