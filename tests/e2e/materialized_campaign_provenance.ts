import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ZERO = Buffer.from([0]);

function integrityError(code: string, message: string): Error {
  const error = new Error(
    `State-authority materialization TEST_INVALID [${code}]: ${message}`,
  );
  error.name = "StateAuthorityMaterializationIntegrityError";
  return error;
}

function assertCanonicalRelativePath(relativePath: string): void {
  if (
    !relativePath
    || relativePath.startsWith("/")
    || relativePath.includes("\\")
    || path.posix.normalize(relativePath) !== relativePath
    || relativePath
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw integrityError(
      "NON_CANONICAL_PATH",
      `unsupported campaign path '${relativePath}'`,
    );
  }
}

function sameNativePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function assertContainedDirectPath(
  root: string,
  absolutePath: string,
  relativePath: string,
): void {
  let realPath: string;
  try {
    realPath = fs.realpathSync.native(absolutePath);
  } catch (error) {
    throw integrityError(
      "MISSING_MATERIALIZED_INPUT",
      `cannot resolve '${relativePath}': ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const relative = path.relative(root, realPath);
  if (
    relative === ".."
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
    || !sameNativePath(realPath, absolutePath)
  ) {
    throw integrityError(
      "MATERIALIZED_PATH_ESCAPE",
      `campaign input '${relativePath}' is linked or escapes its root`,
    );
  }
}

function assertOrdinaryRoot(root: string): string {
  const requested = path.resolve(root);
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(requested);
  } catch (error) {
    throw integrityError(
      "MATERIALIZED_ROOT",
      `campaign root is unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw integrityError(
      "MATERIALIZED_ROOT",
      "campaign root is linked or not an ordinary directory",
    );
  }
  const real = fs.realpathSync.native(requested);
  if (!sameNativePath(requested, real)) {
    throw integrityError(
      "MATERIALIZED_ROOT",
      "campaign root resolves through a link",
    );
  }
  return real;
}

function readMaterializedFile(
  root: string,
  relativePath: string,
): Buffer {
  assertCanonicalRelativePath(relativePath);
  const segments = relativePath.split("/");
  let current = root;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(current);
    } catch {
      throw integrityError(
        "MISSING_MATERIALIZED_INPUT",
        `campaign input '${relativePath}' is missing`,
      );
    }
    if (stats.isSymbolicLink()) {
      throw integrityError(
        "MATERIALIZED_SPECIAL_INPUT",
        `campaign input '${relativePath}' traverses a link`,
      );
    }
    if (index < segments.length - 1) {
      if (!stats.isDirectory()) {
        throw integrityError(
          "MATERIALIZED_SPECIAL_INPUT",
          `campaign input '${relativePath}' has a non-directory ancestor`,
        );
      }
      continue;
    }
    if (!stats.isFile()) {
      throw integrityError(
        "MATERIALIZED_SPECIAL_INPUT",
        `campaign input '${relativePath}' is not a regular file`,
      );
    }
    assertContainedDirectPath(root, current, relativePath);
    return fs.readFileSync(current);
  }
  throw integrityError(
    "MISSING_MATERIALIZED_INPUT",
    `campaign input '${relativePath}' is missing`,
  );
}

/**
 * Hash the exact private campaign tree executed by Playwright.
 *
 * The launcher writes every declared file from an authenticated Git blob before
 * Playwright loads its config or spec graph. This independent path/length/byte
 * framing is re-evaluated by the campaign before build, after build and at
 * receipt time, so a worktree hash cannot stand in for the bytes actually run.
 */
export function hashMaterializedCampaign(
  campaignRoot: string,
  campaignFiles: readonly string[],
): string {
  const root = assertOrdinaryRoot(campaignRoot);
  const sorted = [...campaignFiles].sort();
  if (new Set(sorted).size !== sorted.length) {
    throw integrityError(
      "DUPLICATE_MATERIALIZED_INPUT",
      "campaign source closure contains duplicate paths",
    );
  }

  const hash = createHash("sha256");
  for (const relativePath of sorted) {
    const bytes = readMaterializedFile(root, relativePath);
    hash.update(Buffer.from(relativePath, "utf8"));
    hash.update(ZERO);
    const byteLength = Buffer.allocUnsafe(8);
    byteLength.writeBigUInt64BE(BigInt(bytes.length));
    hash.update(byteLength);
    hash.update(bytes);
  }
  return hash.digest("hex");
}
