---
name: ns-interface-map
description: Maintain agent-facing interface maps so agents can find public NavSentinel seams quickly without broad repo search.
allowed-tools: Read, Grep, Glob, LS, Bash, Edit, Write
user-invocable: true
---

# NavSentinel Interface Map

Use after adding, splitting, moving, or substantially changing a domain seam.

## Workflow

1. Read `autodoc/AGENT_INDEX.md`.
2. Identify public entry files, implementation-heavy files, invariants, and verification commands.
3. Prefer shallow interface docs over long implementation summaries.
4. Add or update one of:
   - `autodoc/AGENT_INDEX.md`
   - `autodoc/interfaces/<domain>.md`
   - a domain `README.agent.md`
5. Do not duplicate source code. Link to files and state how to interact with them.

## Interface Template

```markdown
# <Domain> agent interface

Entry points:
- <file>: <why it matters>

Public operations:
- <operation>: <caller contract>

Invariants:
- <rule>

Do not:
- <dangerous or misleading action>

Verification:
- <command or manual check>
```
