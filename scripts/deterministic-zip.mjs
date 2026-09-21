import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_VERSION = 20;
const ZIP_VERSION_MADE_BY_UNIX = (3 << 8) | ZIP_VERSION;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORE_METHOD = 0;
const ZIP_FIXED_DOS_TIME = 0;
const ZIP_FIXED_DOS_DATE = 0x21; // 1980-01-01, the earliest representable ZIP date.
const ZIP_MAX_UINT16 = 0xffff;
const ZIP_MAX_UINT32 = 0xffffffff;
const REGULAR_FILE_MODE = (0o100644 << 16) >>> 0;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const UNSAFE_ARCHIVE_CHARACTER = /[\u0000-\u001f\u007f\\:*?"<>|]/u;

const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function utf8Compare(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function portableComponentKey(component) {
  return component.normalize("NFC").replace(/[ .]+$/u, "").toLowerCase();
}

/**
 * Validate archive paths against common ZIP extraction ambiguities.
 *
 * The extension bundle is consumed on case-insensitive Windows/macOS filesystems
 * as well as case-sensitive Linux filesystems. Two names that collapse after
 * Unicode normalization, ASCII case folding, or Windows trailing-dot/space
 * handling must never coexist in one release artifact.
 */
export function validatePortableArchivePaths(archivePaths) {
  const seen = new Map();
  const prefixes = new Map();

  for (const archivePath of archivePaths) {
    if (
      typeof archivePath !== "string" ||
      archivePath.length === 0 ||
      archivePath.startsWith("/") ||
      /^[a-zA-Z]:/u.test(archivePath) ||
      UNSAFE_ARCHIVE_CHARACTER.test(archivePath)
    ) {
      throw new Error(`PACKAGE_PATH_UNSAFE: ${JSON.stringify(archivePath)}`);
    }

    const components = archivePath.split("/");
    if (components.some((component) => component === "" || component === "." || component === "..")) {
      throw new Error(`PACKAGE_PATH_UNSAFE: ${JSON.stringify(archivePath)}`);
    }

    const portableKey = components.map(portableComponentKey).join("/");
    const previous = seen.get(portableKey);
    if (previous !== undefined) {
      throw new Error(`PACKAGE_PATH_COLLISION: ${previous} <> ${archivePath}`);
    }
    seen.set(portableKey, archivePath);

    for (const component of components) {
      if (
        component !== component.normalize("NFC") ||
        component.endsWith(".") ||
        component.endsWith(" ") ||
        WINDOWS_RESERVED_NAME.test(component)
      ) {
        throw new Error(`PACKAGE_PATH_UNSAFE: ${JSON.stringify(archivePath)}`);
      }
    }

    // ZIP omits directory entries, but extraction still creates them. Validate
    // every prefix so a file cannot also be a directory and differently cased
    // directory spellings cannot silently collapse on Windows/macOS.
    for (let index = 0; index < components.length; index += 1) {
      const original = components.slice(0, index + 1).join("/");
      const key = components.slice(0, index + 1).map(portableComponentKey).join("/");
      const directory = index < components.length - 1;
      const previousPrefix = prefixes.get(key);
      if (previousPrefix && (
        previousPrefix.original !== original ||
        !previousPrefix.directory ||
        !directory
      )) {
        throw new Error(`PACKAGE_PATH_COLLISION: ${previousPrefix.original} <> ${original}`);
      }
      prefixes.set(key, { original, directory });
    }

    if (Buffer.byteLength(archivePath, "utf8") > ZIP_MAX_UINT16) {
      throw new Error(`PACKAGE_PATH_TOO_LONG: ${archivePath}`);
    }
  }
}

function readRegularFile(rootRealPath, absolutePath, archivePath) {
  const realPath = fs.realpathSync.native(absolutePath);
  if (!isInside(rootRealPath, realPath)) {
    throw new Error(`PACKAGE_PATH_ESCAPE: ${archivePath}`);
  }

  // O_NOFOLLOW closes the lstat/open race on POSIX. Windows does not implement
  // this flag, so the lstat + realpath + fstat checks remain the bounded fallback.
  const noFollow =
    process.platform !== "win32" && typeof fs.constants.O_NOFOLLOW === "number"
      ? fs.constants.O_NOFOLLOW
      : 0;
  let descriptor;
  try {
    descriptor = fs.openSync(absolutePath, fs.constants.O_RDONLY | noFollow);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : "OPEN_FAILED";
    throw new Error(`PACKAGE_FILE_OPEN_FAILED: ${archivePath} (${code})`);
  }

  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) {
      throw new Error(`PACKAGE_NON_REGULAR_FILE: ${archivePath}`);
    }
    if (stat.size > ZIP_MAX_UINT32) {
      throw new Error(`PACKAGE_FILE_TOO_LARGE: ${archivePath}`);
    }
    const data = fs.readFileSync(descriptor);
    if (data.length !== stat.size) {
      throw new Error(`PACKAGE_FILE_CHANGED_DURING_READ: ${archivePath}`);
    }
    return data;
  } finally {
    fs.closeSync(descriptor);
  }
}

export function collectDeterministicZipEntries(sourceDirectory) {
  const sourcePath = path.resolve(sourceDirectory);
  const rootStat = fs.lstatSync(sourcePath);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error("PACKAGE_SOURCE_NOT_DIRECTORY");
  }
  const rootRealPath = fs.realpathSync.native(sourcePath);
  const discovered = [];

  function walk(currentDirectory, relativeComponents) {
    const names = fs.readdirSync(currentDirectory);
    for (const name of names) {
      const absolutePath = path.join(currentDirectory, name);
      const archivePath = [...relativeComponents, name].join("/");
      const stat = fs.lstatSync(absolutePath);

      if (stat.isSymbolicLink()) {
        throw new Error(`PACKAGE_SYMLINK_REFUSED: ${archivePath}`);
      }
      if (stat.isDirectory()) {
        walk(absolutePath, [...relativeComponents, name]);
        continue;
      }
      if (!stat.isFile()) {
        throw new Error(`PACKAGE_NON_REGULAR_FILE: ${archivePath}`);
      }
      discovered.push({ absolutePath, archivePath });
    }
  }

  walk(sourcePath, []);
  validatePortableArchivePaths(discovered.map((entry) => entry.archivePath));
  discovered.sort((left, right) => utf8Compare(left.archivePath, right.archivePath));

  return discovered.map((entry) => ({
    archivePath: entry.archivePath,
    data: readRegularFile(rootRealPath, entry.absolutePath, entry.archivePath),
  }));
}

function makeLocalHeader(name, data, checksum) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(ZIP_LOCAL_FILE_HEADER, 0);
  header.writeUInt16LE(ZIP_VERSION, 4);
  header.writeUInt16LE(ZIP_UTF8_FLAG, 6);
  header.writeUInt16LE(ZIP_STORE_METHOD, 8);
  header.writeUInt16LE(ZIP_FIXED_DOS_TIME, 10);
  header.writeUInt16LE(ZIP_FIXED_DOS_DATE, 12);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function makeCentralHeader(name, data, checksum, localOffset) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(ZIP_CENTRAL_DIRECTORY_HEADER, 0);
  header.writeUInt16LE(ZIP_VERSION_MADE_BY_UNIX, 4);
  header.writeUInt16LE(ZIP_VERSION, 6);
  header.writeUInt16LE(ZIP_UTF8_FLAG, 8);
  header.writeUInt16LE(ZIP_STORE_METHOD, 10);
  header.writeUInt16LE(ZIP_FIXED_DOS_TIME, 12);
  header.writeUInt16LE(ZIP_FIXED_DOS_DATE, 14);
  header.writeUInt32LE(checksum, 16);
  header.writeUInt32LE(data.length, 20);
  header.writeUInt32LE(data.length, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(REGULAR_FILE_MODE, 38);
  header.writeUInt32LE(localOffset, 42);
  return header;
}

function makeEndOfCentralDirectory(entryCount, centralSize, centralOffset) {
  const footer = Buffer.alloc(22);
  footer.writeUInt32LE(ZIP_END_OF_CENTRAL_DIRECTORY, 0);
  footer.writeUInt16LE(0, 4);
  footer.writeUInt16LE(0, 6);
  footer.writeUInt16LE(entryCount, 8);
  footer.writeUInt16LE(entryCount, 10);
  footer.writeUInt32LE(centralSize, 12);
  footer.writeUInt32LE(centralOffset, 16);
  footer.writeUInt16LE(0, 20);
  return footer;
}

/**
 * Write a deterministic, uncompressed ZIP using only Node built-ins.
 *
 * Storing bytes instead of delegating compression to platform tools keeps the
 * output independent from source mtimes, filesystem enumeration order, shell
 * availability, and platform-specific ZIP metadata.
 */
export function createDeterministicZip(sourceDirectory, archiveFile) {
  const sourcePath = path.resolve(sourceDirectory);
  const archivePath = path.resolve(archiveFile);
  const archiveParent = path.dirname(archivePath);
  fs.mkdirSync(archiveParent, { recursive: true });

  const sourceRealPath = fs.realpathSync.native(sourcePath);
  const archiveParentRealPath = fs.realpathSync.native(archiveParent);
  const archiveRealCandidate = path.join(archiveParentRealPath, path.basename(archivePath));
  if (isInside(sourceRealPath, archiveRealCandidate)) {
    throw new Error("PACKAGE_ARCHIVE_INSIDE_SOURCE");
  }

  const entries = collectDeterministicZipEntries(sourcePath);
  if (entries.length > ZIP_MAX_UINT16) {
    throw new Error(`PACKAGE_TOO_MANY_FILES: ${entries.length}`);
  }

  const localChunks = [];
  const centralChunks = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.archivePath, "utf8");
    const checksum = crc32(entry.data);
    const localHeader = makeLocalHeader(name, entry.data, checksum);
    const centralHeader = makeCentralHeader(name, entry.data, checksum, localOffset);

    localChunks.push(localHeader, name, entry.data);
    centralChunks.push(centralHeader, name);
    localOffset += localHeader.length + name.length + entry.data.length;
    if (localOffset > ZIP_MAX_UINT32) {
      throw new Error("PACKAGE_ARCHIVE_TOO_LARGE");
    }
  }

  const centralDirectory = Buffer.concat(centralChunks);
  if (centralDirectory.length > ZIP_MAX_UINT32 || localOffset + centralDirectory.length > ZIP_MAX_UINT32) {
    throw new Error("PACKAGE_ARCHIVE_TOO_LARGE");
  }
  const footer = makeEndOfCentralDirectory(entries.length, centralDirectory.length, localOffset);
  const archive = Buffer.concat([...localChunks, centralDirectory, footer]);

  const temporaryPath = path.join(
    archiveParent,
    `.${path.basename(archivePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(temporaryPath, archive, { flag: "wx", mode: 0o600 });
    // Rename replaces an existing regular file without deleting it first.
    // A refused publication must leave the last good archive untouched.
    fs.renameSync(temporaryPath, archivePath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }

  return {
    archivePath,
    byteLength: archive.length,
    entries: entries.map((entry) => entry.archivePath),
  };
}
