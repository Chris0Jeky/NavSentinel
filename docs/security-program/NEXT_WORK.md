# Next work

This is a short execution cursor, not a second product roadmap. Reconcile it
with live GitHub, [Project_Roadmap.md](../Project_Roadmap.md), the
[development architecture](../development-architecture/README.md), and owner
gates before starting a slice.

The 2026-08-30 administration pass assigns all 75 open issues: M0 has 10 and M1
has 8; only those two milestones are active. Planned M2/M3/M4, gated M5,
passive maintenance, and frozen R1 are not fallback queues. The exact receipt is
[`GITHUB_ADMIN_RECEIPT.md`](../development-architecture/GITHUB_ADMIN_RECEIPT.md).

PR #572 remains parked before AI-31 on the retained SP-F-013 rollback survivor.
PR #599 has been reconciled with current `main`, but its owner policy and
branded-Chrome gates remain open. PR #600 is clean with green hosted checks but
still needs its exact-head owner media-page check. PR #610 is the bounded
test-only #449 parent slice for the seven core locality fixtures; it must still
satisfy its own exact-head checks and review before merge. The final two RW
locality holds are prepared as a stacked follow-up whose PR number is
pending/unpublished; that follow-up remains based on #610 until the parent
lands.

1. **Finish or park the current runtime queue before opening another vertical.**
   Keep #599 and #600 aligned with current `main`, their exact heads, owner
   decisions, and browser gates. #600 is containment; #601 remains the durable
   extension-origin authority outcome and should follow #600 rather than overlap
   its capture and loader seams.
2. **Keep #449 locality bounded and typed.** The twelve evasion, seven core,
   and two RW fixtures now share a loopback-only target contract; no mapped
   external-destination holds remain. Before adding declared adjacent mutation
   axes for `NS-ADV-UI-004`, retain the existing MODELLED ceiling and the
   representative-evasion receipt limitation. Keep each sink typed and local
   rather than building a generic collector.
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
