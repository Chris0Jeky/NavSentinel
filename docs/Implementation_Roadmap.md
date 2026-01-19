# Implementation Roadmap

## Staged plan (each stage testable)

Stage 0 - Gym baseline
- Build Levels 1-9 demo pages.
- Verify expected behaviors manually.

Stage 1 - Capture and logging
- Capture pointerdown/click in isolated world.
- Build click context and gesture token (log only).

Stage 2 - Overlay blocking (CDS v1)
- Implement CDS and reason codes.
- Block or prompt on high CDS.
- Validate against Gym Levels 1-3.

Stage 3 - New-tab and popup gating
- Patch `window.open` in main world when possible.
- Gate `target=_blank` navigation in capture phase.
- Add allow-once and allowlist UI.

Stage 4 - Same-tab redirects and forms
- Patch `location.assign/replace` and `form.submit`.
- Add navigation attempt logging.

Stage 5 - DNR backstop (optional)
- Add DNR ruleset generator and baseline rules.

Stage 6 - Policy and learning
- Per-site modes, rule learning, exportable rules.

Stage 7 - Robustness hardening
- Patch integrity checks and fallback behavior.
- Performance tuning and reentrancy safeguards.

## Short-term focus (next 4-6 weeks)
- Finish Stage 0-3 with unit tests and at least one Playwright e2e spec.
- Build Options UI with modes and allowlist.
- Document reasoning codes and debug steps.

## Long-term focus
- Stage 4-7, network backstop, and policy learning.
- Improve diagnostics (decision log export, DevTools panel).

## Dependencies and risks
- Main world patching can fail under strict CSP; design isolated-only fallback.
- DNR rules require careful curation to avoid breakage.
- Aggressive scoring thresholds can create false positives; tune via Gym and field testing.
