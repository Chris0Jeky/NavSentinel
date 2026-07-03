# NavSentinel — Standing Decisions

Durable register of resolved cross-cutting decisions (process, posture, and product-sequencing). One place so the operating docs (`CLAUDE.md`, `AGENTS.md`, `ORCHESTRATOR.md`, `Project_Roadmap.md`) can point here instead of duplicating rationale. When a decision changes, edit it in place and date the change.

> **Authority:** these are enacted under Chris's general delegation ("take a stance, call the shots"), NOT a point-by-point confirmation — they **await his explicit ratify/amend** (see `ACTION_ITEMS.md` **AI-16**), and until then are the working posture the loop follows. Reversible; flag any you'd change. Where they refine the autonomous-loop prompt or older rules, they win.

---

## 2026-07-03 — Deferred decisions resolved (maintainer delegated the calls)

Chris delegated: *"take a stance yourself and call the shots in the best way possible."* The stances below adopt and operationalize the 2026-07-02 strategic review (`docs/Course_Correction.md`, `docs/Strategic_Outlook.md`). Reversible; flag any you'd change.

### D-2026-07-03-A — Adopt the ship/measure direction (was: Phase A row 1 "confirm or amend")
**Decision:** Adopt the strategic review as the standing priority order. **No hardening PR outranks a release-path task while the product is unreleased.** The release umbrella (#415) is the top standing priority until v0.5.0 ships. Measure before publishing claims; improve only what measurement justifies.
**Why:** the review's evidence is decisive — never shipped, 0 users, the "reputation layer" ships a 15-domain test stub, every efficacy number is stale/invalid, ~27% of throughput was docs-sync. The inner loop (harden/review/merge) ran at max while the outer loop (ship→users→feedback) ran at zero.

### D-2026-07-03-B — Discovery is milestone-gated; LOW residue goes to the icebox (#422)
**Decision:** Replace the old *"Never stop → run a Discovery pass"* rule with the **Priority Ladder** (below). Discovery passes resume **only after the next release milestone**. LOW-severity residue and speculative hardening go to `docs/agentic/ICEBOX.md`, not the active backlog.
**Priority Ladder** (highest first):
1. **Unblock:** broken default branch / red CI / a release-path blocker.
2. **Ship:** release-umbrella (#415) tasks — top standing priority until v0.5.0 ships.
3. **Measure & serve day-one users:** the measurement-enablement set (#416/#417/#418/#426) and the North-Star spine slices that serve first users (#232, #237, explanations, #239/#240).
4. **Correctness/security bugs** *backed by a current measurement or a clear user-impact story* (not speculative).
5. **Scheduled structural cycles:** #374 chunk split; the bridge pair #175/#186 + a fresh bridge security review.
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
- **Non-browser** (agent may auto-merge after aging + 2 adversarial rounds + green CI + bot comments addressed) = shared pure-logic with unit tests, scripts, build config, tests, docs, CI.
- **WIP cap: ≤ 3 open human-gated PRs.** At the cap, do **not** open more browser-surface PRs — surface to Chris and switch to non-browser work.
**Dependency (stated plainly):** the stricter tier only works if Gate-3 has a cadence — either a committed periodic maintainer sitting *or* the headed lane (D-2026-07-03-E). Until then, **the stricter tier is still enforced** — browser-surface work simply queues for Gate-3, and we accept that the North-Star spine (much of which is browser-surface) throttles through this gate as the known cost. This is **not** a licence to keep auto-merging MAIN-world changes.
**Why:** the old classification keyed on surface *visibility* (a chip color waited 13 days while MAIN-world global patches auto-merged) — backwards vs. actual risk.

### D-2026-07-03-E — Headed verification lane is the target Gate-3 mechanism (#420); PROPOSES a Q5 revision (awaits Chris)
**Decision:** Adopt a scheduled headed-Chrome lane on the maintainer's machine as the **primary** Gate-3 mechanism once operational (agent builds the runner/checklist; Chris schedules it — the sandbox cannot run headed Chrome). Until it exists, manual Chrome Gate-3 stands. Making the lane the primary gate **would revise the standing Q5** ("Gate-3 = manual Chrome") to "headed lane + manual spot-checks" — but both strategic docs reserve this as **Chris's explicit call** (it *reduces* manual oversight), so this is a **recommendation only**, flagged as AI-16. Until Chris ratifies, manual Chrome Gate-3 stands and the lane only *augments* it.
**Why:** human activation-energy, not human time, is the bottleneck (13 days for a 10-minute check). Automating the class is the structural fix.

### D-2026-07-03-F — Excise the dead visual-sim capture path (#424); the logo-embedding pivot is a fresh future feature
**Decision:** **Excise**, don't fund the pivot now. Remove the dead visual-sim capture path (placeholder templates, the never-firing NRS hook, the e2e that asserts it never matches) and reclaim its budget — pair with the #374 chunk split. The logo-embedding pivot (P5-D6 / #246) is built **fresh when a user base justifies it**, not carried as dead scaffolding. Seeded as a concrete slice `feat/excise-visual-sim`; roadmap P4-01 status already corrected to "non-functional" (#429).
**Why:** it is detection theater shipping inside one of the two tightest chunks; ship-don't-polish. (This is a code change with real regression risk in `capture_isolated` — done as its own reviewed slice, not rushed.)

### D-2026-07-03-G — Distribution sequence (#425); dogfood starts before submission
**Decision:** dogfood **now** (Chris installs NavSentinel in his daily browser — local-first means field breakage is invisible except via his own reports) → **unlisted** CWS beta (5–10 people) once claims are honest (✓ #429) + the real bloom filter ships (#321) + a real-Chrome regression sweep has run → **public launch** only after the bridge structural cycle (#175/#186 + a fresh bridge security review). Chris-led; agent implements the release-path pieces.
**Why:** a security product shouldn't invite Show-HN-grade adversarial attention while its self-declared highest-risk seam carries a stale review.

### D-2026-07-03-H — Autonomous merge authority is standing for non-browser PRs
**Decision:** The agent may autonomously merge non-browser PRs (per D-2026-07-03-D) after the gates. Confirmed by the maintainer's delegation this session (and consistent with the 2026-06-19 posture). Browser-surface PRs still hold for Gate-3.

---

## Earlier resolved (carried forward)

- **Q1–Q6 (answered 2026-06-26):** Q1 OAuth FP cluster = implement + HOLD for `measure:fp`; **Q2** capture_isolated = split (#374) **and** bump 66→70KB; Q3 = prefer unit-testable extraction over CI-only e2e (CI-verified e2e acceptable when unavoidable); Q4 merge cadence confirmed; **Q5** Gate-3 = manual Chrome (**D-2026-07-03-E *proposes* revising this — awaits Chris's explicit sign-off**); Q6 = extract-to-testable + e2e for `main_guard`.
- **Decision log D01–D20:** see `docs/Project_Roadmap.md`. **D21–D26** (North-Star): see `docs/NORTHSTAR_ROADMAP.md` (D24 visual-sim→logo-embedding; D25 measure-before-tune; D26 one signed bloom-refresh exception).
- **Gate-3 waiver (2026-06-05) + non-browser auto-merge authority (2026-06-19):** standing; superseded/formalized by D-2026-07-03-D/H.
