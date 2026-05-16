# Git Workflow for Agents

This document defines git rules for Claude Code and Codex agents working in this repository. It explains what each dangerous command does in plain language so agents can communicate risks clearly to users who may not be git experts.

## Branch Safety Tiers

The `pre_tool_use.py` hook enforces branch-aware rules:

| Branch | Rebase | Force-push | Hard reset | Clean/Restore | Why |
|---|---|---|---|---|---|
| `main`, `master`, `develop`, `release` | Blocked | Blocked | Blocked | Blocked | Protected branches — history must stay intact |
| Agent worktree branches (`worktree-agent-*`) | User prompt | User prompt | User prompt | User prompt | Disposable — user decides |
| Other feature branches | User prompt | User prompt | User prompt | User prompt | Agent explains, user decides |

"User prompt" means the command is not blocked but goes through the normal Claude Code permission prompt. The agent must explain the risks before attempting the command so the user can make an informed decision.

## Default Workflow

### Updating a branch from main

```bash
# DO THIS:
git merge main

# NOT THIS:
git rebase main    # rewrites history, requires force-push
```

**Why merge?** Merge creates a merge commit that combines both histories. Both your local branch and the remote copy remain compatible — you can push normally. Rebase replays your commits on top of main, changing every commit hash, which makes your local and remote copies incompatible.

### Reconciling local/remote divergence

If your branch and the remote copy have diverged (e.g., after someone amended a commit):

```bash
git merge origin/<branch-name>
```

This creates a merge commit that reconciles both versions. No history is lost.

### After pushing, never amend

```bash
# DO THIS:
git commit -m "Fix the typo"

# NOT THIS:
git commit --amend    # rewrites the last commit, requires force-push
```

## Dangerous Commands Explained

### `git rebase`

**What it does:** Takes your branch's commits and replays them on top of another branch. The result looks like you wrote your code after the latest main, creating clean linear history.

**The trap:** Replaying rewrites every commit hash. Your local branch and the remote copy now have different histories. The only way to sync them is force-push. If force-push is blocked (or fails), you are stuck with diverged branches and no clean escape.

**When it is OK:** On a disposable agent worktree branch that you haven't pushed yet, or where you are willing to force-push. Always explain to the user first.

**Recovery:** If a rebase is in progress and going badly: `git rebase --abort` returns to the state before the rebase started. No data loss.

### `git push --force` and `--force-with-lease`

**What they do:** Overwrite the remote branch's history with your local history.

- `--force`: Unconditional overwrite. If anyone else pushed commits, they are gone.
- `--force-with-lease`: Checks that the remote hasn't changed since your last fetch. Safer, but still rewrites history.

**Bare `--force` and `-f` are always blocked.** `--force-with-lease` is allowed on non-protected branches with user permission.

**Risk:** If an agent makes a mistake (bad conflict resolution, dropped commit) and then force-pushes, the broken version becomes the source of truth. The original commits are only recoverable via `git reflog` on machines that had the old history, and only for ~30 days.

### `git reset --hard`

**What it does:** Moves the branch pointer to a specific commit and permanently discards all uncommitted changes — both staged and unstaged. Every modified file snaps back to the target commit's state.

**What is lost:** Any uncommitted edits are gone forever. Committed work can be recovered via `git reflog` but uncommitted changes cannot.

**When it is OK:** On a disposable agent branch where there is no uncommitted user work at risk.

### `git reset --soft` / `--mixed`

**What they do:** Move the branch pointer backward (rewriting commit history) but keep your file changes:
- `--soft`: keeps changes staged
- `--mixed`: keeps changes in working directory (unstaged)

**Risk:** The "removed" commits still exist in `git reflog` for ~30 days. But if those commits were already pushed, your local and remote branches diverge — requiring force-push to sync.

### `git clean -f`

**What it does:** Deletes untracked files from the working directory. These are files that git doesn't know about — if they contain work that was never committed, they are gone permanently.

### `git checkout -- .` and `git restore`

**What they do:** Replace your uncommitted file changes with the version from the last commit. Permanent — the uncommitted edits are gone.

## Explain-Before-Acting Protocol

Before running any command from the "Dangerous Commands" section, agents must:

1. **Name the command and explain what it does** — assume the user may not know git well.
2. **State what data is at risk** — uncommitted changes? Commit history? Remote state?
3. **State whether the action is reversible** and how (reflog? stash? no recovery?).
4. **Recommend the safest alternative** if one exists.
5. **Wait for the permission prompt** — the user decides.

### Example of good communication

> "I need to force-push this branch because I rebased it to fix a merge conflict.
>
> **What this does:** Overwrites the remote copy of this branch with my local version.
>
> **Risk:** If anything went wrong during the rebase (like a bad conflict resolution), the broken version becomes the source of truth on the remote. Since this is an agent worktree branch that only I am working on, the risk of losing someone else's work is very low.
>
> **Recovery:** If something goes wrong, the old commits are recoverable via `git reflog` for about 30 days.
>
> **Alternative:** I could have used `git merge main` instead of rebase, which would not have required force-push at all.
>
> OK to proceed?"

## Recovery Procedures

### Stuck after a rebase (diverged from remote)

**Symptoms:** `git status` says "Your branch and 'origin/...' have diverged."

**Options (safest first):**
1. `git rebase --abort` — if the rebase is still in progress, this undoes it completely. No data loss.
2. `git merge origin/<branch>` — reconciles the two versions by creating a merge commit. No data loss but creates a messy merge commit.
3. `git push --force-with-lease` — overwrites the remote with your local version. Only on non-protected branches, with user permission.
4. Ask the user to help.

### Conflicted merge you cannot resolve

**Symptoms:** Merge conflict markers in files, `git status` shows "Unmerged paths."

**Options:**
1. `git merge --abort` — undoes the merge, returns to the state before. No data loss.
2. Resolve the conflicts manually, then `git add` the resolved files and `git commit`.
3. Ask the user to help with the conflict.

### Detached HEAD

**Symptoms:** `git branch --show-current` returns empty. `git status` says "HEAD detached at ..."

**What happened:** Usually caused by checking out a specific commit or a failed rebase.

**Recovery:** `git checkout <branch-name>` to reattach to a branch. If you have uncommitted work, `git stash` first.

### Unknown or messy state

**Stop.** Run `git status` and `git log --oneline -10`. Report both outputs to the user. Explain what you see and ask for guidance. Do not attempt to fix an unknown state by discarding work.
