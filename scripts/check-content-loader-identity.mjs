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
const mainScript = manifest.content_scripts
  ?.find((entry) => entry.world === "MAIN")
  ?.js?.[0];
if (!mainScript) throw new Error("MAIN-world content-script loader is missing");

const loaderPath = path.join(dist, mainScript);
if (!fs.existsSync(loaderPath)) {
  throw new Error(`Manifest MAIN-world loader does not exist: ${mainScript}`);
}

const loader = fs.readFileSync(loaderPath, "utf8");
const digest = assertContentAddressedLoader(mainScript, loader);
const revision = assertUiGuardRevision(loader);

console.log(
  `[content-loader] final MAIN loader identity OK; revision=` +
  `${revision}; sha256=${digest}`,
);
