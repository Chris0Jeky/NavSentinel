# Legacy fixture safety holds

The seed pass found 25 mapped legacy Gym pages that did not meet the local, inert fixture policy. Four bounded #449 slices have remediated four ClickFix pages, twelve evasion pages, seven core pages, and two RW pages; no external-destination holds remain excluded from programme evidence.

## Remediated in the first #449 slice

- `gym/clickfix-01-basic.html`
- `gym/clickfix-02-instructions.html`
- `gym/clickfix-03-legit-captcha.html`
- `gym/clickfix-04-winr.html`

The three attack pages now write only `NAVSENTINEL_SENTINEL_DO_NOT_RUN`, and their Playwright checks independently read that exact local clipboard value. The benign page now uses a static local verification control instead of a live provider resource. These repairs remove their quarantine/safety-hold entries but do not establish OS-paste prevention or real-provider browser evidence.

## Remediated in the evasion-family #449 slice

- `gym/evasion-01-opacity-009.html` through `gym/evasion-12-multiple-overlays.html`

All twelve pages now resolve benign and harm destinations through `gym/local-fixture-targets.js`, which rejects non-loopback or unarmed local overrides and falls back to `gym/local-fixture-sink.html`. A representative composite journey uses the typed fake sink for attack, protected, benign, and mixed browser arms. This removes the family from the safety hold without claiming independent harm evidence or mutation robustness for the other eleven fixtures.

## Remediated in the core-fixture #449 slice

- `gym/level1-basic-opacity.html`
- `gym/level2-moving-target.html`
- `gym/level3-instant-injection.html`
- `gym/level4-visual-mimicry.html`
- `gym/level5-window-open-popunder.html`
- `gym/level6-programmatic-click.html`
- `gym/level9-legit-video-overlay.html`

These pages now resolve harm destinations through `gym/local-fixture-targets.js` and the video control's benign link resolves to the typed local sink. The focused contract test checks each mapping and rejects absolute destinations; existing regression checks remain behavior-oriented and do not promote the seven fixtures to independent harm evidence.

## Remediated in the RW-journey #449 slice

- `gym/rw01-search-result-overlay-swap.html`
- `gym/rw06-legit-auth-second-popup.html`

These pages now resolve benign and harm consequences through `gym/local-fixture-targets.js`, preserving origin separation through its cross-loopback harm fallback. The focused contract test rejects public destinations; the RW-01 and RW-06 regressions assert that the typed benign sink is accepted and the deceptive harm follow-up is blocked. Existing regression history remains a dated engineering signal, and these journeys remain `MODELLED` rather than provider or open-web efficacy evidence.

There are no remaining non-hermetic mapped fixtures in this registry.

The machine-readable path list, disposition, and remediation are in [fixture-safety-findings.json](../registry/fixture-safety-findings.json). `npm run security:check` fails if a mapped unsafe page is unflagged, a finding path disappears, or a flagged page no longer contains a detectable finding without the registry being reconciled.
