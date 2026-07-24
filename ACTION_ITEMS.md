<!-- AGENT CONTRACT: This file tracks tasks that only the human (Chris) can do.
     - Read it at session start (it is in the CLAUDE.md / AGENTS.md First-5-Minutes list).
     - Surface every OPEN / BLOCKED item near the top of any summary, status report, or handoff you give Chris. Never let an open item go unmentioned.
     - Mark an item DONE *only* when Chris explicitly says so (e.g. "AI-1 is done"). Move it to the Completed log with the date and a one-line result. Do not self-clear.
     - Keep the "Current state snapshot" accurate when verified truth changes. This file is the can't-lose-context store while status-doc PRs are in flight (see note). -->

# ACTION ITEMS — Human-Owned Tasks (NavSentinel)

**Purpose:** the running list of things only *you* (Chris) can do — and the context an agent needs to not lose the thread between sessions. Agents flag the open items in every summary; you clear them by saying so.

**Last updated:** 2026-07-24 — live-state reconciliation: corrected the AI-13
guide head, the open-PR list, and the issue count, and registered the two
Gate-3 lanes (AI-21/AI-22) that existed only on PR branches. Product thesis:
`docs/Product_Strategy.md`. Corrective
program: `docs/Project_Roadmap.md`. Standing decisions:
`docs/agentic/DECISIONS.md`.

> **Why this file exists separately from the usual docs:** it is the durable human-task
> register while status-doc PRs are in flight. `docs/agentic/HANDOFF.md`,
> `docs/agentic/ORCHESTRATOR.md`, `docs/Project_Roadmap.md`, and
> `autodoc/AGENT_INDEX.md` may lag `main` or open PRs between sync commits. Use this
> file plus live GitHub state as the source of truth, and reconcile the status docs when
> verified truth changes.

---

## Current state snapshot (live state rechecked 2026-07-24)

The root `main` worktree is clean and matches `origin/main`; its exact-head CI
is green. Run `git rev-parse main`, `git rev-parse origin/main`, and live `gh`
checks before acting; the exact audit baseline lives in
`docs/Product_Strategy.md`, not this live snapshot. PR #356's runtime candidate
passed typecheck, lint, build, version/package checks, 2,875 unit tests (95
files), perf 12/12, and all 65 one-worker E2E tests locally. v0.4.0 still has no
tag, GitHub release, CWS release, or external-user evidence.

Live recheck on 2026-07-24 found 81 open issues, no tags/releases/classic branch
protection or repository rulesets, and no milestones or assignees. Verify the
current `main` SHA live rather than pinning it here. Open PRs are #356, #457,
#464, #466, and draft #468; only #468 is a draft, and #457 is **CONFLICTING**
against current `main` rather than the draft this file previously called it.
Stale PRs #273 and #399 were closed with explicit re-entry paths; their heads
remain fetchable server-side at `refs/pull/273/head` and `refs/pull/399/head`,
so the matching local branches are redundant copies, not the only copies.
#356's exact guide head is **`f8028c9`** (the previously published `ee0f9b7` is
stale and would fail the AI-13 step-1 precheck); `f8028c9` has green Build/Unit
and E2E on that exact head via run `29560572081`, all three review threads are
resolved, and the PR is MERGEABLE. Its step-1 live precheck remains mandatory
before Chris's AI-13 Gate-3. The product-posture and guided-workflow
work merged through PR #454; verify live `main` rather than pinning its SHA
here. The RI-01 checkpoint branch is remotely backed up without the unstaged
Defender deletion; verify its SHA live. Its worktree is dirty only because
Windows Defender quarantined one tracked adversarial test fixture. These
changes do not change shipped product state.

- **Product posture:** strong pre-release alpha, not a market-ready or
  efficacy-validated security product. `docs/Product_Strategy.md` owns the
  current thesis, beta profile, and evidence gates; `docs/Project_Roadmap.md`
  owns the corrective action register.
- **Release-integrity blockers:** page-controlled injected UI currently owns
  allow/trust/resume authority and can be redressed under genuine input
  (RI-01); visual-sim can process the wrong active
  tab and has no production value (RI-02/#424); current `main`'s frozen
  MAIN-world prototypes remain site-breaking until #356 lands; fake DNR and
  unmeasured JS behavior should be absent
  or off; stored URLs require minimization (RI-05/RI-06); #175/#186 bridge
  identity/recovery and #455 pre-collection disclosure/consent now block beta.
- **Release/profile blockers:** the 52-byte reputation test filter plus the
  current ~474/500KB package makes the old "150KB/100K domains" plan
  impossible as written. AI-9/AI-16 must choose the recommended interaction-
  only beta or a fully specified real-filter profile.
- **Brand blocker:** the exact name `NavSentinel` is already used by an active
  GNSS security product. AI-19 requires clearance or an early rename before
  CWS submission; this is a risk flag, not a legal conclusion.
- **Legacy PR cleanup:** #273 and draft #399 were closed on 2026-07-13 rather
  than merged from stale bases; their commits, discussions, and open issue
  anchors remain. #356 is refreshed, pushed, twice reviewed, thread-clean, and
  exact-head CI-green. **The current AI-13 guide is actionable only when its
  step-1 live head/CI check passes. The PR remains unmergeable without Chris's
  Gate-3 evidence.**
- **Portfolio:** 81 open issues, none assigned or milestoned; #439–#453 are 15
  frozen Horizon proposals. No new feature/epic issue seeding until the queue is
  culled and milestone-categorized.
- **Infrastructure:** classic branch protection remains absent (`404 Branch not
  protected`) and the rulesets API returns `[]`. AI-17 remains open. Codex hook
  trust remains AI-18. GitHub private vulnerability reporting is enabled and
  linked from `SECURITY.md`. **AI-17 got more urgent on 2026-07-24:** the
  vendored deny floor (`.claude/hooks/dispatch.py` 1.5.2) was shown locally to
  allow a charter command it denies bare, once wrapped in any of three
  PowerShell one-liner shapes (9/9 wrapped combinations allowed across three
  charter payloads). The floor is a local tripwire, not the wall — server-side
  branch protection is — so this raises AI-17's priority rather than blocking
  work. Root cause is upstream (agent-harness #37); see
  `docs/agentic/FAILURE_LEDGER.md`. Do not patch the vendored copy locally: it
  is synced verbatim from canonical.
- **Local verification blocker:** Defender quarantined only
  `C:\Users\Public\codex-shell-home\NavSentinel-ri01\tests\clickfix-detector.property.test.ts`
  as `Trojan:HTML/FakeCaptcha.HNA!MTB`; it reports `DidThreatExecute=False` and
  `IsActive=False`. AI-20 owns the human review. Do not disable Defender or add
  a broad exclusion.
- **Historical snapshots** (pre-2026-07-03, ~28 session bullets) archived to [`docs/archive/ACTION_ITEMS_snapshots.md`](docs/archive/ACTION_ITEMS_snapshots.md).

---

## Action items

**Guided resolution cursor:** `AI-16` (`Resume at: AI-16`; the next
conversational label is `q-1`). Current ready order is AI-16 -> AI-9 -> AI-20 ->
AI-17 -> AI-19 -> AI-18. AI-13, AI-21, and AI-22 are separate conditional Gate-3
lanes: use each guide only when its exact-head precheck passes; they do not
replace the stable AI-16 resume cursor. Run them oldest-PR-first
(AI-13/#356 -> AI-21/#464 -> AI-22/#466), per the merge-oldest-first law. The hook-editing slice is now committed; AI-18 remains
human-owned until its exact definitions are reviewed and trusted. The `q-N`
label may reset between conversations; the `AI-N` identifier is durable.
AI-15/AI-8/AI-14 remain visible but are not actionable questions until agent
preflight clears them. AI-13's current guide is prepared; its live precheck
decides readiness.

> **Gate-queue hold (refreshed 2026-07-17):** do not run the old branch checkout
> guides for AI-8, AI-13, or AI-14. AI-8 and AI-14 require new current-main
> slices after their stale PRs were closed. AI-13's agent preflight is complete;
> use only the current guide below and verify its live exact head/CI before
> starting. AI-15 remains BLOCKED until the remaining release-integrity program
> has a current preflight handoff.

**🚨 OPEN: AI-19 — Clear or replace the working product name before CWS
submission.** An active TruNav GNSS anti-spoofing product uses the exact name
`NavSentinel` and was publicized by the US Department of Transportation in May
2026. This is not a legal conclusion, but shipping under the name without a
search/domain/CWS/trademark review creates avoidable brand and discovery risk.
**Recommendation:** rename early. Reply `AI-19 rename; generate shortlist` and
the agent can generate and preliminarily screen replacements, or reply
`AI-19 keep; begin formal clearance`. For either path: (1) define intended
territories and browser-security goods/services; (2) search exact, similar,
phonetic, joined, and spaced variants in the [UK IPO](https://www.gov.uk/search-for-trademark),
[USPTO](https://www.uspto.gov/trademarks/search), [WIPO Global Brand
Database](https://www.wipo.int/en/web/global-brand-database), and EUIPO if EU
distribution matters; (3) search general product/company usage, Companies
House, GitHub, Chrome Web Store, domains, and relevant handles; (4) save dated
results and potentially conflicting classes/goods; (5) obtain professional
trademark advice before a commercial/public launch; and (6) record **keep** or
**rename**. If renaming, coordinate code, manifest, store copy, assets,
screenshots, docs, and repository metadata before invitations or submission.
Then tell the agent `AI-19 done: <decision>`.

**OPEN: AI-18 — Review and trust the new Codex project hooks.** The Codex parity
setup adds `.codex/hooks.json` for session orientation, the shared irreversible
command floor, agentic-change verification reminders, and sanitized failure
capture. Codex deliberately skips new or changed non-managed hooks until their
exact definitions are trusted. **Human-only guide (run after this agentic slice
is final):** (1) start a fresh Codex session in the canonical repository; (2)
run `/hooks`; (3) compare every project entry with `.codex/hooks.json` —
SessionStart runs `session_start.py`, PreToolUse Bash runs
`.claude/hooks/dispatch.py --event pre`, and PostToolUse runs
`post_tool_use.py` plus sanitized `post_tool_failure.py`; (4) confirm each path
is repository-root-relative and no unexpected command exists; (5) choose
**Trust** for those exact project hooks; (6) run `/hooks` again and confirm they
are trusted/enabled; and (7) restart once to exercise SessionStart. Then reply
`AI-18 done`. Trust is definition-hash-based, so repeat after future hook
definition changes.

> **Hold AI-18 for now (2026-07-24).** Trusting the *current* definitions is
> largely wasted effort: PR #457 replaces `.codex/hooks.json` with a SHA-pinned,
> fail-closed adapter, and because trust is definition-hash-based it would have
> to be redone immediately after that lands. #457 is itself held (see its
> 2026-07-24 state review) until the upstream floor release closing
> agent-harness #37 arrives. Do this after #457's final reviewed head, not
> before. Separately recorded in `docs/agentic/FAILURE_LEDGER.md`: this repo
> currently wires **two** PreToolUse floors at once — the global 1.5.3 and the
> vendored 1.5.2 — which is exactly the topology #457 removes.

**🚨 BLOCKED: AI-15 — Run the headed release session only after agent
preflight.** The prior 60–90 minute one-sitting guide is withdrawn: stale PRs
#273 and #399 were closed, #356 has an isolated human Gate-3 guide whose live
head and CI must pass the guide precheck before use, the reputation/package plan
needs a product decision, and other release-integrity blockers precede a full
manual release session. **Do not use the old #356 guide; use the current AI-13
guide below.** Agent preflight must first: (1) fix RI-01; (2) finish #356
exact-head CI/Gate-3 and keep #273 deferred or recreate it on current `main`;
(3) excise visual-sim and remove fake DNR; (4) complete
RI-06's purpose-specific data minimization/reset; (5) complete RI-07's explicit
JS-behavior beta-off profile; (6) complete #175/#186 bridge integrity and #455
pre-collection consent; (7) prepare the chosen AI-9 release profile; and (8)
provide one current headed checklist. Then split human work into a browser
session, any network/feed session, an overnight measurement run, and a short
result review. Read `docs/Product_Strategy.md` first. This item becomes
actionable only when the preflight handoff explicitly says so.

**🆕 OPEN: AI-16 — Ratify or amend the standing product/process decisions.**
The July 10 posture review and July 13 merge-gate corrections extend the July 3
direction: narrow unlisted beta,
interaction-only by default unless real reputation is fully specified, release
integrity before human Gate-3, frozen Horizon/North-Star work, evidence before
claims, and one post-beta visible bet. **Guide:** read the verdict, Beta Product
Profile, and Portfolio sections of `docs/Product_Strategy.md`, then skim
`docs/agentic/DECISIONS.md`. **Recommended reply:** `AI-16 ratify the July 3,
July 10, and July 13 decisions, including headed Chrome as the primary Gate-3
once operational, with manual spot-checks retained.` Otherwise name only the
amendments.
AI-9's release-profile choice and AI-19's name choice still require explicit
answers; the reversible prioritization is already the working posture.

**🆕 OPEN: AI-17 — Enable GitHub branch protection on `main` (the harness
wall).** Live verification still returns `404 Branch not protected`. The local
deny floor is a tripwire, not a server-side wall; non-hooked clients can bypass
it. Until protection exists, never force-push `main`.

**Recommended:** reply `AI-17 apply recommended protection` and an
authenticated agent can apply and verify this reversible repository setting.
If doing it yourself:

1. Open GitHub → **Settings** → **Branches** → **Add branch protection rule**.
2. Target `main` and require pull requests.
3. Require the branch to be current; select only `Build / Unit` and `E2E`.
4. Require conversation resolution and apply the rule to administrators.
5. Leave force pushes and branch deletion disabled.
6. Do not require an approval count that deadlocks a solo maintainer, the
   scheduled Stress job, or the normally skipped release job.
7. Save, then run
   `gh api repos/Chris0Jeky/NavSentinel/branches/main/protection`. Confirm strict
   checks, admin enforcement, conversation resolution,
   `allow_force_pushes=false`, and `allow_deletions=false`.

Official reference: [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches).
Then tell the agent `AI-17 done`.

**🚨 OPEN: AI-9 — Choose the beta reputation profile (#321).** The current
asset is a 52-byte test fixture. The old instruction to simply run
`npm run build:bloom` is unsafe: the package is already ~474/500KB, a 150KB
filter cannot meet the stated 0.01%/100K-domain combination, and feed licensing,
provenance, cadence, cardinality, and rollback are unresolved. **Recommended
choice:** ship the unlisted beta interaction-only, disable/omit reputation, and
remove every reputation claim; test the actual differentiator without delay.
**Alternative:** authorize a real-filter profile only after an agent proposes a
separate data/package budget, feed/cadence/licensing plan, provenance manifest,
sentinel checks, and reproducible build. Reply "AI-9 interaction-only" or
"AI-9 real-filter" (plus constraints). Do not build/commit a feed artifact until
that decision is recorded.

**🚨 OPEN: AI-20 — Review the Defender quarantine and decide the exact
fixture's fate.** The 2026-07-12 alert is
`Trojan:HTML/FakeCaptcha.HNA!MTB`; Defender reports successful remediation,
`DidThreatExecute=False`, and `IsActive=False`. The affected path is exactly
`C:\Users\Public\codex-shell-home\NavSentinel-ri01\tests\clickfix-detector.property.test.ts`.
The intact canonical copy matches tracked Git blob
`434bbe10e17f754f62db913f28015bb327fe23f4` and SHA-256
`BC317AB1D1B74AE9D8F9D80328818FED2FC304FFA0FEDDC4DBCB9991653AA769`.
The file is a property-test keyword corpus for fake-CAPTCHA/ClickFix command
detection; that strongly suggests a signature collision, but it is not a legal
or malware-vendor determination.

**Human-only guide:** (1) open **Windows Security -> Virus & threat protection
-> Protection history**; (2) expand the 12 July 2026 alert and verify the exact
name and path above; (3) if you accept it as the expected tracked test content,
choose **Restore**; (4) if Defender immediately detects it again, re-verify the
same exact name/path and choose **Allow on device** for that detection only; (5)
do not disable Defender and do not add a repository/folder exclusion; (6) tell
the agent `AI-20 restore exact fixture`. The agent will then verify both hashes
and rerun full branch gates. If you prefer not to restore it, reply
`AI-20 leave quarantined`; the agent will replace the signature-triggering test
representation while preserving coverage, then rescan and rerun the gates.
Microsoft references: [Protection History](https://support.microsoft.com/en-us/windows/protection-history-f1e5fd95-09b4-46d1-b8c7-1059a1e09708)
and [file submission](https://www.microsoft.com/wdsi/filesubmission).

**BLOCKED: AI-8 — Neutral-chip Gate-3 after closed PR #273.** The presentation
intent is still reasonable, but stale PR #273 was closed on 2026-07-13 with its
commit and two unresolved review threads preserved. An agent must recreate or
defer the tiny change from current `main`, resolve both findings, run two fresh
reviews and current CI, then post a new visual-check guide. Do not reuse the old
branch checkout guide.

**AI-10 — Gate-3 + merge the SPA-breakage fix (#352) · ✅ RESOLVED 2026-06-23.** Chris ran the manual Chrome check ("manual checks on chrome for #352 done, it seems to be working fine now") → **#352 merged into `main`** (`#347` pushState de-harden + `#348` reputation WAR). The claude.ai grey screen / infinite-load and the per-page `reputation_data.bin`/`pushState` console errors are fixed; top-frame reputation is re-enabled.

**AI-11 — Toast count-pill (#351 → PR #353) · ✅ RESOLVED 2026-06-23 — MERGED.** Chris said "merge #353"; green CI (incl. the RW-19 e2e fix to accept the coalesced pill) → **#353 merged into `main`** (`d0e0412`). Repeated blocked-popup/redirect prompts now coalesce into one count pill after 3-in-8s (expandable to the latest prompt's Allow once / Always allow). The pill is live on the next `git checkout main && npm run build`.

**🚨 OPEN: AI-13 — Run #356 MAIN-world compatibility Gate-3 (GUIDE PREPARED;
LIVE CI PRECHECK REQUIRED).** PR #356 is refreshed from current `origin/main`
and all three review threads are resolved. Exact guide head **`f8028c9`** passed
GitHub Build/Unit plus E2E (run `29560572081`, `head_sha` verified equal to the
PR head on 2026-07-24); the source-bearing runtime head passed 2,875 unit
tests, 65/65 one-worker E2E, build/package, and all 12 size budgets locally.
The current guide commit must independently satisfy step 1 before use. This
item remains human-owned; only Chris can record Gate-3 as done.

> **Head correction (2026-07-24):** this guide previously pinned `ee0f9b7`,
> which the branch has since moved past. Any run started against `ee0f9b7`
> aborts at step 1 on a SHA mismatch. The live head is `f8028c9`; re-verify it
> yourself with step 1 rather than trusting either SHA written here.

**Current guide:**

1. From the repository root, use the existing isolated worktree; do not switch
   or reset the root `main` checkout:
   `git -C .worktrees/pr356-refresh fetch origin`, then
   `git -C .worktrees/pr356-refresh status --short --branch`,
   `git -C .worktrees/pr356-refresh rev-parse HEAD`, and
   `git ls-remote origin refs/heads/feat/dehard-enforcement-protos`, then
   `gh pr view 356 --json headRefOid --jq .headRefOid`. The worktree must be
   clean, all three SHAs must match, and only then may `gh pr checks 356` be
   accepted as evidence that Build/Unit and E2E are green for that exact head.
   Stop and report the mismatch if any SHA or check differs.
2. In that worktree run `npm ci` and `npm run build`. To avoid starting the
   branch's known-vulnerable pre-#459 Vite server, keep
   `python -m http.server 5173 --bind 127.0.0.1 --directory gym` open in a second
   terminal instead. Create a temporary local Chrome profile from the profile
   picker, do not sign it into a Google account, and leave every established
   profile/extension untouched. In the temporary profile's Extensions page,
   enable Developer mode and load
   `.worktrees/pr356-refresh/extension/dist` unpacked. In NavSentinel Options,
   confirm Smart mode and no localhost/127.0.0.1 trusted-domain or allowlist
   entry before testing. Do not remove an established unpacked copy or its data.
3. Open `http://localhost:5173/proto-wrap-05.html`. Confirm the page reaches
   `Status: OK — all wraps succeeded` with no uncaught page error or
   `Cannot assign to read only property` console error.
4. Click each of the eight exercise buttons once, in their displayed order. In
   DevTools, evaluate this exact object:

   ```js
   ({
     calls: JSON.parse(document.body.dataset.wrapperCalls ?? "{}"),
     formSubmitCall: document.body.dataset.formSubmitCall,
     formTarget: document.querySelector("#submitFrame")?.contentWindow?.location.href,
     formRequestSubmitCall: document.body.dataset.formRequestSubmitCall,
     requestSubmitEvents: document.body.dataset.requestSubmitEvents,
     locationCall: document.body.dataset.locationCall,
     locationReplaceCall: document.body.dataset.locationReplaceCall,
     hash: location.hash,
     unboundOpenCall: document.body.dataset.unboundOpenCall,
     protoOpenCall: document.body.dataset.protoOpenCall,
     crossRealmOpen: document.body.dataset.crossRealmOpen,
     invalidOpenReceiver: document.body.dataset.invalidOpenReceiver
   })
   ```

   `calls` must contain six `1` values (`formSubmit`, `formRequestSubmit`,
   `locationAssign`, `locationReplace`, `windowOpen`, `windowProtoOpen`). The
   other expected values are `called`, a `formTarget` containing `via=submit`,
   `called`, `"1"`, `called`, `called`, `#proto-wrap-replace`, `opened`,
   `opened`, `child`, and `error:TypeError`, in object order. Report any popup
   blocked by Chrome itself instead of treating it as a NavSentinel pass.
5. Preserve the security gate using a fresh Level 10 page for each action:
   immediate redirect should reach Level 4. Reopen Level 10, click delayed
   redirect, and after two seconds confirm Chromium first reaches Level 4 and
   NavSentinel automatically rolls back to Level 10 with the rollback toast;
   normal Location calls bypass the prototype hook (#458), so this is not a
   pre-navigation `Blocked redirect`. Click `Proceed` and confirm Level 4 opens.
   Reopen Level 10, click programmatic form submit, and confirm `Blocked form
   submit` appears before navigation. Choose `Allow once`, confirm only the exact
   form action reaches Level 1 with `from=level10`, then reopen Level 10 and
   repeat it to confirm a fresh attempt blocks again. Finally, on a fresh
   `level5-window-open-popunder.html`, click the fixture's `Click area` control
   (`#area`); `Blocked popup` must appear and no popup may open.
6. Close every test popup/tab, stop the Python Gym server with Ctrl+C, close the
   temporary Chrome profile, and remove only that deliberately disposable local
   profile from Chrome's profile manager. Do not alter or delete an established
   profile; if you chose to disable an older copy instead, re-enable it now.
7. Reply `AI-13 done; Gate-3 passed on PR #356` and include any console error,
   unexpected prompt text, or differing outcome. Do not merge on a partial pass;
   after a full pass the agent will recheck the exact head, CI, comments, and
   merge gate before acting.

**🚨 OPEN: AI-21 — Run PR #464 synthetic-navigation Gate-3 (GUIDE PREPARED ON
THE PR BRANCH; LIVE EXACT-HEAD PRECHECK REQUIRED).** This browser-surface slice
stops page scripts from minting navigation authority with dispatched
pointer/click events, keeping a preceding real pointerdown only as
attack-correlation evidence: a trusted pointerdown now sends only a top-frame
rollback baseline and cannot create gesture, broad, target, or recent-user
authority. Live state on 2026-07-24: head `cf66b28`, MERGEABLE, Build/Unit and
E2E green, 6 review threads all resolved. Automated Chromium proves the
pointerdown-only rollback attack, the synchronous MAIN-world popup attack, the
existing synthetic attacks, and the trusted compatibility paths, but a real
Chrome pass must confirm them before merge. Only Chris can record this complete.

**🚨 OPEN: AI-22 — Run PR #466 pending-decision service-worker Gate-3 (GUIDE
PREPARED ON THE PR BRANCH; LIVE EXACT-HEAD PRECHECK REQUIRED).** Adds the
URL-minimized, session-backed pending-decision boundary so prompt authority is
derived from Chrome rather than page messages. Live state on 2026-07-24: head
`0266107`, MERGEABLE, Build/Unit and E2E green, 4 review threads all resolved.
Its Gate-3 must additionally treat the `rollupOptions` -> `rolldownOptions`
swap in `vite.config.ts` as a first-class target: build, load unpacked in real
Chrome, and confirm the MV3 service worker actually registers, because that
change alters the shipped bundle layout. Only Chris can record this complete.

> **Where the full AI-21/AI-22 guides live (2026-07-24):** the complete
> step-by-step guides are carried in `ACTION_ITEMS.md` **on their own PR
> branches** (`fix/ri01-reject-synthetic-nav-allowances` and
> `fix/ri01-pending-decision-sw`), which hold a much longer version of this file
> than `main` does. They are summarized here — not duplicated — so that landing
> those PRs does not fight a 500-line docs conflict on `main`. Read the full
> guide with
> `git show origin/fix/ri01-reject-synthetic-nav-allowances:ACTION_ITEMS.md`
> (AI-21 at line ~377) or
> `git show origin/fix/ri01-pending-decision-sw:ACTION_ITEMS.md` (AI-22).
> Both remain queued behind AI-13/#356 under the merge-oldest-first law. This
> entry exists so the durable register never silently omits a human-gated item
> while its PR is in flight — which is this file's whole purpose.

**OPEN (low priority): AI-23 — Prune two finished worktrees and their merged
branches.** Agents cannot do this: `git worktree remove` is floor-blocked
(`[floor 1.5.2] Git worktree removal is floor-blocked.`), verified 2026-07-24,
and the branches cannot be deleted while a worktree still holds them. Both
targets are clean and fully merged into `main`, so this is pure housekeeping
with nothing to lose.

```sh
git worktree remove "C:/Users/jekyt/Desktop/Printer Config/Others/Git/nav-floor-sync"
git worktree remove .worktrees/deps-audit
git branch -d chore/deny-floor-v1.5.2 fix/release-dependency-advisories
```

`git branch -d` (not `-D`) is deliberate: it refuses anything not merged, so it
cannot silently drop work. Leave the other five worktrees — they back the open
PRs #356/#464/#466/#468/#457.

Three local branches are also prunable but are **not** included above, because
deleting an unmerged local branch is the one irreversible step here and is your
call: `fix/cooldown-map-cap` (superseded — its fix landed on `main` as
`capCooldowns` via PR #381, and it is the only copy of commit `d682f14`),
`fix/user-activation-neutral-chip` and `fix/oauth-require-state-corroboration-223`
(both redundant — their heads are preserved server-side at `refs/pull/273/head`
and `refs/pull/399/head`, so deleting the local copies loses nothing). Reply
`AI-23 done` when pruned.

**🚨 BLOCKED: AI-14 — OAuth tradeoff measurement after closed PR #399.** The
measurement-held draft was closed on 2026-07-13 rather than merged from a stale
base. It is not a beta blocker. Keep #223 blocked until #417 supplies valid
methodology and an agent creates a current slice, runs two reviews, and posts a
reproducible headed measurement plan. Do not use the closed branch as a current
test or merge target.

**AI-12 — Top-site FP relief + D1 (#350 → PR #354) · ✅ RESOLVED 2026-06-23 — MERGED.** Chris manually confirmed the relief works on LinkedIn ("tested it on linkedin and it seemed to work fine now") = his measure/Gate-3 in lieu of the full `measure:fp` run (which needs headed Chromium + live Tranco, sandbox-can't). **#354 merged into `main`** (`c4426cf`): `getTierAdjustedBlockThreshold` now relieves TOP_SITE + CDS-only (benign-structural whitelist) by `NRS_TOP_SITE_CDS_RELIEF`; trust list grew 24→42 with safe `includeSubdomains`. Green CI (Build/Unit + E2E) on the main-merged head. **Follow-up:** `+20` is an unvalidated starting value; do not tune it again without the valid #417/#416 FP/TP evidence required by D25.

AI-1, AI-2 resolved 2026-06-05; AI-3, AI-4 resolved 2026-06-13; **AI-5 resolved 2026-06-19** (Phishpedia public logo set approved); **AI-6 resolved 2026-06-19** (#249 merged after Gate-3 waiver). See Completed log. Deferred manual checks remain on the regression watchlist `docs/agentic/POST_MERGE_MANUAL_VERIFICATION.md` (run on next build + load; now also covers #249 enriched-capture, #263 credential-submit, and #265 SW-hydration behavior). Standing posture (confirmed 2026-06-19): the agent **may autonomously merge non-browser PRs** (logic/test/build/docs) once aged + 2 adversarial rounds + green CI; **browser-surface PRs still hold for Gate-3**.

> **Note (2026-06-13):** `main` has advanced to `da400fb` since the 2026-06-05 snapshot below (`#196`/FF/domain-impersonation work merged). The snapshot's PR-batch facts are historical; current open-item truth is in this section.

### AI-6 — Manual Gate-3 on PR #249 (P5-C1 / #238) + merge · ✅ **RESOLVED 2026-06-19 — Gate-3 WAIVED by Chris; #249 merged**

> Closed 2026-06-19 (Chris waived Gate-3 for the #249/#263/#265 batch and authorized the agent merge). **#249 merged into `main`** (replay-grade `PromptOutcomeEntry`) on green CI + 2 adversarial review rounds. The manual-browser check is preserved on the deferred regression watchlist `docs/agentic/POST_MERGE_MANUAL_VERIFICATION.md` (run on next build + load). Original guide retained below for reference.

**Why it was yours:** #249 changes what is persisted to `chrome.storage.local` at every nav/cred decision (the replay-grade `PromptOutcomeEntry`: `cds`, `nrsFactors`, `navAnomalyScore`, `adaptiveAdj`, `thresholdUsed`, `elementContext`; plus nav `reasons` and cred `destDomain`). It is **green on CI (Build/Unit + E2E), CLEAN/mergeable, 2 adversarial review rounds resolved** — the only remaining gate is the manual Chrome test the sandbox can't run.

**Guide** (full version in `docs/agentic/POST_MERGE_MANUAL_VERIFICATION.md` → "Pending PRE-merge: #249"):
1. `git fetch && git checkout feat/p5c1-enrich-prompt-outcome && npm run build`
2. Load `extension/dist` unpacked in Chrome; second terminal `npm run gym:serve` (fixed for Vite 8 — serves `http://localhost:5173`).
3. Trigger a blocked/prompted **nav** (suspicious blank-anchor / new-tab fixture) and a **credential** prompt (`level11-credential-guard.html`); make varied choices (allow/block/trust/cancel).
4. Options page → **Export**; confirm the newest records carry the enriched fields — nav: `cds`/`nrsFactors`/`thresholdUsed`/`elementContext`/`reasons` (+`destDomain` on blocks); cred: `reasons`+`destDomain` (action host). Confirm `elementContext` has only structural fields (no text/URLs). No SW/page console errors.
5. **Done when:** verified → `gh pr merge 249 --merge --delete-branch`, or tell me "AI-6 done / merge #249" (or "waive Gate-3" as on 2026-06-05) and I'll merge.

---

### AI-1 — Manual Chrome test (Gate 3) · ✅ **RESOLVED 2026-06-05 — Gate 3 WAIVED by Chris; manual checks deferred to the watchlist**

> Closed: the 11 PRs merged 2026-06-05 after Chris waived the manual-test gate (green CI + 2× adversarial review). The step-by-step guide below is retained for reference only; the live deferred-check list is **`docs/agentic/POST_MERGE_MANUAL_VERIFICATION.md`** — run it next time you build and load the extension.

**Why it's yours:** the contract requires manual testing in a real Chrome (PR Merge Protocol Gate 3), and the agent sandbox can't launch a browser. Everything else for these PRs is already green.

**Guide:**

1. **Check out and build each PR branch** (one at a time):
   ```sh
   git fetch origin
   git checkout fix/credential-modal-focus-trap   # #183 (D-FOCUS) — start here, it's the most browser-visible
   npm ci        # if deps changed; otherwise npm install
   npm run build # outputs to extension/dist
   ```
2. **Load the extension:** open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, select the `extension/dist` folder.
3. **Serve the test pages:** in a second terminal, `npm run gym:serve` (serves the `gym/` fixtures at `http://localhost:5173`).
4. **#183 D-FOCUS — focus-trap golden path + edge cases:**
   - Open `http://localhost:5173/level11-credential-guard.html`, type a password, click **Submit**. The **"Credential submit blocked"** modal must appear.
   - With the modal open, verify focus containment (the fix): **Tab**/**Shift+Tab** cycles only among the modal buttons; clicking the page behind snaps focus back; `document.querySelector('#submitBtn').focus()` in the console bounces focus back into the modal; **Esc**/cancel still dismisses and returns focus sensibly.
5. **#182 D-STORE — prompt outcomes persist:** trigger several credential prompts and choose actions (trust/block) rapidly across reloads; confirm choices persist and the popup/options reflect them (no lost outcomes). Multiple tabs/frames at once is the stress case.
6. **#180 D-PROF — no console errors under repeated navigation:** browse risky/benign fixtures repeatedly; confirm no domain-profile errors in the SW console and risk state stays consistent.
7. **#185 D-BRIDGE + #187 D-SWRATE — regression smoke (internals):** browse a mix of gym fixtures (nav blocks, dblclick, clipboard/ClickFix, pushstate); confirm the guard fires normally and there are **no SW or page console errors** (esp. no "Cannot assign to read only property 'submit'" — that was the bug fixed in `9da8bcc`).
8. **#189 D-ANOM — anomaly scoring sane:** with a built-up history, browse a burst to a *rare* category (e.g. several crypto/wallet fixtures) → anomaly contributes to risk; a burst to a *frequent* category → no false elevation. No SW console errors.
9. **#190 D-IFRAME — iframe flags without false positives:** on a benign page, confirm legit iframes (recaptcha/analytics) are **not** flagged and the page works; if you can, inject a `data:`/`srcdoc` iframe via the console (`document.body.appendChild(Object.assign(document.createElement('iframe'),{srcdoc:'<form><input type=password></form>'}))`) and confirm it registers a suspicious-iframe signal. No console errors.
10. **#191 D-ONCREATE — DoubleClickjacking still works (internals):** with it loaded, exercise the dblclick gym fixtures (a page that opens a child window which then navigates the opener) and confirm the dblclick alert still fires; no SW console errors. The fix is about child-window tracking surviving an SW restart, so the smoke check is "dblclick protection still works + no errors."
11. **#193 D-REDOS — content fingerprinting unchanged (internals):** browse phishing-kit gym fixtures (hidden exfil form/iframe pages) and confirm the content-analysis kit detection still fires as before; no page/SW console errors. This is a regex-internals hardening with zero intended detection change, so the check is "still detects + no errors."
12. **Record the result on each PR:** `gh pr comment <#> --body "Gate 3 manual Chrome test: PASS — <notes>"` (or FAIL with what broke). Then tell me "AI-1 done for #NNN" and I'll proceed to merge per AI-2.

**Done when:** you've manually verified all eleven and recorded PASS (or sent fixes back). Tell me which passed.

---

### AI-2 — Merge order decision + execution · ✅ **DONE 2026-06-05**

> Executed: all 11 merged oldest-first (#180 → … → #195; #182 merged last after a docs-only conflict resolution). `main` @ `4bd60ce`, independently verified (0 open PRs). Original guide retained below for reference.

**Why it's yours:** merging is an irreversible product action; the contract leaves the go/no-go and order to you.

**Guide:** once AI-1 passes, tell me the order (recommended: oldest-first **#180 → #182 → #183 → #185 → #187 → #189 → #190 → #191 → #193 → #194 → #195**). I will, per PR: confirm gates, merge, verify `main` afterward by SHA, then move to the next. Note all 7 branch off a slightly older `main`, so each should `git merge main` (not rebase) before merge if conflicts appear. After the last merge I run the post-merge docs reconciliation (issue #184) and add the `failure_ledger.jsonl` entry for the form-submit patch-order bug.

**Done when:** the verified PRs are merged and `main` is confirmed.

---

### AI-3 — Decide the fate of `fix/jsb-stale-todos-and-tests` · ✅ **RESOLVED 2026-06-13 — superseded by merged work; closed**

> Closed 2026-06-13 (Chris: "mark done"). Verified on `main` @ `da400fb`: the branch no longer exists locally or on `origin` (it was deleted after the 2026-06-05 snapshot); the `TODO: Implement (Slice N)` markers are gone from `js_behavior_monitor.ts`; and `computeJsBehaviorScore` is **no longer a dead stub** — it's a live, implemented function in `extension/src/shared/js_behavior_state.ts:67`, called from `capture_isolated.ts`. Both intents of the branch landed organically through later merges. No action remained. Original context retained below.

**Why it was yours:** it was an old local branch with one trivial commit; deleting vs. reviving was a judgment call.

**Context:** branch was one commit `435597c` (2026-05-23) that removed stale "TODO: Implement (Slice N)" markers + a then-dead `computeJsBehaviorScore` stub. Branched off a *2026-05-23* `main`, far behind — would have reverted ~18.8k lines if merged as-is.

---

### AI-4 — Decide Firefox build tooling for FF-02 · ✅ **DECIDED 2026-06-13 — option (b) `web-ext` + `manifest.firefox.json`**

> Decided 2026-06-13 (Chris). **Chosen: (b) `web-ext` + a separate `manifest.firefox.json` and build script.** **Superseded for scheduling on 2026-07-10:** the tooling choice remains valid history, but Firefox implementation is deferred until desktop-Chrome retention produces a real second-browser demand signal.

**Why it was yours:** a tooling/architecture choice with trade-offs that shapes the whole Firefox port.

**Context:** FF-01 (`browser.*` shim) merged (#173). FF-02 needs a Vite Firefox build; `@crxjs/vite-plugin` (v2.4.0) Firefox support is experimental. Options considered: (a) crxjs Firefox target; **(b) `web-ext` + separate `manifest.firefox.json` — CHOSEN**; (c) hand-rolled second Vite config + dual build scripts.

**Next:** none before the post-retention Firefox activation gate. If that gate
opens, implement FF-02 against web-ext, then reassess FF-03/FF-04.

---

### AI-5 — Visual-sim brand assets · ✅ **RESOLVED 2026-06-19 — public Phishpedia logo set approved**

> **RESOLVED 2026-06-19 (Chris):** use the **public Phishpedia reference logo set** if a future logo-embedding model is authorized. **Superseded for scheduling on 2026-07-10:** RI-02 removes the current visual-sim path; logo embeddings are a fresh post-retention feature, so implementation must not proceed now. Decision history is retained below.

> **DECIDED 2026-06-13 (Chris): pivot to logo-embedding (D24).** The original "sanctioned brand login *screenshots* for pHash" ask is **moot** — perceptual hashing is retired to a cheap pre-filter. **AI-5 re-scopes to:** supply/sanction a set of reference brand **logos** for the Siamese/CNN embedding model (or confirm using a public logo set, e.g. the Phishpedia reference list). This is now a smaller, lower-stakes asset task feeding **P5-D6 (#246)** + the on-device-ML host **P5-D5 (#245)**. Tracked as re-scoped-OPEN (logo set still to be confirmed), not blocking near-term Phase-5 work. Original deferral context retained below.

> **Deferred 2026-06-13 (Chris):** do **not** source screenshots yet. The North-Star research (`docs/research/NORTHSTAR_RESEARCH_HANDOFF.md`, lines 192–196) finds perceptual hashing is weak/evadable for brand impersonation vs **logo CNN / Siamese embeddings** or an **on-device VLM**, and leans toward a pivot (pHash as a cheap pre-filter only). Collecting pHash source screenshots now risks gathering the wrong assets. **Hold AI-5 until the visual-sim tech direction (finish pHash vs. pivot to CNN/VLM) is finalized by the research program;** then this item is either re-scoped (training/reference images) or closed. Stays OPEN as a tracked dependency, not actionable yet.
>
> **DECISION INPUT READY 2026-06-13 (gap-fill research, 3-vote verified):** the visual-sim tech call is now answerable. **Recommend the PIVOT to logo-embedding.** Evidence: USENIX'21 **Phishpedia** (logo + Siamese embeddings) = **98.2% precision / 87.1% recall / 0.19s/page**, far above perceptual-hash/EMD/PhishZoo/LogoSENSE; a pure on-device pHash extension (PhishSnap) is feasible but low-accuracy. Plan: keep pHash only as a cheap pre-filter, pivot confirmation to a logo-embedding model (or on-device VLM in an offscreen doc). See **`docs/NORTHSTAR_ROADMAP.md` → P5-D6 + Decision D24**. **If Chris confirms the pivot, AI-5 re-scopes to "supply reference brand *logos*" (not login screenshots), or P4-01c-as-pHash is closed.** Caveat: Phishpedia is an *identification* system (assumes a page is already flagged) with limited in-the-wild brand coverage — pair it with the existing brand/domain-mismatch flag.


**Why it's yours:** the old pHash/template path is no longer the plan. The remaining human decision is which reference brand **logos** the logo-embedding model may use, or whether to use a public reference set such as Phishpedia. That asset approval is a product/legal call only you can make.

**Context:** P5-D6 (#246) carries the logo-embedding implementation path, with P5-D5 (#245) as the on-device ML host. The legacy pHash screenshots/templates context above is retained only as decision history.

**Done when:** you supply or approve a sanctioned set of brand logos, confirm a public logo reference set, or explicitly defer the logo-embedding asset dependency.

---

## Completed log

- **AI-12 — Top-site FP relief + D1 (#354) · DONE · 2026-06-23.** Chris manually confirmed the relief works on LinkedIn ("seemed to work fine now") = his measure/Gate-3 (the full `measure:fp` needs headed Chromium + live Tranco, which the sandbox can't run). **#354 merged into `main`** (`c4426cf`) on green CI (Build/Unit + E2E, including the main-merge head): `nrs.ts getTierAdjustedBlockThreshold` now relieves TOP_SITE + CDS-only (benign-structural whitelist) by `NRS_TOP_SITE_CDS_RELIEF` (+20, tunable); top-site trust list grew 24→42 with safe `includeSubdomains`. This is the lever #234/P5-A3 promised but never shipped.
- **AI-11 — Toast count-pill (#353) · DONE · 2026-06-23.** Chris approved the merge; **#353 merged into `main`** (`d0e0412`). Repeated blocked-popup/redirect prompts coalesce into one count pill after 3-in-8s (expandable to the latest prompt's Allow once / Always allow). Included an e2e fix (RW-19 now accepts the coalesced pill while keeping the no-popup-opened security assertion). Green CI (Build/Unit + E2E).
- **AI-10 — Gate-3 + merge the SPA-breakage fix · DONE · 2026-06-23.** Chris manually verified #352 in Chrome ("working fine now"); **#352 merged into `main`** (`#347` History.pushState/replaceState de-hardened to writable via `softPatchProto` — fixes the claude.ai grey screen; `#348` `reputation_data.bin` added to `web_accessible_resources` — fixes the per-page console error + re-enables top-frame reputation). Green CI (Build/Unit + E2E). Remaining session PRs: **#353** (toast pill, AI-11) and **#354** (top-site FP relief + D1, AI-12, gated on `measure:fp`).
- **AI-1 — Gate 3 manual Chrome test · WAIVED → DEFERRED · 2026-06-05.** Chris waived the manual-test gate for the 11-PR batch; merges proceeded on fresh-green CI + 2× independent adversarial review. Manual checks preserved as a deferred regression watchlist in `docs/agentic/POST_MERGE_MANUAL_VERIFICATION.md` (run on next build + load).
- **AI-2 — Merge order + execution · DONE · 2026-06-05.** All 11 D-series PRs merged oldest-first (#180, #182, #183, #185, #187, #189, #190, #191, #193, #194, #195). #182 merged last after a docs-only conflict (resolved by taking `main`; verified tsc clean / lint 0/0 / 2298 unit tests + green CI on the merge head). `main` @ `4bd60ce`, 0 open PRs, branches pruned.
- **AI-3 — Fate of `fix/jsb-stale-todos-and-tests` · RESOLVED (superseded) · 2026-06-13.** Verified on `main` @ `da400fb`: branch gone (local + origin), stale TODO markers gone from `js_behavior_monitor.ts`, and `computeJsBehaviorScore` now a live implemented function (`js_behavior_state.ts:67`). Both branch intents landed via later merges; nothing to do.
- **AI-4 — Firefox build tooling for FF-02 · DECIDED · 2026-06-13; scheduling superseded 2026-07-10.** `web-ext` remains the chosen tooling if the post-retention Firefox demand gate opens; no implementation is active now.
- **AI-5 — Visual-sim brand assets · RESOLVED · 2026-06-19; scheduling superseded 2026-07-10.** The Phishpedia set remains the approved future input, but RI-02 removes the current path and no logo-embedding implementation is active before retention evidence.
- **AI-6 — Manual Gate-3 on PR #249 + merge · RESOLVED (Gate-3 WAIVED) · 2026-06-19.** Chris waived Gate-3 for the #249/#263/#265 batch and authorized the agent merge. **#249 merged** (replay-grade `PromptOutcomeEntry`) on green CI + 2 adversarial review rounds. Manual-browser check preserved on the deferred watchlist `docs/agentic/POST_MERGE_MANUAL_VERIFICATION.md`. Standing posture confirmed: agent may autonomously merge non-browser PRs; browser-surface PRs still hold for Gate-3.
