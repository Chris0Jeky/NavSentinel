# Intent Model and Scoring

## Terminology
- GestureToken: short-lived token representing user intent (`trusted`, `suspicious`, `unknown`).
- CDS: Click Deception Score computed from click context.
- NRS: Navigation Risk Score computed at navigation time.
- Reason codes: labels that explain why a score changed.

## Click provenance record
- pointerdown capture: time, x/y, composed path, element stack, top element.
- click capture: same data to detect retargeting or overlays.
- element hints: visibility, size, cursor, accessible name hints.

## Gesture token gating
- Each real user gesture creates a token with TTL around 800ms (tunable).
- Patched navigation primitives require an active `trusted` token.

## CDS (Click Deception Score) features

| Feature | Weight | Rationale |
| --- | --- | --- |
| Target is interactive but has no accessible name (no text, aria-label, title) | +15 | Empty click targets are common for overlays. |
| Target bounding box covers >35% of viewport and is interactive | +30 | Fullscreen interactive layers are rarely legitimate. |
| `elementsFromPoint` shows a more intentful interactive element underneath | +35 | High-signal intent mismatch. |
| pointerdown top element differs from click top element | +20 | Retargeting is a classic overlay technique. |
| Target has position fixed/absolute with very high z-index (>= 9999) | +15 | Overlays use extreme stacking. |
| Cursor pointer but no visible affordance | +10 | Weak signal; do not over-weight. |
| Target is effectively non-visible but receives pointer events | +25 | Strong overlay indicator. |
| Keyboard activation (Enter/Space) | -10 | More likely user intent. |
| Known legit modal backdrop | -20 | Reduce false positives for common overlays. |

CDS bands:
- 0-29: low suspicion
- 30-59: suspicious
- 60+: highly suspicious

## NRS (Navigation Risk Score) features

Start with `NRS = CDS` and add:

| Feature | Weight | Rationale |
| --- | --- | --- |
| New tab/window (`window.open` or `target=_blank`) | +20 | Primary abuse case. |
| Cross-site destination (different registrable domain) | +20 | Monetization redirects are often cross-site. |
| Attempt within 0-250ms of pointerdown | +10 | Typical click-handler timing. |
| `navigator.userActivation.isActive` is true | +5 | Confirms user activation. |
| Multiple attempts within one gesture | +25 | Legit flows rarely do this. |
| Destination matches allowlist | -100 | Hard allow. |
| Explicit new-tab intent (middle click or ctrl/cmd click) | -30 | Respect user intent. |

Decision thresholds:
- Allow: NRS < 40
- Prompt: 40-69
- Block: >= 70
- Strict mode: block >= 50

## Explainability
- Each score contribution produces a reason code.
- The UI should surface the reason codes and allow quick allow-once or allow-always actions.
