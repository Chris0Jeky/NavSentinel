import type { BrowserContext, Worker } from "@playwright/test";

export async function getServiceWorker(context: BrowserContext): Promise<Worker> {
  const existing = context.serviceWorkers()[0];
  if (existing) return existing;
  return context.waitForEvent("serviceworker");
}

export async function getExtensionId(context: BrowserContext): Promise<string> {
  const worker = await getServiceWorker(context);
  return new URL(worker.url()).host;
}
