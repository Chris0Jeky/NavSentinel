# Agent Failure Ledger

This file is the human-readable view of recurring agent, tool, and workflow failures. Machine-appended raw entries live in `docs/agentic/failure_ledger.jsonl` and can be rendered with:

```bash
python scripts/agent_hooks/render_failure_ledger.py
```

## Entries

| Date | Class | Surface | Failure | Workaround | Future fix | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-05-11 | pre_existing_noise | Bash | PowerShell cmdlet used in bash shell | Use grep instead of Select-String in bash | n/a — agent tool misuse | closed |
| 2026-05-11 | pre_existing_noise | Bash | Backslash path separator mangled branch:path ref | Use forward slashes for git refs on Windows | n/a — agent tool misuse | closed |
| 2026-05-11 | pre_existing_noise | Bash | PowerShell cmdlet used in bash shell | Use grep instead of Select-String in bash | n/a — agent tool misuse | closed |
| 2026-05-11 | pre_existing_noise | Bash | $null is PowerShell; bash uses /dev/null | Use 2>/dev/null in bash | n/a — agent tool misuse | closed |
| 2026-05-11 | pre_existing_noise | Bash | findstr treated unquoted arg as filename | Use grep -i in bash | n/a — agent tool misuse | closed |
| 2026-05-12 | non_blocking_risk | Bash | Script removed from package.json during release infra commit | Re-added to package.json | Fixed — scripts restored | closed |
| 2026-05-12 | unclassified | Bash | Exit code 1 === On main (protected) - should DENY risky commands ===
   ok: git rebase -> DENIED
   ok: git push --force-with-lease -> DENIED
   ok: git reset -... |  | classify and promote if recurring | open |
| 2026-05-12 | unclassified | Bash | Exit code 127 /usr/bin/bash: line 1: del: command not found |  | classify and promote if recurring | open |
| 2026-05-16 | unclassified | Bash | Exit code 1  added 2 packages, removed 14 packages, changed 6 packages, and audited 141 packages in 2s  38 packages are looking for funding   run `npm fund` for... |  | classify and promote if recurring | open |
| 2026-05-16 | non_blocking_risk | dependency | Dev server allows any website to read responses. Requires vite >=6.2 for fix, currently on 5.4. Dev-only — no production impact on built extension. | Do not browse untrusted pages while npm run dev or gym:serve is active | Upgrade vite ^5.4 to ^6.2+ (breaking change: requires testing all build/dev/test pipelines) | open |
| 2026-05-16 | unclassified | Bash | Exit code 127 /usr/bin/bash: line 1: del: command not found |  | classify and promote if recurring | open |
| 2026-05-16 | unclassified | Bash | Exit code 127 /usr/bin/bash: line 1: Get-ChildItem: command not found /usr/bin/bash: line 1: Select-Object: command not found /usr/bin/bash: line 1: Format-Tabl... |  | classify and promote if recurring | open |
| 2026-05-16 | unclassified | Bash | Exit code 1 /usr/bin/bash: line 1: cd: /c/Users/jekyt/Desktop/Printer Config/Others/GitNavSentinel: No such file or directory |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 128 Saved working directory and index state WIP on main: f0bb3e6 Merge pull request #111 from Chris0Jeky/feat/visual-sim-templates fatal: 'fix/dedup-j... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 error: Your local changes to the following files would be overwritten by merge: 	docs/agentic/failure_ledger.jsonl Please commit your changes or sta... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1  changed 1 package, and audited 118 packages in 2s  33 packages are looking for funding   run `npm fund` for details  # npm audit report  rollup  <2... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 2 grep: extension/tsconfig.json: No such file or directory |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 127 /usr/bin/bash: line 1: Select-String: command not found |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 127 /usr/bin/bash: line 1: $null: ambiguous redirect /usr/bin/bash: line 1: Measure-Object: command not found /usr/bin/bash: line 1: Select-Object: co... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 2 grep: Unmatched ( or \( |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 2 node_modules/@vitest/expect/dist/index.d.ts(6,27): error TS2307: Cannot find module '@vitest/utils/display' or its corresponding type declarations.
... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 128 fatal: ambiguous argument 'infra\toolchain-migration;.nvmrc': unknown revision or path not in the working tree. Use '--' to separate paths from re... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 /usr/bin/bash: line 1: $null: ambiguous redirect /usr/bin/bash: line 1: $null: ambiguous redirect |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 2 ../../../../../AppData/Local/Temp/test_mock_type.ts(1,20): error TS2307: Cannot find module 'vitest' or its corresponding type declarations. |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 node:fs:439
     return binding.readFileUtf8(path, stringToFlags(options.flag));
                    ^

 Error: ENOENT: no such file or directory, ... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 2 /usr/bin/bash: eval: line 1: syntax error near unexpected token `{' /usr/bin/bash: eval: line 1: `cd ".-wt-ci-perf" && ls extension/public/reputatio... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 [33m[crx:content-scripts] Some content-scripts don't support HMR because the world is MAIN:
   /src/content/main_guard.ts[39m  [7m[1m[36m RUN ... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 [33m[crx:content-scripts] Some content-scripts don't support HMR because the world is MAIN:
   /src/content/main_guard.ts[39m  [7m[1m[36m RUN ... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 [33m[crx:content-scripts] Some content-scripts don't support HMR because the world is MAIN:
   /src/content/main_guard.ts[39m  [7m[1m[36m RUN ... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 [33m[crx:content-scripts] Some content-scripts don't support HMR because the world is MAIN:
   /src/content/main_guard.ts[39m  [7m[1m[36m RUN ... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 2 /usr/bin/bash: command substitution: line 32: syntax error near unexpected token `(' /usr/bin/bash: command substitution: line 32: `$sourceFiles = @... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 [33m[crx:content-scripts] Some content-scripts don't support HMR because the world is MAIN:
   /src/content/main_guard.ts[39m  [7m[1m[36m RUN ... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 [33m[crx:content-scripts] Some content-scripts don't support HMR because the world is MAIN:
   /src/content/main_guard.ts[39m  [7m[1m[36m RUN ... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 /usr/bin/bash: line 1: cd: C:UsersjekytDesktopPrinter ConfigOthersGitNavSentinel: No such file or directory |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 /usr/bin/bash: line 1: $null: ambiguous redirect /usr/bin/bash: line 1: $null: ambiguous redirect |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 2 /usr/bin/bash: eval: line 1: syntax error near unexpected token `(' /usr/bin/bash: eval: line 1: `cd "." && Get-ChildItem -Path "extension/src/conte... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 127 /usr/bin/bash: line 1: $null: ambiguous redirect --- /usr/bin/bash: line 1: Select-String: command not found |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 127 /usr/bin/bash: line 1: Select-String: command not found /usr/bin/bash: line 1: Select-Object: command not found |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 /usr/bin/bash: line 19:  // Test if 'toContain' on formatted NRS/CDS line would catch a swap bug // Source line: NRS: ${info.nrs ?? 'n/a'}  CDS: ${i... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 2 ls: cannot access 'tests/*state-machine*': No such file or directory ls: cannot access 'tests/*icons*': No such file or directory tests/event-tone.t... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 [33m[crx:content-scripts] Some content-scripts don't support HMR because the world is MAIN:
   /src/content/main_guard.ts[39m  [7m[1m[36m RUN ... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 127 /usr/bin/bash: line 1: Select-String: command not found /usr/bin/bash: line 1: Select-Object: command not found |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 127 /usr/bin/bash: line 66: pwsh: command not found |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 /usr/bin/bash: line 1: $null: ambiguous redirect /usr/bin/bash: line 1: $null: ambiguous redirect |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 FINDSTR: Cannot open C:^--- |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 127 /usr/bin/bash: line 1: Select-String: command not found /usr/bin/bash: line 1: Select-Object: command not found |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 127 /usr/bin/bash: line 1: Select-Object: command not found |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 /usr/bin/bash: line 1: $null: ambiguous redirect --- /usr/bin/bash: line 1: $null: ambiguous redirect |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 2 /usr/bin/bash: eval: line 1: unexpected EOF while looking for matching ``' |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 2 extension/src/content/main_guard.ts(560,8): error TS2352: Conversion of type 'Location' to type 'Record<string, unknown>' may be a mistake because n... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 2 /usr/bin/bash: eval: line 1: syntax error near unexpected token `{' /usr/bin/bash: eval: line 1: `cd ".-wt-a11y-types" && git log --oneline origin/f... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 Auto-merging extension/src/options/options.html CONFLICT (content): Merge conflict in extension/src/options/options.html Auto-merging extension/src/... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 2 /usr/bin/bash: eval: line 1: unexpected EOF while looking for matching `"' |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 [33m[crx:content-scripts] Some content-scripts don't support HMR because the world is MAIN:
   /src/content/main_guard.ts[39m  [7m[1m[36m RUN ... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 /usr/bin/bash: line 1: cd: C:UsersjekytDesktopPrinter ConfigOthersGitNavSentinel: No such file or directory |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 2 tests/clickfix-detector.test.ts tests/credential-domain.test.ts tests/csp-analyzer.test.ts tests/dblclick-guard.test.ts tests/dom-builder.test.ts te... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1  [41m                                                                               [0m [41m[37m                This is not the tsc command you ... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 At line:3 char:19
 +   param([string[]])
 +                   ~
 Parameter declarations are a comma-separated list of variable names with optional i... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 2 tests/credential-domain.test.ts tests/credential-guard-model.test.ts tests/icon-manager.test.ts tests/statemachine-timing.test.ts |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 2 |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 127 /usr/bin/bash: line 1: Get-ChildItem: command not found /usr/bin/bash: line 1: Select-Object: command not found |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 [33m[crx:content-scripts] Some content-scripts don't support HMR because the world is MAIN:
   /src/content/main_guard.ts[39m  [7m[1m[36m RUN ... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 127 /usr/bin/bash: line 1: Get-ChildItem: command not found /usr/bin/bash: line 1: Select-Object: command not found |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 [33m[crx:content-scripts] Some content-scripts don't support HMR because the world is MAIN:
   /src/content/main_guard.ts[39m  [7m[1m[36m RUN ... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 === credential-guard-model === 8 wc: extension/src/shared/credential_guard_model.ts: No such file or directory |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 vite.config.ts (2:29) [33m[UNRESOLVED_IMPORT] [0mCould not resolve 'vite' in vite.config.ts    [38;5;246mâ•­[0m[38;5;246mâ”€[0m[38;5;246m[[0... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 2 /usr/bin/bash: eval: line 1: unexpected EOF while looking for matching `"' |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 127 /usr/bin/bash: line 1: Get-ChildItem: command not found /usr/bin/bash: line 1: Select-Object: command not found /usr/bin/bash: line 1: Sort-Object... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 [33m[crx:content-scripts] Some content-scripts don't support HMR because the world is MAIN:
   /src/content/main_guard.ts[39m  [7m[1m[36m RUN ... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 127 /usr/bin/bash: line 1: Get-ChildItem: command not found /usr/bin/bash: line 1: Measure-Object: command not found /usr/bin/bash: line 1: Select-Obj... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 2 /usr/bin/bash: eval: line 1: syntax error near unexpected token `(' /usr/bin/bash: eval: line 1: `cd "." && npx vitest run 2>&1 \| Select-String "te... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 [33m[crx:content-scripts] Some content-scripts don't support HMR because the world is MAIN:
   /src/content/main_guard.ts[39m  [7m[1m[36m RUN ... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 127 /usr/bin/bash: line 1: Get-ChildItem: command not found /usr/bin/bash: line 1: ForEach-Object: command not found /usr/bin/bash: line 1: Sort-Objec... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 At line:16 char:26
 +   [PSCustomObject]@{File=; Tests=}
 +                          ~
 Missing statement after '=' in hash literal.
 At line:16 cha... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 [33m[crx:content-scripts] Some content-scripts don't support HMR because the world is MAIN:
   /src/content/main_guard.ts[39m  [7m[1m[36m RUN ... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 127 /usr/bin/bash: line 1: Select-String: command not found |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 [33m[crx:content-scripts] Some content-scripts don't support HMR because the world is MAIN:
   /src/content/main_guard.ts[39m  [7m[1m[36m RUN ... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 node:internal/modules/cjs/loader:1451
   throw err;
   ^

 Error: Cannot find module './extension/src/shared/domain_groups'
 Require stack:
 - .-wt... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 X [ERROR] Could not resolve "C:\\Users\\jekyt\\Desktop\\Printer Config\\Others\\Git\\NavSentinel-wt-domain-groups-props\\extension\\vitest.config.ts... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 127 /usr/bin/bash: line 1: del: command not found |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 /usr/bin/bash: line 1: cd: C:UsersjekytDesktopPrinter ConfigOthersGitNavSentinel: No such file or directory |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 2 /usr/bin/bash: eval: line 65: unexpected EOF while looking for matching ``' |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 [33m[crx:content-scripts] Some content-scripts don't support HMR because the world is MAIN:
   /src/content/main_guard.ts[39m  [7m[1m[36m RUN ... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 /usr/bin/bash: line 1: cd: C:UsersjekytDesktopPrinter ConfigOthersGitNavSentinel: No such file or directory |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 tests/scoring.property.test.ts Property test: tests/scoring.property.test.ts |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 [33m[crx:content-scripts] Some content-scripts don't support HMR because the world is MAIN:
   /src/content/main_guard.ts[39m  [7m[1m[36m RUN ... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 [33m[crx:content-scripts] Some content-scripts don't support HMR because the world is MAIN:
   /src/content/main_guard.ts[39m  [7m[1m[36m RUN ... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 127 /usr/bin/bash: line 1: $null: ambiguous redirect /usr/bin/bash: line 1: $null: ambiguous redirect /usr/bin/bash: line 1: ConvertFrom-Json: command... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 127 /usr/bin/bash: line 1: Select-String: command not found |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 /usr/bin/bash: line 1: cd: C:UsersjekytDesktopPrinter ConfigOthersGitNavSentinel: No such file or directory |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 127 /usr/bin/bash: line 1: $null: ambiguous redirect /usr/bin/bash: line 1: Select-String: command not found /usr/bin/bash: line 1: Select-Object: com... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 127 /usr/bin/bash: line 1: $null: ambiguous redirect /usr/bin/bash: line 1: $null: ambiguous redirect /usr/bin/bash: line 1: ConvertFrom-Json: command... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 At line:1 char:59
 + [Console]::InputEncoding = [System.Text.Encoding]::UTF8;  \| Select-St ...
 +                                                  ... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 127 /usr/bin/bash: line 1: :TEMP: command not found |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 127 /usr/bin/bash: line 1: Select-Object: command not found |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 [33m[crx:content-scripts] Some content-scripts don't support HMR because the world is MAIN:
   /src/content/main_guard.ts[39m  [7m[1m[36m RUN ... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 /usr/bin/bash: line 1: cd: C:UsersjekytDesktopPrinter ConfigOthersGitNavSentinel: No such file or directory |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 2 /usr/bin/bash: eval: line 1: syntax error near unexpected token `(' /usr/bin/bash: eval: line 1: `cd "." && npx vitest run 2>&1 \| Select-String "te... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 127 /usr/bin/bash: line 1: Sort-Object: command not found |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 127 /usr/bin/bash: line 1: Get-ChildItem: command not found /usr/bin/bash: line 1: Select-Object: command not found |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 [33m[crx:content-scripts] Some content-scripts don't support HMR because the world is MAIN:
   /src/content/main_guard.ts[39m  [7m[1m[36m RUN ... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 2 /usr/bin/bash: eval: line 1: unexpected EOF while looking for matching `"' |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 2 ls: cannot access '.-wt-scoring-props\tests\scoring*.test.ts': No such file or directory |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 2 /usr/bin/bash: -c: line 67: unexpected EOF while looking for matching `'' |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 127 /usr/bin/bash: line 1: $null: ambiguous redirect /usr/bin/bash: line 1: Select-Object: command not found |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 /usr/bin/bash: line 1: $null: ambiguous redirect |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 127 /usr/bin/bash: line 1: Select-Object: command not found |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 127 /usr/bin/bash: line 1: Get-Content: command not found |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 vite.config.ts (2:29) [33m[UNRESOLVED_IMPORT] [0mCould not resolve 'vite' in vite.config.ts    [38;5;246mâ•­[0m[38;5;246mâ”€[0m[38;5;246m[[0... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 [33m[crx:content-scripts] Some content-scripts don't support HMR because the world is MAIN:
   /src/content/main_guard.ts[39m  [7m[1m[36m RUN ... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 [33m[crx:content-scripts] Some content-scripts don't support HMR because the world is MAIN:
   /src/content/main_guard.ts[39m  [7m[1m[36m RUN ... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 127 /usr/bin/bash: line 94: pwsh: command not found |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 === Checking for alternative test patterns for uncovered files === credential_guard.ts: credential-domain.test.ts credential-guard-model.test.ts  de... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 === Checking for tests for uncovered modules === credential_modal: credential-domain.test.ts credential-guard-model.test.ts  debug_overlay: |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 2 === Verifying task completion status === Checking if test files exist for files marked in completed tasks:  T-18 (credential_modal.ts): -rw-r--r-- 1... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 /usr/bin/bash: line 1: $null: ambiguous redirect --- /usr/bin/bash: line 1: $null: ambiguous redirect |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 vite.config.ts (2:29) [33m[UNRESOLVED_IMPORT] [0mCould not resolve 'vite' in vite.config.ts    [38;5;246mâ•­[0m[38;5;246mâ”€[0m[38;5;246m[[0... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 2 /usr/bin/bash: eval: line 1: syntax error near unexpected token `Test-Path' /usr/bin/bash: eval: line 1: `cd "." && Get-ChildItem tests\*.test.ts -F... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 [33m[crx:content-scripts] Some content-scripts don't support HMR because the world is MAIN:
   /src/content/main_guard.ts[39m  [7m[1m[36m RUN ... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 2 /usr/bin/bash: eval: line 1: syntax error near unexpected token `{' /usr/bin/bash: eval: line 1: `cat "C:\Users\jekyt\AppData\Local\Temp\claude\C--U... |  | classify and promote if recurring | open |
| 2026-05-23 | unclassified | Bash | Exit code 1 [33m[crx:content-scripts] Some content-scripts don't support HMR because the world is MAIN:
   /src/content/main_guard.ts[39m  [7m[1m[36m RUN ... |  | classify and promote if recurring | open |
| 2026-05-29 | unclassified | Bash | Exit code 1 FINDSTR: Cannot open explanation |  | classify and promote if recurring | open |
| 2026-05-29 | unclassified | Bash | Exit code 1 FINDSTR: Cannot open C:lint
 FINDSTR: Cannot open C:build
 FINDSTR: Cannot open C:typecheck |  | classify and promote if recurring | open |
| 2026-05-29 | unclassified | Bash | Exit code 1 FINDSTR: Cannot open C:File Not Found
 FINDSTR: Cannot open C:File Not Found
 FINDSTR: Cannot open C:File Not Found |  | classify and promote if recurring | open |
| 2026-05-29 | unclassified | Bash | Exit code 127 /usr/bin/bash: line 1: :TEMP\ff_files.txt: No such file or directory /usr/bin/bash: line 1: Select-String: command not found |  | classify and promote if recurring | open |
| 2026-05-29 | unclassified | Bash | Exit code 1 browser.ts NOT in dist (tree-shaken out) - GOOD === firefox manifest in dist? === ls: cannot access 'extension/dist/manifest.firefox.json': No such ... |  | classify and promote if recurring | open |
| 2026-05-30 | unclassified | Bash | Exit code 1 wc: extension/src/shared/visual_sim.ts: No such file or directory |  | classify and promote if recurring | open |
| 2026-05-30 | unclassified | Bash | Exit code 2 sed: can't read extension/src/shared/visual_sim.ts: No such file or directory |  | classify and promote if recurring | open |
| 2026-05-30 | unclassified | Bash | Exit code 2 ls: cannot access 'extension/src/shared/visual_sim.ts': No such file or directory |  | classify and promote if recurring | open |
| 2026-05-30 | unclassified | Bash | Exit code 128 fatal: option '--include=*.ts' must come before non-option arguments |  | classify and promote if recurring | open |
| 2026-05-30 | unclassified | Bash | Exit code 1 /usr/bin/bash: line 1: cd: C:UsersjekytDesktopPrinter ConfigOthersGitNavSentinel: No such file or directory |  | classify and promote if recurring | open |
| 2026-05-30 | unclassified | Bash | Exit code 2 /usr/bin/bash: line 31: =: command not found /usr/bin/bash: line 32: =: command not found /usr/bin/bash: eval: line 33: syntax error near unexpected... |  | classify and promote if recurring | open |
| 2026-05-30 | unclassified | Bash | Exit code 123 |  | classify and promote if recurring | open |
| 2026-05-30 | unclassified | Bash | Exit code 1 /usr/bin/bash: line 1: cd: /mnt/c/Users/jekyt/Desktop/Printer Config/Others/Git/NavSentinel: No such file or directory |  | classify and promote if recurring | open |
| 2026-05-30 | unclassified | Bash | Exit code 1 /usr/bin/bash: line 1: cd: C:UsersjekytDesktopPrinterConfigOthersGitNavSentinel: No such file or directory |  | classify and promote if recurring | open |

## Classification

- `blocker`: work cannot safely continue.
- `non_blocking_risk`: work can continue, but confidence or coverage is reduced.
- `pre_existing_noise`: unrelated existing failure that should still be visible.
- `invalid_signal`: false alarm, stale check, or non-applicable warning.

## Promotion Rule

A ledger entry should become a guide or skill update only when it is reproducible, project-specific, and likely to recur. Use `GUIDE_UPDATE_PROTOCOL.md`; do not mutate root instructions after a single ambiguous failure.
