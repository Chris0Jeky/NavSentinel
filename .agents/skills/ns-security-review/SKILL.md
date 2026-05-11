---
name: ns-security-review
description: Security-focused review for extension permissions, bridge traffic, credentials, storage, privacy, or release posture.
user-invocable: true
---

# NavSentinel Security Review

Threat frame: impacted asset, cheapest attacker path, and blast radius.

Checklist: no unapproved runtime network calls, no password value storage, bridge messages are marker/version/session checked, main-world patches are minimal, storage writes are bounded, manifest permissions are justified, allow-once cannot replay out of scope, sensitive values are not logged.

Verify with the smallest relevant checks: `npm run typecheck`, `npm run test`, `npm run build`, and targeted E2E for browser-only attack paths.

Output a short security assessment, threats mitigated or left open, and tests run or added.
