# Reporting-document qualification

## Verified browser records

The first document-bound producer head
`2fd7b9d62c6b891d1e904516301757ecd0c74ae6` passed workflow 34791245486:
six lifecycle tests, the original thirty-case matrix with the observer, the same
matrix without it, and agreement across all45 corresponding arm outcomes. The
45 actual v2 captures imported with no rejected/invalid records or trace gaps.
Its lifecycle JSON bodies were embedded only in the overwritten HTML report;
that artifact-retention defect was repaired rather than treating test stdout as
a durable event receipt.

Head `684df3cfbcb6f4c1ce4cd2d0a0ca0c78474124dd`, source tree
`4bda754f991f4c30c503d61f316655ce7e08f745`, reran the same checks in
workflow 34791757796 and additionally required six separately persisted lifecycle
files. Every step passed. Artifact 10328547884 was downloaded and SHA-256 checked:
`cdd437829321251a9fdc64e7db3c20f2abe4e90696f3b3cf454ec29bcd8878fe`.
The 51 distinct raw traces include45 campaign arms and six lifecycle exercises.
The lifecycle exercises deliberately do not satisfy receiver/observation-window
requirements; spoofed-identity rejection is also a deliberately observed gap.
They must not be counted as valid attack campaigns or pooled with efficacy results.

The matrix retains14 unprotected harmful baselines and three protected
Location/late-submit harmful arrivals followed by recovery. These remain existing
boundary observations, not new vulnerability counts. The six lifecycle contexts
and90 matrix profiles total96 independently created browser contexts for that
qualification run, not96 attacks prevented.

## Further source review and qualification gates

Review exposed that repeated document start/end events could exhaust the recorder's
consequence reserve. A failing document-churn regression established the lost harm
receipt; classifying lifecycle events as ordinary observation traffic preserves
the receiver/terminal reserve. Missing lifecycle boundaries then remain explicit
in the reader rather than being fabricated. This is a bounded unit fault trial,
not a newly claimed browser storm qualification.

A new `check-capture.mjs` admission gate requires all45 fixed campaign arms,
distinct run IDs, a common source head, v2 document binding, completed terminal
snapshots and no reported gaps/drops. It runs separately from consequence parity:
correct product outcomes cannot conceal an incomplete observer. This gate is not
a second full schema parser or proof checker; the separate offline reader remains
the strict projection boundary. The18 Node admission/parity tests and51 focused
Vitest contracts passed locally. All3,395 default Vitest cases across123 files,
repository lint and semantic typecheck also passed on the source containing the
reserve repair. The final head's hosted result must be consulted on the PR before
claiming its exact-head browser completion.

## Unchanged limits

The independent reader stack consumes pinned producer bytes rather than executing
#698's runtime at the reader head. Existing runtime bundle budgets still fail on
this stack; no budget is raised or release gate waived. Exact-source/raw-byte
attestation, full four-arm forms, process-swap/OOPIF/BFCache coverage, independent
review and owner acceptance remain separate. #702 live recording remains off and
unimplemented by this test-only work.
