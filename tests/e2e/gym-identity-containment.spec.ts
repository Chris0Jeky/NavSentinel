import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

type PolicyReceipt = { directive: string; disposition: string; trusted: boolean; blockedUri: string };

// URL-model fixtures, not live sign-in pages or extension efficacy evidence.
// Keep each original declared action, but require native CSP to forbid egress.
const fixtures = [
  ["bitb-oauth-window.html", "https://collector.example/take"],
  ["bitb-first-party-window.html", "https://accounts.google.com/signin"],
  ["homograph-mixed-script-login.html", "https://payp\u0430l.com/login"],
  ["homograph-real-paypal-login.html", "https://www.paypal.com/signin"],
  ["typosquat-paypa1-login.html", "https://paypa1.com/login"],
  ["typosquat-paypal-login.html", "https://www.paypal.com/signin"],
  ["subdomain-stuffing-login.html", "https://paypal.login.billing-example.invalid/signin"],
  ["subdomain-real-paypal-login.html", "https://www.paypal.com/signin"],
] as const;

for (const [fixture, declaredDestination] of fixtures) {
  const destination = new URL(declaredDestination).href;
  for (const activation of ["click", "enter", "submit", "requestSubmit"] as const) {
    test(`identity fixture ${fixture} contains ${activation} without egress @regression`, async ({ page, context }) => {
      const attempts: string[] = [];
      const receipts: PolicyReceipt[] = [];
      // Independent fail-closed transport guard: a broken fixture cannot send
      // even the synthetic values below to its external model destination.
      await context.route("**/*", async route => {
        attempts.push(`${route.request().method()} ${route.request().url()}`);
        await route.abort();
      });
      await page.setContent(readFileSync(new URL(`../../gym/${fixture}`, import.meta.url), "utf8"));
      await page.exposeBinding("__nsIdentityFixtureViolation", (source, receipt: PolicyReceipt) => {
        expect(source.page).toBe(page);
        expect(source.frame).toBe(page.mainFrame());
        receipts.push(receipt);
      });
      await page.evaluate(() => {
        const host = window as typeof window & { __nsIdentityFixtureViolation: (value: PolicyReceipt) => Promise<void> };
        addEventListener("securitypolicyviolation", event => {
          if (event.effectiveDirective === "form-action") {
            void host.__nsIdentityFixtureViolation({ directive: event.effectiveDirective,
              disposition: event.disposition, trusted: event.isTrusted, blockedUri: event.blockedURI });
          }
        });
      });
      // Native URL serialization must also preserve the IDN destination, rather
      // than replacing the test's declared host with a convenient local action.
      expect(await page.evaluate(() => document.querySelector("form")?.action)).toBe(destination);
      await page.locator("#email").fill("fixture@example.test");
      await page.locator("#password").fill("SYNTHETIC-NOT-A-SECRET");
      if (activation === "click") await page.locator("button[type=submit]").click({ noWaitAfter: true });
      else if (activation === "enter") await page.locator("#password").press("Enter", { noWaitAfter: true });
      else await page.evaluate(method => {
        const form = document.querySelector("form");
        if (!form) throw new Error("Fixture form is missing");
        form[method]();
      }, activation);
      await expect.poll(() => receipts).toEqual([
        { directive: "form-action", disposition: "enforce", trusted: true, blockedUri: destination },
      ]);
      expect(attempts).toEqual([]);
      expect(page.url()).toBe("about:blank");
      // Do not wait for a CSP-canceled navigation through a locator assertion.
      // Preserve the positive connected/painted form and exact action checks.
      await expect.poll(() => page.evaluate(() => {
        const form = document.querySelector("form");
        if (!form) return null;
        const bounds = form.getBoundingClientRect();
        return { href: location.href, connected: form.isConnected,
          visible: getComputedStyle(form).visibility === "visible" && bounds.width > 0 && bounds.height > 0,
          action: form.action, method: form.method };
      })).toEqual({ href: "about:blank", connected: true, visible: true, action: destination, method: "post" });
    });
  }
}
