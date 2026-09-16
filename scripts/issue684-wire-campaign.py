#!/usr/bin/env python3
"""Wire issue #684 raw evidence authority into the state-authority campaign.

This script is intentionally temporary: the qualification workflow commits the
result and removes both the script and workflow before running exact-head tests.
"""

from pathlib import Path

STATE_PATH = Path("tests/e2e/state-authority-sink.spec.ts")
CAMPAIGN_PATH = Path("docs/security-program/STATE_AUTHORITY_CAMPAIGN.md")
ARCHITECTURE_PATH = Path("docs/security-program/RAW_EVIDENCE_AUTHORITY_684.md")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def replace_exact_count(text: str, old: str, new: str, count: int, label: str) -> str:
    observed = text.count(old)
    if observed != count:
        raise SystemExit(f"{label}: expected {count} matches, found {observed}")
    return text.replace(old, new)


def replace_range(text: str, start: str, end: str, replacement: str, label: str) -> str:
    start_count = text.count(start)
    end_count = text.count(end)
    if start_count != 1 or end_count != 1:
        raise SystemExit(
            f"{label}: expected unique boundaries, found start={start_count}, end={end_count}"
        )
    start_index = text.index(start)
    end_index = text.index(end, start_index) + len(end)
    return text[:start_index] + replacement + text[end_index:]


def wire_state_authority_campaign() -> None:
    text = STATE_PATH.read_text(encoding="utf-8")

    text = replace_once(
        text,
        'import { createHash, randomUUID } from "node:crypto";',
        'import { randomUUID } from "node:crypto";',
        "crypto import",
    )
    text = replace_once(
        text,
        '''import {
  assertCurrentHeadBuildInputs,
  hashCanonicalWorktreeFiles,
  hashGitFiles,
  trackedBuildInputs,
} from "./extension_build_provenance";''',
        '''import {
  assertCurrentHeadBuildInputs,
  assertExtensionBuildOutputHash,
  hashCanonicalWorktreeFiles,
  hashExtensionBuildOutput,
  hashGitFiles,
  resetExtensionBuildOutput,
  type BuildOutputAttestation,
} from "./extension_build_provenance";''',
        "provenance imports",
    )
    text = replace_once(
        text,
        '''type ExtensionProvenance = {
  repositoryHead: string;
  gitSourceSha256: string;
  executedSourceSha256: string;
  buildSha256: string;
  trackedInputCount: number;
};''',
        '''type ExtensionProvenance = {
  repositoryHead: string;
  repositoryTree: string;
  objectFormat: string;
  comparisonMode: "raw-blob-byte-equality";
  gitSourceSha256: string;
  executedSourceSha256: string;
  buildOutput: BuildOutputAttestation;
  trackedInputCount: number;
  unexpectedInputCount: number;
  specialInputCount: number;
};''',
        "extension provenance type",
    )

    hash_start = "function hashFiles(files: string[]): string {\n"
    prepare_start = "function prepareCurrentHeadExtension(): ExtensionProvenance {\n"
    if text.count(hash_start) != 1 or text.count(prepare_start) != 1:
        raise SystemExit("legacy hash helpers: expected unique boundaries")
    hash_index = text.index(hash_start)
    prepare_index = text.index(prepare_start, hash_index)
    text = text[:hash_index] + text[prepare_index:]

    prepare_end = '''}

function allowedLoopbackOrigins(baseUrl: string): Set<string> {'''
    prepared = '''function prepareCurrentHeadExtension(): ExtensionProvenance {
  if (process.env.EXTENSION_PATH && path.resolve(process.env.EXTENSION_PATH) !== extensionPath) {
    throw new Error("State-authority evidence rejects EXTENSION_PATH outside the current worktree build.");
  }
  const requestedHead = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
  const buildInputs = assertCurrentHeadBuildInputs(repositoryRoot, requestedHead);
  resetExtensionBuildOutput(repositoryRoot, extensionPath);

  const buildEnvironment = { ...process.env };
  delete buildEnvironment.EXTENSION_PATH;
  execFileSync(process.execPath, [path.join(repositoryRoot, "scripts", "build-extension.mjs")], {
    cwd: repositoryRoot,
    env: buildEnvironment,
    stdio: "inherit",
  });
  if (!fs.existsSync(path.join(extensionPath, "manifest.json"))) {
    throw new Error("Current-head extension build did not produce extension/dist/manifest.json.");
  }

  const postBuildInputs = assertCurrentHeadBuildInputs(
    repositoryRoot,
    buildInputs.repositoryCommit,
  );
  if (
    postBuildInputs.repositoryTree !== buildInputs.repositoryTree
    || postBuildInputs.gitSha256 !== buildInputs.gitSha256
    || postBuildInputs.executedSha256 !== buildInputs.executedSha256
  ) {
    throw new Error("State-authority build inputs changed while producing the extension artifact.");
  }
  return {
    repositoryHead: buildInputs.repositoryCommit,
    repositoryTree: buildInputs.repositoryTree,
    objectFormat: buildInputs.objectFormat,
    comparisonMode: buildInputs.comparisonMode,
    gitSourceSha256: buildInputs.gitSha256,
    executedSourceSha256: buildInputs.executedSha256,
    buildOutput: hashExtensionBuildOutput(repositoryRoot, extensionPath),
    trackedInputCount: buildInputs.trackedInputCount,
    unexpectedInputCount: buildInputs.unexpectedInputCount,
    specialInputCount: buildInputs.specialInputCount,
  };
}

function allowedLoopbackOrigins(baseUrl: string): Set<string> {'''
    text = replace_range(
        text,
        prepare_start,
        prepare_end,
        prepared,
        "prepare current-head extension",
    )

    campaign_start = "  const campaignFiles = [\n"
    campaign_end = '''  expect(hashDirectory(extensionPath), "Loaded extension bytes must match the current-head build").toBe(
    extensionProvenance.buildSha256,
  );'''
    campaign_replacement = '''  const campaignFiles = [
    path.join(gymRoot, scenario.fixture),
    path.join(gymRoot, "local-fixture-targets.js"),
    path.resolve(process.cwd(), "tests", "e2e", "state-authority-sink.spec.ts"),
    path.resolve(process.cwd(), "tests", "e2e", "extension_build_provenance.ts"),
    path.resolve(process.cwd(), "tests", "e2e", "extension_test_utils.ts"),
    path.resolve(process.cwd(), "tests", "e2e", "local_fixture_target_bootstrap.ts"),
    path.resolve(process.cwd(), "tests", "e2e", "proving_ground_fake_sink.ts"),
    path.resolve(process.cwd(), "playwright.stress.config.ts"),
  ];
  const currentBuildInputs = assertCurrentHeadBuildInputs(repositoryRoot, repositoryHead);
  const gitSourceSha256 = hashGitFiles(repositoryRoot, campaignFiles, repositoryHead);
  const executedSourceSha256 = hashCanonicalWorktreeFiles(
    repositoryRoot,
    campaignFiles,
    repositoryHead,
  );
  expect(executedSourceSha256, "Campaign sources must match raw committed bytes").toBe(gitSourceSha256);
  expect(currentBuildInputs.repositoryCommit, "Repository head must not change after the build").toBe(
    extensionProvenance.repositoryHead,
  );
  expect(currentBuildInputs.repositoryTree, "Repository tree must not change after the build").toBe(
    extensionProvenance.repositoryTree,
  );
  expect(currentBuildInputs.objectFormat).toBe(extensionProvenance.objectFormat);
  expect(currentBuildInputs.comparisonMode).toBe(extensionProvenance.comparisonMode);
  expect(currentBuildInputs.gitSha256).toBe(extensionProvenance.gitSourceSha256);
  expect(currentBuildInputs.executedSha256).toBe(extensionProvenance.executedSourceSha256);
  const currentBuildOutput = assertExtensionBuildOutputHash(
    repositoryRoot,
    extensionPath,
    extensionProvenance.buildOutput,
  );'''
    text = replace_range(
        text,
        campaign_start,
        campaign_end,
        campaign_replacement,
        "receipt-time authority checks",
    )

    text = replace_once(text, "    schema_version: 1,", "    schema_version: 2,", "receipt schema")
    text = replace_once(
        text,
        "    extension_build_sha256: extensionProvenance.buildSha256,",
        "    extension_build_sha256: extensionProvenance.buildOutput.sha256,",
        "receipt output hash",
    )
    text = replace_once(
        text,
        '''      repository_head: extensionProvenance.repositoryHead,
      git_source_sha256: extensionProvenance.gitSourceSha256,''',
        '''      repository_head: extensionProvenance.repositoryHead,
      repository_tree: extensionProvenance.repositoryTree,
      object_format: extensionProvenance.objectFormat,
      comparison_mode: extensionProvenance.comparisonMode,
      git_source_sha256: extensionProvenance.gitSourceSha256,''',
        "receipt repository authority",
    )
    text = replace_once(
        text,
        '''      tracked_input_count: extensionProvenance.trackedInputCount,
    },''',
        '''      tracked_input_count: extensionProvenance.trackedInputCount,
      unexpected_input_count: extensionProvenance.unexpectedInputCount,
      special_input_count: extensionProvenance.specialInputCount,
      build_output_file_count: currentBuildOutput.fileCount,
    },''',
        "receipt input and output counts",
    )
    text = replace_once(
        text,
        '''    campaign_source: {
      git_sha256: gitSourceSha256,''',
        '''    campaign_source: {
      repository_tree: extensionProvenance.repositoryTree,
      object_format: extensionProvenance.objectFormat,
      comparison_mode: extensionProvenance.comparisonMode,
      git_sha256: gitSourceSha256,''',
        "campaign source authority",
    )

    for stale_token in (
        "createHash",
        "trackedBuildInputs",
        "hashDirectory(",
        "buildSha256",
    ):
        if stale_token in text:
            raise SystemExit(f"state-authority wiring left stale token: {stale_token}")
    for required_token in (
        'path.resolve(process.cwd(), "tests", "e2e", "extension_test_utils.ts")',
        "comparison_mode: extensionProvenance.comparisonMode",
        "assertExtensionBuildOutputHash(",
        "resetExtensionBuildOutput(",
    ):
        if required_token not in text:
            raise SystemExit(f"state-authority wiring omitted required token: {required_token}")

    STATE_PATH.write_text(text, encoding="utf-8")


def update_campaign_document() -> None:
    text = CAMPAIGN_PATH.read_text(encoding="utf-8")
    previous_state = (
        "behavior passed once plus three repeats at `a666fda4`; PR #681 parked after review "
        "found an unresolved HIGH receipt-provenance boundary tracked by #684"
    )
    candidate_state = (
        "behavior proved on PR #681; PR #714 supplies raw committed-byte, index, undeclared-input, "
        "and fixed-output receipt authority pending final review"
    )
    text = replace_exact_count(
        text,
        previous_state,
        candidate_state,
        3,
        "campaign checkpoint rows",
    )
    text = replace_once(
        text,
        '''The executable receipt emitted by
`tests/e2e/state-authority-sink.spec.ts` is authoritative for a run. Do not turn
this table into a manual pass claim: promotion requires the test-owned
current-head build, exact-head build-input and campaign-source hash assertions,
loaded-build hash, typed sink observations, and all proving checks below. The
lane rejects an `EXTENSION_PATH` outside the current worktree so a stale or
unrelated artifact cannot be credited to the recorded repository head. The
tracked closure includes release-profile configuration, and a temp-repository
mutation test proves that configuration drift fails closed.''',
        '''The executable receipt emitted by
`tests/e2e/state-authority-sink.spec.ts` is authoritative for a run. Do not turn
this table into a manual pass claim: promotion requires immutable commit/tree
resolution, raw Git-blob versus filesystem-byte equality, exact index modes and
object IDs, zero undeclared or special build inputs, the fixed-output hash,
typed-sink observations, and all proving checks below. The lane rejects an
`EXTENSION_PATH` outside the current worktree, owns only ordinary
`extension/dist`, and rechecks source and output authority before attaching a
receipt. See [RAW_EVIDENCE_AUTHORITY_684.md](RAW_EVIDENCE_AUTHORITY_684.md).''',
        "campaign authority summary",
    )
    text = replace_once(
        text,
        '''- [x] `npm run typecheck`
- [x] focused ESLint for the changed test files
- [x] `npm run test -- --run tests/gym-local-fixture-contract.test.ts`
- [x] test-owned current-head `node scripts/build-extension.mjs`
- [x] one exact-source-head focused campaign run
- [x] one exact-source-head three-repeat campaign run after provenance hardening
- [x] legacy RW-21/RW-24/RW-25 stress regressions
- [x] `npm run security:check` after registry promotion
- [x] two-round fresh-context adversarial review completed; final verdict BLOCK
- [ ] hosted CI on the pushed head''',
        '''- [x] focused ESLint for the changed evidence files
- [x] `npm run typecheck`
- [x] raw-authority adversarial unit suite, including clean-filter and CRLF bypasses
- [x] ordinary and ignored untracked-input rejection
- [x] committed and worktree link rejection without traversal
- [x] stale-head, index-drift, missing-object, linked-worktree, and output-mutation coverage
- [x] test-owned current-head extension build and output recheck
- [x] exact-head RW-21/RW-24/RW-25 typed-harm campaign
- [ ] normal hosted CI on the pushed head
- [ ] one issue-scoped independent review of PR #714''',
        "campaign qualification checklist",
    )
    text = replace_once(
        text,
        '''PR #681 remains ready-for-review but parked. Resume only through #684: replace
filter-aware worktree comparison with raw committed-byte comparison or a clean
isolated checkout, reject untracked/special build inputs, add the clean-filter
bypass regression, then re-run this campaign and one issue-scoped review.''',
        '''PR #714 is stacked directly on PR #681 and supplies the bounded #684 closure.
Its publication gate runs the raw-authority unit suite and all three typed-harm
journeys against the exact candidate commit before pushing it. Merge remains
blocked on normal hosted CI and one issue-scoped independent review; broader
receipt migration stays separate from this state-authority slice.''',
        "campaign resumption guidance",
    )
    CAMPAIGN_PATH.write_text(text, encoding="utf-8")


def write_architecture_document() -> None:
    ARCHITECTURE_PATH.write_text(
        '''# Raw evidence authority for issue 684

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
''',
        encoding="utf-8",
    )


if __name__ == "__main__":
    wire_state_authority_campaign()
    update_campaign_document()
    write_architecture_document()
    print("Issue #684 state-authority candidate wired successfully.")
