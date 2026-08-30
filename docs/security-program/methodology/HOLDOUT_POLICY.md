# Holdout policy

Use four explicit partitions: development, tuning, internal holdout, and external evaluation. Record a content hash and provenance class for every item. Never tune implementation, thresholds, mutators, or prompts against holdout outcomes.

Partition by campaign, kit/template lineage, registrable-site family, and collection window where those relationships could leak the same attack into two partitions. Near-duplicates, localized variants, mutations, and benign duals stay in one partition. Synthetic fixtures used during implementation are development data, not efficacy evidence.

An internal holdout may be opened once for a declared evaluation question. Any implementation change caused by its results moves the affected items into tuning and requires a fresh holdout. External evaluation remains owner- or reviewer-controlled and reports failures as well as successes.

Contamination, missing provenance, non-reproducible routing, uncontrolled network behavior, or a product-coupled oracle makes the affected result `TEST_INVALID`. Do not repair the label after observing the answer.
