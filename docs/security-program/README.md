# NavSentinel security programme

This directory is the operational seed for NavSentinel's local adversarial security programme. It turns the supplied 168-scenario catalogue into validated registries, reproducible views, an evidence vocabulary, and a bounded work queue. It does not replace [Project_Roadmap.md](../Project_Roadmap.md), live milestones, release gates, or [ACTION_ITEMS.md](../../ACTION_ITEMS.md).

All experiments are defensive, local, inert, and synthetic. No programme fixture may use a live target, real credential, external exfiltration, executable malware, or shell execution. A realistic dangerous sink must be replaced with a local fake sink and an independent receipt.

## Product boundaries

| Profile | Seed posture | Boundary |
| --- | --- | --- |
| Release extension | Unchanged | Interaction-only, local-first, zero runtime network calls, and no new powerful permission. |
| Research extension/profile | Unchanged | Unpacked and non-release. Broader observation remains explicit research work. |
| Proving Ground | One bounded local sink and UI-004 oracle | Owns safe fixtures, local sinks, oracles, mutation, and evidence receipts. It is test infrastructure, not release code. |
| Optional native companion | Design only | No host, native messaging permission, enforcement, listener, updater, or distribution exists. |

## Start here

- [PROGRAM_STATE.md](PROGRAM_STATE.md): factual seed state and evidence ceiling.
- [NEXT_WORK.md](NEXT_WORK.md): up to ten concrete next slices, subordinate to live roadmap authority.
- [CAPABILITY_MATRIX.md](CAPABILITY_MATRIX.md): generated 31-capability reconciliation.
- [EVIDENCE_INDEX.md](EVIDENCE_INDEX.md): generated outcome and evidence-state index.
- [DECISIONS.md](DECISIONS.md), [FAILURES.md](FAILURES.md), and [RISK_ACCEPTANCE.md](RISK_ACCEPTANCE.md): durable operational ledgers.
- [registry/SOURCE_PROVENANCE.json](registry/SOURCE_PROVENANCE.json): supplied-bundle hashes and reconstruction boundary.
- [reports/EXISTING_EVIDENCE_MAPPING.md](reports/EXISTING_EVIDENCE_MAPPING.md): generated mapping of current fixtures, tests, and evidence lanes.
- [reports/ISSUE_DEDUPLICATION.md](reports/ISSUE_DEDUPLICATION.md): generated issue and PR reuse map.
- [reports/UNMAPPED.md](reports/UNMAPPED.md): explicit gaps and deliberately unclaimed evidence.
- [reports/LEGACY_FIXTURE_SAFETY.md](reports/LEGACY_FIXTURE_SAFETY.md): machine-checked holds on pre-existing non-local or command-shaped Gym pages.

## Commands

```text
npm run security:import
npm run security:generate
npm run security:check
npm run security:check:source
npm run build
npm run test:e2e:proving-ground
```

`security:import` is read-only by default: when the ignored source bundle is mounted, it verifies the tracked scenario, capability, outcome, evidence-state, work-unit, and provenance snapshots against that bundle. `npm run security:import -- --write` creates missing snapshots only. Replacing an existing differing canonical snapshot requires the deliberately explicit `--write --force` mode after review. The live capability, issue, existing-evidence, and fixture-safety maps are curated repository-current inputs and are never overwritten by import or generation.

`security:generate` writes Markdown, CSV, and the 1,512 local scenario work units. `security:check` is clean-checkout safe: it validates schemas, counts, IDs, dependencies, tracked semantic provenance, paths, links, fixture safety holds, unsafe declarations, and deterministic views without requiring the ignored bundle. `security:check:source` adds exact physical source-bundle inventory and hash verification and therefore requires `RESOURCES/DefenseVectors` to be mounted.

Run generation after an intentional registry change, then commit both source registries and generated views. Never edit `extension/dist` for programme work.

The Proving Ground command runs the `NS-ADV-UI-004` attack, benign, and mixed contracts in Playwright-bundled Chromium. It writes exact-head evidence receipts only under ignored `test-results/` output. Commit the fixture, oracle, and test, but never commit generated receipts or `extension/dist`.

## Evidence rule

Use the exact outcomes and evidence states in [methodology/OUTCOME_MODEL.md](methodology/OUTCOME_MODEL.md). A product event, toast, one-time hidden element, or rollback is not protection unless an independent harm oracle supports that conclusion. Rollback after navigation is post-commit containment. Unknown or invalid evidence stays visible and never promotes silently.
