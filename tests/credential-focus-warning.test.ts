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
    expect(code("https://paypa1.com/signin", ["paypal.com"])).toBe("LOOKALIKE_DOMAIN");
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

  it("ignores the brand-keyword prefix match (applebees.com is not apple)", () => {
    expect(code("https://www.applebees.com/login")).toBeNull();
    expect(code("https://paypal-community.com/login")).toBeNull();
  });

  it("exempts intranet names: single-label hosts and reserved private suffixes", () => {
    for (const url of ["http://intranet/", "http://nas:5000/", "http://printer.local/", "http://router.lan/",
      "http://wiki.internal/", "http://nas.home.arpa/", "http://hr.intranet/", "http://mail.corp/"]) {
      expect(code(url), url).toBeNull();
    }
    expect(code("http://intranet-portal.example/")).toBe("NON_HTTPS_PAGE");
    expect(code("http://login.local-bank.com/")).toBe("NON_HTTPS_PAGE");
  });

  it("never warns on a trusted site, even over http", () => {
    expect(code("http://intranet.corp-example.com/", ["corp-example.com"])).toBeNull();
    expect(code("http://intranet.corp-example.com/")).toBe("NON_HTTPS_PAGE");
  });

  it("never warns when credential protection is off", () => {
    expect(code("http://192.0.2.10/", [], off)).toBeNull();
    expect(code("https://paypa1.com/", [], off)).toBeNull();
  });

  it("exempts localhost, loopback and .test hosts", () => {
    for (const url of ["http://localhost:5173/", "http://app.localhost/", "http://127.0.0.1:8080/",
      "http://[::1]/", "http://shop.test/"]) {
      expect(code(url), url).toBeNull();
    }
    // A DNS name that merely starts with 127 is not loopback.
    expect(code("http://127.evil-example.com/")).toBe("NON_HTTPS_PAGE");
  });

  it("exempts private and link-local IP literals (router, NAS admin pages)", () => {
    for (const url of ["http://10.0.0.1/", "http://172.16.0.1/", "http://172.31.255.254/",
      "http://192.168.1.1/login", "http://169.254.10.20/", "http://127.8.9.10/",
      "http://[fc00::1]/", "http://[fd12:3456::1]/", "http://[fe80::1]/", "http://[febf::1]/",
      "http://100.64.0.1/", "http://100.127.255.254/", "http://[::ffff:10.1.2.3]/",
      "http://[::ffff:192.168.1.1]/", "http://[::ffff:172.20.0.1]/", "http://[::ffff:100.100.0.1]/"]) {
      expect(code(url), url).toBeNull();
    }
  });

  it("still warns on public IP literals next to the private ranges", () => {
    for (const [url, want] of [["http://172.15.0.1/", "IP_HOST"], ["http://172.32.0.1/", "IP_HOST"],
      ["https://8.8.8.8/", "IP_HOST"], ["http://203.0.113.24/", "IP_HOST"], ["http://192.169.0.1/", "IP_HOST"],
      ["http://[fec0::1]/", "IP_HOST"], ["http://[fc::1]/", "IP_HOST"], ["http://[2001:db8::1]/", "IP_HOST"],
      ["http://100.63.0.1/", "IP_HOST"], ["http://100.128.0.1/", "IP_HOST"], ["http://[::ffff:8.8.8.8]/", "IP_HOST"],
      ["http://[::ffff:172.32.0.1]/", "IP_HOST"]]) {
      expect(code(url!), url).toBe(want);
    }
  });

  it("stays silent on a pure IDN, but warns when punycode carries a lookalike signal", () => {
    expect(code("https://xn--mller-kva.de/anmelden")).toBeNull(); // müller.de
    expect(code("https://xn--bcher-kva.ch/")).toBeNull(); // bücher.ch
    expect(code("https://paypal.xn--mller-kva.de/")).toBe("SUBDOMAIN_STUFFING");
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
    // happy-dom has no trusted events; mark a user focus the way Chrome does.
    const focus = (el: Element, trusted = true): void => {
      const ev = new FocusEvent("focusin", { bubbles: true, composed: true });
      Object.defineProperty(ev, "isTrusted", { value: trusted });
      el.dispatchEvent(ev);
    };
    const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 50));

    // A page-dispatched focusin neither warns nor spends the once-per-page check.
    focus(field("password"), false);
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
      kind: "cred_paste_warn", site: "login.northwind.example", reasons: ["NON_HTTPS_PAGE", "PASSWORD_FOCUS_WARNING"],
      extra: { trigger: "password_focus" },
    })));

    focus(field("password"));
    await settle();
    expect(showToast).toHaveBeenCalledTimes(1);
  });
});

describe("password-focus warning for a relayed Microsoft sign-in form (AiTM)", () => {
  const field = (id: string, name: string): HTMLInputElement => {
    const input = document.createElement("input");
    input.type = "password";
    input.id = id;
    input.name = name;
    return input;
  };

  it("flags Microsoft's password field on any host that is not Microsoft's", async () => {
    const { isRelayedMicrosoftLogin } = await import("../extension/src/content/credential_focus_warning");
    expect(isRelayedMicrosoftLogin(field("i0118", "passwd"), "login.secure-docs-share.com")).toBe(true);
    for (const host of ["login.microsoftonline.com", "login.live.com", "login.microsoftonline.us", "login.windows.net", "login.chinacloudapi.cn", "contoso.ciamlogin.com"]) {
      expect(isRelayedMicrosoftLogin(field("i0118", "passwd"), host), host).toBe(false);
    }
    // Label boundaries, and parents that also host anyone's content.
    for (const host of ["evil-microsoftonline.com", "login.microsoftonline.com.evil.example", "phish.web.core.windows.net", "x.blob.core.chinacloudapi.cn", "tenant.b2clogin.com"]) {
      expect(isRelayedMicrosoftLogin(field("i0118", "passwd"), host), host).toBe(true);
    }
    // Ordinary password fields, and look-alikes of only one attribute, are not Microsoft's form.
    expect(isRelayedMicrosoftLogin(field("password", "password"), "acme.example")).toBe(false);
    expect(isRelayedMicrosoftLogin(field("i0118", "password"), "acme.example")).toBe(false);
    expect(isRelayedMicrosoftLogin(field("pw", "passwd"), "acme.example")).toBe(false);
  });

  it("warns at focus with no address signal, and never on an off-limits page", async () => {
    const { focusWarningReason, warnOnPasswordFocus } = await import("../extension/src/content/credential_focus_warning");
    vi.mocked(getCredentialSettings).mockResolvedValue(smart);
    vi.mocked(getTrustedDomains).mockResolvedValue([]);
    expect(focusWarningReason("https://login.secure-docs-share.com/", [], smart)).toBeNull();
    expect(focusWarningReason("https://login.secure-docs-share.com/", [], off)).toBeUndefined();
    vi.mocked(showToast).mockClear();
    vi.mocked(appendEvent).mockClear();
    await warnOnPasswordFocus("https://login.secure-docs-share.com/", field("i0118", "passwd"));
    expect(vi.mocked(showToast).mock.calls[0]?.[0].message).toContain("Microsoft's sign-in form, but it is served by login.secure-docs-share.com");
    expect(vi.mocked(showToast).mock.calls[0]?.[0].timeoutMs).toBe(0);
    expect(appendEvent).toHaveBeenCalledWith(expect.objectContaining({ reasons: ["RELAYED_MICROSOFT_LOGIN", "PASSWORD_FOCUS_WARNING"] }));
    vi.mocked(showToast).mockClear();
    await warnOnPasswordFocus("https://acme.example/login", field("password", "password"));
    await warnOnPasswordFocus("https://login.secure-docs-share.com/");
    expect(showToast).not.toHaveBeenCalled();
  });
});
