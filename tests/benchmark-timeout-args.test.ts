import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const script = path.join(root, "scripts", "benchmark.mjs");

function runBenchmark(args: string[]): { status: number; stderr: string } {
  try {
    execFileSync("node", [script, ...args], { stdio: "pipe" });
    return { status: 0, stderr: "" };
  } catch (err) {
    const failure = err as { status?: number; stderr?: Buffer | string };
    return {
      status: failure.status ?? -1,
      stderr: String(failure.stderr ?? ""),
    };
  }
}

describe("scripts/benchmark.mjs --timeout validation", () => {
  it.each([["abc"], ["-5"], ["0"], ["1.5"]])(
    "rejects --timeout %j with exit 1",
    (value) => {
      const result = runBenchmark(["--timeout", value]);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Invalid --timeout/);
    },
  );

  it("rejects a missing --timeout value with exit 1", () => {
    const result = runBenchmark(["--timeout"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Invalid --timeout/);
  });
});
