# Evidence export boundary repair (#691, #689)

## Scope and source

Based on `main` commit `476301ad1c4b56fc83ed335ac83e343dc93d675e`.
The uploaded checkout's tracked bytes and modes reconstructed its exact tree,
`1407915095e9fb3f09080de5aa806e9b5b482d50`. The live open-PR review found
#681, #662, #572 and #599; their navigation, bridge and naming changes are not
included here. This is export-boundary work, not a detector/scoring change.

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
IPv6 is serialized without brackets, matching the stored hostname contract. The
Lab and desktop's shared importer accepts that canonical spelling, but rejects
URLs, user information, ports, bracketed/noncanonical IPv6 and zone identifiers.
Schema 1, the allowlist, reason caps and `recorded` outcome do not change. Neither
an imported observation nor a user assessment proves prevention or grants action
authority.

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

## Validation and limits

Executed locally on Node 22.16.0:

- `npm run vision:test`: 129 tests passed, zero skipped, including 15 evidence
  importer/workspace tests and canonical-IP round trips.
- An out-of-tree actual-source Node assertion runner reproduced four original
  boundary behaviors, then passed 29 patched contracts. It used the locally
  available TypeScript 5.8.3 transpiler to execute source modules. This is **not**
  Vitest, a typecheck, a Vite build, browser evidence or independent review.
- `git diff --check` passed.

The sandbox could not install the lockfile dependency graph: the offline cache
was empty and registry/DNS access was unavailable. Therefore the new Vitest
cases, full unit suite, lint, repository typecheck, both profile builds/budgets,
package checks and Playwright were not run locally. Keep this candidate draft
until exact-head automated qualification and the applicable reviews are recorded.
Do not infer completion of any existing owner check or extend the named
D-2026-09-12-P waiver to this new PR.

Run the normal repository gates, plus the focused regression set:

```sh
npx vitest run tests/storage-export-privacy.test.ts tests/evidence-model.test.ts tests/evidence-boundaries.test.ts tests/evidence-ui.test.ts
npm run vision:test
npm run vision:build
```

The maintained served Lab and native shell use the changed shared importer.
The three checked-in self-contained HTML previews retain their previous build
receipt in this source-focused change: regenerate them with `vision:build` before
using them to assess the new IPv6 contract. Old downloaded previews are not new
consumer evidence.

Before owner acceptance, follow [EXPORT_REVIEW.md](EXPORT_REVIEW.md) and add a
synthetic legacy URL-shaped `pageSite`, IPv4 and IPv6, out-of-order imported dates,
equal timestamps, preview/refresh/download byte equality and Cancel/Escape. Verify
both the full Options backup and the minimized evidence file, and import the
latter into the rebuilt Lab/native shell. Record exact commit, profile and Chrome
version; no live browsing sample or sensitive value is needed.

## Primary design reference

The [WHATWG URL host parsing and serialization algorithms](https://url.spec.whatwg.org/#host-parsing)
provide the canonical IP spelling. They are used after lexical validation, never
as permission to turn arbitrary URL-shaped data into allowed metadata.
