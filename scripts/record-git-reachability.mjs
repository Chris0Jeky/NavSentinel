#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const phaseIndex = args.indexOf("--phase");
const phase = phaseIndex >= 0 ? args[phaseIndex + 1] : undefined;

if (!phase || !/^[a-z0-9-]+$/u.test(phase)) {
  throw new Error("Usage: node scripts/record-git-reachability.mjs --phase <safe-label>");
}

const knownAncestors = [
  "d132eace0d2b7e905d5d6eb5ad4c831236f925b2",
  "d1895b51763a6c6b7b5280f0ea80664d2f0c796d",
  "003905094982b9a772cc5f06fe504d372c99dd6b",
  "c8b1a70bef3c92600fdf7af3fb9fdc5e73b236f2",
  "595903af89ff3bfb526e71de68f71f8c9459e6d1",
  "d91d11f546a925cfc45f721856e1c8b0378ff23d",
  "c78ba99da5d3357833a5fcd3f4f09bdb255db7a6",
  "d4b1acf5843605f519ffe1732050a2c1bb501ee1",
];

const safeGitEnvironment = [
  "GIT_DIR",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_REPLACE_REF_BASE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "GIT_CONFIG_COUNT",
  "GIT_CEILING_DIRECTORIES",
  "GIT_DISCOVERY_ACROSS_FILESYSTEM",
];

function command(commandArgs) {
  const result = spawnSync("git", commandArgs, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 8 * 1024 * 1024,
  });
  return {
    args: commandArgs,
    status: result.status,
    signal: result.signal,
    error: result.error?.message ?? null,
    stdout: (result.stdout ?? "").trimEnd(),
    stderr: (result.stderr ?? "").trimEnd(),
  };
}

function appendCommand(lines, label, commandArgs) {
  const result = command(commandArgs);
  lines.push(`[command ${label}]`);
  lines.push(`git ${commandArgs.join(" ")}`);
  lines.push(`status=${String(result.status)} signal=${String(result.signal)} error=${result.error ?? ""}`);
  lines.push("stdout<<EOF");
  lines.push(result.stdout);
  lines.push("EOF");
  lines.push("stderr<<EOF");
  lines.push(result.stderr);
  lines.push("EOF");
  return result;
}

function firstLine(result) {
  return result.status === 0 ? result.stdout.split(/\r?\n/u)[0] ?? "" : "";
}

function resolveGitPath(raw) {
  if (!raw) return null;
  return path.isAbsolute(raw) ? raw : path.resolve(root, raw);
}

function digestFile(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function appendPathState(lines, label, targetPath, options = {}) {
  lines.push(`[path ${label}]`);
  lines.push(`path=${targetPath}`);
  if (!fs.existsSync(targetPath)) {
    lines.push("exists=false");
    return;
  }

  const stat = fs.statSync(targetPath);
  lines.push("exists=true");
  lines.push(`type=${stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other"}`);
  lines.push(`size=${stat.size}`);
  lines.push(`mtime_ms=${stat.mtimeMs}`);

  if (stat.isFile()) {
    lines.push(`sha256=${digestFile(targetPath)}`);
    if (options.text) {
      const content = fs.readFileSync(targetPath, "utf8").slice(0, 16_384);
      lines.push("content<<EOF");
      lines.push(content.trimEnd());
      lines.push("EOF");
    }
    return;
  }

  if (!stat.isDirectory()) return;
  const entries = fs.readdirSync(targetPath).sort();
  lines.push(`entries=${entries.join(",")}`);
  for (const entry of entries.slice(0, 128)) {
    const entryPath = path.join(targetPath, entry);
    const entryStat = fs.statSync(entryPath);
    const digest = entryStat.isFile() ? digestFile(entryPath) : "";
    lines.push(
      `entry=${entry} type=${entryStat.isDirectory() ? "directory" : entryStat.isFile() ? "file" : "other"} size=${entryStat.size} sha256=${digest}`,
    );
  }
}

const lines = [];
lines.push("navsentinel_git_reachability_v1");
lines.push(`phase=${phase}`);
lines.push(`recorded_at=${new Date().toISOString()}`);
lines.push(`cwd=${root}`);
lines.push(`node=${process.version}`);

for (const key of safeGitEnvironment) {
  lines.push(`env.${key}=${process.env[key] ?? ""}`);
}

const gitDirResult = appendCommand(lines, "git-dir", ["rev-parse", "--git-dir"]);
const commonDirResult = appendCommand(lines, "git-common-dir", ["rev-parse", "--git-common-dir"]);
appendCommand(lines, "version", ["--version"]);
appendCommand(lines, "head", ["rev-parse", "HEAD"]);
appendCommand(lines, "shallow", ["rev-parse", "--is-shallow-repository"]);
appendCommand(lines, "head-parents", ["show", "-s", "--format=%H%n%P%n%T", "HEAD"]);
appendCommand(lines, "recent-log", ["log", "--oneline", "-3", "HEAD"]);
appendCommand(lines, "revision-count", ["rev-list", "--count", "HEAD"]);
appendCommand(lines, "object-format", ["rev-parse", "--show-object-format"]);
appendCommand(lines, "replace-refs", ["for-each-ref", "--format=%(refname) %(objectname)", "refs/replace"]);
appendCommand(lines, "replace-list", ["replace", "-l"]);
appendCommand(lines, "selected-config", [
  "config",
  "--show-origin",
  "--get-regexp",
  "^(core\\.commitGraph|core\\.useReplaceRefs|extensions\\.objectFormat|gc\\.writeCommitGraph|fetch\\.writeCommitGraph|commitGraph\\.)",
]);
appendCommand(lines, "connectivity", ["fsck", "--connectivity-only", "--no-dangling", "HEAD"]);

const gitDir = resolveGitPath(firstLine(gitDirResult));
const commonDir = resolveGitPath(firstLine(commonDirResult));
if (gitDir) {
  appendPathState(lines, "git-dir", gitDir);
  appendPathState(lines, "shallow-file", path.join(gitDir, "shallow"), { text: true });
}
if (commonDir) {
  appendPathState(lines, "common-dir", commonDir);
  appendPathState(lines, "grafts", path.join(commonDir, "info", "grafts"), { text: true });
  appendPathState(lines, "alternates", path.join(commonDir, "objects", "info", "alternates"), { text: true });
  appendPathState(lines, "commit-graph", path.join(commonDir, "objects", "info", "commit-graph"));
  appendPathState(lines, "commit-graphs", path.join(commonDir, "objects", "info", "commit-graphs"));
  appendPathState(lines, "replace-directory", path.join(commonDir, "refs", "replace"), { text: true });
}

appendCommand(lines, "commit-graph-verify", ["commit-graph", "verify"]);

for (const ancestor of knownAncestors) {
  lines.push(`[ancestor ${ancestor}]`);
  appendCommand(lines, `${ancestor}:object`, ["cat-file", "-e", `${ancestor}^{commit}`]);
  appendCommand(lines, `${ancestor}:default`, ["merge-base", "--is-ancestor", ancestor, "HEAD"]);
  appendCommand(lines, `${ancestor}:no-commit-graph`, [
    "-c",
    "core.commitGraph=false",
    "merge-base",
    "--is-ancestor",
    ancestor,
    "HEAD",
  ]);
  appendCommand(lines, `${ancestor}:no-replace`, [
    "--no-replace-objects",
    "merge-base",
    "--is-ancestor",
    ancestor,
    "HEAD",
  ]);
  appendCommand(lines, `${ancestor}:plain-walk`, [
    "--no-replace-objects",
    "-c",
    "core.commitGraph=false",
    "merge-base",
    "--is-ancestor",
    ancestor,
    "HEAD",
  ]);
  appendCommand(lines, `${ancestor}:merge-base`, ["merge-base", ancestor, "HEAD"]);
}

const outputDirectory = path.join(root, "test-results");
fs.mkdirSync(outputDirectory, { recursive: true });
const outputPath = path.join(outputDirectory, `git-reachability-${phase}.txt`);
const output = `${lines.join("\n")}\n`;
fs.writeFileSync(outputPath, output, "utf8");
process.stdout.write(output);
console.log(`[git-reachability] wrote ${path.relative(root, outputPath)}`);
