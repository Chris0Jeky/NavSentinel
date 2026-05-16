# Changelog

All notable changes to NavSentinel will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Complete UI redesign with brass/jade design system (design tokens, 26-icon SVG system, LogoSentinel mark)
- Popup: Modern HUD variant with ShieldArc gauge, segmented mode controls, signal chips
- Options: SOC dashboard with sidebar navigation, toggle switches, segmented controls
- Credential modal: dark gradient card with alert icon, monospace KV grid, color-coded actions
- Toast: brass-themed with amber dot indicator, pulse animation, slide-up entrance
- Onboarding: redesigned with new design tokens, icon slots, feature grid, toast mockups
- Chrome Web Store listing copy and asset requirements (docs/STORE_LISTING.md)
- Bridge security: challenge-response handshake prevents spoofed port installation (#86)
- Bridge reliability: generation counter prevents stale retries from closing active ports (#90)
- Unit tests for bridge race condition fixes (7 new tests)
- Navigation pattern anomaly detection (P4-08)
- CSP analysis as NRS risk modifier (P4-05)
- Sub-resource integrity awareness for credential pages (P4-06)
- Per-domain behavioral profiling (P4-07)
- Competitive benchmark suite (P2-10)
- First-install onboarding flow (P3-04)
- Security audit scope document (P3-09)
- Performance budget verification in CI (AUD-04)
- Unit tests for dblclick_guard, allowlist, event_tone, dom_builder modules
- Missing NRS explanation strings
- Accessibility improvements across all UI surfaces

### Fixed
- Bridge retry race condition: stale retry could close successfully-established port (#90)
- Bridge session race: MAIN world accepted any first ns-port-init sender (#86)
- Protocol injection, lastError, and isTopFrame bugs in capture_isolated (#89)
- SW TTL clamp and rollback URL validation hardening (#88)
- Extension ID leak in MAIN world via chrome.runtime.sendMessage (#77, #85)
- Main-world patches hardened against bypass and fingerprinting (#79)
- 3 high-severity CVEs in dev dependencies (rollup, undici) (#91, #94)
- Dead exports removed, public API surface reduced (#93)

### Changed
- Options page mode controls: `<select>` elements replaced with segmented button controls
- E2E tests updated to use aria-pressed attribute verification for segmented controls
- All UI surfaces now use shared design tokens (CSS custom properties)

## [0.4.0] - 2026-05-03

### Added
- DoubleClickjacking detection -- detects and blocks double-click hijack attacks
- ClickFix / fake CAPTCHA detection -- identifies clipboard-hijacking fake verification dialogs
- Local bloom filter URL reputation -- catches known-bad domains without network calls
- Page content fingerprinting -- detects brand/domain mismatches and phishing kit patterns
- OAuth consent flow monitoring -- tracks and flags suspicious OAuth redirect patterns
- Redirect chain correlation -- scores multi-hop redirect chains as a unit
- DOM mutation monitoring -- detects post-load overlay injection and form manipulation
- History.pushState gating -- flags suspicious URL manipulation after user gestures
- NRS scoring ceiling with diminishing returns above 100 points
- ClickFix scoring integration into NRS pipeline
- Bloom filter per-frame loading optimization (top-frame only, SW fallback for child frames)
- Smart defaults with allowlist suggestions after repeated allows
- Service worker state migration to chrome.storage.session for restart resilience
- jsdom test environment for ClickFix DOM tests
- Bloom filter size monitoring in CI (2MB cap)
- Issue templates for bug reports, feature requests, false positives, and security vulnerabilities
- Comprehensive Phase 2 gym fixtures and E2E tests (22 tests across 6 detection types)

### Changed
- NRS now applies diminishing returns for scores above 100
- Previously-allowed popups reduce NRS by 20 points

## [0.3.0] - 2026-05-02

### Added
- Navigation Risk Score (NRS) -- composite scoring layering CDS with navigation context
- Public Suffix List integration -- accurate registrable domain extraction for cloud-hosted domains
- Enhanced lookalike detection -- subdomain stuffing, visual homoglyphs, brand keyword matching
- CDS evasion hardening -- gradient scoring, composite escalation, no single-factor bypass
- False positive measurement infrastructure (Tranco top-200)
- Real-world phishing test corpus infrastructure (100 pages)
- CDS evasion red-team test suite
- Local prompt telemetry -- tracks allow/block/trust/dismiss outcomes locally
- Same-organization domain groups to suppress cross-site penalty for multi-domain ecosystems

## [0.2.0] - 2026-04-25

### Added
- Property tests for CDS scoring and state machine (fast-check)
- Wave 5 gym fixtures (RW-21 through RW-25) and stress test infrastructure
- Stress test lane in CI (nightly schedule)
- Recovered 13 missing Wave 2-4 E2E tests

### Changed
- Archived stale planning documents (Execution_Tracker, Implementation_Roadmap)
- Cleaned up stale remote branches

## [0.1.0] - 2026-03-01

### Added
- Initial release with navigation intent firewall
- Click Deception Score (CDS) -- 9-factor composite scoring for overlay/clickjacking detection
- Credential submission guardrails -- domain trust, risk scoring, paste warnings
- Allowlist system with per-source-destination entries
- Debug overlay for development
- Gym test fixtures for deterministic local testing
- E2E test suite with Playwright
