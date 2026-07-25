# Session Handoff — NavSentinel

**Last updated:** 2026-07-25. Always refresh git/GitHub truth before acting.
`ACTION_ITEMS.md` holds the live human-facing snapshot without pinning a SHA;
the posture review's dated exact baseline is in `docs/Product_Strategy.md`.

This is the short next-loop entry point. Product direction is in
`docs/Product_Strategy.md`; execution gates are in `docs/Project_Roadmap.md`;
standing decisions are in `docs/agentic/DECISIONS.md`; human-only work is in
`ACTION_ITEMS.md`; historical cycle detail remains in `ORCHESTRATOR.md` pending
rotation under #437.

## Open human items — surface all of these

<!-- AGENT CONTRACT — read before editing this list.
     `scripts/agent_hooks/smoke_test.py::test_guided_action_contract` builds a dict from
     EVERY `\bAI-\d+\b` token found on EVERY line here that starts with `- **AI-`, and
     asserts it equals the dict built from ACTION_ITEMS.md's `**OPEN:|BLOCKED: AI-N`
     headings. Two consequences:
       1. Never name another item inside a bullet (e.g. "replaces AI-13" or
          "AI-20 evidence") — it registers as a real entry and fails the check as a
          duplicate or as an id absent from ACTION_ITEMS. Refer to items descriptively.
       2. Never rename the `- **Resume at:` line to start with `- **AI-` — it would
          duplicate whichever id it names.
     A violation turns the `harness` CI job red on both ubuntu and windows. -->

- **Resume at: AI-16** (`q-1` in the current guided conversation).
- **AI-16:** ratify/amend the July 3, July 10, and July 13 standing decisions.
- **AI-9:** choose interaction-only or real-filter beta profile.
- **AI-20:** review the Defender quarantine and restore/allow only the exact
  tracked fixture, or choose the coverage-preserving rewrite path.
- **AI-17:** enable `main` branch protection.
- **AI-19:** clear or replace the product name before CWS submission.
- **AI-18: OPEN / READY** (hold lifted 2026-07-25): #457 merged, so
  `.codex/hooks.json` is final and its definition hash is stable. Note a future
  floor sync must bump the adapter pin and the two `EXPECTED_*_SHA256` values or
  the new `harness` CI job fails.
- **AI-24: OPEN (optional):** one post-merge real-Chrome confirmation pass over
  #356 + #464 + #466 now that all three are on `main`. Replaces the three
  per-PR manual gates Chris waived on 2026-07-25 in favour of automated
  equivalents; this closes the residual risk if he wants it closed. Nothing is
  blocked on it.
- **AI-23: OPEN (low priority):** prune the finished worktrees and their merged
  branches — now six of eight, since all seven PRs merged; agent-blocked because
  `git worktree remove` is floor-blocked. Do not remove the
  `codex-shell-home/NavSentinel-ri01` worktree — it holds the Defender-quarantine
  evidence referenced elsewhere in this list.
- **AI-15: BLOCKED** until agent preflight is complete.
- **AI-8 / AI-14: BLOCKED** pending current branches, two fresh reviews, green
  CI, and replacement human guides.

## Verified state

- v0.4.0; no tag, GitHub release, CWS release, classic branch protection,
  repository ruleset, or external-user evidence.
- GitHub private vulnerability reporting is enabled and `SECURITY.md` links the
  verified private advisory route.
- Root `main` was at `dc3d0da` on 2026-07-25 (#457's merge commit, the last of
  the seven). Prefer re-deriving this live over trusting the pin — a stale head
  pin here is what made the AI-13 guide abort on its own precheck on 2026-07-24.
- PR #463 / #459 **MERGED 2026-07-17** (merge commit `2888483`), resolving
  CRXJS 2.7.1, Vite 8.1.5, Rollup 2.80.0, and Rolldown 1.1.5. `npm ci` and
  audit zero passed, as did typecheck, lint, build, version, 2,874 unit tests
  (95 files), 64/64 one-worker E2E, all 12 size budgets, package, and Windows
  Gym HTTP proof. This is now history, not an open lane.
- Open issues: re-derive with `gh issue list --state open`. The count moved on
  2026-07-25 (#349 auto-closed with #356; #474 and #475 were filed), so any number
  written here goes stale immediately. 15 Horizon issues #439–#453 remain a frozen
  option portfolio, not active work.
- Stale PRs #273 and #399 were closed on 2026-07-13 with re-entry paths and
  issue anchors preserved; their heads remain fetchable at `refs/pull/273/head`
  and `refs/pull/399/head`. Open PRs are #356, #457, #464, #466, draft #468,
  **There are no open PRs as of 2026-07-25** — all seven merged: #472 (floor
  v1.6.0), #471 (docs), #356 (`3bd9e02`, closed #349), #464 (`c4f6183`), #466
  (`4ff6341`), #468 (`ebeb922`), #457 (`dc3d0da`). Re-derive live before acting.
- The three browser-surface gates are **resolved by waiver, not by a manual pass.**
  Chris chose on 2026-07-25 to clear #356/#464/#466 by automated equivalent, so
  AI-13/AI-21/AI-22 no longer exist as items; the optional **AI-24** is the single
  post-merge real-Chrome confirmation that would close the residue. The
  human-gated cap is therefore **empty**, not full.
- Package is about 474/500KB while reputation is a 52-byte test fixture. The
  old 150KB/100K-domain plan cannot meet its stated 0.01% FP target or aggregate
  package cap as written.
- Product-posture and guided-workflow work merged through PR #454; verify live
  `main` rather than pinning its SHA. The RI-01 checkpoint branch is remotely
  backed up without the unstaged Defender deletion; verify its SHA live. Its
  worktree remains dirty only because of the Defender-quarantined fixture.
- The RI-01 broker foundation is unit-tested but not wired into production.
  **Corrected 2026-07-24:** the rest of this bullet described the pre-PR
  checkpoint branch. The synthetic-navigation allowance rejection now ships as
  PR #464, **merged 2026-07-25** as `c4f6183`. Its automated Chromium lane is
  green. What has still never run is a **real-Chrome** pass; automated Chromium is
  not a substitute, and that residue is now tracked as the optional AI-24 rather
  than as a per-PR gate.

## Local review evidence

- **Agentic contract round 1 (runtime/parity lens, 2026-07-17):** compared
  Codex instructions, hooks, skills, and shared references against the compact
  Claude contract and current Codex hook guidance. Fixed the oversized Codex
  root contract, a stale named parallel-tool reference, and retired
  pre-dispatch hook references. The actual `.codex/hooks.json` definitions were
  unchanged and remain covered by AI-18 trust review.
- **Agentic contract round 2 (fresh hook/recovery lens, 2026-07-17):** checked
  supported Codex hook matchers and trust behavior, reviewed the revised Git
  safety/recovery instructions, and reran Python compilation, hook smoke, skill
  parity, and diff-whitespace checks. No remaining actionable findings.

- **Audit caveat:** the earlier posture/RI handoff claims 11 documentation
  findings and two RI-01 review rounds, but the inspected local branches do not
  preserve a per-finding artifact. Treat those counts as process history, not
  independently auditable merge-gate evidence.
- **Agentic workflow round 1 (independent contract/parity lens, 2026-07-12):**
  reviewed the new mirrored skill, root routing, question protocol, hook
  dispatch, queue/status parity, and validation. Fixed four findings: Codex
  `apply_patch` did not match PostToolUse, Claude lacked `Edit`/`Write`, `q-N`
  increment/reset semantics were incomplete, and duplicate/conflicting AI IDs
  or HANDOFF status drift could pass silently.
- **Agentic workflow round 2 (fresh recovery/adversarial lens, 2026-07-12):**
  reviewed the updated cursor recovery boundary and harness behavior. Fixed
  stale, blocked, nonexistent, and absent-cursor fail-open paths; added positive
  coverage for an all-blocked queue; and clarified that AI-18 becomes ready
  only after hook definitions are final and unchanged. Those definitions are
  now committed. Final re-review: clean.
- **Forward-test lens:** exercised the sequence as a maintainer handoff. The
  `q-1` / AI-16 guide, exact reply, durable `AI-N` resume semantics, and
  AI-18 conditional readiness are internally consistent after fixes.
- **#459 round 1 (fresh supply-chain/build-portability lens, 2026-07-17):** no
  lockfile, peer-range, audit, or production-build defect. It found unverified
  CRXJS/Vite dev-HMR debt and stale handoff evidence. The HMR debt is tracked in
  #462 without widening `externally_connectable`; this sync fixes the evidence.
  A root `@emnapi/runtime` entry can appear extraneous after clean install, but
  untouched `origin/main` reproduces the same npm optional-dependency behavior.
- **#459 round 2 (fresh supply-chain/portability/docs lens, 2026-07-17):** no
  branch-introduced runtime, graph, provenance, or build defect. It found a
  pre-existing release-guide mismatch: Node 20.18.1 was documented while the
  root engine required a newer range. `614953b` aligned that guide and exact-head
  re-review was clean. Gemini then requested exact semver syntax rather than
  natural-language `or`; `da44f56` fixed it. A later Codex portability review
  found the full ESLint 10 graph is narrower still, so the root declaration,
  lock root, and release guide now use `^20.19.0 || ^22.13.0 || >=24`. Copilot's
  quota-limit response on #463 is an invalid review signal, not a skipped finding.

## Release blockers in order

1. **RI-01:** page-injected UI currently authorizes allow/trust/resume. Move all
   protection-lowering decisions to tab/destination-bound extension-origin UI;
   script rejection/closed roots alone do not stop trusted-click redressing.
2. **RI-03/#356:** #356 **merged 2026-07-25** (`3bd9e02`) with its manual gate
   waived, so the Gate-3 step is gone. What remains for RI-03 is the agent step to
   recreate-or-defer #273 under blocked AI-8. Keep closed #399 outside beta blockers.
3. ~~**#459/#463:** dependency advisories.~~ **CLEARED 2026-07-17** — merged as
   `2888483`. Retained as a numbered slot so the blocker numbering in older
   handoffs still lines up.
4. **RI-02/#424:** excise visual-sim. It has no production match path and can
   process a different active tab's pixels.
5. **RI-05/RI-06:** remove fake DNR; apply purpose-specific URL/data
   minimization, TTLs, controls, and complete behavioral reset.
6. **RI-07:** add the explicit beta capability profile and prove broad JS
   behavior wrappers are off while core navigation protection remains active.
7. **RI-08:** complete #175/#186 trusted bridge identity and bounded fail-closed
   recovery before inviting beta users.
8. **PM-03/#455:** evidence pre-install CWS disclosure/affirmative consent, then
   keep fresh installs passive until in-product disclosure/activation; include
   the Limited Use declaration and redact OAuth response secrets before storage/export.
9. **AI-9:** implement the chosen beta profile; the recommended default is
   interaction-only with no reputation claim.
10. **AI-19 + CWS:** settle name, then re-verify one canonical store/privacy copy,
   assets, permissions, fresh install, and package.
11. Run the current headed regression checklist, submit unlisted, and recruit the
   first 10-user cohort.

Before public launch, obtain an external security review of the exact beta
commit/package and publish valid corpus, quietness, and current-browser
comparative evidence.

## Next safe slice

**Rewritten 2026-07-25 — the previous version of this section is void.** It told
agents to take non-browser work only because the human-gated queue was "at its cap
of three (#356/AI-13, #464/AI-21, #466/AI-22)", and to treat AI-13 as the
unblocking action. All three merged and all three gates were waived, so the cap is
**empty** and that instruction now points at items that do not exist.

**The browser-surface cap is open.** The two slices that were explicitly forbidden
while the cap was full are now the top candidates, in this order:

1. **RI-02 visual-sim excision (#424)** — the largest package lever
   (~31.7KB `brand_templates.json` alone, against a 474/500KB budget) and a real
   defect, not just dead code: the service worker captures the window's *active*
   tab while the request originates from `sender.tab`, after a delay window of up
   to 30s.
2. **RI-05 fake-DNR excision.** `extension/rules/dnr_static.json` holds exactly
   two gym-fixture rules scoped to `localhost`/`127.0.0.1`, while
   `extension/manifest.json` requests both `declarativeNetRequest` and
   `declarativeNetRequestWithHostAccess` for a ruleset registered
   `"enabled": false`. `docs/cws-listing/PRIVACY_DISCLOSURE.md` already marks both
   permissions "Remove before beta". ~150-200 deleted lines. It removes manifest
   permissions, i.e. it changes shipped browser behavior.

Both are classified `Agent + Gate-3` in the roadmap. Given the 2026-07-25
precedent, decide with Chris up front whether each gets a manual pass or an
automated equivalent — do not assume the waiver is standing.

Non-browser candidates, still available and cheaper:

3. **Issue-queue cull** — none milestoned, including the 15 frozen Horizon
   proposals #439-#453. Issues-and-docs only. Closing issues is outward-facing and
   partly a product call, so agree the criteria with Chris before mass-closing.
4. **Status-doc collapse (#421)** — ACTION_ITEMS is ~35k tokens and every session
   is forced to read it. #421 now also carries the constraint that the `OPEN`/
   `BLOCKED` status vocabulary is enforced in code by the guided-action contract.
5. **RI-06 remaining slices (#474)** — path-token redaction, `PromptOutcomeEntry`
   minimization, unified clear-all. Storage-only; narrower blast radius than the
   two above.
6. **Floor fail-open asymmetry (#475)** — make Claude's missing-floor case loud
   instead of silent. Agent-hooks only.

Verify any of these live before starting; this list was accurate on 2026-07-25.

## Reliability notes

- The current environment did not perform real Chrome behavior, CWS submission,
  real-feed building, external audit, or trademark/legal clearance.
- Treat successful CI as regression evidence, not efficacy evidence.
- #462 tracks CRXJS 2.7.1's deprecated Vite HMR option and unverified MAIN-world
  HMR. Production build/package/E2E passed; no `externally_connectable` widening
  is authorized by #459.
- #460 tracks nondeterministic Windows four-worker blank-anchor misses; use the
  supported one-worker proving topology. #461 tracks Windows CRLF false-stale
  output from `check:topsites`; exact-head Linux CI remains authoritative.
- Update shared branches with `git merge main`, never rebase; do not discard work
  or rewrite history without the explain-and-approve protocol.
- Do not edit `extension/dist/` or generated data directly.
