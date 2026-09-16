# Raw evidence authority for issue 684

This slice hardens only the state-authority campaign stacked on PR #681. It does
not change extension runtime behavior and it does not yet migrate every
NavSentinel receipt producer.

## Authority chain

1. Resolve the requested worktree's real top-level and require an ordinary
   directory, including detached linked worktrees whose `.git` entry is a file.
2. Sanitize inherited `GIT_*` overrides, disable replacement objects and lazy
   fetching, and reject shallow, promisor, alternate-object, and replace-ref
   authority.
3. Resolve and retain full `HEAD^{commit}`, `HEAD^{tree}`, and object-format
   identifiers.
4. Enumerate the immutable build tree with NUL-delimited `git ls-tree`; accept
   only regular `100644` or `100755` blobs.
5. Require the live index's stage-zero modes and object IDs to equal the
   immutable tree.
6. Read committed bytes with `git cat-file --batch`, then compare them directly
   with `fs.readFileSync`. Git attributes, clean filters, text conversion, and
   status output have no authority.
7. Walk each build root without following links. Ordinary-untracked,
   ignored-untracked, missing, case-colliding, linked, junction, device, and
   other special inputs invalidate the run.
8. Frame SHA-256 inputs with repository-relative path, Git mode, an eight-byte
   byte length, and the raw bytes.

## Fixed output boundary

Only `extension/dist` is test-owned. A stale ordinary directory is removed
before the build. A linked or special output path is rejected. After the build,
every output entry must be a regular file beneath the fixed root; the path,
effective mode, byte length, and bytes are hashed and rechecked immediately
before a receipt is attached.

## Receipt lifecycle

Source authority is checked before the build, after the build, and again at
receipt time. The receipt is suppressed by any commit, tree, index, raw-source,
unexpected-input, special-input, or output-hash change. The campaign source
closure includes `extension_test_utils.ts`, a direct runtime import that the
earlier receipt omitted.

Successful receipts record the commit, tree, object format,
`raw-blob-byte-equality` comparison mode, zero unexpected/special inputs,
tracked-input count, output-file count, source hashes, and fixed-output hash.

## Explicit ceiling

This establishes exact committed project-source and fixed local build-output
identity for one bundled-Chromium regression campaign. It does not establish
dependency integrity, compiler or runner integrity, reproducible builds,
protection from a concurrent hostile local process, branded-Chrome Gate-3
acceptance, open-web efficacy, or release eligibility. `node_modules`, Node.js,
Git, Playwright, Chromium, the operating system, and the runner remain trusted
local toolchain inputs.


## Independent-review repairs

The first reviewed candidate was not merge-eligible despite green tests. Review
identified three ways a positive receipt could still outpace its authority:
Git could return substituted loose-object payloads under unchanged object IDs,
Vite could auto-select an undeclared alternate config name, and Playwright could
load changed campaign modules before the in-spec check ran.

The repaired boundary now:

- recomputes the Git-format hash of the commit, every traversed tree, and every
  selected blob; the `cat-file` header is not treated as authentication;
- rejects every supported alternate Vite config name and invokes Vite with the
  committed `vite.config.ts` explicitly;
- scrubs inherited Git variables case-insensitively, which matters on Windows;
- requires a launcher extracted from the committed launcher blob, runs full
  object-store integrity checking, extracts the verifier and manifest from Git
  objects, and validates the complete campaign input manifest before Playwright
  imports its config or spec graph;
- passes a short-lived private launch attestation into the one-worker campaign,
  then rechecks build inputs, campaign inputs, and fixed output before receipts.

A direct `playwright test` invocation cannot emit this receipt: the stress hook
fails `TEST_INVALID [EXTERNAL_PREFLIGHT_REQUIRED]` before any campaign arm runs.
The authoritative hosted command first extracts
`scripts/run-state-authority-campaign.mjs` from `HEAD`, supplies its object ID via
`NAVSENTINEL_EXPECTED_LAUNCHER_OID`, and executes that exact blob with Node's
TypeScript stripping enabled.

## Replay-resistant campaign execution

The reviewed preflight candidate still exposed a complete, reusable launch
attestation. A caller could replay or edit that unsigned JSON and load changed
worktree modules before the in-spec verifier ran. The campaign no longer treats
that file as an execution capability.

The exact committed launcher now materializes every declared campaign input from
an authenticated Git blob into a private temporary tree before Playwright loads
its configuration or spec graph. The campaign runs from those copies, while the
repository worktree remains the source/build subject under test. A dedicated
materialized-tree hash is checked before the build, after the build, and at
receipt time. The local `node_modules` directory is linked only as an explicitly
trusted toolchain input and remains outside the project-source claim.

The full launch uses a short-lived HMAC-authenticated envelope that is consumed
and deleted by the one-worker campaign. `--preflight-only` emits a
non-consumable summary: it contains no run ID, expiry, attestation path,
execution root, or authentication key, and its temporary materialization is
deleted before the launcher exits. Direct worktree Playwright loading fails
during module evaluation with `COMMITTED_CAMPAIGN_EXECUTION_REQUIRED`.

This repair prevents a positive receipt from crediting campaign modules that
were merely checked before import but were not the bytes Playwright executed.
It does not turn the local toolchain or a hostile concurrent same-user process
into trusted evidence; those remain outside this bounded receipt.
