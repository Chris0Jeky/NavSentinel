# NavSentinel — repo canon (Claude contract)

NavSentinel is a local-first Chrome MV3 extension (TypeScript + Vite, Vitest + Playwright) that
hardens abuse-heavy browser surfaces: deceptive navigation, risky credential submits,
DoubleClickjacking, and ClickFix / fake-CAPTCHA overlays. Pre-release alpha, `private: true`, and
**zero runtime network calls** by design. Source lives in
`extension/src/{content,shared,sw,popup,options,onboarding}`; `extension/dist/` is build output.
This file is the shared repo canon — `AGENTS.md` is the thin Codex delta over it, so land a
repo-wide change here and only the Codex-specific part there.

Tier: **T2 daily driver** — push free / merge free (`.agent-harness/tier.json`; do not hand-edit
the tier line). Global laws live in `~/.claude/CLAUDE.md`, are auto-injected every session, and
are not restated here.

## First actions

1. `ACTION_ITEMS.md` — the human queue (this repo's HUMAN_TODO alias, stable `AI-N` ids). Surface
   every OPEN/BLOCKED item in every summary; never self-clear one.
2. `autodoc/AGENT_INDEX.md` — the seam map (interface files, meaty files, per-seam verification).
   Use it instead of grepping the tree.
3. `docs/Project_Roadmap.md` — active phase, gates, next tasks.
4. Pick one primary `ns-*` skill (plus at most one support skill), then the smallest reviewable
   slice; state blockers, assumptions, verification target, and docs-sync target before editing.

Do not bulk-read `node_modules/`, `extension/dist/`, `dist/`, `test-results/`, `artifacts/`,
`RESOURCES/`, `HistoryDump.txt`, or `docs/archive/`.

## Proving checks by change class (narrowest that exercises the seam)

| Changed | Command |
| --- | --- |
| any TypeScript | `npm run typecheck` and `npm run lint` |
| one unit seam | `npx vitest run tests/<name>.test.ts` — 97 spec files; scope it rather than `npm test` |
| shared / content / SW logic | `npm test` |
| manifest, SW imports, bundling | `npm run build` (chains `check:mv3-worker`) |
| MAIN-world guard, bridge, detections | `npm run build`, then `npm run test:e2e` (not `:smoke` alone — 4 tests) |
| SW lifecycle / rollback | `npm run build`, then `npm run test:e2e:rollback` |
| reputation / corpus data | `npm run check:topsites`, `npm run build:bloom:test`, `npm run check:bloom-size` |
| perf-sensitive paths | `npm run build && npm run check:perf-budget` |
| version or manifest bumps | `npm run verify:versions` |
| packaging / release | `npm run package:ext` |
| skills, hooks, agentic docs | `npm run agent:hooks:smoke` and `npm run agent:skills:validate` |

`.github/workflows/ci.yml` runs three jobs per PR — **harness** (Ubuntu + Windows: hooks smoke,
skill parity), **build-and-unit** (verify:versions → lint → typecheck → unit → topsites → bloom
build/size → build → perf-budget → package), **e2e** (xvfb + `npm run test:e2e`) — plus a
tag-only **release** job. Reproduce that order locally. Every e2e lane needs a build first — the
specs `test.skip` when `extension/dist/` is absent, so an unbuilt lane reports green having run
nothing. `playwright.config.ts` declares only the `smoke` (4 tests) and `regression` (the
guard/detection body) projects, so the 22 `@phase2` cases in
`tests/e2e/phase2-detections.spec.ts` are selected by no lane, and a CLI `--grep` is ANDed with
the project grep rather than replacing it. `npm run gym:serve` hosts the fixture pages on :5173.

## Repo pitfalls

- **Never edit `extension/dist/`** (generated) or `.claude/hooks/*` — the latter are vendored
  floor/CI fixtures, not this repo's code.
- Local-first is a product invariant, not a preference: no runtime network call, no telemetry, no
  credential exfiltration, no password-value storage. A new `fetch` to a remote origin in
  production code is a defect; fetching a bundled local resource is the established pattern
  (`chrome.runtime.getURL(...)` in `sw.ts`, `capture_isolated.ts`, `visual_sim_loader.ts`; a
  `data:` URL in `visual_sim_capture.ts`) and stays allowed.
- MV3: persist short-lived critical state in `chrome.storage.session`; keep MAIN-world patches
  narrow and bridge-validated; content scripts must run in every required frame.
- Do not mix navigation-guard, credential-guard, service-worker, and UI work in one slice unless
  the seam forces it.
- The bundled `reputation_data.bin` is a 52-byte reserved-domain fixture, not user protection
  (AI-9 / #321). Only the tagged release job fail-closes on it; per-PR CI does not.
- Classify every failure — blocker / non-blocking risk / pre-existing noise / invalid signal — and
  record the workaround plus its fix path in `docs/agentic/FAILURE_LEDGER.md`. No silent skips.
- Git: update from main with `git merge main` (never rebase a shared branch); never amend a pushed
  commit; never force-push `main`/`develop`/`release` — server-side branch protection is still
  missing (AI-17), so the convention is the only wall. Recovery: `docs/agentic/GIT_WORKFLOW.md`.

## Repo-specific gate (not a tier gate)

**Gate-3 manual Chrome verification** is human-owned and holds **browser-surface** PRs only,
defined by runtime blast radius — MAIN-world / submit path / service-worker nav / MutationObserver
/ visible UI — never by file type. Track the need in `ACTION_ITEMS.md`; non-browser PRs never wait
for it. Guides: `docs/agentic/GATE3_GUIDES.md`, run oldest-PR-first.

Standing direction (2026-07-03): ship and measure, not harden. The Priority Ladder and posture are
in `docs/agentic/DECISIONS.md` — discovery is milestone-gated with LOW residue to
`docs/agentic/ICEBOX.md`, and human-gated PRs are capped at 3.

## Skills (`.claude/skills/`)

Orient `ns-repo-onramp` · `ns-repo-map` · `ns-program-board`. Implement `ns-safe-slice` ·
`ns-ext-dev` (MV3 runtime) · `ns-issue-to-pr`. Verify `ns-test-harness` · `ns-threat-validation` ·
`ns-security-review` · `ns-verify-handoff`. UI `ns-ui-ux`. Meta `ns-question-batch` ·
`ns-failure-capture` · `ns-interface-map` · `ns-roadmap-sync` · `ns-human-action-guide` ·
`ns-claude-tooling`. Codex mirrors live in `.agents/skills/` and `validate_skills.py` enforces name
parity, so add or rename a skill in **both** trees. Policy: `docs/agentic/TOOLING_PARITY.md`.

## Settings and hooks

Committed `.claude/settings.json` = acceptEdits + stack allowlist + repo tripwire denies
(`npm publish`, `chrome-webstore-upload`, `web-ext sign`, `git filter-branch`, `chmod -R 777`) +
hook wiring. `.claude/settings.local.json` is gitignored and machine-local. `.mcp.json` is
credential-free — check `/mcp` before claiming a server is live. The irreversible-command floor is
the global `~/.claude/hooks/dispatch.py`; repo-tier SessionStart/PostToolUse handlers are
`scripts/agent_hooks/*`. Leave both wirings alone.
