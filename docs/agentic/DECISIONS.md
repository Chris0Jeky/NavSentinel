# NavSentinel — Standing Decisions

Durable register of resolved cross-cutting decisions (process, posture, and product-sequencing). One place so the operating docs (`CLAUDE.md`, `AGENTS.md`, `ORCHESTRATOR.md`, `Project_Roadmap.md`) can point here instead of duplicating rationale. When a decision changes, edit it in place and date the change.

> **Authority:** Chris explicitly ratified the July 3, July 10, and July 13
> decisions on 2026-08-01, including headed Chrome as the primary Gate-3 once
> operational with manual spot-checks retained. The decisions remain
> reversible through a later explicit amendment. Where they refine the
> autonomous-loop prompt or older rules, they win.

---

## 2026-07-03 — Deferred decisions resolved (maintainer delegated the calls)

Chris delegated: *"take a stance yourself and call the shots in the best way possible."* The stances below adopt and operationalize the 2026-07-02 strategic review (`docs/Course_Correction.md`, `docs/Strategic_Outlook.md`). Reversible; flag any you'd change.

### D-2026-07-03-A — Adopt the ship/measure direction (was: Phase A row 1 "confirm or amend")
**Decision:** Adopt the strategic review as the standing priority order. **No hardening PR outranks a release-path task while the product is unreleased.** The release umbrella (#415) is the top standing priority until v0.5.0 ships. Measure before publishing claims; improve only what measurement justifies.
**Why:** the review's evidence is decisive — never shipped, 0 users, the checked-in "reputation layer" contains a 15-domain test stub, every efficacy number is stale/invalid, ~27% of throughput was docs-sync. The inner loop (harden/review/merge) ran at max while the outer loop (ship→users→feedback) ran at zero.

### D-2026-07-03-B — Discovery is milestone-gated; LOW residue goes to the icebox (#422)
**Decision:** Replace the old *"Never stop → run a Discovery pass"* rule with the **Priority Ladder** (below). Discovery passes resume **only after the next release milestone**. LOW-severity residue and speculative hardening go to `docs/agentic/ICEBOX.md`, not the active backlog.
**Priority Ladder** (highest first):
1. **Unblock:** broken default branch / red CI / a release-path blocker.
2. **Ship:** release-umbrella (#415) tasks — top standing priority until v0.5.0 ships.
3. **Measure & serve day-one users:** the measurement-enablement set (#416/#417/#418/#426) and the North-Star spine slices that serve first users (#232, #237, explanations, #239/#240).
4. **Correctness/security bugs** *backed by a current measurement or a clear user-impact story* (not speculative).
5. **Structural gates:** #374 chunk split; #175/#186 before beta; a fresh
   security review of the exact package before public launch.
6. **Everything else → icebox.**
**Why:** the marginal discovery finding is now `slice(-0)`-class trivia; each drain seeded more LOWs than it closed (self-feeding). The loop is a superb fix-machine pointed at an exhausted seam.

### D-2026-07-03-C — Collapse the status-doc system (#421)
**Decision:** One **live** snapshot + one **append-only** log; fold docs-sync into the code PR that changed the truth (no standalone docs-sync PRs by default).
- `ACTION_ITEMS.md` = contract + AI-N human items + **one** current snapshot. Historical snapshots archived to `docs/archive/ACTION_ITEMS_snapshots.md`.
- `docs/agentic/ORCHESTRATOR.md` = operating loop + current-state block + the append-only cycle log (this is the permitted append-only history).
- `docs/agentic/HANDOFF.md` = a short, always-current next-loop entry point.
**Why:** the append-only-snapshot pattern made every session pay ~30k tokens of mandatory reading and ~27% of throughput on bookkeeping, and the docs still conflicted.

### D-2026-07-03-D — Risk-tier by runtime blast radius + WIP cap (#419)
**Decision:**
- **Browser-surface (HOLD for Gate-3)** = MAIN-world / isolated-world patches, credential/submit path, service-worker navigation/rollback handlers, MutationObserver lifecycle, and any user-visible popup/options/onboarding change — **regardless of unit coverage**.
- **Non-browser** = shared pure logic, scripts, build config, tests, docs,
  dependency maintenance, and CI. Owner decision #499 (2026-07-31) retired the
  repository-local tier, hooks, agent gate, and Harness CI. Use the focused
  product check and hosted product CI; no NavSentinel-specific review or aging
  layer is added here. Active user/runtime rules outside the repository remain
  outside this decision.
- **WIP cap: ≤ 3 open human-gated PRs.** At the cap, do **not** open more browser-surface PRs — surface to Chris and switch to non-browser work.
**Dependency (stated plainly):** the stricter tier only works if Gate-3 has a cadence — either a committed periodic maintainer sitting *or* the headed lane (D-2026-07-03-E). Until then, **the stricter tier is still enforced** — browser-surface work simply queues for Gate-3, and we accept that the North-Star spine (much of which is browser-surface) throttles through this gate as the known cost. This is **not** a licence to keep auto-merging MAIN-world changes.
**Why:** the old classification keyed on surface *visibility* (a chip color waited 13 days while MAIN-world global patches auto-merged) — backwards vs. actual risk.

### D-2026-07-03-E — Headed verification is the primary Gate-3 mechanism once operational (#420); RATIFIED 2026-08-01
**Decision:** Adopt a scheduled headed-Chrome lane on the maintainer's machine as the **primary** Gate-3 mechanism once operational (agent builds the runner/checklist; Chris schedules it — the sandbox cannot run headed Chrome), with manual spot-checks retained. Until the lane is operational, manual Chrome Gate-3 remains the primary mechanism.
**Why:** human activation-energy, not human time, is the bottleneck (13 days for a 10-minute check). Automating the class is the structural fix.

### D-2026-07-03-F — Excise the dead visual-sim capture path (#424); the logo-embedding pivot is a fresh future feature
**Decision:** **Excise**, don't fund the pivot now. Remove the dead visual-sim capture path (placeholder templates, the never-firing NRS hook, the e2e that asserts it never matches) and reclaim its budget. This is an independent beta blocker; #374 may coordinate nearby chunk work but must not delay removal. The logo-embedding pivot (P5-D6 / #246) is built **fresh when a user base justifies it**, not carried as dead scaffolding. Seeded as a concrete slice `feat/excise-visual-sim`; roadmap P4-01 status already corrected to "non-functional" (#429).
**Why:** it is detection theater shipping inside one of the two tightest chunks; ship-don't-polish. (This is a code change with real regression risk in `capture_isolated` — done as its own reviewed slice, not rushed.)

### D-2026-07-03-G — Distribution sequence (#425); daily-profile dogfood follows integrity preflight
**Decision:** use only an isolated development profile while RI-01–RI-08,
PM-03/#455, and
agent preflight remain open. Chris may start daily-browser dogfood after prompt
authority, wrong-tab capture, trusted bridge identity/recovery, and
pre-collection disclosure/consent are complete, the selected beta profile is
implemented, and a current real-Chrome regression sweep passes → **unlisted**
CWS beta (15 invitations, target 10 activated daily-use installs) → **public
launch** only after a fresh external security review of the exact beta package.
Chris-led; agent implements the release-path pieces. #425 must be re-bodied to
this integrity-gated, manual D14/D30 sequence before use.
**Why:** a security product shouldn't invite Show-HN-grade adversarial attention while its self-declared highest-risk seam carries a stale review.

### D-2026-07-03-H — Autonomous merge authority is standing for non-browser PRs
**Decision:** The agent may autonomously merge non-browser PRs (per D-2026-07-03-D) after the gates. Confirmed by the maintainer's delegation this session (and consistent with the 2026-06-19 posture). Browser-surface PRs still hold for Gate-3.

---

## 2026-07-10 — Product-posture review amendments

These working decisions come from the full product, architecture, release,
roadmap, and current-market review in `docs/Product_Strategy.md`. Chris ratified
them on 2026-08-01; they remain reversible through an explicit amendment.

### D-2026-07-10-I — Release integrity precedes the old human batch

**Decision:** AI-15 is blocked until agent preflight moves prompt decision
authority to extension-origin UI, refreshes/reviews the stale PRs, makes #356 green, excises
visual-sim, removes fake DNR, completes #175/#186 bridge integrity and #455
pre-collection consent, and prepares the chosen release profile. Do not spend
human Gate-3 time on old branches.

**Why:** page script can currently activate protection-lowering prompt actions,
and even trusted events can be induced through page-controlled host redressing;
visual-sim can process the wrong active tab; #356 is red; stale #273/#399 were
closed rather than merged. Manual verification before those repairs would be
wasted and could create false confidence.

### D-2026-07-10-J — Interaction-only is the default unlisted-beta profile

**Decision:** Prefer a narrow beta containing core navigation/credential/
interaction protections, explanations, rollback, and local decision history.
Remove visual-sim and fake DNR; default-disable unmeasured JS behavior; omit or
disable reputation and all reputation claims unless AI-9 authorizes a fully
specified real-filter profile.

**Amends D-2026-07-03-G:** a real bloom filter is no longer an unconditional
unlisted-beta gate. Its current package/cardinality/provenance model is
contradictory, and commodity reputation should not block testing the intended
interaction-level differentiator.

### D-2026-07-10-K — Evidence and one user-visible loop before architecture expansion

**Decision:** Freeze North-Star/Horizon implementation and new feature-issue
seeding. After release integrity, ship to a 10-user cohort, measure additive
protection/quietness/comprehension/retention, then fund at most one visible loop:
Decision Journal plus narrowly scoped recovery guidance.

**Why:** 75 unmilestoned issues and 15 new epics are strategy-shaped backlog
inflation while distribution and validation remain zero.

### D-2026-07-10-L — Position as a complementary local interaction guard

**Decision:** Do not use "only", "other extensions miss", "Safe Browsing cannot
see", or broad OAuth-abuse claims. The initial retention cohort is privacy-
conscious technical users running the beta in a daily profile. Security
researchers are a separate design-partner/adversarial cohort and are excluded
from retention/comprehension metrics. Comparative claims require #418 against
current browser-native and extension protections.

**Why:** Chrome, Edge, and Opera now provide local/on-device interaction or scam
protections. Named detectors and local execution are features, not a moat.

### D-2026-07-10-M — Product-name clearance before submission

**Decision:** `NavSentinel` is a working name until AI-19 records a keep/rename
decision after appropriate search/domain/CWS/legal review. No CWS submission or
external beta branding precedes that decision.

**Why:** an active GNSS anti-spoofing security product uses the exact name;
rebranding is cheapest before distribution.

---

## 2026-07-13 — Merge-gate corrections

### D-2026-07-13-N — Bridge identity and informed activation precede beta

**Decision:** Complete #175/#186 so hostile page code cannot become or suppress
the trusted bridge peer, and complete #455 so fresh installs remain passive
until prominent local-data disclosure and affirmative activation. Both are
unlisted-beta gates. The independent external review remains a separate
public-launch gate.

**Why:** document-start ordering is not peer authentication. Chrome's 2026 CWS
policy update also requires prominent disclosure for all collected data,
including local handling; enforcement begins 2026-08-01. The current
onboarding cannot truthfully say protection is already active before informed
activation exists.

---

## Earlier resolved (carried forward)

- **Q1–Q6 (answered 2026-06-26):** Q1 OAuth FP cluster = implement + HOLD for `measure:fp`; **Q2** capture_isolated = split (#374) **and** bump 66→70KB; Q3 = prefer unit-testable extraction over CI-only e2e (CI-verified e2e acceptable when unavoidable); Q4 merge cadence confirmed; **Q5** Gate-3 = manual Chrome, revised by the 2026-08-01 ratification of D-2026-07-03-E to headed Chrome as primary once operational with manual spot-checks retained; Q6 = extract-to-testable + e2e for `main_guard`.
- **Decision log D01–D20:** see `docs/Project_Roadmap.md`. **D21–D26** (North-Star): see `docs/NORTHSTAR_ROADMAP.md`. D26 is a historical concept approval only; the 2026-07-10 beta boundary defers any runtime refresh until a renewed explicit product/privacy/release decision.
- **Gate-3 waiver (2026-06-05) + non-browser auto-merge authority (2026-06-19):** standing; superseded/formalized by D-2026-07-03-D/H.
