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
