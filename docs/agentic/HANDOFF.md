# Session Handoff — NavSentinel Autonomous Loop

**Last updated:** 2026-07-03 · **`main` @ `f2c3652`** (always verify: `git rev-parse origin/main`, `gh pr list`).

> Short, always-current next-loop entry point. Trust live git/GitHub over any snapshot. The append-only history is in `docs/agentic/ORCHESTRATOR.md` (cycle log); standing decisions are in `docs/agentic/DECISIONS.md`; human-only tasks are in `ACTION_ITEMS.md`.

## Current state

- **Direction:** ship/measure, **not** hardening (adopted — `docs/agentic/DECISIONS.md` D-2026-07-03-A). Follow the **Priority Ladder** in `ORCHESTRATOR.md`; discovery passes are milestone-gated; LOW residue → `docs/agentic/ICEBOX.md`.
- **Baseline:** typecheck/lint clean, **2856 unit tests** (94 files), perf 12/12. CI green on `main`.
- **Open PRs (all human-gated, browser-surface / measure:fp):** #399 (AI-14, `measure:fp`), #356 (AI-13, Gate-3), #273 (AI-8, Gate-3). At the WIP cap of 3 — **do not open more browser-surface PRs** (D-2026-07-03-D).
- **Last session (2026-07-03):** merged **#429** (claims-honesty #423 — public docs now match shipped reality) and **#430** (release guard #321-companion + fixed an unparseable `release.mjs` that had blocked *all* releases). See ORCHESTRATOR cycle 43.

## 🚨 Open human items (flag these in every summary — see `ACTION_ITEMS.md`)

- **AI-15** — the 60–90 min batch session (clears the whole gate queue + go/no-go on v0.5.0). Highest-leverage item in the project.
- **AI-9 (#321)** — build & ship the **real** bloom filter (`npm run build:bloom`, needs network). The release guard from #430 now blocks releasing without it.
- **AI-8 (#273) · AI-13 (#356) · AI-14 (#399)** — Gate-3 checks / `measure:fp` run on the 3 open PRs.

## Next safe slices (agent, ungated, in ladder order)

1. **#417** corpus methodology v2 — real-hostname routing (`--host-resolver-rules`) + trusted Playwright clicks + protected-vs-fired scoring. Harness understood (`tests/e2e/corpus-validation.spec.ts`); the re-run itself is headed-Chrome/CI-gated (build + typecheck verifiable in-sandbox; a real run is Gate-3).
2. **#426** corpus TP triage — classify the 72 missed pages (first split: harness-artifact vs real gap). Analysis on committed data where available.
3. **#418** benchmark truth-up — add the Safe-Browsing comparison arm or re-scope the headline.
4. **#427** hygiene sweep — close resolved issues, reconcile; apply the icebox.
5. **#374** chunk split → then the **visual-sim excision** (D-2026-07-03-F).

## Reliability notes

- The sandbox cannot run headed Chrome — browser/behavioral verification is a human task (why Gate-3 exists). Playwright e2e is verified via CI.
- A read-only review Workflow reads the **working tree**, not the reviewed commit — never switch branches mid-review; commit fixes before any checkout-based pre-fix proof.
- The working tree is **CRLF**; new files are LF-normalized by `.gitattributes`. For string-literal edits use a CRLF-aware applier with single-occurrence asserts.
- Verify every state-changing claim by git SHA / GitHub API (a 2026-05-30 incident saw fabricated tool outputs). Do not edit `extension/dist/` or generated data. Update branches with `git merge main` (no rebase of shared branches).
