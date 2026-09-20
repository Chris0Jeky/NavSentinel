import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workflowDirectory = path.resolve(import.meta.dirname, "../.github/workflows");
const immutableRevision = /^[0-9a-f]{40}$/i;
const immutableContainer = /^docker:\/\/.+@sha256:[0-9a-f]{64}$/i;

interface WorkflowUse {
  file: string;
  line: number;
  reference: string;
}

function workflowUses(): WorkflowUse[] {
  const files = fs
    .readdirSync(workflowDirectory)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .sort();
  const uses: WorkflowUse[] = [];

  for (const file of files) {
    const lines = fs.readFileSync(path.join(workflowDirectory, file), "utf8").split(/\r?\n/u);
    for (const [index, line] of lines.entries()) {
      const match = line.match(/^\s*(?:-\s*)?uses:\s*["']?([^\s"'#]+)["']?/u);
      if (!match) continue;
      uses.push({ file, line: index + 1, reference: match[1]! });
    }
  }

  return uses;
}

describe("GitHub Actions supply-chain boundary", () => {
  it("pins every remote action or container to immutable content", () => {
    const mutable: string[] = [];

    for (const use of workflowUses()) {
      if (use.reference.startsWith("./")) continue;
      if (use.reference.startsWith("docker://")) {
        if (!immutableContainer.test(use.reference)) {
          mutable.push(`${use.file}:${use.line} ${use.reference}`);
        }
        continue;
      }

      const separator = use.reference.lastIndexOf("@");
      const action = separator < 0 ? use.reference : use.reference.slice(0, separator);
      const revision = separator < 0 ? "" : use.reference.slice(separator + 1);
      if (!action.includes("/") || !immutableRevision.test(revision)) {
        mutable.push(`${use.file}:${use.line} ${use.reference}`);
      }
    }

    expect(mutable, `Mutable workflow dependencies:\n${mutable.join("\n")}`).toEqual([]);
  });
});
