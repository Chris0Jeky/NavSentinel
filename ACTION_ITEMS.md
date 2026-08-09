<!-- HUMAN QUEUE: Use stable AI-N identifiers when the current task involves a
     human decision or manual check. Close an item only from an explicit owner
     answer or directly verified removal of the action it requested. -->

# ACTION ITEMS — Human-Owned Tasks (NavSentinel)

**Purpose:** the running list of things only *you* (Chris) can do, with enough
context to resume by stable ID.

**Waiver state refreshed:** 2026-08-09.

**Last updated:** 2026-08-08 — an agent session landed five non-browser PRs to
`main` (#519, #524, #525, #527, #529; head `076bb7a`, exact-main CI green on both
jobs) and recorded the owner waiver for the browser-surface queue. Gate-3 is
waived for exactly **#528, #532, #535, #514, #534, #520, #521, #522, #526,
#533, and #542**; this is not a real-Chrome pass and those PRs remain open until
they merge. The AI-28 boundary for #535 and the AI-14/#417 hold for #531 are
also explicitly recorded below; no merge, `measure:fp`, or headed-measurement
claim is made. Two milestones now exist:
`v0.5.0-unlisted-beta` (7 real blockers) and `post-beta-horizon` (the 15 frozen
Horizon epics #439–#453, moved out of the active queue). AI-23 now carries a
completed inspection and a *retire* recommendation for `chore/deny-floor-v1.6.3`,
plus two local-only branches the earlier audit missed. Everything below this
paragraph predates that session unless dated otherwise.

**Previously updated:** 2026-08-02 — remote `main` included PR #510 at `56e3aa6`,
its exact-main product CI was green, and live GitHub had no open PRs. Chris
selected the interaction-only beta under AI-9, retained an opt-in non-release
research profile, and accepted `main`
without branch protection under AI-17. PR #509 merged the profile decision as
`3faeb1e`; AI-25 passed on executable/artifact head `f6815be` in headed Chrome
150.0.7871.187. AI-16 ratified the July 3, July 10, and July 13 standing
decisions, including headed Chrome as the primary Gate-3 once operational with
manual spot-checks retained. Under AI-20, Chris chose to leave the original
fixture quarantined; equivalent scan-clean coverage is remotely backed up on
the RI-01 branch at `184be55`. The guided cursor is now **AI-19** (`q-5`). Owner
decision #499 made AI-18 obsolete. The three browser checks waived on 2026-07-25
remain represented by the single optional **AI-24** confirmation.
Product thesis:
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

## Current state snapshot (live state rechecked 2026-08-02)

The dedicated reconciliation worktree matched `origin/main` at `56e3aa6` after
PR #510 merged; live GitHub showed no open PRs. Run `git fetch origin`,
`git rev-parse origin/main`, and
live `gh` checks before acting; the exact audit baseline lives in
`docs/Product_Strategy.md`, not this live snapshot. v0.4.0 still has no tag,
GitHub release, CWS release, or external-user evidence.

Live recheck on 2026-08-02 found **0 open PRs, 79 open issues, and no open
milestones, tags, or GitHub releases**. Verify all volatile counts live rather
than treating this paragraph as a gate. Chris accepts the current `main`
protection posture under AI-17; do not reopen or re-flag it.
Stale PRs #273 and #399 were closed with explicit re-entry paths; their heads
remain fetchable server-side at `refs/pull/273/head` and `refs/pull/399/head`,
so the matching local branches are redundant copies, not the only copies.
#356 **merged 2026-07-25** as `3bd9e02`, auto-closing #349. Its merged head was
`631461e` (= `f8028c9` + `Merge origin/main`), green on that exact head with all
three review threads resolved; the manual Gate-3 was waived rather than run, so
AI-13 no longer exists as an item.  The historical `ee0f9b7`/`f8028c9` pin
confusion is retained in AI-13's superseded entry only as a lesson about stale
head pins. The product-posture and guided-workflow
work merged through PR #454; verify live `main` rather than pinning its SHA
here. The RI-01 checkpoint branch is remotely backed up at `184be55`. Its
normal Git status is clean after replacing the quarantined test representation
with a runtime-equivalent, Defender-scan-clean form. The branch remains an
unmerged, old-base integration checkpoint; these changes do not change shipped
product state.

- **Product posture:** strong pre-release alpha, not a market-ready or
  efficacy-validated security product. `docs/Product_Strategy.md` owns the
  current thesis, beta profile, and evidence gates; `docs/Project_Roadmap.md`
  owns the corrective action register.
- **Release-integrity blockers:** page-controlled injected UI currently owns
  allow/trust/resume authority and can be redressed under genuine input
  (RI-01); visual-sim can process the wrong active
  tab and has no production value (RI-02/#424); the frozen MAIN-world prototypes
  were site-breaking until #356 landed on 2026-07-25 (`3bd9e02`); fake DNR and
  unmeasured JS behavior should be absent
  or off; stored URLs require minimization (RI-05/RI-06); #175/#186 bridge
  identity/recovery and #455 pre-collection disclosure/consent now block beta.
- **Release/profile status:** AI-9 selected interaction-only. PR #509 makes it
  the release-eligible default with no reputation runtime, asset, or claim. A
  deterministic 52-byte reserved-domain fixture remains available only in the
  unpacked, explicitly non-release `research-reputation` profile. AI-25 passed
  on executable/artifact head `f6815be` in Chrome 150.0.7871.187. PR #509
  merged as `3faeb1e`, and issue #321 closed.
- **Brand blocker:** TruNav publicly uses the exact name `NavSentinel` for a
  coming-soon GNSS anti-spoofing receiver. AI-19 requires clearance or an
  early rename before CWS submission; this is a risk flag, not a legal conclusion.
- **Legacy PR cleanup:** #273 and draft #399 were closed on 2026-07-13 rather
  than merged from stale bases; their commits, discussions, and open issue
  anchors remain. **#356 merged 2026-07-25** (`3bd9e02`) — twice reviewed,
  thread-clean, exact-head CI-green, with its manual Gate-3 waived in favour of the
  automated equivalent. AI-13 is resolved; the optional AI-24 carries the residue.
- **Portfolio:** re-derive the open-issue count with `gh issue list --state open`
  — the 2026-08-02 snapshot was 79, but a number written here ages quickly.
  None assigned or milestoned; #439–#453
  are 15 frozen Horizon proposals. No new feature/epic issue seeding until the queue is
  culled and milestone-categorized.
- **GitHub posture:** Chris accepts `main` without branch protection under
  AI-17. This is not an open action or risk flag and should not be re-surfaced.
  GitHub private vulnerability reporting is enabled and linked from
  `SECURITY.md`. Owner decision #499 removed repository-local hook/floor
  enforcement; NavSentinel is no longer an agent-harness consumer.
- **Local verification resolved:** Chris chose to leave the original exact
  fixture quarantined under AI-20. No Defender exclusion, setting change, or
  allow rule was added. The replacement preserves the exact runtime corpus,
  has SHA-256 `7507B26EABA96947CF5C75BCAAC872442B4CE14DBB91C193A6CDFC3990639F46`,
  and an exact-file `MpCmdRun.exe` scan found no threats. The branch passed
  2,887 unit tests and all 65 E2E tests after the related trusted-click scoring
  regression was fixed.
- **Historical snapshots** (pre-2026-07-03, ~28 session bullets) archived to [`docs/archive/ACTION_ITEMS_snapshots.md`](docs/archive/ACTION_ITEMS_snapshots.md).

---

## Action items

**Guided resolution cursor:** `AI-19` (`Resume at: AI-19`; the next
conversational label is `q-5`). Current ready order is AI-19 -> AI-24 -> AI-23
(low priority housekeeping, last). AI-27 and AI-28 have recorded owner waivers;
they remain pending their dependent PR merge state rather than being complete.

> **2026-08-08 — a browser-surface batch is now waiting on you (AI-27), and one
> scope decision is owed before its last slice can be finished (AI-28).** AI-27
> does **not** automatically close AI-24. AI-24 requires two things beyond the
> AI-13 step-5 gates — the AI-21 trusted-compatibility cases (OAuth popup by
> physical click, by Tab+Enter, by submit input; exactly one popup, no prompt) and
> confirming the MV3 service worker registers in `chrome://extensions`. Those are
> now folded into AI-27's procedure below, so an `AI-27 pass` that includes them
> closes AI-24 as well; an `AI-27 pass` that skips them does not, and AI-24 stays
> open. Say which you ran.

> **Owner waiver recorded 2026-08-09:** Gate-3 is waived for exactly #528, #532,
> #535, #514, #534, #520, #521, #522, #526, #533, and #542. This is not a
> real-Chrome pass, and AI-27 remains pending until every listed PR merges.
**AI-13, AI-21 and AI-22 are resolved** — their
PRs (#356, #464, #466) merged on 2026-07-25 after Chris chose to clear the
browser-surface gate by automated equivalent rather than a manual pass; their
procedures are retained below and in `docs/agentic/GATE3_GUIDES.md` as the
reference for **AI-24**, a single post-merge real-Chrome confirmation over the
merged result. The `q-N` label may reset between conversations; the `AI-N`
identifier is durable. AI-15/AI-8/AI-14 remain visible but are not actionable
questions until agent preflight clears them.

> **Gate-queue hold (refreshed 2026-07-25):** do not run the old branch checkout
> guides for AI-8 or AI-14 — both require new current-main slices after their stale
> PRs were closed. AI-13 is **resolved** (its PR merged with the manual gate
> waived), so its retained procedure is reference material for AI-24, not a queue
> item. AI-15 remains BLOCKED until the remaining release-integrity program has a
> current preflight handoff.

**🚨 OPEN: AI-19 — Clear or replace the working product name before CWS
submission.** TruNav publicly uses the exact name `NavSentinel` for a
coming-soon GNSS anti-spoofing receiver, publicized by the US Department of
Transportation in May 2026. This is not a legal conclusion, but shipping under the name without a
search/domain/CWS/trademark review creates avoidable brand and discovery risk.
**Recommendation:** rename early. Reply `AI-19 rename; generate shortlist` and
the agent can generate and preliminarily screen replacements, or reply
`AI-19 keep; begin formal clearance`. For either path: (1) define intended
territories and browser-security goods/services; (2) search exact, similar,
phonetic, joined, and spaced variants in the [UK IPO](https://www.gov.uk/search-for-trademark),
[USPTO comprehensive clearance guide](https://www.uspto.gov/trademarks/search/comprehensive-clearance-search-similar-trademarks), [WIPO Global Brand
Database](https://www.wipo.int/en/web/global-brand-database), and EUIPO if EU
distribution matters; (3) search general product/company usage, Companies
House, GitHub, Chrome Web Store, domains, and relevant handles; (4) save dated
results and potentially conflicting classes/goods; (5) obtain professional
trademark advice before a commercial/public launch; and (6) record **keep** or
**rename**. If renaming, coordinate code, manifest, store copy, assets,
screenshots, docs, and repository metadata before invitations or submission.
Then tell the agent `AI-19 done: <decision>`.

**RESOLVED 2026-07-31 — AI-18 — Codex project-hook trust.** Chris reviewed and
trusted the prior hook definition, then explicitly directed removal of the
repository-local harness in #499. The hook file and trust action no longer
exist after that change; no restart confirmation or future re-trust is needed.

**OPEN: AI-24 — One post-merge real-Chrome confirmation pass over the three
browser-surface slices now on `main`** (optional; closes the residual risk accepted
by the 2026-07-25 Gate-3 waiver). #356, #464 and #466 all merged after their guides
were satisfied by automated equivalents in real **Chromium** with the real unpacked
extension. What no automation covered: branded **Chrome** rather than Chromium, the
manual temporary-profile hygiene, human eyes on toast wording/placement, and telling
a Chrome-blocked popup apart from a NavSentinel-blocked one.

This replaces AI-13 + AI-21 + AI-22 with a **single** pass, which is both less work
and better evidence: the three changes interact (#356 de-hardened the location hook
so delayed redirects rely on rollback; #464 removed pointerdown-derived authority),
and testing them merged is the state users will actually run. Their procedures are
retained in this file and in `docs/agentic/GATE3_GUIDES.md`.

Suggested scope, ~20 minutes: build from current `main`, load
`extension/dist` unpacked in a fresh temporary Chrome profile, then walk the AI-13
step-5 gates (Level 10 delayed redirect rolls back with its toast; programmatic form
submit blocks then `Allow once` permits exactly the form action; Level 5 popunder
blocks), the AI-21 trusted-compatibility cases (OAuth popup by physical click, by
Tab+Enter, by submit input — exactly one popup, no prompt), and confirm the MV3
service worker registers in `chrome://extensions` (the `rolldownOptions` change).
Reply `AI-24 done` plus Chrome's version, or `AI-24 failed: <step and observed>`.
Only Chris can record this complete; nothing is blocked on it.

**🚨 BLOCKED: AI-15 — Run the headed release session only after agent
preflight.** The prior 60–90 minute one-sitting guide is withdrawn: stale PRs
#273 and #399 were closed, **#356 merged 2026-07-25** (`3bd9e02`) with its manual
Gate-3 waived, and the selected interaction-only profile passed AI-25 and landed
through PR #509. Other release-integrity blockers precede a full manual release
session. Agent preflight
must first: (1) fix RI-01; (2) keep #273 deferred or recreate it on current `main`;
(3) excise visual-sim and remove fake DNR; (4) complete
RI-06's purpose-specific data minimization/reset; (5) complete RI-07's explicit
JS-behavior beta-off profile; (6) complete #175/#186 bridge integrity and #455
pre-collection consent; and (7) provide one current headed checklist. Then
split human work into a browser
session, any network/feed session, an overnight measurement run, and a short
result review. Read `docs/Product_Strategy.md` first. This item becomes
actionable only when the preflight handoff explicitly says so.

**🚨 OPEN: AI-27 — One Gate-3 batch pass over the browser-surface queue from the
2026-08-08 session.** Eleven browser-surface PRs are open and reviewed, and none can
merge without your call. They are listed in the order they should be merged, not
the order they were opened.

**Status update (2026-08-09): WAIVED, PENDING MERGE.** The owner waived Gate-3
for exactly **#528, #532, #535, #514, #534, #520, #521, #522, #526, #533, and
#542**. This is never a real-Chrome pass; no Chrome test is claimed or implied,
and AI-27 is not complete until every listed PR has merged.

**Check CI yourself before passing any of them — do not assume green.** Two
separate things went wrong here and both are worth knowing:

- **Stacked PRs run no CI at all** (issue **#537**, found during this session).
  `.github/workflows/ci.yml` filters `pull_request` on `branches: [main]`, and that
  filter matches the *base* branch — so #532 and #535, whose bases are other
  branches, reported `no checks reported on the branch`: not red, not pending,
  never ran. `mergeStateStatus` still says `CLEAN`, so a stacked PR *looks*
  mergeable while being entirely unverified. Both were given a real run via
  `gh workflow run ci.yml --ref <branch>` (the workflow already declares
  `workflow_dispatch`), and **both are now green** — #532 at head `c12de37a`
  (run `31227640239`) and #535 at head `51df51ea` (run `31229947040`), each with
  `Build / Unit` and `E2E` passing, and each run's `headSha` checked against the PR
  head rather than assumed. PR **#538** widens the trigger so future
  stacked PRs are covered; it does **not** retroactively fix these two, because a
  `pull_request` run resolves its workflow file from the base-plus-head merge
  commit, and their branches still carry the old filter until `main` is merged in.
  **Beware where you look:** a `workflow_dispatch` run attaches to the *branch*,
  not the PR, so the PR page and `gh pr checks` keep saying "no checks reported"
  even after a green run exists. Check it with
  `gh run list --branch <branch> --workflow ci.yml --event workflow_dispatch --limit 1 --json headSha,status,conclusion`
  — the `--workflow`/`--event` filters matter, because `stress.yml` also accepts a
  dispatch, so an unfiltered lookup can show a green `stress` run at the same SHA
  and let you conclude `Build / Unit` and `E2E` passed when they never ran
  (the default table has no SHA column) and match it to
  `gh pr view <N> --json headRefOid`.
  **And know what that evidence is worth:** a dispatch builds the branch *tip*,
  while a `pull_request` run builds the base-plus-head *merge commit*. So a green
  dispatch can bless a tree that omits newer base changes. Both runs above predate
  any further movement on their bases; if `#528` or `#532` gains commits before you
  merge, merge the new base into the child and re-dispatch rather than trusting the
  run recorded here.
- **#533 was red** — its new popup code pushed `popup JS` to 10.1KB against a 10KB
  budget, which failed `build-and-unit` and therefore **skipped `E2E` entirely**. A
  skipped job is not a passed job. **Now fixed and green** at head `147d4a07`
  (run `31228467376`, `Build / Unit` and `E2E` both passing). It was fixed by
  removing ~1.6KB of duplicated popup code rather than by raising the budget, so
  the 10KB line still means what it meant. Note the popup chunk now sits at 96%
  with roughly 400 bytes of headroom — the next popup slice has to trim or make an
  explicit budget decision.

**Slots 1-3 are a three-deep stack: #528 ← #532 ← #535.** Merge them oldest-first
in exactly that order; merging the newest first would strand its parents (global
law 4).

On deleting the base branches, note the two cases are **opposite**, and the safe-
sounding one is the dangerous one. Deleting an *unmerged* branch that other PRs are
based on closes those PRs — never do that. But deleting the head branch *as part of
merging it* makes GitHub automatically retarget the children onto the merged PR's
own base, which is what you want. So refusing to delete #528's branch after merging
it leaves #532 still targeting #528, and merging #532 then updates **#528's branch
rather than `main`** — the slice silently never lands. The rule that is actually
safe is: after each base merges, **confirm the child now targets `main` before
merging it**, whether that happened automatically or via `gh pr edit <N> --base main`:

```
gh pr view 532 --json baseRefName -q '.baseRefName'   # must print: main
```

Retargeting on its own also runs **no CI** — it fires an `edited` activity, which a
`pull_request` workflow with no `types` filter ignores, and the child's head SHA
does not change so nothing looks stale. Merge `main` into the child after
retargeting; that changes the head, triggers a real run, and tests the tree that
will actually merge. Slots 4-11 are independent branches off
`main` and can go in any order.

| Order | PR | What it changes | Why it needs your eyes |
| --- | --- | --- | --- |
| 1 | **#528** | RI-05: removes the fake `declarativeNetRequest` surface, its two localhost-scoped stub rules, the options toggle, and **two manifest permissions** | Permission surface shrinks 5→3. Confirm the extension still loads and behaves normally after the manifest change |
| 2 | **#532** | RI-07: JS-behaviour instrumentation is a build-time capability, off in every profile; the monitor module is not linked at all | Confirm navigation, credential and DoubleClickjacking protection still work — those are deliberately unaffected, but that is the thing to verify by hand |
| 3 | **#535** | RI-06 last slice: one service-worker-owned **clear-all behavioural-data** reset (prompt outcomes → adaptive scores → event log → domain profiles), with partial-failure reporting and crash-resume | Ships under the **AI-28** assumption below. Use the new options → Analytics *Clear behavioural data* control and confirm it erases history but leaves your settings, allowlist and trusted domains intact. Review round 2 fixed four failure-semantics defects here, the worst being a swallowed marker-finalization error that reported success and would later replay the reset over data created *after* it. Two things are visually unverified and are what your pass is for: the new "wasn't finalized" status line and the confirm dialog |
| 4 | **#514** | RI-02: removes visual-sim capture, templates, the scoring hook, the `brand_templates.json` web-accessible resource, and the stored state | Already reviewed on its exact head, exact-head CI green. Manual pass: see the **#514 note** directly below this table — the "AI-26" its review thread cites was never actually written into this file, so there was no recorded procedure until now |
| 5 | **#534** | #458: removes the `Location.prototype` patch that never intercepted anything, and corrects README / architecture / design-brief claims | Confirm delayed-redirect rollback still works. Note the Gate-3 guide text itself changed — a step that said "normal Location calls bypass the prototype hook" now says there is no pre-navigation hook at all |
| 6 | **#520** | #389: primes redirect chain-info at content-script init so first-click NRS is not under-scored | Decision path is unchanged and still synchronous; worth a normal browse to confirm no latency |
| 7 | **#521** | #382: forward-offer no longer re-sent after delivery | Do a rollback and confirm you get exactly one forward prompt, and that resuming still works |
| 8 | **#522** | #410: bounds the action-attribute scan on the credential submit path | Submit a real login form and confirm the prompt still names the correct destination host |
| 9 | **#526** | #413: reserves the last 5 of the 50 mutation-alert slots for scarce security detections (injected password field, suspicious iframe, cross-domain form-action change), so a benign-alert flood can no longer switch detection off | Review caught that the originally-prescribed fix registered shadow roots but still emitted nothing past the cap; the reserve is the real fix. Worth browsing a few mutation-heavy sites (cookie banners, chat widgets) to confirm no new prompts |
| 10 | **#533** | #219: distinct gauge state when a page has only scoreless threat alerts | Purely visual — confirm the dashed-ring "!" state reads as a warning and not as an error. Its scope is narrower than #219 asked for: review found `nav_reputation_late_warn` stamps the *child frame's* hostname while the popup matches the top-level domain, so the state cannot fire for third-party iframes — #219's headline case. Tracked as **#539**; the PR's claim was narrowed rather than the fix widened |
| 11 | **#542** | #391: reports fixed-cap event-log truncation during suite import | In Options, import a synthetic JSON suite with `settings: { "logLimit": 5000 }` and 5,001 valid `eventLog` records (`id: "evt-0"` … `"evt-5000"`, increasing numeric `ts`, `kind: "suite_config_update"`). Confirm the import succeeds, the status says `Imported. Event log truncated: 1 older event was not imported.`, and the Options view refreshes. Repeat with the same setting and 5,000 records; confirm the status remains `Imported.` |

**#514 note — the missing "AI-26".** PR #514's review thread says *"`ACTION_ITEMS.md`
AI-26 still requires Chris's fresh-profile real-Chrome Gate-3 evidence"*, but a
repo-wide search finds no AI-26 item: it was referenced on the PR and never
recorded here, so the stable ID was not resumable and #514 had **no written pass
criteria anywhere**. Rather than mint a second ID, its criteria are folded into
AI-27. For #514 specifically, confirm on a fresh profile:

- No viewport capture occurs on any page (the removed path could previously
  process the *wrong* active tab — that is the defect RI-02 exists to remove).
- No console error about `brand_templates.json` or a missing web-accessible
  resource, on a normal page and on a credential page.
- A credential/login page still produces a sensible risk read-out with the
  visual-similarity factor gone — the gauge and chips should look unremarkable,
  not empty or broken.
- The popup and options surfaces show no leftover visual-similarity control,
  label, or explanation string.

If you would rather keep `AI-26` as a distinct ID, say so and it will be written up
properly as its own item instead.

**Budget note, measured 2026-08-08:** the stack in slots 1-2 *reclaims* bundle
space rather than spending it. `main_guard` drops 18.5KB → 14.2KB (92% → 71% of
budget) because the JS-behaviour monitor is no longer linked, and total dist goes
495.0KB → 491.3KB. Total headroom nearly doubles, 5.0KB → 8.7KB. `total dist` was
sitting at **99%** of its 500KB budget, and CI gates on it — so merging slots 1-2
early is what buys room for the rest. #514 should give back more again.

**Suggested approach:** one session, build from a branch, load `extension/dist`
unpacked in a fresh temporary Chrome profile, and walk the gates once per merged
group rather than once per PR — several of these interact and testing them merged
is the state users run. The gate set is:

1. The **AI-13 step-5 gates** in `docs/agentic/GATE3_GUIDES.md` (delayed-redirect
   rollback with its toast, programmatic form submit blocked before navigation,
   `Allow once` scoping, popup blocks).
2. The **AI-21 trusted-compatibility cases** — OAuth popup opened by physical
   click, by Tab+Enter, and by submit input: exactly one popup each, no prompt.
3. **MV3 service-worker registration** in `chrome://extensions` (no errors, worker
   active).

Items 2 and 3 are carried over from AI-24 deliberately: without them an `AI-27
pass` would silently drop AI-24's residual checks. They also matter more than
usual this time, because #528 changes the manifest's permission set and #532
changes what is linked into the bundle — both are exactly the kind of change that
can break worker registration.

Reply `AI-27 pass: <PR list>` or `AI-27 waive: <PR list>` (a waiver is a legitimate
outcome and is what you chose on 2026-07-25; it is recorded as a waiver, never as a
Gate-3 pass), and say whether you ran items 2-3 so AI-24 can be closed or left
open accordingly. Anything you fail, say so and it becomes a fix slice.

**Not in this batch:** PR #531 (OAuth state corroboration) is titled
`[HELD on AI-14/#417]` and must **not** enter the Gate-3 queue — see AI-14. It is
open only as a durable backup of work that previously existed on one machine.

**🚨 OPEN: AI-28 — Define the behavioural-data boundary for the RI-06 clear-all
reset.** Issue #474 (the last RI-06 slice) cannot be finished correctly without an
owner ruling, and the agent implementing it was told to proceed on a **named
assumption** rather than block:

> Assumption: the behavioural-data boundary covers the event log, prompt outcomes,
> and caches derived from them (adaptive scores / domain profiles built from
> observed behaviour). It EXCLUDES user configuration: suite settings, the user's
> allowlist and trusted domains. Reason: erasing configuration the user
> deliberately set would be data loss, whereas leaving behavioural residue is the
> privacy defect this slice exists to fix.

**Status update (2026-08-09): DECISION RECORDED, PENDING #535 MERGE.** The owner
delegated/waived the AI-28 choice by accepting #535's existing boundary: clear
prompt outcomes, adaptive scores, the event log, and domain profiles; preserve
suite settings, the allowlist, and trusted domains. The navigation-category
profile and smart-default cooldowns are explicitly outside this boundary. This
records the decision only; #535 remains unmerged and this item is not complete
until its implementation merges. No claim of a full behavioural-data reset is
made.

The boundary question below is historical and superseded by the recorded owner
decision above; it is retained only to preserve the original rationale.

Event log and prompt outcomes are unequivocally in scope; the open question is
whether **domain profiles, adaptive scores, allowlist/trusted domains and suite
settings** belong inside the boundary. Reply `AI-28: <lanes to include>` — the
lane set is a single declared list in the implementation, so widening it is a
one-line change rather than a redesign. Until you rule, the reset ships with the
conservative boundary above, which can only under-clear, never destroy config.

**BLOCKED: AI-8 — Neutral-chip Gate-3 after closed PR #273.** The presentation
intent is still reasonable, but stale PR #273 was closed on 2026-07-13 with its
commit and two unresolved review threads preserved. An agent must recreate or
defer the tiny change from current `main`, resolve both findings, pass the
focused product checks and hosted product CI, then post a new visual-check
guide. Do not reuse the old branch checkout guide.

**AI-10 — Gate-3 + merge the SPA-breakage fix (#352) · ✅ RESOLVED 2026-06-23.** Chris ran the manual Chrome check ("manual checks on chrome for #352 done, it seems to be working fine now") → **#352 merged into `main`** (`#347` pushState de-harden + `#348` reputation WAR). The claude.ai grey screen / infinite-load and the per-page `reputation_data.bin`/`pushState` console errors were fixed. This is historical: PR #509 later made interaction-only the release default and removed reputation from that profile.

**AI-11 — Toast count-pill (#351 → PR #353) · ✅ RESOLVED 2026-06-23 — MERGED.** Chris said "merge #353"; green CI (incl. the RW-19 e2e fix to accept the coalesced pill) → **#353 merged into `main`** (`d0e0412`). Repeated blocked-popup/redirect prompts now coalesce into one count pill after 3-in-8s (expandable to the latest prompt's Allow once / Always allow). The pill is live on the next `git checkout main && npm run build`.

**RESOLVED 2026-07-25 (manual gate waived) — AI-13 — #356 MAIN-world compatibility Gate-3.** PR #356 merged as `3bd9e02`; issue #349 auto-closed. Chris chose the automated-equivalent path on 2026-07-25 rather than a manual pass; the PR carries the mapping from each guide step to the spec that covers it, plus what automation cannot establish (real Chrome vs Chromium, manual profile hygiene, human eyes on toast wording). This was **never recorded as a Gate-3 pass** — only Chris can do that. Residual risk accepted under the waiver; **AI-24** is the single confirmation pass that closes it if he wants one. Procedure retained below for that purpose.

*Original item: Run #356 MAIN-world compatibility Gate-3 (GUIDE PREPARED; LIVE CI PRECHECK REQUIRED).* PR #356 is refreshed from current `origin/main`
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

**Retained procedure (steps 1 and 7 are SUPERSEDED).** Step 1's exact-head
precheck cannot pass — it compares a worktree against `gh pr view 356
--json headRefOid` and `git ls-remote` for a branch whose PR is merged. Step 7's
reply line (`AI-13 done; Gate-3 passed on PR #356`) would record exactly the
Gate-3 pass this file says was never recorded. For a confirmation run use **AI-24**
instead: build from current `main` and execute steps 2–6 below against it.

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
2. In that worktree run `npm ci` and `npm run build`. Keep
   `python -m http.server 5173 --bind 127.0.0.1 --directory gym` open in a second
   terminal to serve the fixtures. (This instruction previously said the static
   server was needed to avoid the branch's "known-vulnerable pre-#459 Vite
   server". That reason is **stale and was removed on 2026-07-24**: the branch
   already contains #459/#463's dependency fix — it contains merge commit
   `2888483` and its `package.json` pins `vite ^8.1.5` / `@crxjs/vite-plugin
   ^2.7.1`, identical to `main`. The branch trails `main` by five commits — the
   two deny-floor syncs (#467/#469), their two merge commits, and
   `d7528f9 Update package-lock.json`. The floor syncs touch only
   `.claude/hooks/` and do not affect the extension build; the lockfile commit
   is the one to check yourself if `npm ci` behaves unexpectedly. A static server is still the simpler choice for a Gate-3
   run, so the step is unchanged — only its justification was wrong. Do **not**
   merge `main` into #356 on the strength of the old wording; that would
   invalidate its exact-head CI and review evidence for no benefit.) Create a temporary local Chrome profile from the profile
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
7. **SUPERSEDED — do not use this reply line.** It would record a Gate-3 pass that
   was never taken. For a confirmation run reply `AI-24 done` instead, with Chrome's
   version and any console error, unexpected prompt text, or differing outcome.
   *Original step: Reply `AI-13 done; Gate-3 passed on PR #356` …*

**RESOLVED 2026-07-25 (manual gate waived) — AI-21 — #464 synthetic-navigation Gate-3.** PR #464 merged as `c4f6183`. Chris chose the automated-equivalent path on 2026-07-25 rather than a manual pass; the PR carries the mapping from each guide step to the spec that covers it, plus what automation cannot establish (real Chrome vs Chromium, manual profile hygiene, human eyes on toast wording). This was **never recorded as a Gate-3 pass** — only Chris can do that. Residual risk accepted under the waiver; **AI-24** is the single confirmation pass that closes it if he wants one. Procedure retained below for that purpose.

*Original item: Run PR #464 synthetic-navigation Gate-3 (GUIDE IN
`docs/agentic/GATE3_GUIDES.md`; LIVE EXACT-HEAD PRECHECK REQUIRED).** This browser-surface slice
stops page scripts from minting navigation authority with dispatched
pointer/click events, keeping a preceding real pointerdown only as
attack-correlation evidence: a trusted pointerdown now sends only a top-frame
rollback baseline and cannot create gesture, broad, target, or recent-user
authority. Live state on 2026-07-24: head `cf66b28`, MERGEABLE, Build/Unit and
E2E green, 6 review threads all resolved. Automated Chromium proves the
pointerdown-only rollback attack, the synchronous MAIN-world popup attack, the
existing synthetic attacks, and the trusted compatibility paths, but a real
Chrome pass must confirm them before merge. Only Chris can record this complete.

**RESOLVED 2026-07-25 (manual gate waived) — AI-22 — #466 pending-decision service-worker Gate-3.** PR #466 merged as `4ff6341`. Chris chose the automated-equivalent path on 2026-07-25 rather than a manual pass; the PR carries the mapping from each guide step to the spec that covers it, plus what automation cannot establish (real Chrome vs Chromium, manual profile hygiene, human eyes on toast wording). This was **never recorded as a Gate-3 pass** — only Chris can do that. Residual risk accepted under the waiver; **AI-24** is the single confirmation pass that closes it if he wants one. Procedure retained below for that purpose. The `rolldownOptions` bundle-layout risk this guide singled out is covered by the `check:mv3-worker` gate #466 itself adds (`PASS: 5 statically linked worker modules`), now wired into `npm run build` and `npm run package:ext`.

*Original item: Run PR #466 pending-decision service-worker Gate-3 (GUIDE IN
`docs/agentic/GATE3_GUIDES.md`; LIVE EXACT-HEAD PRECHECK REQUIRED).** Adds the
URL-minimized, session-backed pending-decision boundary so prompt authority is
derived from Chrome rather than page messages. Live state on 2026-07-24: head
`0266107`, MERGEABLE, Build/Unit and E2E green, 4 review threads all resolved.
Its Gate-3 must additionally treat the `rollupOptions` -> `rolldownOptions`
swap in `vite.config.ts` as a first-class target: build, load unpacked in real
Chrome, and confirm the MV3 service worker actually registers, because that
change alters the shipped bundle layout. Only Chris can record this complete.

> **Full AI-21/AI-22 guides:** [`docs/agentic/GATE3_GUIDES.md`](docs/agentic/GATE3_GUIDES.md)
> — verbatim from their PR branches, tracked here rather than branch-only. **Both are
> now reference material for AI-24, not a queue** (their PRs merged 2026-07-25 with the
> manual gates waived), and that file carries a superseding banner saying so. These
> entries exist so the durable register never silently omits a human-gated item while
> its PR is in flight, which is this file's whole purpose; the guides live in a separate
> tracked file only so landing those PRs did not collide with a large
> `ACTION_ITEMS.md` rewrite. Do **not** move them back onto a branch-only path.

**OPEN: AI-23 — Resolve remaining worktree and branch housekeeping safely**
(low priority; do not reuse a pinned removal inventory). Owner decision #499
removed NavSentinel's repository-local floor; it did **not** authorize cleanup
of user-owned worktrees or branches. An agent may audit, inventory, preserve,
and recommend, but Chris must explicitly approve each exact worktree removal
and each branch deletion. A blanket prune is unsafe because removal also
deletes ignored files, and several current branches contain work absent from
`main`.

The 2026-08-02 live audit established these boundaries:

- retain `C:/Users/Public/codex-shell-home/NavSentinel-ri01`; it has nine commits
  absent from `main` and holds the remotely backed RI-01 checkpoint at `184be55`;
- retain `.worktrees/issue496-doubleclick`; it has three commits absent from
  `main` and issue #496 remains open;
- retain `nav-floor-sync` for now; branch `chore/deny-floor-v1.6.3` has three
  commits absent from `main`, PR #477 closed without merging, and the worktree
  contains an ignored cache entry;
- `.worktrees/ai16-ratification` has no commits absent from `main` after PR #509,
  but it contains ignored build/test output, so it is only a candidate for
  owner-approved pruning after a fresh inspection identifies what must be
  preserved; and
- do not switch or remove the user's primary checkout merely to make the list
  shorter.

Before requesting approval for any candidate, re-run
`git worktree list --porcelain`, inspect both
`git status --porcelain` and `git status --porcelain --ignored`, prove the
branch is merged or otherwise preserved, and identify any ignored artifact
that must survive. Present the exact path, branch, commit delta, and preservation
plan to Chris. Only after Chris approves that named target may an agent copy out
the retained artifacts and use plain `git worktree remove` without `--force`.
Branch deletion needs its own explicit approval; use `git branch -d`, never
`-D`, after approval so Git still refuses an unmerged branch.

The only unresolved owner decision in this item is the fate of
`chore/deny-floor-v1.6.3`. Reply `AI-23 inspect nav-floor-sync` and the agent will
present its exact three-commit delta and recommend retain, archive, land, or
retire. Do not delete it before that review. Reply `AI-23 done` only after the
ambiguous branch has a deliberate disposition and the agent re-verifies the
remaining inventory.

**Inspection performed 2026-08-08 — recommendation ready, still your call.**

`chore/deny-floor-v1.6.3` (worktree `../nav-floor-sync`, three commits):

| Commit | Content | Status on current `main` |
| --- | --- | --- |
| `207ee79` | advance vendored deny floor to v1.6.3, re-pin the Codex adapter | Targets `.claude/hooks/dispatch.py`, `.claude/tier.json`, `.codex/hooks.json` — **none of these are tracked on `main`**; owner decision #499 removed the whole repository-local harness |
| `61e3a2b` | unblock AI-18 and correct its Codex hook guide | AI-18 is recorded in this file as **obsolete**, because #499 deleted the hook it describes |
| `f438b53` | correct two stale v1.6.0 provenance strings to v1.6.3 | Fixes strings inside files that no longer exist on `main` |

Verified: the only thing under `.claude/hooks/` on `main` today is an ignored
`__pycache__` directory; no `dispatch.py` is tracked. **Recommendation: retire**
(delete branch and worktree). All three commits maintain a surface owner decision
#499 deliberately removed, so landing them would partially reinstate the retired
harness. Nothing else in the branch is unique. Reply `AI-23 retire nav-floor-sync`
to authorize, and the agent will copy out the ignored cache entry first, use plain
`git worktree remove`, then `git branch -d`.

**Two local-only branches the 2026-08-02 audit did not list** (found 2026-08-08;
neither exists on `origin`, so this machine is the only copy):

- `fix/user-activation-neutral-chip` (`c19f96a`, 3 files) — this is the **closed
  PR #273 work**, which RI-03 and **AI-8** both ask to recreate from current
  `main`. Genuinely unmerged and wanted. Do not delete. It collides with PR #533,
  so recreation is queued behind it rather than done now.
- `fix/cooldown-map-cap` (`d682f14`, #308) — **superseded**. `main` already has an
  equivalent `capCooldownMap` + `SMART_DEFAULT_COOLDOWNS_LIMIT` implemented
  differently (`Object.keys` sort rather than `Object.entries`), so the guarantee
  is present and this branch adds nothing. Safe to retire on your word.

A third, `fix/oauth-require-state-corroboration-223`, was local-only and is now
published as PR #531, so it is no longer at risk of loss.

**🚨 BLOCKED: AI-14 — OAuth tradeoff measurement after closed PR #399.** The
measurement-held draft was closed on 2026-07-13 rather than merged from a stale
base. It is not a beta blocker. Keep #223 blocked until #417 supplies valid
methodology and an agent creates a current slice, passes its focused product
checks and hosted product CI, and posts a reproducible headed measurement plan.
Do not use the closed branch as a current test or merge target.

**Status update (2026-08-09): WAIVED FOR #531 ONLY.** The owner waived the
AI-14/#417 measurement hold for **PR #531 specifically**. This does not claim
`measure:fp` or a headed measurement ran, and it does not waive the methodology
requirement for other work. AI-14 remains blocked for unrelated or future
measurement work.

**AI-12 — Top-site FP relief + D1 (#350 → PR #354) · ✅ RESOLVED 2026-06-23 — MERGED.** Chris manually confirmed the relief works on LinkedIn ("tested it on linkedin and it seemed to work fine now") = his measure/Gate-3 in lieu of the full `measure:fp` run (which needs headed Chromium + live Tranco, sandbox-can't). **#354 merged into `main`** (`c4426cf`): `getTierAdjustedBlockThreshold` now relieves TOP_SITE + CDS-only (benign-structural whitelist) by `NRS_TOP_SITE_CDS_RELIEF`; trust list grew 24→42 with safe `includeSubdomains`. Green CI (Build/Unit + E2E) on the main-merged head. **Follow-up:** `+20` is an unvalidated starting value; do not tune it again without the valid #417/#416 FP/TP evidence required by D25.

AI-1, AI-2 resolved 2026-06-05; AI-3, AI-4 resolved 2026-06-13; **AI-5 resolved 2026-06-19** (Phishpedia public logo set approved); **AI-6 resolved 2026-06-19** (#249 merged after Gate-3 waiver). See Completed log. Deferred manual checks remain on the regression watchlist `docs/agentic/POST_MERGE_MANUAL_VERIFICATION.md` (run on next build + load; now also covers #249 enriched-capture, #263 credential-submit, and #265 SW-hydration behavior). Standing posture (updated by owner decision #499 on 2026-07-31): non-browser PRs use focused product checks plus hosted product CI, with no NavSentinel-local review or aging gate; **browser-surface PRs still hold for Gate-3**.

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

- **AI-20 — Defender fixture disposition · DONE · 2026-08-01.** Chris chose to
  leave the original exact fixture quarantined after reviewing the limited
  benefit of restoring it. No Defender exclusion, setting change, or allow rule
  was made. The property corpus was reconstructed byte-equivalently at runtime
  in a signature-resistant representation; an exact-file Defender scan found
  no threats. The RI-01 branch is remotely backed at `184be55` and passed
  typecheck, lint, build, version/package and perf checks, 2,887 unit tests, and
  all 65 E2E tests. RI-01 itself remains open and the old-base branch is not
  ready to merge.
- **AI-25 — PR #509 interaction-only Gate-3 · DONE · 2026-08-01.** Chris
  explicitly recorded completion on Chrome 150.0.7871.187 after reloading the
  corrected current executable/artifact head `f6815be`: NavSentinel 0.4.0 and
  its MV3 service worker registered; the interaction-only onboarding copy was
  correct; the Level 10 delayed redirect rolled back; the Level 11 credential
  submit produced the expected blocking modal and remained on the fixture; and
  both the page and service-worker consoles showed no reputation-load,
  registration, or other new errors. The disposable profile was removed and
  the Gym listener was stopped. PR #509 subsequently passed its exact-head
  hosted checks and merged as `3faeb1e`.
- **AI-9 — Beta reputation profile · DECIDED · 2026-08-01.** Chris selected
  interaction-only, while authorizing extra reproducibility, configuration, and
  opt-in experiments at agent discretion. Merged PR #509 implements the release
  default with no reputation runtime/asset/claim and retains a deterministic
  `research-reputation` fixture that is unpacked-only and rejected by packaging
  and release gates. AI-25 passed its browser-surface gate.
- **AI-17 — GitHub `main` posture · ACCEPTED · 2026-08-01.** Chris explicitly
  accepts `main` without branch protection. This is not an outstanding action or
  active risk flag and must not be re-surfaced unless Chris changes the decision.
- **AI-16 — July standing product/process decisions · RATIFIED · 2026-08-01.**
  Chris ratified the July 3, July 10, and July 13 decisions, including headed
  Chrome as the primary Gate-3 once operational with manual spot-checks
  retained. AI-9 was subsequently decided as interaction-only; AI-19 remains the
  separate name decision. The guided cursor later advanced through AI-20 to
  AI-19 (`q-5`).
- **AI-12 — Top-site FP relief + D1 (#354) · DONE · 2026-06-23.** Chris manually confirmed the relief works on LinkedIn ("seemed to work fine now") = his measure/Gate-3 (the full `measure:fp` needs headed Chromium + live Tranco, which the sandbox can't run). **#354 merged into `main`** (`c4426cf`) on green CI (Build/Unit + E2E, including the main-merge head): `nrs.ts getTierAdjustedBlockThreshold` now relieves TOP_SITE + CDS-only (benign-structural whitelist) by `NRS_TOP_SITE_CDS_RELIEF` (+20, tunable); top-site trust list grew 24→42 with safe `includeSubdomains`. This is the lever #234/P5-A3 promised but never shipped.
- **AI-11 — Toast count-pill (#353) · DONE · 2026-06-23.** Chris approved the merge; **#353 merged into `main`** (`d0e0412`). Repeated blocked-popup/redirect prompts coalesce into one count pill after 3-in-8s (expandable to the latest prompt's Allow once / Always allow). Included an e2e fix (RW-19 now accepts the coalesced pill while keeping the no-popup-opened security assertion). Green CI (Build/Unit + E2E).
- **AI-10 — Gate-3 + merge the SPA-breakage fix · DONE · 2026-06-23.** Chris manually verified #352 in Chrome ("working fine now"); **#352 merged into `main`** (`#347` History.pushState/replaceState de-hardened to writable via `softPatchProto` — fixes the claude.ai grey screen; `#348` `reputation_data.bin` added to `web_accessible_resources` — fixes the per-page console error + re-enables top-frame reputation). Green CI (Build/Unit + E2E). Remaining session PRs: **#353** (toast pill, AI-11) and **#354** (top-site FP relief + D1, AI-12, gated on `measure:fp`).
- **AI-1 — Gate 3 manual Chrome test · WAIVED → DEFERRED · 2026-06-05.** Chris waived the manual-test gate for the 11-PR batch; merges proceeded on fresh-green CI + 2× independent adversarial review. Manual checks preserved as a deferred regression watchlist in `docs/agentic/POST_MERGE_MANUAL_VERIFICATION.md` (run on next build + load).
- **AI-2 — Merge order + execution · DONE · 2026-06-05.** All 11 D-series PRs merged oldest-first (#180, #182, #183, #185, #187, #189, #190, #191, #193, #194, #195). #182 merged last after a docs-only conflict (resolved by taking `main`; verified tsc clean / lint 0/0 / 2298 unit tests + green CI on the merge head). `main` @ `4bd60ce`, 0 open PRs, branches pruned.
- **AI-3 — Fate of `fix/jsb-stale-todos-and-tests` · RESOLVED (superseded) · 2026-06-13.** Verified on `main` @ `da400fb`: branch gone (local + origin), stale TODO markers gone from `js_behavior_monitor.ts`, and `computeJsBehaviorScore` now a live implemented function (`js_behavior_state.ts:67`). Both branch intents landed via later merges; nothing to do.
- **AI-4 — Firefox build tooling for FF-02 · DECIDED · 2026-06-13; scheduling superseded 2026-07-10.** `web-ext` remains the chosen tooling if the post-retention Firefox demand gate opens; no implementation is active now.
- **AI-5 — Visual-sim brand assets · RESOLVED · 2026-06-19; scheduling superseded 2026-07-10.** The Phishpedia set remains the approved future input, but RI-02 removes the current path and no logo-embedding implementation is active before retention evidence.
- **AI-6 — Manual Gate-3 on PR #249 + merge · RESOLVED (Gate-3 WAIVED) · 2026-06-19.** Chris waived Gate-3 for the #249/#263/#265 batch and authorized the agent merge. **#249 merged** (replay-grade `PromptOutcomeEntry`) on green CI + 2 adversarial review rounds. Manual-browser check preserved on the deferred watchlist `docs/agentic/POST_MERGE_MANUAL_VERIFICATION.md`. Standing posture confirmed: agent may autonomously merge non-browser PRs; browser-surface PRs still hold for Gate-3.
