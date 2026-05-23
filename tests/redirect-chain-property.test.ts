import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import {
  isKnownRedirector,
  RedirectChainTracker,
} from "../extension/src/shared/redirect_chain";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const arbDomain = fc.string({ minLength: 1, maxLength: 30 })
  .filter((s) => /^[a-z0-9.-]+$/.test(s) && !s.startsWith(".") && !s.endsWith("."));

const arbPath = fc.string({ maxLength: 30 })
  .map((s) => "/" + s.replace(/[^a-zA-Z0-9/_.-]/g, ""));

const arbHttpUrl = fc.tuple(
  fc.constantFrom("http", "https"),
  arbDomain,
  arbPath,
  fc.array(
    fc.tuple(
      fc.constantFrom("q", "page", "id", "ref", "sort", "lang", "v"),
      fc.string({ minLength: 1, maxLength: 15 }).map((s) => s.replace(/[^a-zA-Z0-9]/g, "a"))
    ),
    { maxLength: 3 }
  )
).map(([scheme, domain, path, params]) => {
  const qs = params.map(([k, v]) => `${k}=${v}`).join("&");
  return `${scheme}://${domain}${path}${qs ? "?" + qs : ""}`;
}).filter((url) => {
  try { new URL(url); return true; } catch { return false; }
});

const arbTabId = fc.integer({ min: 1, max: 10000 });

const arbTimestamp = fc.integer({ min: 1_700_000_000_000, max: 1_800_000_000_000 });

const arbTransitionType = fc.constantFrom(
  "link", "typed", "auto_bookmark", "auto_subframe",
  "manual_subframe", "generated", "auto_toplevel", "form_submit", "reload"
);

// ---------------------------------------------------------------------------
// isKnownRedirector property tests
// ---------------------------------------------------------------------------

describe("isKnownRedirector property tests", () => {
  it("never throws on arbitrary HTTP URLs", () => {
    fc.assert(
      fc.property(arbHttpUrl, (url) => {
        const result = isKnownRedirector(url);
        expect(typeof result).toBe("boolean");
      }),
      { numRuns: 500 }
    );
  });

  it("never throws on arbitrary strings (including non-URLs)", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (input) => {
        const result = isKnownRedirector(input);
        expect(typeof result).toBe("boolean");
      }),
      { numRuns: 300 }
    );
  });

  it("always returns false for empty string", () => {
    expect(isKnownRedirector("")).toBe(false);
  });

  it("always detects known shortener domains regardless of path/query", () => {
    const shorteners = ["bit.ly", "t.co", "goo.gl", "tinyurl.com", "ow.ly", "is.gd", "buff.ly", "rebrand.ly"];
    fc.assert(
      fc.property(
        fc.constantFrom(...shorteners),
        arbPath,
        (domain, path) => {
          const url = `https://${domain}${path}`;
          expect(isKnownRedirector(url)).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("always detects redirect query parameters regardless of domain", () => {
    const redirectParams = ["url", "redirect", "redirect_uri", "redirect_url", "goto", "dest", "return_to"];
    fc.assert(
      fc.property(
        arbDomain,
        fc.constantFrom(...redirectParams),
        fc.string({ minLength: 1, maxLength: 30 }).map((s) => s.replace(/[^a-zA-Z0-9]/g, "x")),
        (domain, param, value) => {
          const url = `https://${domain}/?${param}=${value}`;
          try { new URL(url); } catch { return; }
          expect(isKnownRedirector(url)).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("never flags allowlisted tracking-prefix domains", () => {
    const allowlisted = [
      "go.microsoft.com", "go.dev", "go.googleprod.com",
      "go.google.com", "click.mailchimp.com", "click.convertkit.com",
      "click.pstmrk.it"
    ];
    fc.assert(
      fc.property(
        fc.constantFrom(...allowlisted),
        arbPath,
        (domain, path) => {
          const url = `https://${domain}${path}`;
          expect(isKnownRedirector(url)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("detects tracking-prefix subdomains for non-allowlisted domains", () => {
    const prefixes = ["click.", "track.", "redirect.", "go.", "redir."];
    const allowlisted = new Set([
      "go.microsoft.com", "go.dev", "go.googleprod.com",
      "go.google.com", "click.mailchimp.com", "click.convertkit.com",
      "click.pstmrk.it"
    ]);
    fc.assert(
      fc.property(
        fc.constantFrom(...prefixes),
        fc.constantFrom("example.com", "evil.test", "phish.net", "scam.org"),
        (prefix, baseDomain) => {
          const hostname = prefix + baseDomain;
          const url = `https://${hostname}/path`;
          if (!allowlisted.has(hostname)) {
            expect(isKnownRedirector(url)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("is case-insensitive for hostname matching", () => {
    fc.assert(
      fc.property(arbHttpUrl, (url) => {
        const lower = isKnownRedirector(url.toLowerCase());
        const upper = isKnownRedirector(url.toUpperCase());
        expect(lower).toBe(upper);
      }),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// RedirectChainTracker property tests
// ---------------------------------------------------------------------------

describe("RedirectChainTracker property tests", () => {
  it("single hop never produces a chain", () => {
    fc.assert(
      fc.property(arbTabId, arbHttpUrl, arbTimestamp, arbTransitionType, (tabId, url, ts, tt) => {
        const tracker = new RedirectChainTracker();
        tracker.recordHop(tabId, url, ts, tt);
        expect(tracker.getChainInfo(tabId)).toBeNull();
      }),
      { numRuns: 200 }
    );
  });

  it("two hops within window always produce depth=2", () => {
    fc.assert(
      fc.property(
        arbTabId,
        arbHttpUrl, arbHttpUrl,
        arbTimestamp,
        fc.integer({ min: 0, max: 9999 }),
        arbTransitionType, arbTransitionType,
        (tabId, url1, url2, ts1, delta, tt1, tt2) => {
          const tracker = new RedirectChainTracker();
          tracker.recordHop(tabId, url1, ts1, tt1);
          tracker.recordHop(tabId, url2, ts1 + delta, tt2);
          const info = tracker.getChainInfo(tabId);
          expect(info).not.toBeNull();
          expect(info!.depth).toBe(2);
        }
      ),
      { numRuns: 200 }
    );
  });

  it("hops outside 10s window start a new chain (single hop = no chain)", () => {
    fc.assert(
      fc.property(
        arbTabId,
        arbHttpUrl, arbHttpUrl,
        arbTimestamp,
        fc.integer({ min: 10001, max: 100000 }),
        arbTransitionType, arbTransitionType,
        (tabId, url1, url2, ts1, gap, tt1, tt2) => {
          const tracker = new RedirectChainTracker();
          tracker.recordHop(tabId, url1, ts1, tt1);
          tracker.recordHop(tabId, url2, ts1 + gap, tt2);
          expect(tracker.getChainInfo(tabId)).toBeNull();
        }
      ),
      { numRuns: 200 }
    );
  });

  it("chain depth never exceeds 10 hops", () => {
    fc.assert(
      fc.property(
        arbTabId,
        fc.array(
          fc.tuple(arbHttpUrl, fc.integer({ min: 1, max: 100 }), arbTransitionType),
          { minLength: 2, maxLength: 20 }
        ),
        arbTimestamp,
        (tabId, hops, startTs) => {
          const tracker = new RedirectChainTracker();
          let ts = startTs;
          for (const [url, delta, tt] of hops) {
            tracker.recordHop(tabId, url, ts, tt);
            ts += delta;
          }
          const info = tracker.getChainInfo(tabId);
          if (info) {
            expect(info.depth).toBeLessThanOrEqual(10);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("deleteTab always removes chain for that tab", () => {
    fc.assert(
      fc.property(
        arbTabId,
        fc.array(
          fc.tuple(arbHttpUrl, fc.integer({ min: 1, max: 100 }), arbTransitionType),
          { minLength: 2, maxLength: 5 }
        ),
        arbTimestamp,
        (tabId, hops, startTs) => {
          const tracker = new RedirectChainTracker();
          let ts = startTs;
          for (const [url, delta, tt] of hops) {
            tracker.recordHop(tabId, url, ts, tt);
            ts += delta;
          }
          tracker.deleteTab(tabId);
          expect(tracker.getChainInfo(tabId)).toBeNull();
          expect(tracker.hasActiveChain(tabId, ts)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("different tabs have independent chains", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5000 }),
        fc.integer({ min: 5001, max: 10000 }),
        arbHttpUrl, arbHttpUrl, arbHttpUrl,
        arbTimestamp,
        arbTransitionType,
        (tabA, tabB, url1, url2, url3, ts, tt) => {
          const tracker = new RedirectChainTracker();
          tracker.recordHop(tabA, url1, ts, tt);
          tracker.recordHop(tabA, url2, ts + 100, tt);
          tracker.recordHop(tabB, url3, ts, tt);

          const infoA = tracker.getChainInfo(tabA);
          const infoB = tracker.getChainInfo(tabB);
          expect(infoA).not.toBeNull();
          expect(infoA!.depth).toBe(2);
          expect(infoB).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("stale chains (>15s since last hop) are pruned on next recordHop", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4999 }),
        fc.integer({ min: 5000, max: 9999 }),
        arbHttpUrl, arbHttpUrl, arbHttpUrl,
        arbTimestamp,
        arbTransitionType,
        (staleTab, freshTab, url1, url2, url3, ts, tt) => {
          const tracker = new RedirectChainTracker();
          tracker.recordHop(staleTab, url1, ts, tt);
          tracker.recordHop(staleTab, url2, ts + 100, tt);

          tracker.recordHop(freshTab, url3, ts + 100 + 15001, tt);
          expect(tracker.getChainInfo(staleTab)).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it("map size never exceeds 100 entries", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.integer({ min: 1, max: 200 }),
            arbHttpUrl,
            arbTransitionType
          ),
          { minLength: 101, maxLength: 120 }
        ),
        arbTimestamp,
        (entries, startTs) => {
          const tracker = new RedirectChainTracker();
          let ts = startTs;
          for (const [tabId, url, tt] of entries) {
            tracker.recordHop(tabId, url, ts, tt);
            ts += 20000;
          }
          expect(tracker.size).toBeLessThanOrEqual(100);
        }
      ),
      { numRuns: 50 }
    );
  });

  it("hasActiveChain is consistent with chain freshness", () => {
    fc.assert(
      fc.property(
        arbTabId,
        arbHttpUrl, arbHttpUrl,
        arbTimestamp,
        fc.integer({ min: 1, max: 5000 }),
        arbTransitionType,
        (tabId, url1, url2, ts, delta, tt) => {
          const tracker = new RedirectChainTracker();
          tracker.recordHop(tabId, url1, ts, tt);
          tracker.recordHop(tabId, url2, ts + delta, tt);

          const now = ts + delta + 1;
          const hasActive = tracker.hasActiveChain(tabId, now);
          const info = tracker.getChainInfo(tabId);

          if (info && info.depth >= 2) {
            expect(hasActive).toBe(true);
          }
        }
      ),
      { numRuns: 200 }
    );
  });

  it("knownRedirectorHops count is always <= depth", () => {
    fc.assert(
      fc.property(
        arbTabId,
        fc.array(
          fc.tuple(arbHttpUrl, fc.integer({ min: 1, max: 100 }), arbTransitionType),
          { minLength: 2, maxLength: 10 }
        ),
        arbTimestamp,
        (tabId, hops, startTs) => {
          const tracker = new RedirectChainTracker();
          let ts = startTs;
          for (const [url, delta, tt] of hops) {
            tracker.recordHop(tabId, url, ts, tt);
            ts += delta;
          }
          const info = tracker.getChainInfo(tabId);
          if (info) {
            expect(info.knownRedirectorHops).toBeLessThanOrEqual(info.depth);
          }
        }
      ),
      { numRuns: 200 }
    );
  });
});
