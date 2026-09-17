# Independent Vision Lab delivery

The maintained prototype lives in [experiments/vision-lab](../experiments/vision-lab/README.md).
The original `RESOURCES/NavSentinel-Vision-Lab` remains unchanged; its
[62-file inventory](vision-overhaul/RESOURCE_INVENTORY.json) records paths,
categories, byte sizes and hashes.

| Surface | Working behavior | Evidence boundary |
| --- | --- | --- |
| Browser, Desktop, Relay previews | Shared renderer, Forest/Paper/Midnight themes, synthetic scenarios, offline HTML | Prototype policy is not the production detector |
| Evidence workspace | Explicit schema-checked file import, separate assessments, exact export preview, review-package round trip | Observations and user claims are not authenticated prevention receipts |
| Local broker | Operator/client roles, one-use context-bound grants, fixed measurable fixture counter, replay rejection | Cooperative research; no arbitrary URL fetch, shell action or OS enforcement |
| Native shell | Sandboxed Electron renderer, constrained IPC, actual broker flow and shutdown | No native system hooks; same-user isolation is not claimed |
| Proving tools | Node contracts, browser UI/storage/download tests, native smoke, deterministic CSP build | Synthetic fixtures do not establish attack-prevention efficacy |

The Protection Center extension page and browser settings overhaul remain in
separate PRs #640/#641 and #643. This Lab-only delivery changes no production
extension source, manifest, permission, settings, detector, or release profile.
Its optional experimental extension adapter remains research source and still
needs its own explicit browser procedure before anyone claims it works.

The source was extracted from the reviewed overhaul in incremental commits.
Review-package portability from #642 is included. The earlier Sol daemon/native
review and Terra fixture-boundary/import reviews apply to the preserved code;
the standalone candidate is checked again for extraction/integration errors.

Run `npm run vision:test`, `npm run vision:build`, and `npm run vision:test:browser`.
For native validation, first run `npm run vision:desktop:install`, then
`npm run vision:test:desktop`. The path-scoped Vision Lab CI also checks generated
HTML drift and retains browser evidence. Local session credentials and browser
profiles are ignored and excluded from delivery artifacts.

The locked Electron 44 package has an explicit installer rather than an npm
postinstall hook. `vision:desktop:install` therefore installs dependencies and
runs that installer; dependency installation alone does not supply the binary.

[ACTION_ITEMS.md](../ACTION_ITEMS.md) remains the human-action queue. Lab tests
do not close any pending real-Chrome acceptance or authorize a store release.
