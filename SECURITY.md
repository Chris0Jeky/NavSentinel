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

- steady-state relaying uses a transferred `MessagePort` scoped to the current
  document/frame rather than ordinary page-visible messages
- challenge-response proves liveness and possession of the transferred port; it
  does **not** authenticate an isolated-world identity against hostile same-page
  code, so document-start ordering remains a mitigation and #175/#186 block beta
- per-document session and schema checks reject stale/cross-document traffic
- explicit inbound message-type allowlists
- replayable blocked actions with short-lived ids
- no authorization decision should rely on an arbitrary page-originated message

### Navigation controls

- popup and redirect allowance windows are time-limited
- blocked actions expire quickly
- rollback exists as a recovery path for suspicious committed navigations
- allowlists are site-scoped rather than global

### Credential controls

- password submits are intercepted before dispatch completes
- risk and destination are evaluated before a blocked submit can resume
- trusted domains are stored locally and scoped to registrable domains
- paste warnings discourage silent use of saved secrets on untrusted surfaces

### Storage controls

- local-only storage
- bounded event log retention
- normalization and migration of older key shapes

## Known Limitations

- event logging is best-effort because `chrome.storage.local` is not transactional
- domain normalization uses a build-time PSL snapshot; new TLDs require a data rebuild
- page-injected navigation/credential prompts currently expose protection-
  lowering actions to page-controlled placement and scripted activation. RI-01
  blocks beta until injected UI is warn/cancel only and extension-origin UI owns
  every proceed/allow/trust/resume decision with tab/destination binding and TTL
- the current development build contains only a placeholder 15-domain `.example` reputation
  fixture. The recommended interaction-only beta omits reputation and its
  claims; if AI-9 selects a real-filter profile, feed provenance, licensing,
  cadence, cardinality, false-positive target, and package budget must first be
  specified and verified
- a browser extension cannot defend against a fully compromised browser or OS

## Reporting

If a bug could materially weaken the extension's protections, use the
[private vulnerability report](https://github.com/Chris0Jeky/NavSentinel/security/advisories/new)
instead of opening a public issue. GitHub private vulnerability reporting is
enabled for this repository; the report and follow-up remain private to the
reporter and repository maintainers until coordinated disclosure is appropriate.

When reporting, include:

- affected file paths
- reproduction steps
- expected and actual behavior
- whether the issue affects navigation protection, credential protection, or both
