# Implementation Roadmap

## Current state

The original SentinelSuite merge is effectively complete on this branch. The core product now includes:

- hardened main/isolated navigation enforcement
- popup and options UX
- unified local storage
- trusted domains and event logging
- credential-submit protection
- build, packaging, CI, and strict type verification

This roadmap is therefore no longer about landing the core suite. It is about disciplined follow-up work.

## Near-term follow-up

### 1. Broaden test coverage

- add Playwright coverage for popup workflows
- add Playwright coverage for options-page import/export
- add trusted-domain decision-path tests
- cover more rollback edge cases without relying on manual env gates

### 2. Tighten operator ergonomics

- better event-log filtering/searching
- clearer differentiation between navigation allowlist and trusted domains
- possible per-entry timestamps or notes for trust decisions

### 3. Release workflow polish

- issue templates
- changelog or release-notes workflow
- optional release-tag automation
- clearer screenshot coverage for the GitHub README and PR templates

### 4. Optional future integration

`RESOURCES/link` and `RESOURCES/hardened` remain deliberately out of the first merge tranche. If revisited later, they should be treated as separate, explicitly-scoped efforts rather than folded in opportunistically.

## Non-goals for now

- cloud telemetry
- remote reputation lookups
- credential capture beyond destination-risk analysis
- broad browser-porting work before Chrome behavior is fully stabilized

## Current status
- Stage 0: complete (Gym Levels 1-9 + index page).
- Stage 1: complete (capture, gesture token, CDS context logging).
- Stage 2: complete (CDS v1 + overlay blocking + debug overlay).
- Stage 3: in progress (window.open patch + prompt UI; allowlist UI pending).
- Stage 4: in progress (location and form submit gating; history.pushState pending).

## Staged plan (each stage testable)

Stage 0 - Gym baseline
- Build Levels 1-9 demo pages.
- Verify expected behaviors manually.

Stage 1 - Capture and logging
- Capture pointerdown/click in isolated world.
- Build click context and gesture token (log only).
- Cache CDS in the token and keep decision logic in a separate module.

Stage 2 - Overlay blocking (CDS v1)
- Implement CDS and reason codes.
- Block or prompt on high CDS.
- Optional: pointer-events: none on suspect overlays during hit-testing (after capture).
- Validate against Gym Levels 1-3.

Stage 3 - New-tab and popup gating
- Patch window.open and Window.prototype.open in main world when possible.
- Gate target=_blank navigation in capture phase.
- Add in-page prompt with destination URL, allow-once, always allow.
- Define content script <-> service worker messaging for allowlist updates.
- Ensure content scripts run in all frames.

Stage 4 - Same-tab redirects and forms
- Patch location.assign/replace and form.submit.
- Add navigation attempt logging.
- Consider short-window history.pushState gating (careful with false positives).
- Note: Chrome makes window.location.assign non-writable; add a fallback (DNR or post-nav rollback) if needed.
 - Post-navigation rollback prompt for client redirects when no recent allow gesture is seen.

Stage 5 - DNR backstop (optional)
- Add DNR ruleset generator and baseline rules (toggleable).
- Consider dynamic DNR blocks for known-bad destinations (temporary).
- Optional: allow advanced users to import a small known-bad list.

Stage 6 - Policy and learning
- Per-site modes, rule learning, exportable rules.
- Add a decision log page to Options UI.
- Consider adaptive risk thresholds based on repeated allows (guarded).

Stage 7 - Robustness hardening
- Patch integrity checks and fallback behavior.
- Seal hooks to reduce tampering in main world.
- Performance tuning and reentrancy safeguards.
- WebNavigation fallback for cross-origin frames (last resort).

## Short-term focus (next 4-6 weeks)
- Finish Stage 0-3 with unit tests and at least one Playwright e2e spec.
- Build Options UI with modes and allowlist.
- Document reason codes and debug steps.

## Long-term focus
- Stage 4-7, network backstop, and policy learning.

## Dependencies and risks
- Main world patching can fail under strict CSP; design isolated-only fallback.
- DNR rules require careful curation to avoid breakage.
- Aggressive scoring thresholds can create false positives; tune via Gym and field testing.
