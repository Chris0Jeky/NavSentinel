import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error Release helpers are plain ESM and intentionally have no declaration file.
import { assertRepositoryPath } from "../scripts/safe-release-path.mjs";

const temporaryDirectories: string[] = [];

function makeTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "navsentinel-release-path-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe("release path ancestry", () => {
  it("accepts ordinary repository files and directories", () => {
    const repository = makeTemporaryDirectory();
    const directory = path.join(repository, "extension", "dist");
    const file = path.join(directory, "manifest.json");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(file, "{}\n");

    expect(
      assertRepositoryPath(repository, directory, {
        expectedType: "directory",
        label: "Build output",
      }).realPath,
    ).toBe(fs.realpathSync.native(directory));
    expect(
      assertRepositoryPath(repository, file, {
        expectedType: "file",
        label: "Build manifest",
      }).realPath,
    ).toBe(fs.realpathSync.native(file));
  });

  it("rejects an intermediate link even when it resolves within the repository", () => {
    const repository = makeTemporaryDirectory();
    const realExtension = path.join(repository, "real-extension");
    const dist = path.join(realExtension, "dist");
    fs.mkdirSync(dist, { recursive: true });
    const linkedExtension = path.join(repository, "extension");

    try {
      fs.symlinkSync(
        realExtension,
        linkedExtension,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }

    expect(() =>
      assertRepositoryPath(repository, path.join(linkedExtension, "dist"), {
        expectedType: "directory",
        label: "Build output",
      }),
    ).toThrow(/PACKAGE_LINKED_PATH_REFUSED/);
  });

  it("rejects logical paths and resolved targets outside the repository", () => {
    const parent = makeTemporaryDirectory();
    const repository = path.join(parent, "repository");
    const outside = path.join(parent, "outside");
    fs.mkdirSync(repository);
    fs.mkdirSync(outside);

    expect(() =>
      assertRepositoryPath(repository, outside, {
        expectedType: "directory",
        label: "Build output",
      }),
    ).toThrow(/PACKAGE_PATH_OUTSIDE_REPOSITORY/);
  });

  it("enforces the declared regular-file or directory type", () => {
    const repository = makeTemporaryDirectory();
    const directory = path.join(repository, "artifacts");
    const file = path.join(repository, "package.json");
    fs.mkdirSync(directory);
    fs.writeFileSync(file, "{}\n");

    expect(() =>
      assertRepositoryPath(repository, directory, {
        expectedType: "file",
        label: "package.json",
      }),
    ).toThrow(/PACKAGE_REGULAR_FILE_REQUIRED/);
    expect(() =>
      assertRepositoryPath(repository, file, {
        expectedType: "directory",
        label: "Artifacts directory",
      }),
    ).toThrow(/PACKAGE_DIRECTORY_REQUIRED/);
  });
});
