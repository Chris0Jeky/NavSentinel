# Release input integrity boundary (#692)

## Threat and evidence boundary

The release script previously treated `git status --porcelain` as proof that the
bytes read from the worktree matched `HEAD`. That is not a byte-authoritative
claim. A repository clean filter can map attacker-modified worktree bytes back
to the committed blob, and line-ending conversion can produce the same class of
mismatch. Git can therefore report a clean index/worktree while Node, npm, Vite,
or another release tool consumes different raw bytes.

The release gate now proves a narrower and explicit claim:

> Every supported tracked project input at the checked boundary is a regular
> filesystem file whose raw bytes and executable mode match the blob and mode in
> one pinned full Git tree, and no undeclared project input is present.

It does **not** prove dependency integrity, compiler/toolchain integrity,
reproducible output, a trusted operating system, or protection from a process
that can replace the Git executable or mutate Git objects after the check. Those
remain release-environment assumptions.

## Immutable source identity

`scripts/release-input-integrity.mjs` resolves and records full `HEAD^{commit}`
and `HEAD^{tree}` identities. It reads the tree with NUL-delimited `git ls-tree`
and reads blob contents directly with `git cat-file --batch`; neither operation
uses clean/smudge filters, text conversion, textconv, or the worktree index as
byte authority.

Before any release mutation, the attestor:

1. resolves the requested worktree to its real Git top level;
2. rejects shallow, promisor/partial-clone, alternate-object, and replacement-ref
   stores;
3. accepts only regular blob modes `100644` and `100755`;
4. rejects Git symlinks, gitlinks, unsupported modes, non-UTF-8/control-character
   paths, and normalized case collisions;
5. walks every tracked path without following a symlink/junction ancestor;
6. compares raw filesystem bytes with committed blob bytes and executable mode;
7. scans the project tree for ordinary or ignored untracked inputs, links, empty
   untracked directories, devices, sockets, FIFOs, and other special entries.

The scan excludes only declared non-project/toolchain or generated roots:
Git metadata, linked-worktree containers, `node_modules`, extension/build output,
artifacts, reports, resources, and coverage output. Their exclusion is part of
the evidence ceiling rather than an assertion that those bytes are trustworthy.

## Git process isolation

Every release-path Git call uses an argument array rather than a shell command.
The child environment removes inherited Git directory, worktree, index, object
directory, alternate-object, namespace, shallow-file, replacement-base, exec
path, and `GIT_CONFIG_*` overrides. It sets `GIT_NO_REPLACE_OBJECTS=1`,
`GIT_NO_LAZY_FETCH=1`, and `GIT_OPTIONAL_LOCKS=0` and also invokes Git with
`--no-replace-objects`.

The package-lock refresh receives the same sanitized environment because npm
may invoke Git for git-backed dependencies.

Normal user identity and repository/global signing configuration remain
available for the existing commit and annotated-tag gates. The release script
does not disable hooks or signing; instead it verifies the commit they produce
before a tag can be created.

## Two-boundary mutation protocol

The initial snapshot is retained while `release.mjs` updates exactly:

- `CHANGELOG.md`;
- `extension/manifest.json`;
- `package-lock.json`;
- `package.json`.

Immediately before staging, `assertReleaseSnapshotUnchanged` requires:

- the original commit and tree still be `HEAD`;
- the index still write the original tree;
- every non-release tracked path still match its original raw blob;
- each mutable path still be an ordinary direct file;
- no new project input or special filesystem entry have appeared.

At that boundary the script also records the size and SHA-256 of the four raw
metadata files it is about to stage. The post-commit check binds each committed
blob to those exact prepared bytes. A commit hook or concurrent writer therefore
cannot replace an otherwise allowed metadata path and still obtain a release
tag.

The script stages only those four paths and creates the existing release commit.
It then re-attests the new commit and requires it to have exactly one parent—the
initial pinned commit—and exactly the four declared changed paths. A hook or
concurrent process that stages or commits anything else suppresses tagging.

Immediately before the irreversible boundary, the release commit/tree and raw
worktree are attested again. The annotated tag names the explicit attested
commit object, not implicit moving `HEAD`; a subsequent worktree mutation cannot
change the tag target.

## Regression matrix

`tests/release-input-integrity.test.ts` uses disposable repositories to prove:

- exact commit/tree and raw-byte success;
- a clean-filter bypass where `git status` is empty but raw bytes differ;
- LF blobs materialized as CRLF;
- ordinary and ignored untracked inputs;
- tracked and untracked symbolic links/junction-shaped inputs;
- gitlinks and unsupported modes;
- case-colliding paths;
- FIFO/special filesystem entries;
- inherited Git override scrubbing and no-replace/no-lazy-fetch settings;
- detached linked-worktree attestation without trusting its `.git` indirection;
- mid-run unrelated mutation rejection;
- allowed pre-commit metadata mutation;
- allowed-path mutation by a commit hook/concurrent writer after preparation;
- one-parent exact release change scope and undeclared commit-path rejection;
- end-to-end `release.mjs --dry-run` refusal when filter-aware Git cleanliness
  hides raw worktree changes.

A dependency-free Node contract additionally exercises the same boundaries
without Vitest. A disposable real release with a no-dependency package proves
the complete bump, lock refresh, commit attestation, and explicit tag path.

## Non-goals

This change adds no runtime permission, endpoint, telemetry, browser behavior,
release eligibility, version policy, bloom-filter waiver, changelog waiver,
commit/tag signing waiver, or automatic publication. Pushing `main` and tags
remains an explicit human action after the existing release review.
