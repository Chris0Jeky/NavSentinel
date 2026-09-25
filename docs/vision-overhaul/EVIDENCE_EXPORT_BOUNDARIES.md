# Evidence export boundary repair (#691, #689)

## Scope and source

The implementation began from `main` commit
`476301ad1c4b56fc83ed335ac83e343dc93d675e`. Before final qualification it was
integrated with current `main` `a00ae443b83342ce82bc556506110c112995e868`
through the real two-parent merge `ec364c216ccf00baecbbdb3062adbafe0b0a2446`.
That merge added only the test-side bounded MutationObserver delivery repair from
#697; it did not synthesize or resolve any export-boundary file.

The live open-PR review found #681, #662, #572 and #599; their navigation,
bridge and naming changes are not included here. This is export-boundary work,
not a detector/scoring change. It adds no permission, endpoint, telemetry,
runtime dependency or retention field.

## Contracts

**Legacy backup privacy.** `exportAll()` revalidates optional `pageSite` even
when a retained event has no `url`. It emits a canonical hostname/IP or omits the
field; it never extracts a hostname from a full URL. Existing URL query/fragment
minimization remains in place. The returned event is a fresh object and reading
an export does not migrate or overwrite the event store. Full backups still
contain configuration and retained records; they are not the minimized evidence
format and this change does not claim a whole-backup privacy audit.

**Portable IP evidence.** The extension reuses `normalizeEventPageSite` rather
than maintaining a second hostname grammar. The portable boundary additionally
rejects surrounding whitespace. IPv4 and IPv6 are validated and canonicalized
using browser-compatible URL host parsing only after a hostname/IP lexical fence.
Short, integer and hexadecimal WHATWG IPv4 spellings are canonicalized by the
extension and rejected on imported evidence unless already dotted-decimal.
Lexically hostname-shaped values that browser parsing rejects, including
overflow and numeric-final forms, are omitted by the extension and rejected on
import. IPv6 is serialized without brackets, matching the stored hostname
contract. The Lab and desktop shared importer accepts that canonical spelling,
but rejects URLs, user information, ports, bracketed/noncanonical IPv6 and zone
identifiers. Schema 1, the allowlist, reason caps and `recorded` outcome do not
change. Neither an imported observation nor a user assessment proves prevention
or grants action authority.

**Ordering.** Select the last 5,000 retained records by insertion first. Drop
invalid kinds and timestamps, project fresh allowlisted objects, then stably sort
valid records by ascending timestamp. Export is oldest first; the journal is its
reverse. Equal timestamps retain insertion order in export and later-retained
records appear first in the journal. A malformed date is not guessed. Sorting is
presentation/export-only and does not change storage retention or navigation.

**Reviewed bytes.** `prepareEvidenceExport` projects, serializes, measures and
freezes one snapshot containing text, byte count, filename and preparation time.
The preview and download use that exact string; storage refresh and later source
mutation cannot change it. The 8 MiB UTF-8 limit is inclusive. Refusal clears any
older prepared snapshot. Tests use bounded JSON plus legal trailing whitespace
at the exact boundary rather than inflating an unbounded event fixture. A
multibyte control distinguishes byte count from UTF-16 string length.

## Regression construction and hosted evidence

The browser-host repairs were developed test-first against unchanged production
code. The failing runs are retained because they prove the new cases exercised
the intended gaps rather than merely passing after implementation:

- At `86f2b38715f8cd23b78b13b8ae58bdff7862e2f6`, CI run
  `34911689090` failed exactly the five new producer assertions for short,
  integer and hexadecimal WHATWG IPv4 forms while 3,338 existing tests passed.
  Vision Lab run `34911689039` failed exactly the new shared-import assertion
  while 128 of 129 tests passed.
- At `167ab60b5a0176bd2a3733bc6cd42f73deb33607`, CI run
  `34912637040` failed exactly five newly added browser-invalid host controls
  while 3,344 existing tests passed. Vision Lab run `34912637045` failed exactly
  the new overflow-host assertion while 130 of 131 tests passed.

The fail-closed repair job `34913021410` checked out exact source head
`5b74ea50fab1ea97047adf4b8b8b8ccc5bdac972`, applied only the reviewed producer,
consumer and contract edits, and then passed:

- focused Vitest: 2 files, 53 tests;
- the complete Vision Lab Node suite: 131 tests;
- deterministic generation of all three hash-pinned, network-disabled previews;
- working-tree and staged `git diff --check`.

It published `32d74323628238238ece11f84fbd3461d9ba840d` and removed its temporary
workflow before the commit. The final pull-request path list contains no workflow
or permission change. The generated standalone sizes at that receipt were
185,111 bytes (Browser), 185,110 bytes (Desktop) and 185,104 bytes (Intent Relay).

Because that self-cleanup commit was authored by `github-actions[bot]`, GitHub
recorded normal CI runs `34913275988` and `34913276012` as `action_required`
without starting jobs. This owner-authored receipt commit exists to trigger the
normal exact-head CI and Vision Lab workflows. Their result must be read from the
new commit; the focused green repair run is not a substitute for full CI.

Run the normal repository gates, plus the focused regression set:

```sh
npx vitest run tests/storage-export-privacy.test.ts tests/evidence-model.test.ts tests/evidence-boundaries.test.ts tests/evidence-ui.test.ts
npm run vision:test
npm run vision:build
```

## Owner acceptance and limits

Automated tests do not prove that branded Chrome loaded the rebuilt artifact or
that the review/download interaction is understandable. Before owner acceptance,
follow [EXPORT_REVIEW.md](EXPORT_REVIEW.md) and add synthetic legacy URL-shaped
`pageSite` values, canonical/noncanonical IPv4 and IPv6, browser-invalid numeric
hosts, out-of-order imported dates, equal timestamps, preview/refresh/download
byte equality and Cancel/Escape. Verify both the full Options backup and the
minimized evidence file, then import the latter into the rebuilt Lab/native shell.
Record exact commit, profile and Chrome version; no live browsing sample or
sensitive value is needed.

Do not infer completion of any existing owner check or extend the named
`D-2026-09-12-P` waiver to this pull request. Old downloaded standalone previews
are not evidence for the new contract.

## Primary design reference

The [WHATWG URL host parsing and serialization algorithms](https://url.spec.whatwg.org/#host-parsing)
provide the canonical IP spelling. They are used after lexical validation, never
as permission to turn arbitrary URL-shaped data into allowed metadata.
