# Git Workflow and Recovery

This is recovery guidance, not an enforcement layer. Owner decision #499
removed NavSentinel's repository-local command harness, tier, and hooks. Shared
runtime settings outside the repository may still apply, but this project does
not verify or depend on them.

Chris explicitly accepts `main` without branch protection (AI-17, 2026-08-01);
do not flag or re-open that posture. Independently, do not force-push `main`,
`master`, `develop`, or `release`. Prefer additive commits and merge commits.
Before discarding uncommitted work or rewriting shared history, explain the
affected data and recovery path and obtain explicit approval.

## Default Workflow

### Updating a branch from main

```bash
git merge main
```

Do not rebase a shared branch. A merge creates a reconciliation commit while
preserving both histories and avoids a force-push.

### Stacked branches and CI

When slice B depends on unmerged slice A, branch B off A and target B's pull
request at A's branch. Merge the stack **oldest-first** — merging the newest first
strands its parents.

CI runs on stacked pull requests. That was not always true: `ci.yml`'s
`pull_request` trigger used to be filtered to `branches: [main]`, and that filter
matches the **base** branch, so a stacked pull request ran no CI at all. It did not
show as red or pending — `gh pr checks` said "no checks reported on the branch"
while `mergeStateStatus` still said `CLEAN`, so the pull request looked mergeable
while being entirely unverified. It hid a genuinely broken build in PR #535. The
filter is now `branches: ["**"]` (issue #537); do not re-add one.

#### Deleting a base branch — the two cases are opposite

- **Deleting an unmerged branch that other pull requests are based on closes
  those pull requests.** Do not do this.
- **Deleting the head branch as part of merging it is different**: GitHub then
  automatically retargets any open pull request that was based on it onto the
  merged pull request's own base. That is the *desired* outcome for a stack.

So "never delete a base branch" is wrong as a blanket rule, and following it
literally causes a worse bug: leave A's branch alive after merging A, and B still
targets A, so merging B updates **A** rather than `main` and the slice silently
never reaches the release branch.

The rule that is actually safe: **after A lands, make sure B targets `main`
before merging B, and confirm it rather than assume it.**

```bash
gh pr view <B> --json baseRefName -q '.baseRefName'   # must be main
```

Either let GitHub do it (delete A's head branch when merging A) or retarget
explicitly (`gh pr edit <B> --base main`). Confirm with the command above either
way.

#### Re-proving a retargeted child — retargeting alone runs nothing

Retargeting fires a `pull_request` **`edited`** activity. A `pull_request`
workflow that declares no `types` runs only on `opened`, `synchronize` and
`reopened`, so a retarget produces **no new run**: the child keeps the checks
attached to its pre-retarget merge ref, against the old base. The widened branch
filter does not help here.

The child's head SHA does not change on a retarget either, so nothing about the
check list looks stale. To get a real run against the new base, change the head:

```bash
git switch <B> && git merge main && git push    # -> synchronize -> real run
```

That is preferable to closing and reopening the pull request, because it also
makes the tree you test the tree you merge.

#### `workflow_dispatch` is weaker evidence than a pull-request run

A dispatch is the escape hatch when a pull-request run is unavailable, but know
what it does and does not prove:

- It attaches to the **branch, not the pull request**, so the pull request page
  and `gh pr checks` keep reporting no checks even once a green run exists.
- It builds the branch **tip**, whereas a `pull_request` run builds the synthetic
  base-plus-head **merge commit**. If the base has moved since the child was cut,
  a green dispatch can bless a tree that omits newer base changes.

So merge the current base into the child *before* dispatching, and read the run's
SHA explicitly — the default `gh run list` table does not show it:

```bash
gh run list --branch <branch> --limit 1 --json headSha,status,conclusion \
  -q '.[] | "\(.headSha) \(.status)/\(.conclusion)"'
gh pr view <B> --json headRefOid -q '.headRefOid'     # the two must match
```

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
truth. Do not rely on any runtime deny floor as complete protection.

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
