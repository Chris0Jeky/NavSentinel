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
| 2026-06-14 | non_blocking_risk | multi-agent review tooling | Both subagents errored with Codex usage-limit exhaustion before producing review findings, so their runs could not satisfy the independent-review evidence gate. | Closed out the failed delegation path, performed direct local adversarial review of #253's changed seams, and recorded the failure explicitly instead of treatin... | Before depending on delegated reviews for a gate, confirm available Codex review/subagent quota or use a non-quota local review path; keep PR comments explicit ... | open |
| 2026-06-14 | non_blocking_risk | Codex shell / PowerShell | The active PowerShell version rejected `&&` as a statement separator, so the combined commit/push command failed before staging or committing docs. | Use separate PowerShell commands or semicolon-separated commands in this workspace; rerun the Git steps without POSIX-style `&&` chaining. | Prefer native PowerShell command sequencing in agent instructions and avoid POSIX shell separators when the environment context says `shell: powershell`. | open |
| 2026-06-14 | non_blocking_risk | GitHub CLI / multi-worktree merge | The GitHub CLI attempted a local git operation and failed because `main` was already checked out in a separate worktree, even though the PR itself was mergeable... | Merged PR #253 through the GitHub API merge endpoint, deleted the remote feature branch through the refs API, then removed the temporary helper worktree and fas... | When merging from a branch worktree while `main` is checked out elsewhere, either run `gh pr merge` from the `main` worktree or use the GitHub API merge endpoin... | open |
| 2026-07-03 | non_blocking_risk | GitHub PR / issue auto-close | GitHub's closing-keyword parser ignores negation: the phrase 'Does not close #418' in the PR body matched 'close #418' and auto-closed issue #418 on merge, desp... | Reopened #418 with a comment explaining the accidental auto-close and its remaining gated (Safe-Browsing comparison arm) scope. | Never place a closing keyword (close/closes/fix/fixes/resolve/resolves) adjacent to an issue number in a PR body or commit unless you intend the merge to close ... | resolved |
| 2026-07-12 | non_blocking_risk | Windows Defender / adversarial test fixture | Windows Defender detected Trojan:HTML/FakeCaptcha.HNA!MTB while rg read the tracked ClickFix property-test fixture and quarantined only the RI worktree copy. De... | Stopped broad reads, left the quarantine deletion unstaged, avoided scanner bypass/exclusions, and limited verification to focused files/tests using the intact ... | Chris should review Windows Security protection history and restore only this exact tracked test fixture if he confirms the detection is expected adversarial te... | open |

## Classification

- `blocker`: work cannot safely continue.
- `non_blocking_risk`: work can continue, but confidence or coverage is reduced.
- `pre_existing_noise`: unrelated existing failure that should still be visible.
- `invalid_signal`: false alarm, stale check, or non-applicable warning.

## Promotion Rule

A ledger entry should become a guide or skill update only when it is reproducible, project-specific, and likely to recur. Use `GUIDE_UPDATE_PROTOCOL.md`; do not mutate root instructions after a single ambiguous failure.
