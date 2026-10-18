/** Authored attack scheduling only; this fixture never grants product authority. */
export function installDeferredPointerdownNavigation(
  { targetUrl, marker }: { targetUrl: string; marker: string },
): void {
  const anchor = document.createElement("a");
  anchor.href = targetUrl;
  anchor.textContent = "Delayed synthetic cross-site navigation";
  anchor.style.cssText = "position:fixed;left:-9999px;top:-9999px";
  anchor.addEventListener("click", (event) => {
    console.log(`${marker} click ${event.isTrusted}`);
  });
  document.body.appendChild(anchor);

  const released = new Promise<void>((resolve) => {
    document.addEventListener(`${marker}:release`, () => resolve(), { once: true });
  });
  const button = document.createElement("button");
  button.id = "trusted-pointerdown-only";
  button.textContent = "Trusted pointerdown only";
  button.style.cssText =
    "position:fixed;left:0;top:0;width:160px;height:120px;z-index:2147483647";
  button.addEventListener("pointerdown", (event) => {
    console.log(`${marker} pointerdown ${event.isTrusted}`);
    // Keep the original minimum delay, but do not race the worker's authority
    // observation. Promise.all and once:true release exactly one synthetic click.
    const delayed = new Promise<void>((resolve) => window.setTimeout(resolve, 150));
    void Promise.all([released, delayed]).then(() => anchor.click());
  }, { once: true });
  document.body.appendChild(button);
}
