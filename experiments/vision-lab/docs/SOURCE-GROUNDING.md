# Source grounding and provenance

Research date: **2026-09-07**. This is a source-informed prototype exercise, not an exhaustive checkout/build/audit of NavSentinel. The GitHub connector was used for repository reads. Container network access could not clone the repository; no full-source fork is claimed. The new kernel is independent experimental code, not a copied implementation of upstream computeCDS.

## Shared vision context

The supplied shared-chat URL was opened, but its message body was not exposed by the reader. The page title was “NavSentinel Security Testing Plan.” No claim is made that the complete conversation was read. Available project context and the repository’s strategy, roadmap, architecture and Horizon documents supplied the usable direction: local-first interaction protection, strong intent/consequence boundaries, realistic adversarial/benign scenarios, explainable evidence and optional expansion beyond a browser extension.

Source: https://chatgpt.com/share/6a9f3861-0b08-83eb-9b13-5c006b9db40c

## Inspected primary sources

| Source | Grounding used |
|---|---|
| [Repository and README](https://github.com/Chris0Jeky/NavSentinel) | Current product scope, limitations, interaction-only posture; no blanket protection claims |
| [Docs index](https://github.com/Chris0Jeky/NavSentinel/blob/main/docs/README.md) | Active operating documents versus dated/historical/frozen options |
| [Project Roadmap](https://github.com/Chris0Jeky/NavSentinel/blob/main/docs/Project_Roadmap.md) | Current execution truth, outcome milestones, release/evidence gates; inspected version says last status sync 2026-09-04 |
| [Development system architecture](https://github.com/Chris0Jeky/NavSentinel/blob/main/docs/development-architecture/SYSTEM_ARCHITECTURE.md) | Worker-owned authority; exact-context capability path; no page-owned protection-lowering controls; independent harm receipts; data lifecycle |
| [Horizon Epics](https://github.com/Chris0Jeky/NavSentinel/blob/main/docs/HORIZON_EPICS.md) | Signal Fabric, judgment/attention, narrative, agent conduct, aftermath and native companion; explicitly frozen upstream options |
| [Actual scoring source](https://github.com/Chris0Jeky/NavSentinel/blob/main/extension/src/shared/scoring.ts) | Existing CDS ingredients: hit-area coverage, opacity, intended underlying target, retargeting, accessible names and mitigations |
| [Open issue collection](https://github.com/Chris0Jeky/NavSentinel/issues) | Live issue/milestone associations and recent authority/interaction residue; not just the README |
| [Companion issue #452](https://github.com/Chris0Jeky/NavSentinel/issues/452) | Native messaging and cross-layer clipboard/shell concept, still a frozen research option rather than an implemented OS adapter |
| [Child-frame authority residue #637](https://github.com/Chris0Jeky/NavSentinel/issues/637) | Why this prototype must not use tab-wide grants or claim child-frame correctness without real proof |

## Feature and milestone mapping

| Prototype decision | Upstream home | What this bundle does NOT imply |
|---|---|---|
| Fixture registry, attack/benign/mixed controls, honest survivor | M0 Proving Ground; #449, #420 | Does not certify a production detector or replace Gate-3 |
| Trusted popup authority and exact document binding | M1 release integrity; #601, #175/#186 boundary work | Not a merged or equivalent replacement for the existing MAIN/isolated bridge |
| Bounded cleanup, explicit Undo, quiet page status | M2 interaction integrity; #579 recovery hierarchy | Not sustained cleanup proof against arbitrary hostile pages |
| Settings plus separate behavioral/configuration resets | #558 and #474 | Not production worker-owned field-revision settings synchronization |
| Journal, later corrections and explicit export | M3 local evidence plane; #591 | No automatic telemetry, silent sharing or proof of efficacy |
| Protection Center and Data Flow Lens | M3; #592; system architecture’s evidence projections | Does not invent a validated “protected user” score |
| Profile comparisons and benign controls | EV-1 efficacy and quietness | Tiny fixture sets do not estimate false-positive/true-positive rates |
| Cross-layer incident and recovery workspace | Frozen narrative/Aftermath/Companion options; #452 | No OS watcher, process filter, malware scan or native taint bridge |
| Cooperative local intent broker | Frozen agent-conduct and exact-capability direction | Not an MCP product, a hostile-agent sandbox, or an activated upstream epic |

Only M0 and the unlisted-beta release-integrity milestone were active in the inspected execution roadmap. The interaction-integrity and local-evidence milestones were planned; the Horizon portfolio remained frozen. This user-requested vision exercise explores those ideas in isolation without treating a prototype as permission to change the upstream release plan.

## Platform sources checked

- [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts): isolated worlds, dynamic registration, document timing. A page and isolated script still share a DOM, so page content is not an authority source.
- [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging): a possible later extension/native boundary. **No native-messaging host is shipped here.**
- [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security): renderer isolation, sandboxing, limited navigation/new windows, validated IPC, current runtime.
- [Official Electron stable index](https://releases.electronjs.org/releases/stable): 44.2.0 was listed as released 2026-09-04 when checked on 2026-09-07. Pinning a version is not a substitute for local runtime verification or future security updates.

These links are provenance, not network dependencies. The offline prototypes make no external requests.
