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

## Discovery-pass sub-findings (no standalone issue — parked here)

LOW-severity findings that live *inside* an umbrella issue's body (no GitHub number of their own), dispositioned to the icebox by the #427 hygiene sweep (2026-07-03). Full per-finding detail + evidence is in each umbrella's disposition comment.

- **#339 discovery-pass-4 residue (13 findings)** — detail in the [#339 disposition comment](https://github.com/Chris0Jeky/NavSentinel/issues/339#issuecomment-4879407971) (2026-07-03):
  - `release.mjs` diagnostics: dry-run hard-abort (#1), dead `!dryRun` guard (#2), missing-`version` TypeError vs friendly error (#3).
  - `build-bloom-filter` `optimalParams` can return `m < MIN` for unusual in-range `p` (#4); `build-test-bloom` `insertDomain` guards `m===0` not `m<8` (#8).
  - `measure-fp.mjs` ZIP `dataOffset` bounds-check (#5); `--resume` with missing `--out` silently starts fresh (#7).
  - `check_versions` prints `=undefined` instead of a "field missing" diagnostic (#6).
  - sw `ns-dblclick-opener-nav` dangling port on early-return (#10); `icon_manager.tabUpdateChains` map not pruned (#13).
  - storage `replacePromptOutcomesDirect` double-bound (#19).
  - `adaptive` `updateAdaptiveScores` overwrite (by-design) (#26); `computeAdjustment` inconsistency (#29).
- **#395 discovery-pass-2 residue (3 findings)** — detail in the [#395 disposition comment](https://github.com/Chris0Jeky/NavSentinel/issues/395#issuecomment-4879407912) (2026-07-03):
  - `adaptive_scoring.refreshAdaptiveScores` fire-and-forget RMW (D2-3) — self-correcting (pure recompute of all outcomes).
  - `domain_profile.applyDecay` omits `maxNRS` (D2-4) — `maxNRS` has **no reader** in `extension/src`, zero measured impact.
  - `nrs` tests lack csp/navAnomaly-gate × negative-factor combinations (D2-5) — test-only residue.

## Gated, NOT iceboxed (kept in the active/blocked backlog)

These are valuable but blocked on a specific input, not parked as residue:
- **OAuth FP cluster** #269 / #223 (PR #399) / #397 — implemented/holding for `measure:fp` (AI-14). Ship-relevant.
- **#374** capture chunk split — a scheduled structural cycle (ladder rung 5)
  for future capture-growing work. It is not a prerequisite for RI-02's
  visual-sim excision.
- **#175 / #186** bridge init-auth pair — scheduled structural cycle + a gate for public launch.
- **#339** (re-bodied 2026-07-03) — the 7 gated discovery-pass-4 residuals: 6 budget-gated on **#374** (grow the capture_isolated bundle; #20 explanations / #22+#24 allowlist / #25+#27 scoring [also D25 measure-before-tune] / #28 nrs simplification) + 1 Gate-3 (#23 credential_modal focus-trap). Unblock when #374 lands or Gate-3 runs.
- **#418** (re-bodied 2026-07-03) — the Safe-Browsing / competitor comparison arm for `benchmark.mjs`. The honest re-scope (option b: name + roadmap now say "gym regression, competitor arm unbuilt") shipped; building the actual comparison arm needs **branded Google Chrome** (`channel: 'chrome'` — Playwright's default open-source Chromium ships **no** Safe-Browsing verdicts, so a Chromium run would silently measure a browser without SB and recreate the invalid benchmark) or an explicit Safe-Browsing API harness, plus network → gated with the measurement-reset session **#416** (which owns the benchmark-baseline re-run).
