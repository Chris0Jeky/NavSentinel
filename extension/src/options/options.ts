import { getSettings, setSettings } from "../shared/storage";
import { getAllowlist, removeAllowlistEntry, clearAllowlist, type Allowlist } from "../shared/allowlist";
import type { Mode } from "../shared/types";

const modeEl = document.getElementById("mode") as HTMLSelectElement;
const debugEl = document.getElementById("debug") as HTMLInputElement;
const statusEl = document.getElementById("status") as HTMLSpanElement;
const saveBtn = document.getElementById("save") as HTMLButtonElement;
const allowlistEl = document.getElementById("allowlist") as HTMLDivElement;
const clearAllowlistBtn = document.getElementById("clearAllowlist") as HTMLButtonElement;

function setStatus(message: string) {
  statusEl.textContent = message;
  setTimeout(() => (statusEl.textContent = ""), 1200);
}

function renderAllowlist(list: Allowlist) {
  allowlistEl.innerHTML = "";
  const sites = Object.keys(list).sort();
  clearAllowlistBtn.disabled = sites.length === 0;

  if (sites.length === 0) {
    const empty = document.createElement("div");
    empty.className = "allowlist-empty";
    empty.textContent = "No allowlist entries yet.";
    allowlistEl.appendChild(empty);
    return;
  }

  for (const site of sites) {
    const siteRow = document.createElement("div");
    siteRow.className = "allowlist-site";

    const title = document.createElement("div");
    title.className = "allowlist-site-title";
    title.textContent = site;

    const hostList = document.createElement("div");
    hostList.className = "allowlist-hosts";

    const hosts = (list[site] ?? []).slice().sort();
    for (const host of hosts) {
      const hostRow = document.createElement("div");
      hostRow.className = "allowlist-host";

      const hostLabel = document.createElement("span");
      hostLabel.textContent = host;

      const removeBtn = document.createElement("button");
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", async () => {
        await removeAllowlistEntry(site, host);
        await refreshAllowlist();
        setStatus("Allowlist updated.");
      });

      hostRow.appendChild(hostLabel);
      hostRow.appendChild(removeBtn);
      hostList.appendChild(hostRow);
    }

    siteRow.appendChild(title);
    siteRow.appendChild(hostList);
    allowlistEl.appendChild(siteRow);
  }
}

async function refreshAllowlist() {
  const list = await getAllowlist();
  renderAllowlist(list);
}

async function init() {
  const s = await getSettings();
  modeEl.value = s.defaultMode;
  debugEl.checked = s.debug;
  await refreshAllowlist();
}

saveBtn.addEventListener("click", async () => {
  const m = modeEl.value as Mode;
  await setSettings({ defaultMode: m, debug: debugEl.checked });
  setStatus("Saved.");
});

clearAllowlistBtn.addEventListener("click", async () => {
  await clearAllowlist();
  await refreshAllowlist();
  setStatus("Allowlist cleared.");
});

init();
