# Implementation Roadmap

## Current status
- Stage 0: complete (Gym Levels 1-9 + index page).
- Stage 1: complete (capture, gesture token, CDS context logging).
- Stage 2: complete (CDS v1 + overlay blocking + debug overlay).
- Stage 3: in progress (window.open patch + prompt UI; allowlist UI pending).

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

Stage 5 - DNR backstop (optional)
- Add DNR ruleset generator and baseline rules.
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
