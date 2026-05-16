/**
 * Onboarding page script.
 * Handles the "Get started" button and the options page link.
 */

const getStartedBtn = document.getElementById("getStarted") as HTMLButtonElement | null;
const openOptionsLink = document.getElementById("openOptions") as HTMLAnchorElement | null;

if (getStartedBtn) {
  getStartedBtn.addEventListener("click", () => {
    window.close();
  });
}

if (openOptionsLink) {
  openOptionsLink.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}
