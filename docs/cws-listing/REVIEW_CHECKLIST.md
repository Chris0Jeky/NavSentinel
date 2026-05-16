# NavSentinel — Chrome Web Store Review Preparation Checklist

## Pre-Submission Checklist

### Manifest Compliance
- [x] manifest_version: 3
- [x] No `unsafe-eval` in CSP
- [x] No remote code loading
- [x] All permissions justified (see PRIVACY_DISCLOSURE.md)
- [x] `host_permissions: <all_urls>` justified (content scripts for click monitoring)
- [ ] Icons at 16, 32, 48, 128px (verify assets exist)
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
- [x] PRIVACY.md up to date
- [x] Privacy disclosure prepared (PRIVACY_DISCLOSURE.md)
- [x] Single-purpose description prepared

### Store Listing
- [x] Short description (under 132 chars)
- [x] Detailed description
- [x] Category selected
- [ ] 1-5 screenshots captured (see SCREENSHOTS.md)
- [ ] Promotional tile (440x280)
- [ ] Promotional marquee tile (1400x560)

### Functionality
- [ ] Extension loads without errors on fresh install
- [ ] Onboarding page displays on first install
- [ ] Popup shows current site and controls
- [ ] Options page saves/loads settings
- [ ] Smart mode blocks known-bad test scenarios
- [ ] Allow-once and always-allow work correctly
- [ ] Credential guard prompts on risky submits
- [ ] No console errors during normal browsing

### Manifest Pre-Submission
- [ ] Add `"minimum_chrome_version": "116"` to `extension/manifest.json`
- [ ] Remove `declarativeNetRequestWithHostAccess` from `manifest.json` permissions (unused; only `declarativeNetRequest` is needed for static rulesets)

### Known Limitations to Document
- Extension requires Manifest V3 (Chrome 116+)
- Bloom filter is build-time only (no runtime updates)
- Public Suffix List is build-time snapshot
- Some CSP-restricted pages may prevent main-world patches

## Post-Submission
- [ ] Monitor review status (typically 1-3 business days)
- [ ] Respond to any reviewer questions about permissions
- [ ] Update PRIVACY.md if reviewer requests changes
