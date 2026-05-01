# Phishing Corpus Validation Results

**Date**: 2026-05-01
**Task**: P1-06 (Real-world phishing test corpus)
**NavSentinel version**: 0.2.1

---

## Methodology

### Corpus source

- **Feed**: OpenPhish public feed (`openphish.com/feed.txt`)
- **PhishTank**: Feed attempted but most URLs failed to download (pages taken down)
- **Total URLs fetched**: 200 (from OpenPhish; PhishTank feed failed)
- **Successfully downloaded**: 101 HTML snapshots
- **Snapshot date**: 2026-05-01

### Test setup

1. Each snapshot served from a local HTTP server (`http://127.0.0.1:47000/`)
2. Chromium launched with NavSentinel extension loaded
3. Each page loaded with `domcontentloaded` wait
4. Extension initialization waited (up to 10s for `data-navsentinel-capture-ready`)
5. **User interactions simulated**:
   - On pages with password forms: fill dummy values, dispatch `SubmitEvent`
   - On all pages: click the first visible link (dispatches `MouseEvent`)
6. Detection checked via NavSentinel event log and UI elements (toast, credential modal at `#__sentinelsuite_cred_modal_host__`)

### Detection criteria

A page counts as a "true positive" if NavSentinel fires any of:
- `nav_blank_prompt` -- navigation to blank target prompted
- `nav_click_block` -- click blocked
- `nav_rollback` -- navigation rolled back
- `cred_submit_prompt` -- credential submission prompted
- `cred_paste_warn` -- paste into password field warned
- Toast notification or credential modal visible

### Limitations

This methodology has known limitations that affect detection rates:

1. **Same-origin serving**: All pages served from `127.0.0.1`, so cross-site
   domain signals are weaker than in live browsing (where the URL bar shows
   the real phishing domain).
2. **No network context**: Redirect chains, cross-origin iframes, and external
   resource loading are sandboxed by the local server's CSP.
3. **Static snapshots**: Pages may behave differently live (JavaScript-driven
   redirects, delayed DOM injection, API calls). Snapshots only capture the
   initial HTML response.
4. **Single interaction per page**: Only one form submit and one link click
   are attempted. Real users might interact more extensively.
5. **No content analysis yet**: NavSentinel does not yet have page content
   fingerprinting (planned for P2-04). Many phishing pages that mimic brand
   login forms are not detectable by interaction-level heuristics alone.
6. **Synthetic events**: Both form submission and link clicks are dispatched
   programmatically via `dispatchEvent()`, not through native Playwright clicks.
   This means `isTrusted` is false. The test dispatches `pointerdown` before
   `click` so that `capture_isolated.ts` populates `downForClick` context for
   NRS scoring, but the events are still untrusted. The navigation guard
   detection rate (24.2%) may be an undercount. Most `nav_rollback` detections
   appear to come from pages that auto-redirect (meta refresh, inline JS) rather
   than from the synthetic click, because untrusted click events do not cause
   the browser to follow anchor hrefs.
7. **Password form detection undercount**: The test searches for
   `input[type="password"]` in the DOM. Pages that inject password fields via
   JavaScript (which does not execute in static snapshots) or use non-standard
   input types (e.g., `type="text"` with CSS masking) are missed. The test
   found only 5 pages with detectable password forms; manual inspection of the
   snapshots suggests approximately 21 pages originally had password forms,
   with the remainder relying on dynamic JavaScript creation.

---

## Results

### Summary

| Metric | Value |
|--------|-------|
| Total in manifest | 200 |
| Testable snapshots | 101 |
| Successfully tested | 100 |
| Errors | 1 |
| **True positives (TP)** | **28** |
| **False negatives (FN)** | **72** |
| **Overall detection rate** | **28.0%** |

### Breakdown by page type

| Category | Pages | Detected | Rate |
|----------|-------|----------|------|
| Pages with password forms | 5 | 5 | **100.0%** |
| Pages without password forms | 95 | 23 | **24.2%** |

### Detection event types

| Event type | Count | Description |
|------------|-------|-------------|
| `nav_rollback` | 25+ | Navigation rolled back (pages with external links) |
| `cred_submit_prompt` | 5 | Credential submission blocked on untrusted domain |

---

## Analysis

### What NavSentinel detects well

1. **Credential harvesting forms (100% TP rate on detected forms)**: Every
   phishing page where the test found a `<input type="password">` in the DOM
   was detected when form submission was attempted (5/5). The credential guard
   correctly identifies untrusted domains and non-HTTPS pages attempting to
   collect passwords. **Caveat**: only 5 of an estimated 21 password-form pages
   were identified by the test selector -- the remainder likely use JavaScript
   to inject password fields dynamically, which does not execute in static
   snapshots (see Limitations #7).

2. **Pages with suspicious outbound links (~24%)**: Pages containing links
   that trigger NavSentinel's navigation guard (cross-origin navigation from
   a link click) were rolled back. This catches pages that redirect users
   to external phishing destinations.

### What NavSentinel misses (and why)

1. **Static phishing pages without password forms (72% of corpus)**: Many
   phishing pages in the OpenPhish feed are:
   - Cryptocurrency scam landing pages (no password form, just wallet connect)
   - Brand impersonation pages with no interactive elements
   - Redirect/URL shortener landing pages (served as static snapshots)
   - Package delivery phishing (DPD, etc.) with non-password forms

2. **Pages requiring network context**: Some phishing pages use JavaScript
   to redirect to the actual credential-harvesting page. In static snapshots,
   these redirects don't execute, so the final phishing form never loads.

3. **Content-based indicators**: NavSentinel does not yet analyze page content
   (brand/domain mismatch, phishing kit fingerprints). This is planned for
   Phase 2 (P2-04: Page content fingerprinting).

### Comparison to industry targets

From `docs/Project_Roadmap.md` "Industry benchmark targets":

| Metric | Target | Measured | Status |
|--------|--------|----------|--------|
| Clickjacking TP rate | > 80% | N/A (no clickjacking in corpus) | Not measured |
| Credential theft TP rate | > 50% | 100% (on password forms) | Exceeds target |
| Phishing URL TP rate | > 60% | 28% overall | Below target (expected pre-P2) |

The overall 28% rate is expected at this stage. NavSentinel is currently an
**interaction-level detector**, not a page-content scanner. The phishing URL TP
target of > 60% depends on Phase 2 features:
- P2-03: Local bloom filter URL reputation (catches known-bad domains)
- P2-04: Page content fingerprinting (catches brand/domain mismatch)

---

## Per-page results

### True positives (28 pages detected)

| # | URL | Events |
|---|-----|--------|
| 1 | `http://qrco.de/bgkr3a` | nav_rollback |
| 2 | `https://shingwish-gemini-balancer.zeabur.app/` | cred_submit_prompt, nav_rollback |
| 3 | `http://bafkreighdzwwvje2ziuphcw7jpnerrgckkrecgjzaivht3gqp3a6k2cerm.ipfs.dweb.link/` | nav_rollback |
| 4 | `https://channelhub.info/5132a94fde58e246a26b6265589qfef5aaee.html` | nav_rollback |
| 5 | `https://6425656.ru/.../linkh.html` | cred_submit_prompt |
| 6 | `http://f237u.xyz/` | nav_rollback x2 |
| 7 | `http://g89c.xyz/` | nav_rollback x2 |
| 8 | `http://j325m.xyz/` | nav_rollback |
| 9 | `https://www.admin.preprod.pearson367.com/` | nav_rollback x3 |
| 10 | `http://www.u96t.xyz/` | nav_rollback |
| 11 | `http://heron-emu-4rdg.squarespace.com/` | nav_rollback |
| 12 | `https://www.api.portal.artelepresence.com/` | nav_rollback |
| 13 | `https://myybusinesspage.serv00.net/` | cred_submit_prompt, nav_rollback |
| 14 | `http://j331g.xyz/` | nav_rollback |
| 15 | `http://meta-very.program-ads-agency.com/` | nav_rollback |
| 16 | `https://dzhbqdrq.elementor.cloud/.../index.html` | cred_submit_prompt |
| 17 | `http://www.t51q.xyz/` | nav_rollback |
| 18 | `http://account-connect.credit-agency-meta.com/` | nav_rollback |
| 19 | `http://h103n.xyz/` | nav_rollback |
| 20 | `https://redirect-bd3ec739.vercel.app/` | nav_rollback |
| 21 | `https://ipfs.io/ipfs/bafkreiap7ms7...` | cred_submit_prompt |
| 22 | `http://y214c.xyz/` | nav_rollback x2 |
| 23 | `http://j319s.xyz/` | nav_rollback x2 |
| 24 | `http://q-r.to/bgkr3a` | nav_rollback |
| 25 | `http://www.y209m.xyz/` | nav_rollback x2 |
| 26 | `https://channelhub.info/5b5867330e82...` | nav_rollback x2 |
| 27 | `http://j313g.xyz/` | nav_rollback |
| 28 | `http://us-mettaa-mask_loggin.godaddysites.com/` | nav_rollback |

### Errors (1 page)

| URL | Error |
|-----|-------|
| `https://dpdbitkouyem-rlsaq0in-mhd0c9gt.s3.amazonaws.com/dpd.html` | Execution context destroyed (page self-navigated) |

---

## Recommendations

### Immediate (no code changes needed)

1. Re-run corpus validation periodically with fresh snapshots as feeds update.
2. Investigate why some password-form pages were not detected as having password
   forms (the test found only 5 of the 21 password-form snapshots -- some may
   use dynamically-created password fields or non-standard input types).

### Phase 2 priorities informed by this run

1. **P2-03 (Bloom filter)**: Would catch many of the .xyz, .shop, and other
   suspicious TLD pages that were missed. These domains are likely on known-bad
   domain lists.
2. **P2-04 (Content fingerprinting)**: Would catch brand impersonation pages
   (PayPal clones, MetaMask clones, Amazon clones) that currently pass undetected
   because they don't trigger interaction-level heuristics.
3. **P2-07 (DOM mutation monitoring)**: Would catch pages that inject credential
   forms after initial load.

### Test infrastructure improvements

1. Consider using Playwright's `page.type()` instead of `value` assignment for
   even more realistic form interaction (the test now dispatches `input`/`change`
   events after setting values, but `page.type()` would also produce per-key
   `keydown`/`keyup` events).
2. Add scroll-and-wait to trigger lazy-loaded content.
3. Consider serving pages on a mock domain (not 127.0.0.1) to enable
   domain-based heuristics to fire more realistically.
4. Investigate whether synthetic (untrusted) clicks contribute any detections
   at all, since the browser does not follow anchor hrefs for untrusted events.
   The nav_rollback detections may come entirely from auto-redirect behavior
   in the phishing pages themselves.
