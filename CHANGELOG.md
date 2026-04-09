# Changelog

All notable changes to NavSentinel will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- GitHub issue templates
- This changelog

## [0.2.0] - 2026-03-01

### Added
- Guided demo showcase with core, operator, and recovery variants (PRs #14-#16)
- Real-world adversarial program with Waves 1-4 covering scenarios RW-01 through RW-20 (PRs #10-#13)
- Premium operator surfaces for popup and options pages (PR #9)
- Demo record mode with deterministic video capture

### Changed
- Popup and options UI refined for operator clarity

## [0.1.0] - 2026-01-20

### Added
- Merged SentinelSuite baseline with navigation firewall and credential guard
- Click Deception Score (CDS) system for navigation intent analysis
- Main-world patching for `window.open`, `location.assign`/`replace`, form submit
- Credential-submit protection with domain risk scoring
- Popup for per-tab control and options page for persistent configuration
- Trusted-domain management and bounded local event log
- Gym test fixtures (Levels 1-12) with Playwright E2E coverage
- Unit test coverage for storage, popup model, credential domain, SW rollback
- CI pipeline with typecheck, build, test, and package verification (PR #5)
- Rollback handling for suspicious redirect-style navigations
