# Checklists

## Master checklist
- Create repo skeleton with extension/, gym/, docs/, tests/.
- Add MV3 manifest, build tooling, and extension scaffold.
- Implement isolated capture and gesture token logging.
- Implement CDS v1 with reason codes.
- Implement overlay blocking (Stage 2).
- Implement window.open and target=_blank gating (Stage 3).
- Build Options UI with modes and allowlist.
- Add unit tests for CDS and edge cases.
- Add at least one Playwright e2e test against the Gym.
- Implement same-tab redirect gating (Stage 4).
- Add DNR backstop ruleset (Stage 5, optional).
- Harden patch integrity and fallback behavior (Stage 7).
- Add a decision log page in Options UI (future).

## Setup and tooling checklist
- Choose repo structure (extension/gym/docs/tests).
- Install Vite + CRXJS + TypeScript.
- Configure scripts for build, watch, test, e2e.
- Create minimal MV3 manifest with all_frames content scripts.

## Gym checklist
- Create Levels 1-9 HTML pages.
- Verify each level manually with no extension installed.
- Document expected outcomes for each level.

## Stage 1 checklist (capture and logging)
- Capture pointerdown and click in isolated world.
- Build click context from elementsFromPoint.
- Create gesture token with TTL and cached CDS.
- Log decisions and reason codes.

## Stage 2 checklist (overlay blocking)
- Implement CDS v1 with reason codes.
- Block or prompt at CDS threshold.
- Optional: pointer-events: none on suspect overlays during hit-testing (after capture).
- Validate against Levels 1-3.

## Stage 3 checklist (new tab and popup gating)
- Patch window.open and Window.prototype.open in main world (best effort).
- Gate target=_blank at capture phase.
- Add in-page prompt with destination URL, allow-once, always allow.
- Define content script <-> service worker messaging for allowlist updates.
- Invalidate token after first allowed open and auto-block extra attempts.

## Stage 4+ checklist (redirects and backstop)
- Patch location.assign/replace and form submits.
- Add navigation attempt logging and correlation.
- Consider short-window history.pushState gating.
- Implement DNR ruleset and baseline rules.
- Optional: dynamic DNR block for known-bad destinations.

## Testing checklist
- Unit tests for CDS edge cases (Vitest + JSDOM).
- E2E tests for Gym Level 1 at minimum (Playwright).
- Regression tests for Levels 7-9 (legit UI cases).
- Add a multi-popup test case for auto-block behavior.

## Release readiness checklist
- Reason codes visible in UI.
- Per-site mode defaults set to smart.
- Documentation updated (docs/README and checklists).
