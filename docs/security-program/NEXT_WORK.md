# Next work

This is a short execution cursor, not a second product roadmap. Reconcile it
with live GitHub, [Project_Roadmap.md](../Project_Roadmap.md), the
[development architecture](../development-architecture/README.md), and owner
gates before starting a slice.

The 2026-08-30 administration pass assigns all 75 open issues: M0 has 10 and M1
has 8; only those two milestones are active. Planned M2/M3/M4, gated M5,
passive maintenance, and frozen R1 are not fallback queues. The exact receipt is
[`GITHUB_ADMIN_RECEIPT.md`](../development-architecture/GITHUB_ADMIN_RECEIPT.md).

At that snapshot, PR #572 is conflict-dirty and parked before AI-31 on the
retained SP-F-013 rollback survivor. PR #599 is conflict-dirty with its owner
policy and branded-Chrome gates open. PR #600 is clean with green hosted checks
but still needs its exact-head owner media-page check. PR #605 is the bounded
test-only #449 slice and is red in Build / Unit on #595's mutation-monitor
scarce-reserve assertion; the failure is tracked and must not be called flaky.

1. **Finish or park the current runtime queue before opening another vertical.**
   Reconcile #599 and #600 against current `main`, their exact heads, owner
   decisions, and browser gates. #600 is containment; #601 remains the durable
   extension-origin authority outcome.
2. **Repair the current M0 red.** Investigate PR #605's deterministic #595
   failure, preserve its valid failure mode, and re-prove only the changed test
   seam. Until it merges, `main` remains at 64 mappings and 21 held external
   destinations.
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
