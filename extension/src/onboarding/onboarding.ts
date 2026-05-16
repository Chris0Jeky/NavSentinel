/**
 * Onboarding page script.
 * Handles the "Get started" button and the options page link.
 */

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
