import fs from "node:fs";
import path from "node:path";

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
}

/**
 * Assert that a release input/output path is both logically and physically
 * contained by the trusted repository root and that no descendant path
 * component is a symbolic link or junction.
 *
 * The repository root itself is the caller's trust anchor and may be reached
 * through an outer workspace symlink. Links below that root are refused so a
 * path such as `extension/dist` cannot silently resolve to unrelated bytes.
 */
export function assertRepositoryPath(
  repositoryRoot,
  candidatePath,
  { expectedType = "any", label = "release path" } = {},
) {
  const logicalRoot = path.resolve(repositoryRoot);
  const logicalCandidate = path.resolve(candidatePath);
  if (!isInside(logicalRoot, logicalCandidate)) {
    throw new Error(`PACKAGE_PATH_OUTSIDE_REPOSITORY: ${label}`);
  }

  const relative = path.relative(logicalRoot, logicalCandidate);
  let current = logicalRoot;
  let finalStat = fs.statSync(logicalRoot);

  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    finalStat = fs.lstatSync(current);
    if (finalStat.isSymbolicLink()) {
      throw new Error(`PACKAGE_LINKED_PATH_REFUSED: ${label} (${current})`);
    }
  }

  const physicalRoot = fs.realpathSync.native(logicalRoot);
  const physicalCandidate = fs.realpathSync.native(logicalCandidate);
  if (!isInside(physicalRoot, physicalCandidate)) {
    throw new Error(`PACKAGE_PATH_ESCAPE: ${label}`);
  }

  if (expectedType === "file" && !finalStat.isFile()) {
    throw new Error(`PACKAGE_REGULAR_FILE_REQUIRED: ${label}`);
  }
  if (expectedType === "directory" && !finalStat.isDirectory()) {
    throw new Error(`PACKAGE_DIRECTORY_REQUIRED: ${label}`);
  }
  if (
    expectedType === "file" &&
    (finalStat.isBlockDevice() ||
      finalStat.isCharacterDevice() ||
      finalStat.isFIFO() ||
      finalStat.isSocket())
  ) {
    throw new Error(`PACKAGE_REGULAR_FILE_REQUIRED: ${label}`);
  }

  return {
    logicalPath: logicalCandidate,
    realPath: physicalCandidate,
    stat: finalStat,
  };
}
