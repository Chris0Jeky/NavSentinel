# NavSentinel — Chrome Web Store Review Preparation Checklist

## Pre-Submission Checklist

### Release Integrity
- [ ] AI-19 product-name search/domain/CWS/legal clearance recorded
- [ ] RI-01 injected UI is warn/cancel only; tab-bound extension-origin UI owns
  every proceed/allow/trust/resume action and resists redressing/tampering
- [ ] RI-02 visual-sim viewport capture and placeholder assets removed
- [ ] RI-07 beta capability profile proves fetch/XHR/beacon/password-value
  wrappers are off while core navigation protection remains active
- [ ] AI-9 release profile selected; package, claims, and privacy text agree
- [ ] Open PR branches refreshed; #356 green/reviewed before human Gate-3
- [ ] Persistent data is fully inventoried; URLs are minimized by purpose;
  exact session URLs have tab binding/TTL/tests; one complete reset exists

### Manifest Compliance
- [x] manifest_version: 3
- [x] No `unsafe-eval` in CSP
- [x] No remote code loading
- [ ] All permissions are used and justified in the exact beta package
- [x] `host_permissions: <all_urls>` justified (content scripts for click monitoring)
- [x] Icons at 16, 32, 48, 128px exist
- [ ] Version number bumped for submission

### Content Scripts
- [x] `capture_isolated.ts` — ISOLATED world, all URLs (navigation monitoring)
- [x] `main_guard.ts` — MAIN world, all URLs (API patching for interception)
- [x] `credential_guard.ts` — ISOLATED world, all URLs (form submit monitoring)
- [x] No eval(), no dynamic script injection, no Function() constructor
- [ ] Verify all content script paths resolve in built extension

### Privacy Compliance
- [x] No data transmitted externally
- [x] No telemetry or analytics
- [x] No user tracking
- [ ] PRIVACY.md re-verified after visual-sim/DNR/release-profile changes
- [ ] Privacy disclosure re-verified against the exact package
- [x] Single-purpose description prepared

### Store Listing
- [x] Short description (under 132 chars)
- [ ] Detailed description re-verified after final name/release profile
- [x] Category selected: Privacy & Security
- [ ] 1-5 screenshots captured (see SCREENSHOTS.md)
- [ ] Promotional tile (440x280)
- [ ] Promotional marquee tile (1400x560)

### Functionality
- [ ] Extension loads without errors on fresh install
- [ ] Onboarding page displays on first install
- [ ] Popup shows current site and controls
- [ ] Options page saves/loads settings
- [ ] Smart mode produces expected decisions on the declared core Gym scenarios
- [ ] Extension-origin proceed-once and persistent allow/trust flows work and
  stale/tab-switched pending actions fail closed
- [ ] Credential guard prompts on risky submits
- [ ] Representative normal-site journeys record no unexplained breakage or page
  errors and meet the declared startup/action latency and CPU budgets
- [ ] No console errors during normal browsing

### Manifest Pre-Submission
- [ ] Derive the oldest supported Chrome version from the exact APIs/features
  used, test that version, then set `minimum_chrome_version` in the manifest
- [ ] Remove the test-only DNR ruleset, options toggle, and both DNR permissions
  from the beta; redesign #242/#243 only when an exact bounded rule product exists

### Known Limitations to Document
- Oldest supported Chrome version remains unverified until the compatibility
  derivation/test above is complete
- Reputation coverage is absent unless AI-9 selects and validates a real-filter profile
- Public Suffix List is build-time snapshot
- Some CSP-restricted pages may prevent main-world patches
- The extension is complementary to built-in browser protection and does not
  validate every OAuth flow, app identity, or permission scope

## Post-Submission
- [ ] Monitor review status; timing can range from days to weeks, especially for
  broad host permissions—see the [official review guidance](https://developer.chrome.com/docs/webstore/review-process)
- [ ] Respond to any reviewer questions about permissions
- [ ] Update PRIVACY.md if reviewer requests changes
