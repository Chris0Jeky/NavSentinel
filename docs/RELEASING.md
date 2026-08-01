# Releasing

## Preconditions

- Node `^20.19.0 || ^22.13.0 || >=24`
- Clean working tree on the `main` branch
- `package.json`, `extension/manifest.json`, and `package-lock.json` versions aligned
- Unreleased entries present in `CHANGELOG.md`
- `npm run build` emits an `interaction-only` release receipt and
  `npm run check:release-profile -- --release` passes

## Automated Release Flow

Releases are driven by `npm run release`, which bumps versions, updates the
changelog, commits, and tags in one step.

### 1. Run the release script

```bash
# Preview what would happen (no changes made):
npm run release:dry -- patch

# Perform the release:
npm run release -- patch   # or minor / major
```

The script selects the committed default profile and refuses any profile marked
non-release. It then:
1. Validates a clean working tree on `main`.
2. Checks that no tag already exists for the computed version.
3. Bumps the version in `package.json`, `extension/manifest.json`, and
   `package-lock.json`.
4. Moves the `## [Unreleased]` section in `CHANGELOG.md` under a new versioned
   heading.
5. Commits: `Release v<version>`.
6. Creates an annotated tag: `v<version>`.

### 2. Push

```bash
git push origin main --tags
```

### 3. CI creates the GitHub Release

When a `v*` tag lands on `main`, CI:
1. Runs the full build / unit / E2E pipeline.
2. Verifies the tag commit is an ancestor of `main`.
3. Verifies the deterministic `interaction-only` receipt, absence of the
   reputation asset/loader, and release eligibility.
4. Packages the extension zip.
5. Creates a GitHub Release with auto-generated release notes and the zip
   artifact attached.

## Convenience npm scripts

| Script               | Description                              |
| -------------------- | ---------------------------------------- |
| `npm run release`    | Interactive release (requires bump type) |
| `npm run release:dry`| Dry-run preview                          |
| `npm run release:patch` | Shortcut for patch bump               |
| `npm run release:minor` | Shortcut for minor bump               |
| `npm run release:major` | Shortcut for major bump               |

## Version Verification

```bash
npm run verify:versions
```

Checks that `package.json`, `extension/manifest.json`, and `package-lock.json`
all report the same version string.

## Packaging (manual)

```bash
npm run package:ext
```

`package:ext` refuses missing, unknown, or non-release profile receipts. In
particular, an unpacked `npm run build:research-reputation` artifact cannot be
zipped by this command; rebuild with `npm run build` first.

Expected artifact:

```text
artifacts/navsentinel-v<version>.zip
```

## When Not To Release

- E2E failures in Gym-backed tests
- Version mismatch between `package.json`, `extension/manifest.json`, or
  `package-lock.json`
- Unreviewed changes to `main_guard.ts`, `credential_guard.ts`, `storage.ts`,
  or `sw.ts`
- Empty `[Unreleased]` section in `CHANGELOG.md`
- A missing/non-release build receipt or any reputation asset in the selected
  interaction-only package
