#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripSensitiveEnvironment } from "./sensitive-environment.mjs";

const LAUNCHER_REPOSITORY_PATH = "scripts/run-state-authority-campaign.mjs";
const SENSITIVE_ENVIRONMENT_REPOSITORY_PATH = "scripts/sensitive-environment.mjs";

function fail(message) {
  throw new Error(`State-authority bootstrap failed: ${message}`);
}

export function sanitizedBootstrapEnvironment(source = process.env) {
  const environment = stripSensitiveEnvironment(source);
  environment.GIT_NO_REPLACE_OBJECTS = "1";
  environment.GIT_NO_LAZY_FETCH = "1";
  environment.GIT_OPTIONAL_LOCKS = "0";
  return environment;
}

export function gitObjectId(type, content, objectFormat) {
  if (!Buffer.isBuffer(content)) {
    fail("Git object content must be a Buffer");
  }
  if (objectFormat !== "sha1" && objectFormat !== "sha256") {
    fail(`unsupported Git object format '${objectFormat}'`);
  }
  return createHash(objectFormat)
    .update(Buffer.from(`${type} ${content.length}\0`, "utf8"))
    .update(content)
    .digest("hex");
}

function git(args, { cwd, environment, encoding } = {}) {
  return execFileSync("git", args, {
    cwd,
    env: environment,
    encoding,
    maxBuffer: 128 * 1024 * 1024,
  });
}

export function main(args = process.argv.slice(2)) {
  if (args.some((argument) => argument !== "--preflight-only")) {
    fail("only --preflight-only is accepted");
  }
  const environment = sanitizedBootstrapEnvironment(process.env);
  const repositoryRoot = path.resolve(
    git(["rev-parse", "--show-toplevel"], {
      cwd: process.cwd(),
      environment,
      encoding: "utf8",
    }).trim(),
  );
  git(
    [
      "-C",
      repositoryRoot,
      "fsck",
      "--full",
      "--strict",
      "--no-reflogs",
      "--no-progress",
      "HEAD",
    ],
    { environment },
  );
  const objectFormat = git(
    ["-C", repositoryRoot, "rev-parse", "--show-object-format"],
    { environment, encoding: "utf8" },
  ).trim();
  const launcherOid = git(
    ["-C", repositoryRoot, "rev-parse", `HEAD:${LAUNCHER_REPOSITORY_PATH}`],
    { environment, encoding: "utf8" },
  ).trim();
  if (!/^[0-9a-f]{40,64}$/u.test(launcherOid)) {
    fail("committed launcher object ID is malformed");
  }
  const launcherBytes = git(
    ["-C", repositoryRoot, "cat-file", "blob", launcherOid],
    { environment },
  );
  if (gitObjectId("blob", launcherBytes, objectFormat) !== launcherOid) {
    fail("extracted launcher bytes do not match the committed object ID");
  }
  const sensitiveEnvironmentOid = git(
    ["-C", repositoryRoot, "rev-parse", `HEAD:${SENSITIVE_ENVIRONMENT_REPOSITORY_PATH}`],
    { environment, encoding: "utf8" },
  ).trim();
  const sensitiveEnvironmentBytes = git(
    ["-C", repositoryRoot, "cat-file", "blob", sensitiveEnvironmentOid],
    { environment },
  );
  if (gitObjectId("blob", sensitiveEnvironmentBytes, objectFormat) !== sensitiveEnvironmentOid) {
    fail("extracted sensitive-environment bytes do not match the committed object ID");
  }
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "navsentinel-state-authority-bootstrap-"),
  );
  try {
    const launcherPath = path.join(
      temporaryRoot,
      "run-state-authority-campaign.mjs",
    );
    fs.writeFileSync(launcherPath, launcherBytes, { mode: 0o600 });
    fs.writeFileSync(
      path.join(temporaryRoot, "sensitive-environment.mjs"),
      sensitiveEnvironmentBytes,
      { mode: 0o600 },
    );
    environment.NAVSENTINEL_EXPECTED_LAUNCHER_OID = launcherOid;
    const result = spawnSync(
      process.execPath,
      [launcherPath, "--repository", repositoryRoot, ...args],
      {
        cwd: repositoryRoot,
        env: environment,
        stdio: "inherit",
      },
    );
    if (result.error) throw result.error;
    return result.status ?? 1;
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

const modulePath = path.resolve(fileURLToPath(import.meta.url));
const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const directExecution = process.platform === "win32"
  ? modulePath.toLowerCase() === entryPath.toLowerCase()
  : modulePath === entryPath;
if (directExecution) process.exitCode = main();
