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
      const markerPath = path.join(root, "preload-ran.txt");
      const preloadPath = path.join(root, "caller-preload.cjs");
      fs.writeFileSync(
        preloadPath,
        `require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, "ran");\n`,
        "utf8",
      );

      const environment = {
        ...process.env,
        NoDe_OpTiOnS: `--require=${preloadPath}`,
        nAvSeNtInEl_StAtE_aUtHoRiTy_KeY: "caller-key",
      };
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
      expect(result.stdout).toContain("non-consumable-preflight-summary");
      expect(fs.existsSync(markerPath)).toBe(false);
    },
  );
});
