#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertContentAddressedLoader,
  assertUiGuardRevision,
} from "./content-loader-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "extension", "dist");
const manifestPath = path.join(dist, "manifest.json");

if (!fs.existsSync(manifestPath)) {
  throw new Error("Built extension manifest is missing; run npm run build first");
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const captureScript = manifest.content_scripts
  ?.find((entry) => entry.world === "ISOLATED" && /capture_isolated/.test(entry.js?.[0] ?? ""))
  ?.js?.[0];
if (!captureScript) throw new Error("Isolated-world capture content-script loader is missing");

const loaderPath = path.join(dist, captureScript);
if (!fs.existsSync(loaderPath)) {
  throw new Error(`Manifest isolated-world capture loader does not exist: ${captureScript}`);
}

const loader = fs.readFileSync(loaderPath, "utf8");
const digest = assertContentAddressedLoader(captureScript, loader);
const revision = assertUiGuardRevision(loader);

const mainScript = manifest.content_scripts
  ?.find((entry) => entry.world === "MAIN" && /main_guard/.test(entry.js?.[0] ?? ""))
  ?.js?.[0];
if (!mainScript) throw new Error("MAIN-world guard content-script loader is missing");
const mainPath = path.join(dist, mainScript);
if (!fs.existsSync(mainPath)) throw new Error(`Manifest MAIN-world guard loader does not exist: ${mainScript}`);
const mainLoader = fs.readFileSync(mainPath, "utf8");
assertContentAddressedLoader(mainScript, mainLoader);
if (!mainLoader.includes("Object.defineProperty(globalThis,'__navsentinelMainDateNow'")) {
  throw new Error("MAIN-world guard loader is missing early clock capture");
}

console.log(
  `[content-loader] final isolated capture loader identity OK; revision=` +
  `${revision}; sha256=${digest}`,
);
