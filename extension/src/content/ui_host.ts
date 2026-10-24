/** Reattachment must also restore top-layer placement lost on removal. */
export function attachUiHost(host: HTMLElement): void {
  if (host.isConnected) return;
  document.documentElement.appendChild(host);
  try {
    if ("showPopover" in host) {
      host.setAttribute("popover", "manual");
      host.showPopover();
    }
  } catch {
    // Older engines and unsupported document states retain the z-index fallback.
  }
}
