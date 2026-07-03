# NavSentinel — Hardening Icebox

Per **D-2026-07-03-B** (`docs/agentic/DECISIONS.md`): LOW-severity residue and speculative hardening are parked here, **not** in the active backlog. **Discovery passes and icebox items resume only after the next release milestone (v0.5.0, #415).** Until then the loop points at the Priority Ladder (ship → measure → serve day-one users).

This is a living pointer, not a source of truth — reconcile against `gh issue list` (part of the #427 hygiene sweep). An item leaves the icebox when (a) v0.5.0 has shipped, or (b) a current measurement or a user report elevates it.

## Parked (LOW residue / speculative)

| Issue | What | Why iceboxed |
|---|---|---|
| #408 | title-scan Aho-Corasick / middle-band evasion | accepted inherent tradeoff; no measured impact |
| #410 | `credential_guard.resolveActionUrl` slice-before-trim | pre-existing LOW, mirrors the #407 fix; no live exploit path measured |
| #413 | `mutation_monitor` shadow-root DISCOVERY past the alert cap | pre-existing LOW; mirrors the #409 fix |
| #382 | forward-rewrite post-delivery re-send | LOW, rare dup |
| #391 | import-truncation telemetry | LOW |
| #274 | popup chip text-contrast (design-system-wide a11y) | design-system, not shipping-critical |
| #176 | minimize SW URL persistence (drop query strings) | privacy nicety; touches rollback, needs care |
| #282 | `credential_guard` `allowNext` WeakSet cleanup | LOW housekeeping |
| #389 | redirect chain-info first-eval race | design-gated (handshake ordering) |

## Gated, NOT iceboxed (kept in the active/blocked backlog)

These are valuable but blocked on a specific input, not parked as residue:
- **OAuth FP cluster** #269 / #223 (PR #399) / #397 — implemented/holding for `measure:fp` (AI-14). Ship-relevant.
- **#374** capture chunk split — a scheduled structural cycle (ladder rung 5), and the prerequisite for the visual-sim excision (D-2026-07-03-F) and any capture-growing slice.
- **#175 / #186** bridge init-auth pair — scheduled structural cycle + a gate for public launch.
