# NavSentinel — Chrome Web Store Listing

## Short Name
NavSentinel

## Summary (132 characters max)
Catches what Safe Browsing can't see. Detects DoubleClickjacking, ClickFix, and OAuth abuse — all locally, no data sent anywhere.

## Detailed Description (max 16,000 characters)

**NavSentinel is a local-first browser defense extension that detects interaction-level attacks Safe Browsing structurally cannot see.**

Traditional browser protection compares URLs against known-bad lists. NavSentinel goes deeper — it watches how pages interact with your clicks, navigations, and credentials in real time.

### What It Detects

**DoubleClickjacking** — A 2025 attack that bypasses X-Frame-Options, CSP, and SameSite cookies. The attacker tricks you into double-clicking: the first click opens a window, the second click lands on a real OAuth consent or payment button in a page the attacker navigated your browser to. NavSentinel detects the opener manipulation pattern and blocks it.

**ClickFix / Fake CAPTCHA overlays** — Malicious pages that look like "verify you are human" prompts, secretly writing commands to your clipboard and instructing you to paste them into a Run dialog or terminal. NavSentinel correlates clipboard writes, overlay presence, and instruction text to catch these.

**Redirect chain laundering** — Pages that bounce you through multiple sites to disguise where you're actually going. NavSentinel tracks redirect hops and flags chains that pass through known redirect services.

**OAuth consent flow abuse** — Pages that manipulate popup windows during OAuth login flows to redirect your authorization to unexpected destinations.

**Credential submission risks** — Warns before you submit passwords on suspicious, lookalike, or untrusted domains. Detects IP-address hosts, punycode tricks, mixed-script hostnames, and cross-site form submissions.

**PushState URL spoofing** — Pages that rewrite the browser URL bar after your click to make it look like you're on a different site.

### Three Protection Modes

- **Smart** (recommended) — Balanced protection. Prompts on suspicious navigations and credential risks without interrupting normal browsing.
- **Strict** — Maximum protection. Lower thresholds for all detections. Best for high-risk environments.
- **Off** — Monitoring only. Events are logged but nothing is blocked. Useful for testing.

### Key Features

- **Local-first**: No telemetry, no cloud scoring, no remote lookups. Everything runs in your browser.
- **Dual scoring engine**: Click Deception Score (CDS) analyzes click context; Navigation Risk Score (NRS) analyzes destination risk. Both produce explainable reason codes.
- **Known-bad domain filter**: Build-time bloom filter from public threat feeds (URLhaus, OpenPhish) adds +50 to risk score for known malicious destinations.
- **Smart defaults**: After 3 "Allow once" decisions for the same site pair, suggests adding it to your permanent allowlist.
- **Detailed event log**: Every decision is logged locally with score, reason codes, and timestamps. Export as JSON for analysis.
- **Trusted domain management**: Mark sites you trust for credential submissions. Uses registrable-domain matching for accuracy.

### Privacy

NavSentinel stores only local settings, allowlist entries, trusted domains, and a bounded event log. No data leaves your browser. No accounts, no sync, no analytics. The extension's complete privacy policy is available in the source repository.

### Open Source

NavSentinel is fully open source. Every detection heuristic, scoring weight, and decision threshold is auditable in the public repository.

## Category
Productivity (or Security)

## Language
English

## Single Purpose Description (required for CWS review)
NavSentinel protects users from interaction-level browser attacks by monitoring click context, navigation patterns, and credential submissions, blocking suspicious activity while keeping all data local.
