import { icon, logoSentinel } from "../shared/icons";

document.getElementById("logoSlot")!.innerHTML = logoSentinel(56, true);
document.getElementById("iconCursor")!.innerHTML = icon("cursor", 20, "var(--ns-cyan)");
document.getElementById("iconBolt")!.innerHTML = icon("bolt", 20, "var(--ns-cyan)");
document.getElementById("iconLock")!.innerHTML = icon("lock", 20, "var(--ns-green)");

const getStartedBtn = document.getElementById("getStarted") as HTMLButtonElement | null;
const openOptionsLink = document.getElementById("openOptions") as HTMLAnchorElement | null;

if (getStartedBtn) {
  getStartedBtn.addEventListener("click", () => {
    chrome.tabs.getCurrent().then((tab) => {
      if (tab?.id) chrome.tabs.remove(tab.id);
    }).catch(() => {
      window.close();
    });
  });
}

if (openOptionsLink) {
  openOptionsLink.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}
