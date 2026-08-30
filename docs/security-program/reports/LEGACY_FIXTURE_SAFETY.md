# Legacy fixture safety holds

The seed pass found 25 mapped legacy Gym pages that did not meet the local, inert fixture policy. This first #449 slice remediates four ClickFix pages; 21 external-destination holds remain excluded from programme evidence.

## Remediated in the first #449 slice

- `gym/clickfix-01-basic.html`
- `gym/clickfix-02-instructions.html`
- `gym/clickfix-03-legit-captcha.html`
- `gym/clickfix-04-winr.html`

The three attack pages now write only `NAVSENTINEL_SENTINEL_DO_NOT_RUN`, and their Playwright checks independently read that exact local clipboard value. The benign page now uses a static local verification control instead of a live provider resource. These repairs remove their quarantine/safety-hold entries but do not establish OS-paste prevention or real-provider browser evidence.

## Remaining non-hermetic mapped fixtures

- `gym/level1-basic-opacity.html`
- `gym/level2-moving-target.html`
- `gym/level3-instant-injection.html`
- `gym/level4-visual-mimicry.html`
- `gym/level5-window-open-popunder.html`
- `gym/level6-programmatic-click.html`
- `gym/level9-legit-video-overlay.html`
- `gym/rw01-search-result-overlay-swap.html`
- `gym/rw06-legit-auth-second-popup.html`
- `gym/evasion-01-opacity-009.html` through `gym/evasion-12-multiple-overlays.html`

These 21 pages include public/example destinations. Replace them with local origin-separated benign and harm sinks in bounded follow-ups. Existing regression history can remain a dated engineering signal, but these pages cannot promote programme evidence while held.

The machine-readable path list, disposition, and remediation are in [fixture-safety-findings.json](../registry/fixture-safety-findings.json). `npm run security:check` fails if a mapped unsafe page is unflagged, a finding path disappears, or a flagged page no longer contains a detectable finding without the registry being reconciled.
