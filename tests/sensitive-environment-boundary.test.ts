import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isSensitiveEnvironmentKey,
  normalizeEnvironmentKey,
  stripSensitiveEnvironment,
} from "../scripts/sensitive-environment.mjs";
import {
  createSanitizedGitEnvironment,
  resolveReleaseCommand,
} from "../scripts/release-input-integrity.mjs";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("normalized sensitive environment classification (#717)", () => {
  it.each([
    "GIT_DIR",
    "git_work_tree",
    "Git_Config_Count",
    "NAVSENTINEL_STATE_AUTHORITY_KEY",
    "navsentinel_state_authority_attestation",
    "NoDe_OpTiOnS",
    "node_path",
    "Extension_Path",
  ])("classifies %s case-insensitively", key => {
    expect(isSensitiveEnvironmentKey(key)).toBe(true);
  });

  it.each(["PATH", "HOME", "NAVSENTINEL_BUILD_PROFILE", "npm_execpath"])(
    "retains nonsensitive key %s",
    key => {
      expect(isSensitiveEnvironmentKey(key)).toBe(false);
    },
  );

  it("normalizes with a locale-independent uppercase key", () => {
    expect(normalizeEnvironmentKey("nOdE_oPtIoNs")).toBe("NODE_OPTIONS");
  });

  it("strips every sensitive spelling while allowing explicit normalized preserves", () => {
    const environment = stripSensitiveEnvironment(
      {
        PATH: "retained-path",
        SAFE_VALUE: "retained",
        git_dir: "attacker-git-dir",
        Git_Author_Name: "Release Author",
        navsentinel_state_authority_key: "attacker-key",
        NoDe_OpTiOnS: "--require=attacker.cjs",
        node_path: "attacker-modules",
        Extension_Path: "attacker-extension",
      },
      { preserveNormalizedKeys: ["GIT_AUTHOR_NAME"] },
    );

    expect(environment).toEqual({
      PATH: "retained-path",
      SAFE_VALUE: "retained",
      Git_Author_Name: "Release Author",
    });
  });
});

describe("release trust-boundary environment and npm execution (#717)", () => {
  it("scrubs Node, authority, extension, and mixed-case Git overrides", () => {
    const environment = createSanitizedGitEnvironment({
      PATH: "retained-path",
      Git_Author_Name: "Release Author",
      git_dir: "attacker-git-dir",
      NAVSENTINEL_STATE_AUTHORITY_KEY: "attacker-key",
      navsentinel_state_authority_attestation: "attacker-attestation",
      NoDe_OpTiOnS: "--require=attacker.cjs",
      node_path: "attacker-modules",
      Extension_Path: "attacker-extension",
      SAFE_VALUE: "retained",
    });

    const normalizedKeys = Object.keys(environment).map(normalizeEnvironmentKey);
    expect(environment).toMatchObject({
      PATH: "retained-path",
      SAFE_VALUE: "retained",
      Git_Author_Name: "Release Author",
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_NO_LAZY_FETCH: "1",
      GIT_OPTIONAL_LOCKS: "0",
      LC_ALL: "C",
      LANG: "C",
    });
    expect(normalizedKeys).not.toContain("GIT_DIR");
    expect(normalizedKeys.some(key => key.startsWith("NAVSENTINEL_STATE_AUTHORITY_"))).toBe(false);
    expect(normalizedKeys).not.toContain("NODE_OPTIONS");
    expect(normalizedKeys).not.toContain("NODE_PATH");
    expect(normalizedKeys).not.toContain("EXTENSION_PATH");
  });

  it("runs npm's JavaScript entry point through Node without a command shell", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-npm-cli-"));
    roots.push(root);
    const npmExecPath = path.join(root, "npm-cli.js");
    fs.writeFileSync(npmExecPath, "process.exitCode = 0;\n");

    expect(resolveReleaseCommand("npm", [
      "install",
      "--package-lock-only",
      "--ignore-scripts",
      "argument with spaces & shell syntax",
    ], {
      nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
      npmExecPath,
    })).toEqual({
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: [
        fs.realpathSync.native(npmExecPath),
        "install",
        "--package-lock-only",
        "--ignore-scripts",
        "argument with spaces & shell syntax",
      ],
    });
  });

  it("rejects npm invocation without an absolute ordinary CLI entry point", () => {
    expect(() => resolveReleaseCommand("npm", ["install"], {
      nodeExecutable: process.execPath,
      npmExecPath: "relative/npm-cli.js",
    })).toThrow(/absolute npm CLI|npm_execpath/u);
  });
});
