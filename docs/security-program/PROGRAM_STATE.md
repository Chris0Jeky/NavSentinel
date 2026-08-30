# Programme state

As of 2026-08-30, based on merged programme seed `d2762f296b07bfd650971141bf9bf7a9b2c016b9` and the live issue and pull-request inventory refreshed for the first #449 vertical.

## Seeded

- 168 stable scenarios across 21 families, with 168 malicious, benign, and mixed contracts retained locally.
- 31 stable capabilities across proving-ground, release-integrity, research, agent-future, and optional-native tracks.
- 11 outcome values and 8 ordered evidence states.
- 1,512 generated local work units, nine for each scenario. They are not GitHub issues.
- 64 current-work mappings: 12 Gym levels, 23 RW journeys, 12 evasion fixtures, 4 ClickFix fixtures, 4 DoubleClickjacking fixtures, 7 evidence lanes, and 2 browser-suite mappings.
- 12 deduplicated issue themes and zero new issues created by the seed pass.

## Evidence ceiling

All 168 canonical scenarios remain `UNMODELLED`. Existing artefacts are reconciled separately: 60 mappings are `MODELLED`, 2 are `UNMODELLED`, and 2 bounded lanes are `REGRESSION_PROVEN`: C-10 overlay nesting and the #566 modified-anchor opener-authority matrix. No canonical scenario is promoted by either mapping, and none is claimed as browser-proven, efficacy-measured, release-eligible, universally secure, or anonymous.

The historical corpus result is `INVALID`. The historical false-positive result is `STALE`. The external live-site check and local event-coupled benchmark are `UNVERIFIED`. Bundled Chromium regression is not owner Chrome, current human Gate-3, or open-web evidence.

The first #449 vertical adds one loopback-only typed sink and independent wrong-target navigation oracle. Its attack baseline reaches `HARM_REACHED`; the protected attack and mixed runs produce `BLOCKED_PRE_HARM`; the benign rerender produces `NO_SIGNAL` and remains usable. This gives F-02 `FIXTURE_PROVEN` evidence and the bounded F-03/F-04 lane `REGRESSION_PROVEN` evidence. The canonical imported scenario snapshot remains `UNMODELLED`; the repository-current evidence is recorded in the separate mapping registry.

The #566 repair lane uses trusted bundled-Chromium input on loopback-only `127.0.0.1` and `localhost` fixtures. Navigation Off reaches the opener-navigation sink; Smart keeps the opener URL and history stable after the requested child closes across Ctrl/middle, early-event, and effective-target mutations. Base-target, named-context, same-site, non-HTTP, child-frame, and closed-shadow handlers and native behavior remain reachable where applicable. Page-origin popups from those non-isolated handlers are blocked as a known MEDIUM false intervention. Non-current MAIN `_self` blocking and service-worker `location.replace` rollback prove the no-grant boundary. Behavior head `03f04f4` passes the 30-case headed matrix, five focused target-classifier units, unchanged performance budgets in both build profiles, and hosted Build / Unit plus E2E run `33318797927`. Exact-head run `33319338777` was `TEST_INVALID`: a one-shot handler receipt could be erased by rare duplicate rollback delivery, and the control did not explicitly await service-worker readiness. Harness head `57f4995` makes that receipt durable, retains exact URL, history, child URL, and page-count oracles, and passes 50/50 exact-control fresh profiles plus the full 30/30 matrix locally. Rare possible redelivery remains an explicit lifecycle residual because the worker prefers restart durability over a missed rollback. The research-profile budget failure on `c6fd06d` is resolved through separately capped shared chunks rather than a larger limit. This is `REGRESSION_PROVEN` for the mapped lane only. Final exact-head hosted checks, AI-31 owner Chrome, and pointerup/mouseup holdouts remain open, and the broader C-02 and canonical WIN-004 evidence states do not advance.

Four ClickFix fixtures now use only an inert sentinel or local static control, leaving 21 mapped legacy Gym pages on a machine-checked external-destination hold. ClickFix remains browser detection evidence, not OS-paste prevention or real-provider browser evidence.

## Active authority

- Live source, tests, GitHub, [Project_Roadmap.md](../Project_Roadmap.md), and current owner gates outrank this programme state.
- Release-integrity blockers, including bridge identity/recovery and extension-origin protection-lowering decisions, retain their existing homes.
- [ACTION_ITEMS.md](../../ACTION_ITEMS.md) remains the only human-action queue. Its cursor remains AI-19; this seed closes no human decision or manual browser check.
- The release, research, proving-ground, and optional-native profiles remain separate. The #449 vertical changes no extension runtime behavior, permission, remote service, or committed build output.

## Source boundary

The supplied `RESOURCES/DefenseVectors` bundle physically contains seven files. It advertises capability, evidence-state, backlog, schema, and broader source artifacts that were not included. The missing registries were reconstructed deterministically from the supplied master and seed brief, and the limitation is recorded in [registry/SOURCE_PROVENANCE.json](registry/SOURCE_PROVENANCE.json). The supplied validation report could not be rerun against absent upstream files.
