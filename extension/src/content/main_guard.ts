// Stage 1: minimal indicator that MAIN world script ran.
// Later: patch window.open / location.assign / etc.
(() => {
  (window as any).__navsentinelMainGuard = true;
})();
