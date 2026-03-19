# Security

## Security Posture

NavSentinel is a defensive browser extension. Its job is to make common navigation and credential-deception paths harder to execute quietly.

The most security-sensitive code lives in:

- `extension/src/content/main_guard.ts`
- `extension/src/content/capture_isolated.ts`
- `extension/src/content/credential_guard.ts`
- `extension/src/shared/domain.ts`
- `extension/src/shared/storage.ts`
- `extension/src/sw/sw.ts`

## Hardening Measures

### Main-world and isolated-world bridge

- extension-runtime relaying scoped to the current tab/frame
- explicit inbound message-type allowlists
- replayable blocked actions with short-lived ids
- no trust in arbitrary page-originated messages

### Navigation controls

- popup and redirect allowance windows are time-limited
- blocked actions expire quickly
- rollback exists as a recovery path for suspicious committed navigations
- allowlists are site-scoped rather than global

### Credential controls

- password submits are intercepted before dispatch completes
- risky submits require explicit local user choice
- trusted domains are stored locally and scoped to registrable domains
- paste warnings discourage silent use of saved secrets on untrusted surfaces

### Storage controls

- local-only storage
- bounded event log retention
- normalization and migration of older key shapes

## Known Limitations

- event logging is best-effort because `chrome.storage.local` is not transactional
- domain normalization uses a curated multipart-suffix list rather than the full PSL
- a browser extension cannot defend against a fully compromised browser or OS

## Reporting

If you find a security issue in the repository, report it privately to the maintainers before opening a public issue if the bug could materially weaken the extension's protections.

When reporting, include:

- affected file paths
- reproduction steps
- expected and actual behavior
- whether the issue affects navigation protection, credential protection, or both
