# Testing and Gym

## Gym purpose
The Gym is a deterministic set of local HTML pages that simulate common malicious and legitimate patterns. It provides a stable target for manual testing and automated E2E tests.

## Gym levels and expected outcomes
- Level 1: invisible overlay anchor (should block or reroute).
- Level 2: overlay follows mouse (should block or reroute).
- Level 3: instant injection on pointerdown (should block).
- Level 4: visual mimicry (should prompt or block based on score).
- Level 5: window.open popunder handler (should block).
- Level 6: programmatic click chain (should block).
- Level 7: legit modal backdrop (should allow).
- Level 8: legit OAuth popup (should prompt or allow).
- Level 9: legit video overlay controls (should allow).

## Automated tests
- Unit tests: CDS scoring and reason codes (Vitest + JSDOM).
- E2E tests: Playwright against Gym (assert no unwanted new tabs).
- Multi-popup test: one click -> multiple opens (auto-block extras).
- Performance: basic click budget checks (no DOM polling, minimal style reads).

## Debug workflow
- Use DevTools event listener breakpoints for click handlers.
- Log reason codes and last gesture context for each decision.
