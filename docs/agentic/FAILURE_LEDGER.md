# Agent Failure Ledger

This file is the human-readable view of recurring agent, tool, and workflow failures. The curated source is `docs/agentic/failure_ledger.jsonl` (git-tracked; deliberately-promoted entries only). Raw machine-captured failures go to the gitignored `docs/agentic/failure_autolog.jsonl` — promote genuinely recurring ones into the curated ledger per `GUIDE_UPDATE_PROTOCOL.md`. Render with:

```bash
python scripts/agent_hooks/render_failure_ledger.py
```

## Entries

| Date | Class | Surface | Failure | Workaround | Future fix | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-05-11 | pre_existing_noise | Bash | Backslash path separator mangled branch:path ref | Use forward slashes for git refs on Windows | n/a — agent tool misuse | closed |
| 2026-05-11 | pre_existing_noise | Bash | $null is PowerShell; bash uses /dev/null | Use 2>/dev/null in bash | n/a — agent tool misuse | closed |
| 2026-05-11 | pre_existing_noise | Bash | findstr treated unquoted arg as filename | Use grep -i in bash | n/a — agent tool misuse | closed |
| 2026-05-12 | non_blocking_risk | Bash | Script removed from package.json during release infra commit | Re-added to package.json | Fixed — scripts restored | closed |
| 2026-05-16 | non_blocking_risk | dependency | Dev server allows any website to read responses. Requires vite >=6.2 for fix, currently on 5.4. Dev-only — no production impact on built extension. | Do not browse untrusted pages while npm run dev or gym:serve is active | DONE: toolchain migrated to vite ^8 / vitest ^4 (cycles 6-7); esbuild GHSA-67mh-4wv8-2f99 (vite <6.2) no longer applies. | fixed |
| 2026-05-30 | invalid_signal | npm script | Exit code 1: PreToolUse guardrails did not deny git reset --hard. The hook is branch-aware and allows this command on non-protected branches to flow to the norm... | Interpret the pickup green hook-smoke state against protected main, or run smoke from a clean main worktree. D-STORE verification remains covered by typecheck, ... | DONE: smoke_test.py test_pre_tool_use is now branch-aware (splits always-deny vs branch-aware deny; asserts allow on non-protected branches). | fixed |
| 2026-06-05 | blocker | extension runtime | Plain assignment to the now-non-writable prototype.submit throws (Cannot assign to read only property submit), aborting JS-behavior init: lost signals + page er... | Guard the assignment with try/catch + graceful degrade (fixed in #185, commit 9da8bcc, merged 2026-06-05). | MAIN-world prototype patches must be try/catch-guarded; audit other prototype writes for patch-order assumptions. | fixed |
| 2026-06-13 | non_blocking_risk | npm script / CI | capture_isolated content-script chunk exceeded its per-chunk size budget after P5-C1 (#238) wiring; caught only in CI Build/Unit (the perf-budget step is NOT pa... | Moved the pure feature-builder into the storage chunk; bumped capture_isolated 61->62KB with documented justification; ran check:perf-budget locally to confirm. | Run check:perf-budget locally before pushing extension changes; consider folding it into the default test gate or a pre-push hook so it is not a CI-only surpris... | open |
| 2026-06-13 | non_blocking_risk | npm script / vite CLI | CACError: Unknown option --root. The vite 8 migration (cycles 6-7) dropped the --root CLI flag; vite 8 takes root as a POSITIONAL arg (vite [root]). gym:serve w... | Changed gym:serve to vite gym --port 5173 --strictPort (positional root). Verified the dev server starts and serves http://localhost:5173 (HTTP 200). | After a major build-tool upgrade, audit ALL CLI invocations in package.json scripts against the new tool help (npx vite --help), not just the build path. Remove... | fixed |

## Classification

- `blocker`: work cannot safely continue.
- `non_blocking_risk`: work can continue, but confidence or coverage is reduced.
- `pre_existing_noise`: unrelated existing failure that should still be visible.
- `invalid_signal`: false alarm, stale check, or non-applicable warning.

## Promotion Rule

A ledger entry should become a guide or skill update only when it is reproducible, project-specific, and likely to recur. Use `GUIDE_UPDATE_PROTOCOL.md`; do not mutate root instructions after a single ambiguous failure.
