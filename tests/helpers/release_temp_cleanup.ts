import fs from "node:fs";

export interface ReleaseTempRemoveOptions {
  recursive: true;
  force: true;
  maxRetries: number;
  retryDelay: number;
}

export type RemoveReleaseTempTree = (
  root: string,
  options: ReleaseTempRemoveOptions,
) => void;

const RELEASE_TEMP_REMOVE_OPTIONS: ReleaseTempRemoveOptions = {
  recursive: true,
  force: true,
  maxRetries: 10,
  retryDelay: 100,
};

export function removeReleaseTempRoot(
  root: string,
  remove: RemoveReleaseTempTree = fs.rmSync as RemoveReleaseTempTree,
): void {
  remove(root, RELEASE_TEMP_REMOVE_OPTIONS);
}
