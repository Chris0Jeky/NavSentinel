import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(process.cwd());
const bootstrapPath = path.join(
  repositoryRoot,
  "scripts",
  "launch-state-authority-campaign.ps1",
);
const temporaryRoots: string[] = [];
const powershellAvailable = process.platform === "win32"
  && spawnSync(
    "pwsh",
    ["-NoLogo", "-NoProfile", "-Command", "exit 0"],
    { encoding: "utf8" },
  ).status === 0;

afterEach(() => {
  for (const root of temporaryRoots.splice(0).reverse()) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("Windows state-authority bootstrap boundary", () => {
  it.skipIf(!powershellAvailable)(
    "removes a mixed-case Node preload before Node starts",
    () => {
      const root = fs.mkdtempSync(
        path.join(os.tmpdir(), "navsentinel-windows-bootstrap-"),
      );
      temporaryRoots.push(root);
      const shimDirectory = path.join(root, "bin");
      fs.mkdirSync(shimDirectory);
      const receiptPath = path.join(root, "node-receipt.txt");
      const shimPath = path.join(shimDirectory, "node.cmd");
      fs.writeFileSync(
        shimPath,
        [
          "@echo off",
          `> "%NS_TEST_NODE_RECEIPT%" echo %*`,
          `if defined NODE_OPTIONS >> "%NS_TEST_NODE_RECEIPT%" echo NODE_OPTIONS_PRESENT`,
          `if defined NODE_PATH >> "%NS_TEST_NODE_RECEIPT%" echo NODE_PATH_PRESENT`,
          `if defined EXTENSION_PATH >> "%NS_TEST_NODE_RECEIPT%" echo EXTENSION_PATH_PRESENT`,
          `if defined GIT_DIR >> "%NS_TEST_NODE_RECEIPT%" echo GIT_DIR_PRESENT`,
          `if defined NAVSENTINEL_STATE_AUTHORITY_KEY >> "%NS_TEST_NODE_RECEIPT%" echo AUTHORITY_PRESENT`,
          "exit /b 0",
          "",
        ].join("\r\n"),
        "utf8",
      );

      const inheritedPathKey = Object.keys(process.env).find(
        (key) => key.toUpperCase() === "PATH",
      );
      const inheritedPath = inheritedPathKey
        ? process.env[inheritedPathKey] ?? ""
        : "";
      const environment = { ...process.env };
      for (const key of Object.keys(environment)) {
        if (key.toUpperCase() === "PATH") delete environment[key];
      }
      Object.assign(environment, {
        PATH: `${shimDirectory};${inheritedPath}`,
        NS_TEST_NODE_RECEIPT: receiptPath,
        NoDe_OpTiOnS: "--require=caller-preload.cjs",
        node_path: "caller-modules",
        Extension_Path: "caller-extension",
        Git_Dir: "caller-git-dir",
        nAvSeNtInEl_StAtE_aUtHoRiTy_KeY: "caller-key",
      });
      const result = spawnSync(
        "pwsh",
        [
          "-NoLogo",
          "-NoProfile",
          "-File",
          bootstrapPath,
          "-PreflightOnly",
        ],
        {
          cwd: repositoryRoot,
          env: environment,
          encoding: "utf8",
          timeout: 30_000,
          maxBuffer: 128 * 1024 * 1024,
        },
      );

      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      const receipt = fs.readFileSync(receiptPath, "utf8");
      expect(receipt).toContain("--preflight-only");
      expect(receipt).not.toMatch(
        /(?:NODE_OPTIONS|NODE_PATH|EXTENSION_PATH|GIT_DIR|AUTHORITY)_PRESENT/u,
      );
    },
  );
});
