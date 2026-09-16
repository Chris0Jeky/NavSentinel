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
