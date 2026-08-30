# Legacy fixture safety holds

The seed pass found 25 mapped legacy Gym pages that do not meet the new local, inert fixture policy. They remain useful source inventory but are excluded from programme evidence and must not be run as programme attacks until remediated.

## Quarantined command-shaped fixtures

- `gym/clickfix-01-basic.html`
- `gym/clickfix-02-instructions.html`
- `gym/clickfix-04-winr.html`

These pages place runnable PowerShell or curl-to-shell-shaped strings on the clipboard. No command was executed during this seed. Replace each value with a non-executable sentinel and use only a local clipboard receipt before re-enabling programme use.

## Non-hermetic mapped fixtures

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
- `gym/clickfix-03-legit-captcha.html`

These pages include public/example destinations or a live remote resource. Replace them with local origin-separated benign and harm sinks. Existing regression history can remain a dated engineering signal, but these pages cannot promote programme evidence while held.

The machine-readable path list, disposition, and remediation are in [fixture-safety-findings.json](../registry/fixture-safety-findings.json). `npm run security:check` fails if a mapped unsafe page is unflagged, a finding path disappears, or a flagged page no longer contains a detectable finding without the registry being reconciled.
