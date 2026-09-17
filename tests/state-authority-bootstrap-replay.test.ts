import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { afterEach, describe, it } from "vitest";

const bootstrap = path.resolve("scripts/launch-state-authority-campaign.mjs");
const roots: string[] = [];

function fixture(format: "sha1" | "sha256") {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "nav bootstrap replay ")),
  );
  roots.push(root);
  const home = path.join(root, "home");
  const repository = path.join(root, "repository with spaces");
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(repository, "scripts"), { recursive: true });
  const environment: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(GIT_|NODE_OPTIONS$|NODE_PATH$)/iu.test(key)),
  );
  Object.assign(environment, { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home });
  const launcher = path.join(repository, "scripts/run-state-authority-campaign.mjs");
  fs.writeFileSync(launcher, `console.log(JSON.stringify({
    marker: "committed-launcher-ran", file: process.argv[1], args: process.argv.slice(2),
    oid: process.env.NAVSENTINEL_EXPECTED_LAUNCHER_OID
  })); process.exitCode = 23;\n`);
    fs.writeFileSync(
      path.join(repository, "scripts/sensitive-environment.mjs"),
      "export function stripSensitiveEnvironment(source = process.env) { return { ...source }; }\n",
    );
  const git = (args: string[]) => execFileSync("git", args, {
    cwd: repository, env: environment, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
  git(["init", `--object-format=${format}`, "--initial-branch=main"]);
  git(["add", "."]);
  git(["-c", "user.name=Bootstrap Fixture", "-c", "user.email=fixture@example.invalid",
    "-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
  const oid = git(["rev-parse", "HEAD:scripts/run-state-authority-campaign.mjs"]);
  const run = () => spawnSync(process.execPath, [bootstrap, "--preflight-only"], {
    cwd: repository, env: environment, encoding: "utf8", timeout: 20_000,
  });
  return { repository, launcher, oid, run };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

for (const format of ["sha1", "sha256"] as const) {
  describe(`committed bootstrap replay (${format})`, () => {
    it("runs the committed bytes, forwards arguments/status, and removes the extracted launcher", () => {
      const { repository, launcher, oid, run } = fixture(format);
      fs.writeFileSync(launcher, "console.log('dirty-working-tree-ran'); process.exitCode = 91;\n");
      const result = run();
      assert.ifError(result.error);
      assert.equal(result.status, 23, result.stderr);
      const receipt = JSON.parse(result.stdout.trim());
      assert.equal(receipt.marker, "committed-launcher-ran");
      assert.equal(receipt.oid, oid);
      assert.deepEqual(receipt.args, ["--repository", repository, "--preflight-only"]);
      assert.notEqual(receipt.file, launcher);
      assert.equal(fs.existsSync(receipt.file), false, "The temporary launcher must be cleaned up");
    });

    it("rejects a substituted loose object after proving the same repository can execute", () => {
      const { repository, oid, run } = fixture(format);
      const control = run();
      assert.ifError(control.error);
      assert.equal(control.status, 23, control.stderr);
      assert.equal(JSON.parse(control.stdout.trim()).marker, "committed-launcher-ran");
      const replacement = Buffer.from("console.log('substituted-object-ran'); process.exitCode = 91;\n");
      const object = path.join(repository, ".git/objects", oid.slice(0, 2), oid.slice(2));
      fs.chmodSync(object, 0o600);
      fs.writeFileSync(object, deflateSync(Buffer.concat([
        Buffer.from(`blob ${replacement.length}\0`, "utf8"), replacement,
      ])));
      const result = run();
      assert.ifError(result.error);
      assert.notEqual(result.status, 0);
      assert.notEqual(result.status, 23);
      assert.notEqual(result.status, 91);
      assert.doesNotMatch(result.stdout, /committed-launcher-ran|substituted-object-ran/u);
      assert.match(result.stderr, /corrupt|mismatch/iu);
    });
  });
}
