import { getSettings, setSettings } from "../shared/storage";
import type { Mode } from "../shared/types";

const modeEl = document.getElementById("mode") as HTMLSelectElement;
const debugEl = document.getElementById("debug") as HTMLInputElement;
const statusEl = document.getElementById("status") as HTMLSpanElement;
const saveBtn = document.getElementById("save") as HTMLButtonElement;

async function init() {
  const s = await getSettings();
  modeEl.value = s.defaultMode;
  debugEl.checked = s.debug;
}

saveBtn.addEventListener("click", async () => {
  const m = modeEl.value as Mode;
  await setSettings({ defaultMode: m, debug: debugEl.checked });
  statusEl.textContent = "Saved.";
  setTimeout(() => (statusEl.textContent = ""), 1000);
});

init();
