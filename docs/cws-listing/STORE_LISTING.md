# NavSentinel — Chrome Web Store Listing

> **Submission blocked:** `NavSentinel` is a working name pending AI-19
> clearance. Re-run the claims/package review after the final name and beta
> release profile are selected.

## Short Name
NavSentinel

## Summary (132 characters max)
Local, open-source checks for risky browser actions and password submissions — without telemetry or cloud scoring.

## Detailed Description (max 16,000 characters)

**NavSentinel is an open-source, local interaction guard that complements your
browser's built-in security.**

It checks consequential browser actions—clicks, popups, redirects, clipboard
writes, OAuth callbacks, and password submissions—at the moment they happen.
Scoring and event history stay in your browser; there is no account, telemetry,
cloud scoring, or runtime reputation lookup.

### What It Detects

**DoubleClickjacking patterns** — Correlates rapid clicks, child-window timing,
and opener navigation to warn or block suspicious flows.

**ClickFix / Fake CAPTCHA patterns** — Correlates page-initiated clipboard
writes, overlay presence, and command-like instruction text to flag suspicious
flows. Clipboard content is processed transiently for classification but is not
stored or transmitted.

**Redirect chain laundering** — Pages that bounce you through multiple sites to disguise where you're actually going. NavSentinel tracks redirect hops and flags chains that pass through known redirect services.

**Suspicious OAuth redirects** — Tracks redirect/callback and popup/opener
behavior during likely OAuth flows. It does not validate app identity, requested
scopes, or every OAuth attack.

**Credential submission risks** — Warns before you submit passwords on suspicious, lookalike, or untrusted domains. Detects IP-address hosts, punycode tricks, mixed-script hostnames, and cross-site form submissions.

**Misleading same-origin URL rewrites** — Flags rapid, domain-like path changes
made with the History API after a user gesture. The History API cannot change
the page's origin.

### Three Protection Modes

- **Smart** (default) — Uses the standard intervention thresholds. It may warn,
  prompt, block, or roll back actions; compatibility/quietness is still being
  measured in beta.
- **Strict** — Uses lower thresholds and therefore intervenes more often.
  Intended for controlled testing until efficacy and false-positive behavior are
  validated.
- **Off** — Protection disabled. No navigations are blocked or prompted. Some internal scoring and event logging may still occur. Useful for debugging site compatibility.

### Key Features

- **Local-first**: No telemetry, no cloud scoring, no remote lookups. Everything runs in your browser.
- **Dual scoring engine**: Click Deception Score (CDS) analyzes click context; Navigation Risk Score (NRS) analyzes destination risk. Both produce explainable reason codes.
- **Smart defaults**: After 3 consecutive allow decisions for the same site pair, suggests adding it to your permanent allowlist.
- **Local decision history**: Prompt and block outcomes are kept locally with
  scores, reason codes, and timestamps. Export is available for voluntary
  troubleshooting.
- **Trusted domain management**: Mark sites you trust for credential submissions. Uses registrable-domain matching for accuracy.

### Privacy

NavSentinel stores local configuration, decision history, prompt outcomes, and
bounded behavioral profiles. No data is sent to the developer or a third party.
There are no accounts, sync, analytics, ads, or beta runtime network services.
Review the full privacy policy before installing; local exports can contain
browsing-related security history.

### Open Source

NavSentinel is fully open source. Every detection heuristic, scoring weight, and decision threshold is auditable in the public repository.

## Category
Privacy & Security

## Language
English

## Single Purpose Description (required for CWS review)
NavSentinel is designed to reduce interaction-level browser risk by evaluating
click context, navigation patterns, and credential submissions locally, then
warning, prompting, blocking, or rolling back suspicious actions.
