# Checklists

## Master checklist
- [x] Create repo skeleton with extension/, gym/, docs/, tests/.
- [x] Add MV3 manifest, build tooling, and extension scaffold.
- [x] Implement isolated capture and gesture token logging.
- [x] Implement CDS v1 with reason codes.
- [x] Implement overlay blocking (Stage 2).
- [x] Implement window.open and target=_blank gating (Stage 3).
- [ ] Build Options UI with modes and allowlist.
- [ ] Add unit tests for CDS and edge cases.
- [x] Add at least one Playwright e2e test against the Gym.
- [x] Implement same-tab redirect gating (Stage 4).
- [ ] Add DNR backstop ruleset (Stage 5, optional).
- [ ] Harden patch integrity and fallback behavior (Stage 7).
- [ ] Add a decision log page in Options UI (future).

## Setup and tooling checklist
- [x] Choose repo structure (extension/gym/docs/tests).
- [x] Install Vite + CRXJS + TypeScript.
- [x] Configure scripts for build, watch, test, e2e.
- [x] Create minimal MV3 manifest with all_frames content scripts.

## Gym checklist
- [x] Create Levels 1-9 HTML pages.
- [x] Add Gym index page for quick navigation.
- [x] Add Gym Level 10 for Stage 4.
- [x] Verify each level manually with no extension installed.
- [x] Document expected outcomes for each level.

## Stage 1 checklist (capture and logging)
- [x] Capture pointerdown and click in isolated world.
- [x] Build click context from elementsFromPoint.
- [x] Create gesture token with TTL and cached CDS.
- [x] Log decisions and reason codes (console + debug overlay).

## Stage 2 checklist (overlay blocking)
- [x] Implement CDS v1 with reason codes.
- [x] Block or prompt at CDS threshold.
- [ ] Optional: pointer-events: none on suspect overlays during hit-testing (after capture).
- [x] Validate against Levels 1-3.

## Stage 3 checklist (new tab and popup gating)
- [x] Patch window.open and Window.prototype.open in main world (best effort).
- [x] Gate target=_blank at capture phase.
- [x] Add in-page prompt with destination URL, allow-once, always allow.
- [ ] Define content script <-> service worker messaging for allowlist updates.
- [x] Invalidate token after first allowed open and auto-block extra attempts.

## Stage 4+ checklist (redirects and backstop)
- [x] Patch location.assign/replace and form submits.
- [x] Add navigation attempt logging and correlation.
- [ ] Consider short-window history.pushState gating.
- [ ] Implement DNR ruleset and baseline rules.
- [ ] Optional: dynamic DNR block for known-bad destinations.

## Testing checklist
- [ ] Unit tests for CDS edge cases (Vitest + JSDOM).
- [x] E2E tests for Gym Level 1 at minimum (Playwright).
- [ ] Regression tests for Levels 7-9 (legit UI cases).
- [ ] Add a multi-popup test case for auto-block behavior.
- [ ] Investigate Level 2 moving target inconsistencies (no prompt).

## Release readiness checklist
- [ ] Reason codes visible in UI.
- [ ] Per-site mode defaults set to smart.
- [ ] Documentation updated (docs/README and checklists).
