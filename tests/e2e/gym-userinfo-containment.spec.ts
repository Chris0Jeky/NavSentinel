import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

type PolicyReceipt = {
  directive: string;
  disposition: string;
  trusted: boolean;
  blockedUri: string;
};

// These are local model fixtures, not a live login or an extension efficacy arm.
// Keep the real action attributes for URL scoring while native CSP contains
// submission, including paths that bypass a JavaScript submit listener.
for (const [fixture, destination] of [
  ["userinfo-obfuscated-login.html", "https://collector.example/login"],
  ["userinfo-real-google-login.html", "https://accounts.google.com/ServiceLogin"],
] as const) {
  for (const activation of ["click", "enter", "submit", "requestSubmit"] as const) {
    test(`userinfo fixture ${fixture} contains ${activation} without egress @regression`, async ({ page, context }) => {
      const attempts: string[] = [];
      const receipts: PolicyReceipt[] = [];
      // Fail closed independently of the fixture so the regression cannot send
      // even synthetic form values to an external endpoint if CSP is removed.
      await context.route("**/*", async route => {
        attempts.push(`${route.request().method()} ${route.request().url()}`);
        await route.abort();
      });
      await page.setContent(readFileSync(new URL(`../../gym/${fixture}`, import.meta.url), "utf8"));
      await page.exposeBinding("__nsFixtureFormViolation", (source, receipt: PolicyReceipt) => {
        expect(source.page).toBe(page);
        expect(source.frame).toBe(page.mainFrame());
        receipts.push(receipt);
      });
      await page.evaluate(() => {
        const host = window as typeof window & {
          __nsFixtureFormViolation: (receipt: PolicyReceipt) => Promise<void>;
        };
        addEventListener("securitypolicyviolation", event => {
          if (event.effectiveDirective === "form-action") {
            void host.__nsFixtureFormViolation({ directive: event.effectiveDirective,
              disposition: event.disposition, trusted: event.isTrusted, blockedUri: event.blockedURI });
          }
        });
      });
      await expect(page.locator("form")).toHaveAttribute("action", destination);
      await page.locator("#email").fill("fixture@example.test");
      await page.locator("#password").fill("SYNTHETIC-NOT-A-SECRET");
      if (activation === "click") await page.locator("button[type=submit]").click({ noWaitAfter: true });
      else if (activation === "enter") await page.locator("#password").press("Enter", { noWaitAfter: true });
      else await page.evaluate(method => {
        const form = document.querySelector("form");
        if (!form) throw new Error("Fixture form is missing");
        form[method]();
      }, activation);
      // No-request alone could pass because of an unrelated browser policy.
      // Require the browser's positive, enforced form-action violation instead.
      await expect.poll(() => receipts).toEqual([
        { directive: "form-action", disposition: "enforce", trusted: true, blockedUri: destination },
      ]);
      expect(attempts).toEqual([]);
      expect(page.url()).toBe("about:blank");
      // After a CSP-canceled submit, locator assertions can wait forever for
      // a navigation that will not commit. Read this fixed form's surviving
      // document and painted geometry directly; do not remove the visibility
      // or destination assertions, reload the page, or swallow the timeout.
      await expect.poll(() => page.evaluate(() => {
        const form = document.querySelector("form");
        if (!form) return null;
        const bounds = form.getBoundingClientRect();
        return { href: location.href, connected: form.isConnected,
          visible: getComputedStyle(form).visibility === "visible" && bounds.width > 0 && bounds.height > 0,
          action: form.action, method: form.method };
      })).toEqual({ href: "about:blank", connected: true, visible: true,
        action: destination, method: "post" });
    });
  }
}
