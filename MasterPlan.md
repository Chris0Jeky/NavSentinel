# NavSentinel — Proposal (Initial Stage)

## Summary
NavSentinel is a Manifest V3 browser extension that reduces “malicious-by-design” navigations that exploit real user clicks: deceptive overlay clickjacking, forced popunders, and unwanted new tabs triggered by click handlers. It does this by correlating each navigation attempt with a short-lived “gesture token” representing user intent, and then allowing, blocking, or prompting based on a transparent risk model.

## Problem Statement (Why)
Many sites monetize by forcing navigation on user interaction in ways that are not classified as “popups” by the browser:
- New tabs/windows triggered inside a real click handler (allowed due to user activation)
- Invisible or near-invisible overlays that steal clicks (UI redressing/clickjacking)
- Programmatic clicks on hidden anchors
- Aggressive redirect chains

The browser’s popup blocker often allows these because they appear user-initiated. NavSentinel adds a second layer of intent verification.

## Goals (Scope)
### In scope (initial releases)
- Detect deceptive click targets (overlay traps) using just-in-time hit-testing (`elementsFromPoint`) at the exact click coordinate.
- Gate disruptive navigation primitives (new tabs/windows, target=_blank) by correlating navigation attempts to trusted gestures.
- Provide low-breakage UX: prompt on uncertainty, allow-once, allowlist per-site.
- Maintain performance: O(1) work per interaction, no DOM polling.

### Out of scope (initial stage)
- “Perfect” prevention of all same-tab redirects across every technique.
- Adblocking/tracker blocking as a general purpose replacement for uBlock.
- Deep content inspection or remote classification (privacy-first).

## Approach (How)
NavSentinel implements a Navigation Intent Firewall (NIF):

1) Gesture Tokenization:
- On capture-phase pointerdown/click, record click context (coords, element stack, accessibility cues).
- Create a short-lived GestureToken (default TTL ~800ms).

2) Deception Scoring:
- Compute a Click Deception Score (CDS) based on intent mismatch features:
    - Top target vs plausible underlying intended element
    - Fullscreen interactive overlays
    - Retargeting between pointerdown and click

3) Navigation Risk Scoring:
- When a navigation attempt occurs (window.open, target=_blank, etc.), compute NRS = CDS + navigation features:
    - New tab/window
    - Cross-site destination
    - Multi-attempt per gesture

4) Decision:
- Allow / Block / Prompt based on thresholds.
- Prompt includes Allow once / Always allow destination.

## Architecture
### Components
- Content Script (ISOLATED world): capture-phase event interception, token creation, default navigation blocking.
- Content Script (MAIN world): best-effort patching of navigation primitives (window.open, later location/form).
- Service Worker: settings persistence, site modes, allowlists, optional network backstop.
- Options UI: configure mode, allowlists, view decision reasons.

### Execution Worlds
Chrome runs content scripts in isolated worlds by default. NavSentinel uses ISOLATED for safe observation and MAIN world when patching page JS is required.

## Testability
NavSentinel ships with a deterministic “Gym”:
- Levels 1–6: adversarial patterns (overlay traps, window.open abuse, programmatic clicks)
- Levels 7–9: legitimate UI patterns (modal overlay, auth popup, video overlay controls)

Automated E2E tests use Playwright against the Gym to prevent regressions.

## Performance
- No background scanning or polling.
- Computation happens only on user gestures and navigation attempts.
- Expensive operations are bounded and just-in-time (hit-testing, small style checks).

## Privacy and Security
- No network calls.
- No page content exfiltration.
- Decisions are explainable via local reason codes.
- Per-site configuration lives in local extension storage.

## Roadmap (Initial)
1) Stage 1: token logging + Gym repro
2) Stage 2: overlay blocking + CDS tests
3) Stage 3: new-tab gating (target=_blank + window.open)
4) Stage 4: same-tab redirect vectors (location/form)
5) Stage 5: optional MV3 network backstop via declarativeNetRequest
