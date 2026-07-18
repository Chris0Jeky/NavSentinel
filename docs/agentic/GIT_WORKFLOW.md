# Git Workflow for Agents

This document explains NavSentinel's Git safety rules for Claude Code and
Codex agents, including the plain-language explanation required before risky
Git operations.

## Branch Safety Tiers

The canonical deny floor is the global dispatcher `~/.claude/hooks/dispatch.py`.
Claude receives it globally; Codex's sole project `PreToolUse` adapter in
`.codex/hooks.json` pins the same dispatcher with `--runtime codex` after the
project and exact hook definitions are trusted. Repo-local `.claude/hooks/*`
files are exact CI/audit fixtures, not a second active hook. It blocks only
irreversible operations: force-push patterns, `rm -rf` outside the project,
pipe-to-shell, `sudo`, and secret-file mutation. It is a tripwire, not a
complete safety boundary.

At NavSentinel's T2 tier, `reset --hard`, `rebase`, and `checkout -- .` are
recoverable from origin and may be technically permitted. They still require
the explain-before-acting protocol below. Never force-push `main`, `master`,
`develop`, or `release`; AI-17 tracks the missing server-side branch-protection
wall.

## Default Workflow

### Updating a branch from main

```bash
git merge main
```

Do not rebase a shared branch. A merge creates a reconciliation commit while
preserving both histories and avoids a force-push.

### Reconciling local/remote divergence

```bash
git merge origin/<branch-name>
```

This creates a merge commit that reconciles both versions without losing
history.

### After pushing, never amend

```bash
git commit -m "Fix the typo"
```

Create a new commit instead of `git commit --amend`; amending rewrites the
pushed commit and normally requires a force-push.

## Dangerous Commands Explained

### `git rebase`

**What it does:** Replays commits onto another base, changing their hashes.

**Risk:** A pushed branch then diverges from its remote and normally needs a
history rewrite to synchronize.

**When it is acceptable:** Only after the user approves a clear explanation of
the rewrite and its recovery path. Prefer merging `main`.

**Recovery:** `git rebase --abort` returns an in-progress rebase to its starting
state without data loss.

### `git push --force` and `--force-with-lease`

**What they do:** Replace remote history with local history. The `--with-lease`
variant checks the remote ref first, but it still rewrites history.

**Risk:** A bad resolution or dropped commit can become the remote source of
truth. Do not rely on the local deny floor as the complete protection.

**Rule:** Treat every force-push as a history rewrite requiring prior user
approval; never use one on a protected branch.

### `git reset --hard`

**What it does:** Moves the branch pointer and discards all staged and
unstaged changes.

**What is lost:** Uncommitted edits can be unrecoverable. Committed work is
usually recoverable through `git reflog`.

### `git reset --soft` / `--mixed`

**What they do:** Move the branch pointer while retaining changes staged or
unstaged, respectively.

**Risk:** If commits were pushed, the local branch diverges from the remote.

### `git clean -f`, `git checkout -- .`, and `git restore`

**What they do:** Delete untracked files or replace uncommitted changes with a
committed version.

**Risk:** Work that was never committed can be permanently lost.

## Explain-Before-Acting Protocol

Before any history-rewriting or work-discarding command, agents must:

1. Name the command and explain it plainly.
2. State what data or remote history is at risk.
3. State whether it is reversible and how.
4. Offer the safest practical alternative.
5. Wait for explicit user approval.

## Recovery Procedures

### Stuck after a rebase

1. `git rebase --abort` if the rebase is still in progress.
2. `git merge origin/<branch>` to reconcile histories without discarding work.
3. Report the state and ask the user before considering any force-push.

### Conflicted merge

1. `git merge --abort` to return to the pre-merge state.
2. Resolve conflicts deliberately, then `git add` and commit.
3. Ask the user when conflict resolution changes product behavior or remains unclear.

### Detached HEAD

Check whether there is uncommitted work. If it is safe, `git checkout
<branch-name>` reattaches HEAD; otherwise explain the state and obtain approval
before a recovery action.

### Unknown or messy state

Stop. Run `git status` and `git log --oneline -10`, report the evidence, and
offer safest-first options. Never discard work merely to get unstuck.
