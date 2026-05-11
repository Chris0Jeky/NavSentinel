---
name: ns-security-review
description: Security-focused review for NavSentinel changes involving extension permissions, bridge traffic, credentials, storage, privacy, or release posture.
user-invocable: true
---

# NavSentinel Security Review

Use for any change touching main-world patching, bridge messages, extension permissions, credentials, storage, network behavior, service-worker state, or release packaging.

## Threat Framing

Ask:

1. What asset is impacted: navigation intent, credential safety, user trust choices, local event log, extension permissions, or release artifact?
2. What is the attacker's cheapest path: spoof a bridge message, exploit page-visible state, induce a popup, bypass allow-once, trigger a false prompt, or exfiltrate data?
3. What is the blast radius: one tab, one domain pair, all extension state, or shipped package?

## Checklist

- [ ] No runtime network calls or telemetry added without explicit product approval.
- [ ] Content scripts do not read or persist password values.
- [ ] Bridge messages carry source marker, protocol version, session checks, and narrow message types.
- [ ] Main-world patches are minimal, reversible, and tested against legitimate flows.
- [ ] `chrome.storage.local` and `chrome.storage.session` writes are bounded and schema-aware.
- [ ] Extension permissions in `manifest.json` remain minimal and justified.
- [ ] Allow-once and always-allow behavior cannot be replayed outside its intended tab/time/domain scope.
- [ ] Sensitive values are not logged, exported, or displayed in debug UI.
- [ ] Build-time threat feed updates do not become runtime lookups.

## Verification

Run the smallest checks that exercise the security boundary:

```bash
npm run typecheck
npm run test
npm run build
```

Add targeted E2E for browser-only attack paths.

## Output

- short security assessment
- threats mitigated or left open
- tests added or run
- prioritized fix plan for issues found
