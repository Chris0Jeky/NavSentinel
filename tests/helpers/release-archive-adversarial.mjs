import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createDeterministicZip,
  validatePortableArchivePaths,
} from "../../scripts/deterministic-zip.mjs";

const collisionCases = [
  ["assets", "assets/app.js"],
  ["Assets", "assets/app.js"],
  ["Assets/a.js", "assets/b.js"],
];

for (const names of collisionCases) {
  for (const ordered of [names, [...names].reverse()]) {
    test(`rejects extraction-prefix aliases: ${JSON.stringify(ordered)}`, () => {
      assert.throws(
        () => validatePortableArchivePaths(ordered),
        /PACKAGE_PATH_COLLISION/,
      );
    });
  }
}

test("retains shared directories and unrelated same-basename paths", () => {
  assert.doesNotThrow(() => validatePortableArchivePaths([
    "assets/a.js", "assets/nested/b.js", "assets/nested/c.js", "other/a.js",
  ]));
});

test("a publication failure preserves the previous archive and cleans the temporary file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-archive-failure-"));
  const originalRename = fs.renameSync;
  try {
    const source = path.join(root, "dist");
    const archive = path.join(root, "extension.zip");
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, "manifest.json"), '{"version":"1"}\n');
    createDeterministicZip(source, archive);
    const previousBytes = fs.readFileSync(archive);
    fs.writeFileSync(path.join(source, "manifest.json"), '{"version":"2"}\n');

    // Fault injection only at the final filesystem publication boundary. All
    // collection, validation, ZIP generation and temporary writes are real.
    fs.renameSync = (from, to) => {
      if (to === archive) {
        throw Object.assign(new Error("injected rename refusal"), { code: "EACCES" });
      }
      return originalRename(from, to);
    };
    assert.throws(() => createDeterministicZip(source, archive), /injected rename refusal/);
    assert.equal(fs.existsSync(archive), true, "the last good archive must survive");
    assert.deepEqual(fs.readFileSync(archive), previousBytes);
    assert.deepEqual(fs.readdirSync(root).sort(), ["dist", "extension.zip"]);

    fs.renameSync = originalRename;
    createDeterministicZip(source, archive);
    assert.notDeepEqual(fs.readFileSync(archive), previousBytes);
    assert.deepEqual(fs.readdirSync(root).sort(), ["dist", "extension.zip"]);
  } finally {
    fs.renameSync = originalRename;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Exercise the real package CLI, profile inspector and ZIP writer on inert
// fixtures. Only explicit filesystem faults use the child-process preload.
import { spawnSync } from "node:child_process";
import process from "node:process";
import { createReleaseProfileReceipt, resolveReleaseProfile } from "../../scripts/release-profile.mjs";

const licenseBytes = "GNU GENERAL PUBLIC LICENSE\r\nVersion 3, 29 June 2007\r\nInert fixture terms.\r\n";
const normalizedLicense = licenseBytes.replace(/\r\n?/g, "\n");

function packageFixture(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "ns-license-contract-"));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const root = path.join(parent, "repo");
  const dist = path.join(root, "extension", "dist");
  fs.mkdirSync(dist, { recursive: true });
  fs.mkdirSync(path.join(root, "scripts"));
  fs.mkdirSync(path.join(root, "config"));
  const actualRoot = path.resolve(import.meta.dirname, "../..");
  for (const name of ["package.mjs", "deterministic-zip.mjs", "safe-release-path.mjs",
    "check-release-profile.mjs", "release-profile.mjs", "check-bloom-size.mjs"]) {
    fs.copyFileSync(path.join(actualRoot, "scripts", name), path.join(root, "scripts", name));
  }
  fs.copyFileSync(path.join(actualRoot, "config/release-profiles.json"), path.join(root, "config/release-profiles.json"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fixture", version: "1.0.0" }));
  fs.writeFileSync(path.join(root, "LICENSE"), licenseBytes);
  fs.writeFileSync(path.join(dist, "manifest.json"), JSON.stringify({ manifest_version: 3, name: "Fixture", version: "1.0.0" }));
  fs.writeFileSync(path.join(dist, "navsentinel-profile.json"), JSON.stringify(createReleaseProfileReceipt(resolveReleaseProfile("interaction-only"))));
  const target = path.join(dist, "LICENSE");
  const outside = path.join(parent, "untouched.txt");
  fs.writeFileSync(outside, "unrelated file must survive\n");
  return {
    root, dist, target, outside,
    run(preload = "") {
      const args = [];
      if (preload) {
        const loader = path.join(parent, "fault.cjs");
        fs.writeFileSync(loader, `const fs = require('node:fs');\nconst target = ${JSON.stringify(target)};\nconst outside = ${JSON.stringify(outside)};\n${preload}`);
        args.push("--require", loader);
      }
      const result = spawnSync(process.execPath, [...args, path.join(root, "scripts/package.mjs")], {
        cwd: root, encoding: "utf8", timeout: 5_000,
      });
      assert.equal(result.error, undefined);
      return result;
    },
    assertClean() {
      assert.deepEqual(fs.readdirSync(dist).sort(), ["LICENSE", "manifest.json", "navsentinel-profile.json"]);
    },
  };
}

for (const existing of [false, true]) {
  test(`LICENSE publication writes normalized bytes with existing=${existing}`, (t) => {
    const f = packageFixture(t);
    if (existing) fs.writeFileSync(f.target, "previous terms\n");
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(f.target, "utf8"), normalizedLicense);
    const archive = fs.readFileSync(path.join(f.root, "artifacts/fixture-v1.0.0.zip"));
    assert.equal(archive.includes(normalizedLicense), true);
    f.assertClean();
    assert.equal(f.run().status, 0);
    assert.deepEqual(fs.readFileSync(path.join(f.root, "artifacts/fixture-v1.0.0.zip")), archive);
  });
}

for (const aliasRootLicense of [false, true]) {
  test(`LICENSE publication does not truncate a hard-link target: rootLicense=${aliasRootLicense}`, (t) => {
    const f = packageFixture(t);
    const alias = aliasRootLicense ? path.join(f.root, "LICENSE") : f.outside;
    const before = fs.readFileSync(alias);
    fs.linkSync(alias, f.target);
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(fs.readFileSync(alias), before);
    assert.equal(fs.readFileSync(f.target, "utf8"), normalizedLicense);
    f.assertClean();
  });
}

test("LICENSE rename refusal preserves previous bytes and removes the temporary file", (t) => {
  const f = packageFixture(t);
  fs.writeFileSync(f.target, "previous terms\n");
  const result = f.run(`const rename = fs.renameSync;
fs.renameSync = (from, to) => {
  if (to === target) throw Object.assign(new Error('LICENSE_RENAME_INJECTED'), { code: 'EACCES' });
  return rename(from, to);
};`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /LICENSE_RENAME_INJECTED/);
  assert.equal(fs.readFileSync(f.target, "utf8"), "previous terms\n");
  f.assertClean();
  assert.equal(f.run().status, 0, "a later retry must succeed");
});

test("LICENSE temporary-write refusal preserves previous bytes and cleans up", (t) => {
  const f = packageFixture(t);
  fs.writeFileSync(f.target, "previous terms\n");
  const result = f.run(`const open = fs.openSync, write = fs.writeFileSync;
let descriptor;
fs.openSync = (name, ...args) => {
  const fd = open(name, ...args);
  if (typeof name === 'string' && name.includes('.LICENSE.')) descriptor = fd;
  return fd;
};
fs.writeFileSync = (name, ...args) => {
  if (descriptor !== undefined && name === descriptor) throw new Error('LICENSE_WRITE_INJECTED');
  return write(name, ...args);
};`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /LICENSE_WRITE_INJECTED/);
  assert.equal(fs.readFileSync(f.target, "utf8"), "previous terms\n");
  f.assertClean();
});

for (const dangling of [false, true]) {
  test(`LICENSE refuses a pre-existing symlink, dangling=${dangling}`, (t) => {
    const f = packageFixture(t);
    try { fs.symlinkSync(dangling ? f.outside + ".missing" : f.outside, f.target); }
    catch (error) {
      if (error.code === "EPERM") { t.skip("Host does not permit file symlinks"); return; }
      throw error;
    }
    const before = fs.readFileSync(f.outside);
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /PACKAGE_SYMLINK_REFUSED|PACKAGE_LINKED_PATH_REFUSED/);
    assert.deepEqual(fs.readFileSync(f.outside), before);
    assert.equal(fs.existsSync(f.outside + ".missing"), false);
  });
}

test("LICENSE refuses a directory instead of replacing it", (t) => {
  const f = packageFixture(t);
  fs.mkdirSync(f.target);
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PACKAGE_REGULAR_FILE_REQUIRED/);
  assert.equal(fs.statSync(f.target).isDirectory(), true);
});

test("LICENSE leaf replacement at the final publication boundary cannot truncate the link target", (t) => {
  const f = packageFixture(t);
  // Probe permission once; unsupported symlinks are explicit skips, not passes.
  try { fs.symlinkSync(f.outside, f.target); }
  catch (error) {
    if (error.code === "EPERM") { t.skip("Host does not permit file symlinks"); return; }
    throw error;
  }
  fs.unlinkSync(f.target);
  fs.writeFileSync(f.target, "previous terms\n");
  const before = fs.readFileSync(f.outside);
  const result = f.run(`const write = fs.writeFileSync, rename = fs.renameSync;
function swap() { fs.unlinkSync(target); fs.symlinkSync(outside, target); }
fs.writeFileSync = (name, ...args) => { if (name === target) swap(); return write(name, ...args); };
fs.renameSync = (from, to) => { if (to === target) swap(); return rename(from, to); };`);
  assert.deepEqual(fs.readFileSync(f.outside), before);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.lstatSync(f.target).isSymbolicLink(), false);
  assert.equal(fs.readFileSync(f.target, "utf8"), normalizedLicense);
  f.assertClean();
});
