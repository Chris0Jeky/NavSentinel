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

describe("Observatory recorded campaign integration trigger", () => {
  it("runs on bounded qualifying main pushes rather than a retired feature branch", () => {
    const source = fs.readFileSync(
      path.join(workflowDirectory, "observatory-campaign.yml"),
      "utf8",
    );
    const pushBlock = source.match(/\n {2}push:\n([\s\S]*?)\n {2}workflow_dispatch:/u)?.[1] ?? "";

    expect(pushBlock).toContain("branches: [main]");
    expect(pushBlock).toContain("paths:");
    expect(pushBlock).toContain("'experiments/evidence-observatory/**'");
    expect(source).not.toContain("feat/observatory-campaign-20260913");
  });
});

describe("Branded Chrome browser-gate trigger", () => {
  it("runs only for explicitly labelled same-repository pull requests", () => {
    const source = fs.readFileSync(
      path.join(workflowDirectory, "branded-chrome-advisory.yml"),
      "utf8",
    );

    const pullRequestBlock =
      source.match(/\n {2}pull_request:\n([\s\S]*?)\n\npermissions:/u)?.[1] ?? "";

    expect(pullRequestBlock).toContain("types: [labeled, synchronize, reopened, ready_for_review]");
    expect(source).toContain("github.event.pull_request.head.repo.full_name == github.repository");
    expect(source).toContain(
      "contains(github.event.pull_request.labels.*.name, 'gate:browser')",
    );
    expect(source).not.toContain("pull_request_target:");
    expect(source).toContain(
      "PULL_REQUEST_HEAD: ${{ github.event.pull_request.head.sha || '' }}",
    );
    expect(source).toContain("checkout_head=%s");
    expect(source).toContain('"$GITHUB_SHA" "$PULL_REQUEST_NUMBER"');
  });
});
