import assert from "node:assert/strict";
import type { Page } from "@playwright/test";

/** Exact synthetic destination of held-blank.html, never a page-reported URL. */
export function proceedDestinationUrl(sourceUrl: string, marker: string): string {
  const url = new URL(sourceUrl);
  assert.ok(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname));
  assert.match(marker, /^NSACC[A-Z0-9]+$/);
  url.hostname = url.hostname === "127.0.0.1" ? "localhost" : "127.0.0.1";
  url.pathname = `/acceptance/dest/${marker}/landing.html`;
  url.search = `?probe=${marker}`;
  url.hash = `frag-${marker}`;
  return url.href;
}

/** Wait for this destination document, not the already-loaded initial blank. */
export async function waitForProceedDestination(page: Page, expectedUrl: string): Promise<void> {
  // waitForLoadState can resolve for the initial empty/about:blank document.
  // Predicate matching also avoids treating query/fragment text as a glob.
  await page.waitForURL((url) => url.href === expectedUrl, {
    waitUntil: "domcontentloaded", timeout: 5000,
  });
  assert.equal(page.url(), expectedUrl, "Proceed once must reach its exact full destination");
  const documentState = await page.evaluate(() => ({
    href: location.href,
    openerless: window.opener === null,
    fixtureOpener: document.documentElement.dataset.acceptanceOpener,
  }));
  assert.equal(documentState.href, expectedUrl, "the evaluated document must be the destination");
  assert.equal(documentState.openerless, true, "Proceed once must preserve opener isolation");
  assert.equal(documentState.fixtureOpener, "false", "the destination's startup script must have run");
}
