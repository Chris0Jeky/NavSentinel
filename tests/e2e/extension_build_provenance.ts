import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

const BUILD_INPUT_PATHS = [
  "extension",
  "scripts",
  "config",
  "package.json",
  "package-lock.json",
  "vite.config.ts",
  "tsconfig.json",
] as const;

function git(repositoryRoot: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }).trim();
}

export function trackedBuildInputs(repositoryRoot: string, repositoryHead: string): string[] {
  return execFileSync(
    "git",
    ["ls-tree", "-r", "--name-only", "-z", repositoryHead, "--", ...BUILD_INPUT_PATHS],
    { cwd: repositoryRoot, encoding: "utf8" },
  ).split("\0").filter(Boolean).map((relativePath) => path.join(repositoryRoot, relativePath));
}

export function hashGitFiles(repositoryRoot: string, files: string[], repositoryHead: string): string {
  const hash = createHash("sha256");
  const relativePaths = files
    .map((file) => path.relative(repositoryRoot, file).replaceAll("\\", "/"))
    .sort();
  for (const relativePath of relativePaths) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(git(repositoryRoot, ["rev-parse", `${repositoryHead}:${relativePath}`]));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function hashCanonicalWorktreeFiles(repositoryRoot: string, files: string[]): string {
  const hash = createHash("sha256");
  const relativePaths = files
    .map((file) => path.relative(repositoryRoot, file).replaceAll("\\", "/"))
    .sort();
  for (const relativePath of relativePaths) {
    const file = path.resolve(repositoryRoot, relativePath);
    const blobId = git(repositoryRoot, [
      "hash-object",
      "--filters",
      `--path=${relativePath}`,
      file,
    ]);
    hash.update(relativePath);
    hash.update("\0");
    hash.update(blobId);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function assertCurrentHeadBuildInputs(
  repositoryRoot: string,
  repositoryHead: string,
): { files: string[]; gitSha256: string; executedSha256: string } {
  const files = trackedBuildInputs(repositoryRoot, repositoryHead);
  const gitSha256 = hashGitFiles(repositoryRoot, files, repositoryHead);
  const executedSha256 = hashCanonicalWorktreeFiles(repositoryRoot, files);
  if (executedSha256 !== gitSha256) {
    throw new Error("Extension build inputs must match the recorded Git head before evidence is collected.");
  }
  return { files, gitSha256, executedSha256 };
}
