# Project Overview

## Summary

NavSentinel is a browser-side defense layer for high-risk interaction flows. It focuses on two classes of abuse:

- deceptive navigation attempts that try to move a user somewhere they did not clearly intend to go
- risky credential submissions that look like phishing or unsafe login handling

The merged branch is intentionally local-first. All scoring, prompting, and state management happens inside the extension. There are no remote verdict services, telemetry pipelines, or password uploads.

## User-visible capabilities

### Navigation firewall

- observes pointer and keyboard activation context before a navigation can occur
- computes a Click Deception Score (CDS)
- prompts or blocks suspicious `_blank` links, popunders, programmatic popup attempts, and delayed redirects
- rolls back some non-user-initiated redirects and offers an explicit "Proceed" action
- remembers explicit per-site destination approvals in the navigation allowlist

### Credential guard

- detects password-form submission at capture time
- computes risk from HTTPS state, cross-site action target, lookalike similarity, mixed scripts, punycode, deep subdomains, and untrusted domains
- blocks with a modal prompt before a risky submit proceeds
- supports "proceed once" and trusted-domain workflows
- warns when the user pastes into a password field on an untrusted domain

### Local operator surfaces

- popup for fast per-tab inspection and trust toggling
- options page for persistent configuration and inspection
- event log with bounded retention
- import/export of local configuration as JSON

## Protection philosophy

- default to explainable heuristics, not opaque ML
- prefer local decisions over cloud lookups
- keep prompts actionable and bounded
- preserve legitimate user intent when it is explicit
- make risky decisions inspectable through reason codes and event logs

## Effective deployment guidance

- use `smart` mode for normal daily browsing and regression testing
- use `strict` mode when validating new heuristics or running adversarial Gym scenarios
- keep the trusted-domain list small and deliberate
- treat the navigation allowlist as a site-specific exception list, not a global trust signal
- clear and export the event log during testing cycles so you can compare runs cleanly

## Main code entry points

- `extension/src/content/capture_isolated.ts`
- `extension/src/content/main_guard.ts`
- `extension/src/content/credential_guard.ts`
- `extension/src/popup/popup.ts`
- `extension/src/options/options.ts`
- `extension/src/shared/storage.ts`
- `extension/src/shared/domain.ts`
- `extension/src/shared/scoring.ts`
- `extension/src/sw/sw.ts`

NavSentinel is a Manifest V3 browser extension that reduces "malicious by design" navigations that abuse real user clicks (overlay clickjacking, popunders, and unwanted new tabs). It correlates each navigation attempt with a short-lived gesture token that represents user intent and then allows, blocks, or prompts based on a transparent risk model.

## Problem statement
- Browsers allow `window.open` and `target=_blank` when triggered by real clicks (user activation).
- Abusive sites hide or retarget click targets to monetize those clicks.
- Existing popup blockers often allow these because they look user-initiated.

## Goals (in scope)
- Detect deceptive click targets with just-in-time hit testing (`elementsFromPoint`) at the click coordinate.
- Gate disruptive navigation primitives (new tabs/windows, `target=_blank`, `window.open`) using gesture tokens.
- Provide low-breakage UX: prompt on uncertainty, allow-once, allowlist per site.
- Keep performance bounded (no DOM polling, O(1) per interaction).

## Non-goals (out of scope)
- Perfect prevention of all same-tab redirects across every technique.
- General ad blocking or tracker blocking.
- Remote classification or content exfiltration.

## Core approach
- Navigation Intent Firewall (NIF): build a click provenance record, compute Click Deception Score (CDS), then compute Navigation Risk Score (NRS) at navigation time.
- Decisions: allow, block, or prompt with a clear reason code.

## Constraints and principles
- MV3 only; use MV3-native APIs when needed (DNR for backstop).
- Privacy-first: no network calls, no page content exfiltration.
- Explainability: reason codes, logs, and per-site modes.

## Success criteria
- Blocks common overlay and popunder abuse with minimal breakage.
- Prompts only when necessary; provides allow-once and allow-always paths.
- Repeatable validation via the Gym and Playwright tests.
