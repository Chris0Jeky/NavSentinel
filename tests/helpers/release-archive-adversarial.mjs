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
