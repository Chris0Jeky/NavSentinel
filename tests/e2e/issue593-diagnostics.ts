/**
 * Durable writer for MODELLED issue #593 diagnostics.
 *
 * Playwright clears `test-results/` on the next invocation, which would lose
 * an earlier lane's missed-rollback evidence. This writer mirrors every
 * serialized observation into a fresh `mkdtemp` run directory under the
 * retention root while preserving the disposable test/project/retry hierarchy.
 */
import fs from "node:fs";
import path from "node:path";

export type Issue593DiagnosticsWrite = (
  disposableOutputRoot: string,
  disposableOutputPath: string,
  serialized: string,
) => string;

export function createIssue593DiagnosticsWriter(
  retentionRoot: string,
): Issue593DiagnosticsWrite {
  const absoluteRetentionRoot = path.resolve(retentionRoot);
  let runDir: string | null = null;
  return (disposableOutputRoot, disposableOutputPath, serialized) => {
    const relative = path.relative(disposableOutputRoot, disposableOutputPath);
    if (
      relative === "" ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error(
        `Issue #593 diagnostics path escapes the disposable output root: ${disposableOutputPath}`,
      );
    }
    if (runDir === null) {
      fs.mkdirSync(absoluteRetentionRoot, { recursive: true });
      runDir = fs.mkdtempSync(path.join(absoluteRetentionRoot, "run-"));
    }
    const retained = path.join(runDir, relative);
    fs.mkdirSync(path.dirname(disposableOutputPath), { recursive: true });
    fs.mkdirSync(path.dirname(retained), { recursive: true });
    fs.writeFileSync(disposableOutputPath, serialized, "utf8");
    fs.writeFileSync(retained, serialized, "utf8");
    return retained;
  };
}
