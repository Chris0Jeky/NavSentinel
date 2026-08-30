# NavSentinel development architecture

Status: current routing aid, reconciled against `main` at
`22377604a363141fc6e99a45800beca868307764` on 2026-08-30.

This directory gives the issue estate an outcome order and records the trust
boundaries each milestone must respect. It is not a second roadmap or human
queue. Authority remains, in order:

1. current owner instruction;
2. [`AGENTS.md`](../../AGENTS.md) and [`CLAUDE.md`](../../CLAUDE.md);
3. [`Product_Strategy.md`](../Product_Strategy.md);
4. [`Project_Roadmap.md`](../Project_Roadmap.md);
5. live GitHub issues, pull requests, milestones, labels, and Actions;
6. [`ACTION_ITEMS.md`](../../ACTION_ITEMS.md) for human decisions and manual checks;
7. the [security programme](../security-program/README.md) for scenario and evidence truth;
8. this directory for architecture routing and milestone sequencing.

## Current order

| Order | Milestone | State | Outcome |
| --- | --- | --- | --- |
| M0 | `M0-proving-ground-foundation` | Active | Trustworthy, hermetic browser evidence |
| M1 | `v0.5.0-unlisted-beta` | Active | Interaction-only artifact safe enough for an unlisted beta |
| M2 | `v0.5.1-interaction-integrity` | Planned | Consequences stay scoped, usable, accessible, and reversible |
| M3 | `v0.6.0-local-evidence-plane` | Planned | Bounded journal, Protection Center, corrections, and Data Flow Lens |
| M4 | `EV-1-efficacy-and-quietness` | Planned | Valid attack, benign, performance, and comparator evidence |
| M5 | `BETA-1-cohort-and-operations` | Gated | First daily-use cohort and an operated release path |
| — | `maintenance-icebox` | Passive | Accepted residue; never an autonomous fallback |
| R1 | `post-beta-horizon` | Frozen | Research options requiring explicit promotion |

Only M0 and M1 are active. Issue #417 may advance test methodology because it
is a prerequisite to valid measurement; that exception does not activate M4
detector tuning.

## Operating rules

- At most two runtime-affecting PRs may be active across M0 and M1, with one
  writer per high-risk seam. A parked PR has an explicit resume condition.
- MAIN-world code is an untrusted sensor and interception seam. It does not own
  protection-lowering authority.
- Product events do not prove protection; an independent harm oracle decides
  whether the consequence was reached.
- Page-injected UI may warn or cancel. Allow, proceed, trust, resume, and
  security-relevant Undo belong in extension-origin UI.
- Local data remains purpose-limited, bounded, sanitised, deletable, and
  explicitly exportable.
- The 168 scenarios and 1,512 work units remain in the local registry. They do
  not become one GitHub issue per scenario.
- Runtime implementation stops at owner, browser, measurement, privacy,
  permission, or external gates recorded in the authoritative queue.

## Files

- [MILESTONES.md](MILESTONES.md): milestone states, entry rules, and exit evidence.
- [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md): global and per-milestone contracts.
- [ISSUE_MAP.md](ISSUE_MAP.md) and [ISSUE_MAP.json](ISSUE_MAP.json): complete issue classification.
- [ISSUE_RECONCILIATION.md](ISSUE_RECONCILIATION.md): stale-premise and closure audit.
- [DECISIONS.md](DECISIONS.md): accepted boundaries, design targets, and live deviations.
- [RECONCILIATION.md](RECONCILIATION.md): package-to-live-state evidence and gates.

The execution cursor remains [`docs/security-program/NEXT_WORK.md`](../security-program/NEXT_WORK.md),
after refreshing GitHub. The dated source package remains outside the tracked
required-reading chain under ignored `RESOURCES/`; this directory contains the
repository-current, reviewable result.
