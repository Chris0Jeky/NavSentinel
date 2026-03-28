import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const rawArgs = process.argv.slice(2);

let variant = "core";
let mode = "live";
let scale;
let forceVideo = false;
let forceTrace = false;

for (let index = 0; index < rawArgs.length; index += 1) {
  const arg = rawArgs[index];

  if (arg === "core" || arg === "operator" || arg === "recovery" || arg === "all") {
    variant = arg;
    continue;
  }

  if (arg === "--record") {
    mode = "record";
    continue;
  }

  if (arg === "--fast") {
    mode = "fast";
    continue;
  }

  if (arg === "--live") {
    mode = "live";
    continue;
  }

  if (arg === "--video") {
    forceVideo = true;
    continue;
  }

  if (arg === "--trace") {
    forceTrace = true;
    continue;
  }

  if (arg === "--scale") {
    scale = rawArgs[index + 1];
    index += 1;
    continue;
  }

  if (arg.startsWith("--scale=")) {
    scale = arg.slice("--scale=".length);
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const shouldCapture = mode === "record" || forceVideo || forceTrace;
const artifactDir = path.resolve(
  process.cwd(),
  "artifacts",
  "demo",
  `${stamp}-${variant}-${mode}`
);

if (shouldCapture) {
  fs.mkdirSync(artifactDir, { recursive: true });
}

const env = {
  ...process.env,
  NAVSENTINEL_DEMO_MODE: mode,
  NAVSENTINEL_DEMO_VIDEO: mode === "record" || forceVideo ? "1" : "0",
  NAVSENTINEL_DEMO_TRACE: forceTrace ? "1" : "0"
};

if (scale) {
  env.NAVSENTINEL_DEMO_SCALE = scale;
}

if (shouldCapture) {
  env.NAVSENTINEL_DEMO_ARTIFACT_DIR = artifactDir;
}

const cliArgs = [
  path.resolve(process.cwd(), "node_modules", "playwright", "cli.js"),
  "test",
  "-c",
  "playwright.demo.config.ts"
];

if (variant !== "all") {
  cliArgs.push("--grep", `@demo-${variant}`);
}

const result = spawnSync(process.execPath, cliArgs, {
  cwd: process.cwd(),
  env,
  stdio: "inherit"
});

if (result.error) {
  console.error(result.error);
}

process.exit(result.status ?? 1);
