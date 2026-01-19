# Project Overview

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
