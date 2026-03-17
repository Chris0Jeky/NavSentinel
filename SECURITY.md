# Security Policy

## Supported versions

This repository should be treated as supported only on the latest state of `main`.

## Reporting a vulnerability

If you find a security issue in NavSentinel:

1. Prefer a private disclosure channel if one is available.
2. If private disclosure is unavailable, open an issue with only the minimum reproduction detail needed.
3. Do not publish weaponized proof-of-concept material.

## In scope

- Message spoofing or privilege escalation involving the extension
- Sensitive-data leakage caused by extension behavior
- Unsafe handling of untrusted page input that could compromise the extension

## Out of scope

- Attacks that already require a compromised browser or operating system
- General website vulnerabilities that are unrelated to the extension

## Hardening notes

The current merged branch includes:

- per-document session-key handshaking between main-world and isolated-world code
- local-only storage for settings, allowlists, trust state, and event logs
- credential-submit protection that does not read or store password contents
