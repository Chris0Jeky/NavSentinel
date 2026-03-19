import type { BrowserContext, Page, Worker } from "@playwright/test";

export async function getServiceWorker(context: BrowserContext): Promise<Worker> {
  const existing = context.serviceWorkers()[0];
  if (existing) return existing;
  return context.waitForEvent("serviceworker");
}

export async function getExtensionId(context: BrowserContext): Promise<string> {
  const worker = await getServiceWorker(context);
  return new URL(worker.url()).host;
}

export async function waitForNavSentinelBridge(page: Page, timeout = 5000): Promise<void> {
  await page.waitForFunction(
    () =>
      (window as { __navsentinelMainGuard?: boolean }).__navsentinelMainGuard === true ||
      document.documentElement.getAttribute("data-navsentinel-bridge-ready") === "1",
    null,
    { timeout }
  );
}

export async function waitForToastText(page: Page, text: string, timeout = 4000): Promise<void> {
  await page.waitForFunction(
    (expected) => {
      const host = document.querySelector("#__navsentinel_toast_host");
      const root = host?.shadowRoot;
      return !!root?.textContent?.includes(expected);
    },
    text,
    { timeout }
  );
}
