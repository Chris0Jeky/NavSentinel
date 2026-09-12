# Next work

This is a short execution cursor, not a second product roadmap. Reconcile it
with live GitHub, [Project_Roadmap.md](../Project_Roadmap.md), the
[development architecture](../development-architecture/README.md), and owner
gates before starting a slice.

The 2026-08-30 administration pass assigns all 75 open issues: M0 has 10 and M1
has 8; only those two milestones are active. Planned M2/M3/M4, gated M5,
passive maintenance, and frozen R1 are not fallback queues. The exact receipt is
[`GITHUB_ADMIN_RECEIPT.md`](../development-architecture/GITHUB_ADMIN_RECEIPT.md).

As of 2026-09-04, `origin/main` is `a440e35` and the runtime queue is parked in
full: **#572** (AI-31, still held on the retained SP-F-013 rollback survivor),
**#599** (AI-37, reconciled with current `main`; owner queue-design decision and
branded-Chrome check open), **#600** (AI-38, containment; owner media-page
check), **#608** (AI-39, stacked on #600 and must follow it), **#609** (AI-40,
branded-Chrome BFCache check), and **#636** (AI-41, the #593 child-frame
navigation-authority boundary). All six are ready-for-review with green
exact-head CI; none may be merged by an agent. Issue **#637** is the residue home
for the remaining child-frame `ns-allow` -> `form.submit(target=_top)` path, and
#593 stays open. PR #610 merged the bounded
test-only #449 parent slice for the seven core locality fixtures. PR #613 merged
the final RW locality sink slice, PR #614 merged loopback sink hardening, and PR
#615 merged the static RW scenario assertion. Those merges retain the
MODELLED/local-only ceiling. #420 now has a bounded maintainer-headed runner:
the operator prepares branded Chrome and reloads the exact build, while the
runner attaches through loopback CDP for one local benign Gym observation. It
writes redacted pass/failure receipts but does not schedule, measure FP, or
claim Gate-3.

1. **The runtime queue is parked; do not open another vertical over it.**
   #572, #599, #600, #608, #609, and #636 are all parked on owner gates, so no
   agent-side work remains on them beyond keeping them aligned with current
   `main` and their exact heads. #600 is containment; #601 (PR #608) remains the
   durable extension-origin authority outcome and must follow #600 rather than
   overlap its capture and loader seams. New work goes to #637 or the next
   bounded M0/M1 slice, not across those seams.
2. **Keep #449 locality bounded and typed.** The twelve evasion, seven core,
   and two RW fixtures now share a loopback-only target contract; no mapped
   external-destination holds remain. The Evasion 05 representative now records
   one control plus four deterministic neighbours across two CSS and two
   structural axes, each with benign and mixed duals. Every arm now compares
   both live hrefs with its exact normalized harm and benign target authorities
   before activation. Retain the MODELLED ceiling: randomized DOM, text, localization,
   timing, viewport, and holdout robustness remain unproved. Before adding
   declared adjacent mutation axes for `NS-ADV-UI-004`, keep each sink typed and
   local rather than building a generic collector.
3. **Keep PR #572 parked before AI-31.** Resume only from its retained local
   survivor and exact service-worker lifecycle checkpoint; do not run the manual
   gate on the current head.
4. **Close the C-04 release-integrity boundary without manufacturing an attack.**
   The first #186 model slice is merged, but same-session/pre-page reachability,
   authenticated recovery, and #175 liveness remain open. Do not force a result
   with privileged pre-page injection.
5. **Keep protection-lowering authority extension-owned.** Page text or
   page-owned UI may warn or cancel; it must not grant allow, trust, proceed,
   resume, or security-relevant Undo. Use #601 and the worker-owned exact-context
   capability architecture.
6. **Finish activation disclosure and valid methodology.** #455 remains the M1
   activation/consent home. #417 may proceed as the one planned-milestone
   exception for real-host routing, trusted input, protected-versus-fired
   outcomes, committed manifests, and invalid-run handling; #416/#426 remain
   measurement/reporting homes.
7. **Respect human and external gates.** Resume
   [ACTION_ITEMS.md](../../ACTION_ITEMS.md) at AI-19. Keep owner Chrome,
   accessibility, release-signing, store review, and external review open until
   directly evidenced.
