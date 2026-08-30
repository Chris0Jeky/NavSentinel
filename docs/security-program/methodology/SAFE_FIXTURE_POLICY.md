# Safe fixture policy

Programme fixtures must be useful enough to exercise the harm boundary and incapable of causing external harm.

## Required

- Use only local origins, localhost, loopback, or reserved `.test`/`.invalid` names.
- Use synthetic sentinel credentials, tokens, payment values, clipboard values, and files that cannot authenticate or authorize anything.
- Replace network, credential, payment, file, clipboard, native, and execution consequences with a local inspectable fake sink.
- Make the sink record only the minimum typed sentinel, scenario ID, consequence type, and timing needed by the oracle.
- Include malicious, benign, and mixed fixtures. An attack-only fixture is incomplete.
- Keep fixtures inert and silent. No shell execution, executable malware, destructive file operation, remote support, browser exploit, or external egress.
- Start the deny layer before loading the tested browser profile. It may forward only the declared loopback origins. Retain blocked browser-platform attempts separately from fixture violations; neither category may reach a remote network.
- Use no real user data, browsing history, credentials, private workbook, operational output, or live phishing page.

## Command-shaped and file-shaped tests

A ClickFix or file-delivery fixture may contain a visibly inert sentinel that cannot execute, such as `NAVSENTINEL_SENTINEL_DO_NOT_RUN`. It must not contain a runnable shell line, encoded payload, downloader, launcher, macro, binary, or executable archive. The oracle stops at local clipboard or fake-sink receipt.

## Invalid run conditions

Record `TEST_INVALID` when the sink is not armed, the extension build/profile is wrong, readiness is unknown, a fixture request targets a public origin, the pre-launch deny layer is absent or bypassed, a remote request escapes it, a non-synthetic value reaches the sink, timing attribution is ambiguous, or the control fixture cannot complete. Preserve blocked browser-platform attempts as minimized metadata; they are not external egress because the deny proxy never forwards them.

`npm run security:check` rejects public URLs, executable command patterns, credential-shaped content, missing safety constraints, and unsafe programme paths. Runtime fixtures still require focused review because static scanning is a guardrail, not proof.
