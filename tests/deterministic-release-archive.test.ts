import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error Release helpers are plain ESM and intentionally have no declaration file.
import { createDeterministicZip, validatePortableArchivePaths } from "../scripts/deterministic-zip.mjs";

const temporaryDirectories: string[] = [];

function makeTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-package-"));
  temporaryDirectories.push(directory);
  return directory;
}

function digest(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

interface ParsedEntry {
  name: string;
  data: Buffer;
  method: number;
  dosTime: number;
  dosDate: number;
}

function parseStoredZip(filePath: string): ParsedEntry[] {
  const bytes = fs.readFileSync(filePath);
  const eocdOffset = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(eocdOffset).toBeGreaterThanOrEqual(0);

  const entryCount = bytes.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = bytes.readUInt32LE(eocdOffset + 16);
  const entries: ParsedEntry[] = [];
  let cursor = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    expect(bytes.readUInt32LE(cursor)).toBe(0x02014b50);
    const method = bytes.readUInt16LE(cursor + 10);
    const dosTime = bytes.readUInt16LE(cursor + 12);
    const dosDate = bytes.readUInt16LE(cursor + 14);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");

    expect(bytes.readUInt32LE(localOffset)).toBe(0x04034b50);
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const data = Buffer.from(bytes.subarray(dataOffset, dataOffset + compressedSize));

    entries.push({ name, data, method, dosTime, dosDate });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe("deterministic release archive", () => {
  it("emits identical sorted bytes after source mtimes and creation order change", () => {
    const root = makeTemporaryDirectory();
    const source = path.join(root, "dist");
    fs.mkdirSync(path.join(source, "nested"), { recursive: true });
    fs.writeFileSync(path.join(source, "z.txt"), "last\n");
    fs.writeFileSync(path.join(source, "nested", "a.txt"), "first\n");

    const firstArchive = path.join(root, "first.zip");
    const secondArchive = path.join(root, "second.zip");
    createDeterministicZip(source, firstArchive);

    const changedTime = new Date("2040-12-31T23:59:58.000Z");
    fs.utimesSync(path.join(source, "z.txt"), changedTime, changedTime);
    fs.utimesSync(path.join(source, "nested", "a.txt"), changedTime, changedTime);
    createDeterministicZip(source, secondArchive);

    expect(digest(secondArchive)).toBe(digest(firstArchive));
    const entries = parseStoredZip(secondArchive);
    expect(entries.map((entry) => entry.name)).toEqual(["nested/a.txt", "z.txt"]);
    expect(entries.map((entry) => entry.data.toString("utf8"))).toEqual(["first\n", "last\n"]);
    expect(entries.every((entry) => entry.method === 0)).toBe(true);
    expect(entries.every((entry) => entry.dosTime === 0 && entry.dosDate === 0x21)).toBe(true);
  });

  it("refuses a symlink in the packaged tree instead of following external bytes", () => {
    const root = makeTemporaryDirectory();
    const source = path.join(root, "dist");
    fs.mkdirSync(source);
    const outside = path.join(root, "outside-secret.txt");
    fs.writeFileSync(outside, "must not be packaged");

    try {
      fs.symlinkSync(outside, path.join(source, "linked-secret.txt"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }

    expect(() => createDeterministicZip(source, path.join(root, "artifact.zip"))).toThrow(
      /PACKAGE_SYMLINK_REFUSED/,
    );
  });

  it("rejects archive names that collide on common extraction filesystems", () => {
    expect(() => validatePortableArchivePaths(["assets/App.js", "assets/app.js"])).toThrow(
      /PACKAGE_PATH_COLLISION/,
    );
    expect(() => validatePortableArchivePaths(["assets/app.js", "assets/app.js."])).toThrow(
      /PACKAGE_PATH_COLLISION/,
    );
    expect(() => validatePortableArchivePaths(["safe.js", "dir\\escape.js"])).toThrow(
      /PACKAGE_PATH_UNSAFE/,
    );
  });

  it("refuses to create the archive inside the source tree", () => {
    const root = makeTemporaryDirectory();
    const source = path.join(root, "dist");
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, "manifest.json"), "{}\n");

    expect(() => createDeterministicZip(source, path.join(source, "artifact.zip"))).toThrow(
      /PACKAGE_ARCHIVE_INSIDE_SOURCE/,
    );
  });
});

it("qualifies prefix identity and failure-safe publication in an isolated process", () => {
  const result = spawnSync(
    process.execPath,
    ["--test", path.join(import.meta.dirname, "helpers/release-archive-adversarial.mjs")],
    { encoding: "utf8", timeout: 10_000 },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
});
