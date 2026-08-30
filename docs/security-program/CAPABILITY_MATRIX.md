# Capability matrix

Generated from the canonical capability registry and the live reconciliation map. Do not edit this view by hand.

Profiles are boundaries, not a delivery promise. `release_extension`, `research_extension`, `proving_ground`, `native_companion`, and `agent_future` remain separate.

| ID | Capability | Track | Priority | Implementation | Profiles | Evidence | Release posture | Issues |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F-01 | Canonical scenario registry and schema | proving_ground | P0 | SEEDED | proving_ground | MODELLED | FOUNDATION | #449 |
| F-02 | Hermetic adversarial lab and synthetic sink | proving_ground | P0 | PARTIAL | proving_ground | UNMODELLED | FOUNDATION | #417, #439 |
| F-03 | Trusted-input headed browser rig | proving_ground | P0 | PARTIAL | proving_ground | MODELLED | FOUNDATION | #420, #439, #460, #498, #565 |
| F-04 | Pre-harm protection oracle | proving_ground | P0 | PARTIAL | proving_ground | MODELLED | FOUNDATION | #417, #449 |
| F-05 | Invariant-preserving mutation engine | proving_ground | P0 | PARTIAL | proving_ground | MODELLED | FOUNDATION | #449 |
| F-06 | Benign and mixed journey corpus | proving_ground | P0 | PARTIAL | proving_ground | MODELLED | FOUNDATION | #232, #417 |
| F-07 | Lifecycle and state-chaos injector | proving_ground | P0 | PARTIAL | proving_ground | MODELLED | FOUNDATION | #175, #186, #389, #460 |
| F-08 | Train/tune/holdout corpus governance | proving_ground | P1 | NOT_IMPLEMENTED | proving_ground | UNMODELLED | FOUNDATION | #417, #449 |
| F-09 | Evidence ledger, failure capture, and scorecard | proving_ground | P0 | PARTIAL | proving_ground | MODELLED | FOUNDATION | #416, #417, #439, #449, #591 |
| F-10 | Differential browser and comparator runner | proving_ground | P1 | PARTIAL | proving_ground | UNMODELLED | POST_BETA | #418 |
| C-01 | Typed evidence and signal registry | research_extension | P1 | PLANNED | research_extension | UNMODELLED | POST_BETA | #440 |
| C-02 | Consequence model and scoped intent capabilities | research_extension | P0 | PARTIAL | release_extension, research_extension | MODELLED | BETA_BLOCKER | #566, private:RI-01 |
| C-03 | Extension-origin decision authority | release_integrity | P0 | PARTIAL | release_extension | MODELLED | BETA_BLOCKER | private:RI-01 |
| C-04 | Bridge identity, liveness, recovery, and fail policy | release_integrity | P0 | PARTIAL | release_extension | MODELLED | BETA_BLOCKER | #175, #186, #523 |
| C-05 | Episode and attack-narrative engine | research_extension | P1 | PARTIAL | research_extension | UNMODELLED | POST_BETA | #443 |
| C-06 | Local Data Flow Lens | research_extension | P1 | PLANNED | research_extension | UNMODELLED | RESEARCH_ONLY | #127, #237, #591 |
| C-07 | Relationship and trust ledger | research_extension | P1 | PARTIAL | research_extension | UNMODELLED | POST_BETA | #445 |
| C-08 | Confidence, abstention, and attention budget | research_extension | P1 | PLANNED | research_extension | UNMODELLED | POST_BETA | #441, #442 |
| C-09 | Capability readiness and failure-mode matrix | release_integrity | P0 | PARTIAL | release_extension, research_extension | MODELLED | BETA_BLOCKER | #175, #215, #565 |
| C-10 | Reversible deceptive-surface remediation | research_extension | P1 | ACTIVE_BOUNDED | release_extension, proving_ground | REGRESSION_PROVEN | RELEASE_ACTIVE | #555, #560, #564, #577, #579, #580, #591 |
| C-11 | Credential and protected-data sink guard | research_extension | P0 | PARTIAL | release_extension, research_extension | MODELLED | RELEASE_ACTIVE | #199, #200, #417 |
| C-12 | Authorization, consent, and transaction integrity | research_extension | P1 | PARTIAL | release_extension, research_extension | MODELLED | RELEASE_ACTIVE | #223, #269, #397 |
| C-13 | Permission consequence mediator | research_extension | P1 | NOT_IMPLEMENTED | research_extension | UNMODELLED | RESEARCH_ONLY | #448, #455 |
| C-14 | Download and artifact provenance | research_extension | P1 | NOT_IMPLEMENTED | research_extension | UNMODELLED | RESEARCH_ONLY | #452 |
| C-15 | Agent conduct policy and flight recorder | agent_future | P1 | DESIGN_ONLY | agent_future | UNMODELLED | POST_BETA | #448 |
| N-01 | Native-messaging protocol and minimal host | native_post_validation | P1 | DESIGN_ONLY | native_companion | UNMODELLED | NATIVE_DEFERRED | #244, #452 |
| N-02 | Clipboard taint and shell-sink sentinel | native_post_validation | P1 | NOT_IMPLEMENTED | native_companion | UNMODELLED | NATIVE_DEFERRED | #452 |
| N-03 | Artifact scan and execution-boundary adapter | native_post_validation | P2 | NOT_IMPLEMENTED | native_companion | UNMODELLED | NATIVE_DEFERRED | #452 |
| N-04 | Header, DNS, proxy, and network-context observer | native_post_validation | P2 | NOT_IMPLEMENTED | native_companion | UNMODELLED | NATIVE_DEFERRED | #179, #452 |
| N-05 | Local model host with untrusted-sensor contract | native_post_validation | P2 | NOT_IMPLEMENTED | native_companion | UNMODELLED | NATIVE_DEFERRED | #444, #452 |
| N-06 | Signed installer, updater, rollback protection, and external review | native_post_validation | P0 | NOT_IMPLEMENTED | native_companion | UNMODELLED | NATIVE_DEFERRED | #452 |
