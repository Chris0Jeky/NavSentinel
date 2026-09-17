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
  maxRetries: 5,
  retryDelay: 50,
};

const RETRYABLE_REMOVE_CODES = new Set(["EBUSY", "EMFILE", "ENFILE", "ENOTEMPTY", "EPERM"]);
const RETRY_SLEEP = new Int32Array(new SharedArrayBuffer(4));

function waitForRetry(delay: number): void {
  if (delay > 0) Atomics.wait(RETRY_SLEEP, 0, 0, delay);
}

export function removeReleaseTempRoot(
  root: string,
  remove: RemoveReleaseTempTree = fs.rmSync as RemoveReleaseTempTree,
): void {
  for (let retry = 0; ; retry += 1) {
    try {
      remove(root, RELEASE_TEMP_REMOVE_OPTIONS);
      return;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
      if (retry >= RELEASE_TEMP_REMOVE_OPTIONS.maxRetries || !RETRYABLE_REMOVE_CODES.has(String(code))) {
        throw error;
      }
      waitForRetry(RELEASE_TEMP_REMOVE_OPTIONS.retryDelay * (retry + 1));
    }
  }
}
