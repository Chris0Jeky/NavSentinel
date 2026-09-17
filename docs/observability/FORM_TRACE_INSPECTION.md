# Child-form intent inspection

Continuation of #700/#701. The collector is in #707, based on the child-form
runtime PR #698. This consumer is independently stacked on #706. No runtime
merge is required to inspect a file, and no #698 budget or owner gate is waived.

## What to inspect

The new form panel compares the snapshot at the original interaction with the
snapshot at the later operation. Three concrete examples:

- **action-substitution:** the button selects a benign action, but `submit()` has
  no submitter, so the form's harmful action becomes effective.
- **alternate-submitter:** the operation uses button b rather than clicked button
  a, and the effective target changes from the child to the top context.
- **late-submit:** the submit listener changes the action late. Receiver arrival
  and browser return remain distinct observations; recovery never erases harm.

Use Show input / Show operation / Show late mutation to jump to the actual record.
Changed rows compare form ID, submitter ID, declared versus effective action,
method, encoding, target and override presence. No DOM content, field values,
raw URL, body or authority token is displayed. These are authored fixture reports,
not a screenshot, native browser initiator identity or an authenticated page.

The timeline only renders snapshots at/before the selected event. Each operation
is compared with its latest earlier input, not an unrelated older interaction. An observed
navigation clears the current form interval. Old snapshots can still be visited
explicitly, but they do not become the current document's state. Source receive
times are not synchronized native-execution times. Product log samples are labeled
as samples, not assigned an invented intervention time.

Accepted receiver requests appear as `sink.receipt`. Rejected spends have their
own `receiver.rejected` event and count. One-use receiver enforcement must not hide
that a second operation reached the receiver. A denied receiver spend is not a
NavSentinel block. The inbox retains event links and as-of-scrubber visibility.

## Owner and headless commands

From a checkout of the consumer, use a directory containing only the desired
`*.form-trace.json` files copied from #707's artifact (not result files or metadata):

```bash
node experiments/evidence-observatory/cli.mjs inspect --input FORM_TRACES --out NEW_REPORT_DIRECTORY
node experiments/evidence-observatory/cli.mjs check --input FORM_TRACES
```

The first command writes local HTML and projected JSON. The second returns exit
1 for these diagnostics even if every source was parsed: they do not constitute
native four-arm certification. Exit 2 means an input is rejected. Inspect the
JSON's `rejected`, `cases[].gaps`, `cases[].facts`, `cases[].formEvidence`, and
`formComparisons` before deriving an explanation.

The known source schema is `navsentinel.observatory.form.v1`. Unknown fields,
invalid types, arbitrary descriptions, wrong source/kind, nonsequential event or
receiver order, duplicate health observations and malformed identities are rejected.
Missing/incomplete health, short observation, collector loss and failed execution
remain explicit. A failed framework status supplied to the report builder invalidates
its pairs; a standalone trace does not attest all surrounding test assertions.

## Pairing policy

The original thirty-test matrix has fifteen paired variants and fifteen protected-only
controls: 45 browser arms. It does not provide baseline/protected/benign/mixed for
each variant. This consumer preserves that topology rather than relabeling it.

Pairs require matching variant/source/build/browser, distinct run IDs, successful
baseline harm, complete health and observation, and no reported collection failure.
The separate descriptive statuses are `PAIRED_NON_REACHABILITY_OBSERVED`,
`PROTECTED_CONSEQUENCE_OBSERVED`, `RECEIVER_REJECTED_OPERATION` and
`COMPARISON_INCOMPLETE`. Every entry has `preventionSupported: false` and a
`NOT_A_FOUR_ARM_COMPARISON` limitation. Positive request/recovery facts remain
visible even when pairing or collection is incomplete. Original producer claims
never override independent receiver facts.

## Recorded fixtures and browser qualification

`experiments/evidence-observatory/fixtures/forms/` contains a small pinned sample
from an actually executed #707 campaign, with producer commit/tree, artifact/run
IDs and digests in `provenance.json`. The gzip file is a fixed bundled JSON array,
not a general archive-import capability. The smoke test bounds decompression to
1 MiB, verifies its digest and source identities, and routes HTTP requests to failure.
The original full artifact remains separate; these selected records are not a
statistical sample and must not be pooled into an efficacy score.

```bash
node --test experiments/evidence-observatory/tests/*.test.mjs
node experiments/evidence-observatory/smoke-forms.mjs
```

The browser smoke checks recorded action changes, alternate submitters, late
mutation followed by harm/recovery, rejected replay, explicit-empty target,
paired-run navigation, no future/stale snapshots, responsive layout and exact JSON
download. Its screenshots qualify this renderer using past producer evidence;
they do not rerun or certify NavSentinel at the consumer commit.

## Scope still open

Neither imported hashes nor a structurally valid file authenticate a producer.
The existing #684 raw-source work, document-bound causal attribution, representative
four-arm form contracts, genuinely held-out cases and additional browser topologies
remain open. Current fixture page reports can be lost; absence of a report does
not mean an operation was impossible. The recorder is not a network firewall.

#702 remains the separately consented live session integration. No browsing
session is started, no capture permission is added, and no real form or clipboard
content is recorded by this offline consumer. The existing consent/feedback/export
work stays authoritative.

## Related fixture correction

During reconstruction, the source-verification symlink test failed because its
symlink target was also an untracked file inside the very root being checked.
Directory enumeration could find either violation first. The test now keeps the
target outside that root, so it isolates the intended linked-input failure. The
verifier, expected error and all other source validation are unchanged.
