import { expect, test } from "@playwright/test";
import { proceedDestinationUrl, waitForProceedDestination } from "../acceptance/proceed_destination";

// Harness-only regression: real browser document loading with a deliberately
// delayed local response. No extension, native input, or product efficacy claim.
test("Proceed destination waits beyond initial blank load for the exact document (#1028) @regression", async ({ page }) => {
  const expected = proceedDestinationUrl("http://127.0.0.1:46200/acceptance/held-blank.html", "NSACCCONTRACT");
  const networkUrl = expected.split("#")[0];
  let release!: () => void;
  let requested!: () => void;
  const responseGate = new Promise<void>((resolve) => { release = resolve; });
  const requestSeen = new Promise<void>((resolve) => { requested = resolve; });
  await page.route("**/*", async (route) => {
    if (route.request().url() !== networkUrl) return route.abort();
    requested();
    await responseGate;
    await route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head>
      <script>document.documentElement.dataset.acceptanceOpener = String(window.opener !== null);</script>
      </head><body>Controlled destination document</body></html>` });
  });
  // This is the predecessor seam: initial about:blank has already fired DCL,
  // even though no destination document has committed or initialized yet.
  await page.waitForLoadState("domcontentloaded");
  expect(page.url()).toBe("about:blank");
  let outcome: { ok: boolean; error?: unknown } | undefined;
  const ready = waitForProceedDestination(page, expected).then(
    () => { outcome = { ok: true }; }, (error: unknown) => { outcome = { ok: false, error }; },
  );
  const navigation = page.goto(expected, { waitUntil: "domcontentloaded" });
  try {
    await requestSeen;
    expect(page.url()).toBe("about:blank");
    expect(outcome, "the initial loaded blank must not resolve or fail the destination wait").toBeUndefined();
    release();
    await navigation;
    await ready;
    expect(outcome).toEqual({ ok: true });
    expect(page.url()).toBe(expected);
    expect(await page.evaluate(() => window.opener === null)).toBe(true);
    expect(await page.locator("html").getAttribute("data-acceptance-opener")).toBe("false");
  } finally {
    release();
    await Promise.allSettled([navigation, ready]);
  }
});
