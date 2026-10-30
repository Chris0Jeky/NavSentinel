// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("../extension/src/shared/storage", () => ({
  getCredentialSettings: vi.fn(),
  getTrustedDomains: vi.fn(),
  addTrustedDomain: vi.fn(),
  appendEvent: vi.fn(),
  appendPromptOutcome: vi.fn(),
  onSuiteSettingsChange: vi.fn(),
}));
vi.mock("../extension/src/content/ui_toast", () => ({ showToast: vi.fn() }));
vi.mock("../extension/src/content/credential_modal", () => ({ showCredentialModal: vi.fn() }));

import { appendEvent, getCredentialSettings, getTrustedDomains, type CredentialSettings } from "../extension/src/shared/storage";
import { showToast } from "../extension/src/content/ui_toast";
import { focusWarningMessage, focusWarningReason } from "../extension/src/content/credential_focus_warning";

const smart: CredentialSettings = {
  mode: "smart",
  promptOnUntrustedDomain: true,
  promptOnMediumRisk: true,
  mediumRiskThreshold: 40,
  blockHttpPasswordSubmit: true,
  warnOnPaste: true,
  similarity: { enabled: true, maxDistance: 2 },
};
const strict: CredentialSettings = { ...smart, mode: "strict" };
const off: CredentialSettings = { ...smart, mode: "off" };

const code = (url: string, trusted: string[] = [], cfg = smart): string | null =>
  focusWarningReason(url, trusted, cfg)?.code ?? null;

describe("focusWarningReason (#1170)", () => {
  it("warns on each strong page-address signal", () => {
    expect(code("http://login.northwind.example/")).toBe("NON_HTTPS_PAGE");
    expect(code("https://192.0.2.10/signin")).toBe("IP_HOST");
    expect(code("https://[2001:db8::1]/signin")).toBe("IP_HOST");
    expect(code("https://xn--pypal-4ve.com/signin")).toBe("PUNYCODE_HOST");
    expect(code("https://paypa1.com/signin")).toBe("BRAND_KEYWORD_DOMAIN");
    expect(code("https://paypal.login.billing-example.com/")).toBe("SUBDOMAIN_STUFFING");
    expect(code("https://gooogle.com/", ["google.com"])).toBe("LOOKALIKE_DOMAIN");
  });

  it("stays silent on a benign login and on weak-only signals", () => {
    expect(code("https://login.northwind.example/")).toBeNull();
    expect(code("https://www.wikipedia.org/")).toBeNull();
    // Untrusted plus deep subdomain scores LOW: never a focus warning.
    expect(code("https://a.b.c.d.northwind.example/")).toBeNull();
    // The real brand domain is not its own lookalike.
    expect(code("https://www.paypal.com/signin")).toBeNull();
  });

  it("never warns on a trusted site, even over http", () => {
    expect(code("http://intranet.corp-example.com/", ["corp-example.com"])).toBeNull();
    expect(code("http://intranet.corp-example.com/")).toBe("NON_HTTPS_PAGE");
  });

  it("never warns when credential protection is off", () => {
    expect(code("http://192.0.2.10/", [], off)).toBeNull();
    expect(code("https://xn--pypal-4ve.com/", [], off)).toBeNull();
  });

  it("exempts localhost, loopback and .test hosts", () => {
    for (const url of ["http://localhost:5173/", "http://app.localhost/", "http://127.0.0.1:8080/",
      "http://[::1]/", "http://shop.test/"]) {
      expect(code(url), url).toBeNull();
    }
    // A DNS name that merely starts with 127 is not loopback.
    expect(code("http://127.evil-example.com/")).toBe("NON_HTTPS_PAGE");
  });

  it("treats strict like smart: the page model does not depend on mode", () => {
    expect(code("https://192.0.2.10/", [], strict)).toBe("IP_HOST");
    expect(code("https://login.northwind.example/", [], strict)).toBeNull();
  });

  it("ignores opaque pages with no host", () => {
    expect(code("about:blank")).toBeNull();
    expect(code("data:text/html,x")).toBeNull();
  });

  it("phrases the toast calmly with the registry reason", () => {
    expect(focusWarningMessage("IP_HOST")).toBe(
      "Heedline: this page's address looks risky for a password (the page address is a raw IP number, unusual for a real sign-in page). Check the address before typing."
    );
  });
});

describe("gym/fetch-login-phish.html and gym/fetch-login-benign.html", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const canonical = (name: string): string => {
    const html = readFileSync(resolve(root, "gym", name), "utf8");
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelector("form"), `${name} must not use a form`).toBeNull();
    expect(html).toMatch(/connect-src 'none'/);
    return doc.querySelector('link[rel="canonical"]')!.getAttribute("href")!;
  };

  it("warns for the fetch-only kit model and not for its contrast", () => {
    expect(code(canonical("fetch-login-phish.html"))).not.toBeNull();
    expect(code(canonical("fetch-login-benign.html"))).toBeNull();
  });
});

describe("credential_guard password-focus hook", () => {
  it("checks once per page, only for a visible enabled password field", async () => {
    Object.defineProperty(window, "location", {
      value: new URL("http://login.northwind.example/signin"), writable: true, configurable: true,
    });
    vi.mocked(getCredentialSettings).mockResolvedValue(smart);
    vi.mocked(getTrustedDomains).mockResolvedValue([]);
    vi.mocked(appendEvent).mockResolvedValue(undefined);
    await import("../extension/src/content/credential_guard");

    const field = (type: string, style = "", disabled = false): HTMLInputElement => {
      const el = document.createElement("input");
      el.type = type;
      el.setAttribute("style", style);
      el.disabled = disabled;
      document.body.appendChild(el);
      return el;
    };
    const focus = (el: Element): void => {
      el.dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true }));
    };
    const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 50));

    focus(field("text"));
    focus(field("password", "display:none"));
    focus(field("password", "", true));
    await settle();
    expect(showToast).not.toHaveBeenCalled();

    focus(field("password"));
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledTimes(1));
    expect(vi.mocked(showToast).mock.calls[0]![0]).toEqual({
      message: focusWarningMessage("NON_HTTPS_PAGE"),
      timeoutMs: 12000,
    });
    await vi.waitFor(() => expect(appendEvent).toHaveBeenCalledWith(expect.objectContaining({
      kind: "cred_paste_warn", site: "login.northwind.example", reasons: ["NON_HTTPS_PAGE"],
      extra: { trigger: "password_focus" },
    })));

    focus(field("password"));
    await settle();
    expect(showToast).toHaveBeenCalledTimes(1);
  });
});
