# NavSentinel Overnight Loop — Codex

Use this as the starting prompt for a bounded, autonomous NavSentinel session. It is an operating procedure, not a second source of project state. Live Git/GitHub, the current contracts, and the declared tier always outrank this document.

## Mission

Take only a small, release-path NavSentinel slice from verified current state to a cold-readable handoff. Favor shipping, measurement, and unblocking over speculative hardening or backlog manufacture.

Respect the current authority and evidence order:

1. The current user request.
2. \`CLAUDE.md\`, then \`AGENTS.md\` for Codex-specific rules, plus the declared tier.
3. \`docs/Project_Roadmap.md\` — active phase, priorities, and gates.
4. \`autodoc/AGENT_INDEX.md\` — code seams, invariants, and verification.
5. The relevant skill.
6. \`docs/agentic/DECISIONS.md\`, deeper documentation, archives, and historical material.

Live Git, executable checks, GitHub issue/PR state, CI, and unresolved review threads are current-state evidence. They outrank stale handoffs, test counts, and status prose, but do not replace the authority order. If a lower document conflicts with a higher source, follow the higher source and record the drift rather than copying it forward.

## Required preflight

Before choosing work:

1. Make the repository guard preamble the first repository action. Use only project-directory paths; do not discard, stash, restore, clean, or switch unrelated work.
2. Read \`AGENTS.md\`, \`CLAUDE.md\`, \`~/.claude/ESTATE.md\` when the checkout is unfamiliar, \`ACTION_ITEMS.md\`, \`docs/agentic/HANDOFF.md\`, \`docs/agentic/ORCHESTRATOR.md\`, \`docs/agentic/DECISIONS.md\`, \`docs/Project_Roadmap.md\`, \`autodoc/AGENT_INDEX.md\`, the applicable tier declaration, and the exact current hook definition.
3. Re-derive live GitHub state: branch/base/head SHA, relevant issue and PR state, checks, mergeability, existing comments/review threads, and the current browser/Gate-3 WIP count.
4. In a fresh session for this exact repository, inspect the active \`/hooks\` definitions and determine whether trust is current. Honor any current human-held trust action in \`ACTION_ITEMS.md\`; do not trigger it until its named prerequisite is proved. Once it is authorized and current, run the ordinary allow canary \`git status --short --branch\`, then run the inert deny canary \`git push --dry-run --no-verify --force . HEAD:refs/heads/codex-h2-deny-canary\` and require the floor to block it before Git executes.
5. If the adapter reports a shared-dispatcher identity mismatch, or a benign allow canary is denied, stop normal implementation. Do not use wrapper shells, copied dispatchers, alternate mutation channels, or an untrusted definition to work around it. Record the failure as a hook-preflight blocker and hand off the repair path.

A trusted hook definition is not runtime proof. An allow canary and a denied canary are required separately.

## One state model

Do not create a Taskdeck-style root \`ORCHESTRATOR.overnight-*\` ledger or any competing queue.

- \`ACTION_ITEMS.md\` is the human-owned queue and current-state snapshot. Surface every OPEN/BLOCKED item in each summary; add a complete stable \`AI-N\` guide when new human action is genuinely required; never clear an item yourself.
- \`docs/agentic/HANDOFF.md\` is the short next-session entry point.
- \`docs/agentic/ORCHESTRATOR.md\` records operational/cycle history, not a parallel backlog.
- The roadmap records active program truth; GitHub issues and PRs record live work and review state.
- Update status documents only when implementation changes their truth. A stale handoff is evidence to reconcile, not authority to follow.

## Selecting work

Use the current Priority Ladder: unblock the release path, protect release integrity, measure or serve day-one users, fix evidenced correctness/security failures, then perform scheduled structural gates. Route low-priority residue to the icebox under the current decision policy.

Do not seed speculative discovery, broad cleanup, a new tracker, or another browser-surface PR merely to stay busy. Recalculate the human-gated browser WIP cap from live state; if it is full, select a permitted non-browser slice or checkpoint. Browser blast radius is defined by runtime behavior, not by file extension.

State any non-blocking assumption in this form before editing:

> Assumption: <fact>. Reason: <evidence>. Reversible by: <safe undo or verification>.

Batch only true blockers into one question. Otherwise proceed.

## Hook and harness changes

Treat the shared irreversible floor as a cross-repository release, never as a Nav-only pin update:

\`\`\`text
agent-harness producer
  → tracked claude-config source
  → staged and landed NavSentinel adapter and fixtures
  → installed machine copy
  → fresh-session /hooks trust plus live canaries
\`\`\`

For such a change:

1. Freeze an exact reviewed producer commit, version, and normalized dispatcher digest.
2. Use the harness-supported sync path to update \`claude-config\`; do not hand-copy templates.
3. Complete the producer/config tests and required review at their exact heads.
4. Before changing NavSentinel's pin, obtain explicit owner scope for the installation and write a resumable transition note in \`docs/agentic/HANDOFF.md\`: old/new digests, exact producer/config/consumer commits, clean non-Nav checkout paths, and the recovery command \`py -3 .\\harness.py sync-global --config-root <clean-claude-config-checkout> --apply\`. Preview that command from the recorded clean agent-harness checkout, then update and land NavSentinel's adapter and frozen fixtures against the exact future digest from the still-working trusted session; run its native hook smoke, skill validation, and static checks.
5. Immediately run the recorded installer command from the clean non-Nav checkout and retain its generated backup paths. If the staged session is interrupted after the consumer pin lands, do not attempt a NavSentinel shell or alternate mutation channel; resume only in the recorded installer checkout, run that recovery command, and then continue with doctor/trust proof.
6. Obtain fresh exact-repository runtime proof after the new definition is trusted. Static pins, source equality, and CI do not replace this proof.

Never promote an unmerged/local-only producer or a known failing floor into the machine installation just to unblock a consumer.

## Implementation and review

Use one writer per checkout and a guarded detached worktree only for genuinely disjoint work. The guard preamble comes first; keep every path within that worktree's project directory and create it with \`git worktree add --detach origin/main\`, never a branch ref. After a wave, verify the primary checkout remains clean. Keep diffs narrow, make small present-tense commits, preserve unrelated changes, and never edit generated \`extension/dist/\`.

Select one primary NavSentinel skill and at most one supporting skill. Use the seam map to pick the narrowest relevant checks. Keep navigation-guard, credential-guard, service-worker, and UI work separate unless the seam demonstrably requires them.

Follow the current declared review gate, including the bounded review policy in the canonical contract. Inspect every existing comment and bot result; fix confirmed merge-blocking correctness, security, or data-loss defects, and explicitly track or decline non-blocking/out-of-scope findings. Re-prove the affected checks whenever the head or merge base changes. Do not merge a failing CI run.

For agentic-tooling changes, run at least:

\`\`\`text
npm run agent:hooks:smoke
npm run agent:skills:validate
\`\`\`

along with relevant JSON/Python validation and the seam-specific checks from \`autodoc/AGENT_INDEX.md\`. Do not claim browser, CI, MCP, or runtime-hook evidence unless it was actually observed for the current head.

## Stop conditions and handoff

Stop and hand off when the user asks to wrap, a required hook preflight fails, a true blocker has no safe permitted slice, the priority ladder is exhausted, or the bounded retry/review limit is reached. After three genuinely different attempts at a red check, park the failure with direct evidence rather than looping.

Close every slice with:

\`\`\`text
Changed: <files and behavior>
Verified: <commands/checks and exact results>
NOT verified: <what and why>
Residual risk: <remaining impact and owner>
Failures/workarounds: <classification and repair path>
Review disposition: <findings fixed, tracked, or declined>
Docs/status sync: <updated or not needed>
Human actions: <current ACTION_ITEMS.md items; none were self-cleared>
Next safe slice: <one concrete action>
\`\`\`

A session is successful when it leaves a verified, usable increment or a precise, cold-readable blocker—not when it accumulates ceremony.
