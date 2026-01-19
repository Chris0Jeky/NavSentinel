import type { Mode } from "./types";

export interface Settings {
  defaultMode: Mode;
  debug: boolean;
}

export const SETTINGS_KEY = "navsentinel:settings";

const DEFAULT_SETTINGS: Settings = {
  defaultMode: "smart",
  debug: false
};

export async function getSettings(): Promise<Settings> {
  const res = await chrome.storage.local.get(SETTINGS_KEY);
  const stored = res[SETTINGS_KEY] as Settings | undefined;
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
}

export async function setSettings(s: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: s });
}

export function onSettingsChange(cb: (s: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    const change = changes[SETTINGS_KEY];
    if (!change) return;
    const next = (change.newValue as Settings | undefined) ?? DEFAULT_SETTINGS;
    cb({ ...DEFAULT_SETTINGS, ...next });
  });
}
