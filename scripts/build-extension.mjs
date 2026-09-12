#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  contentAddressedLoaderPath,
  finalizeUiGuardLoader,
  UI_GUARD_REVISION_PLACEHOLDER,
} from "./content-loader-contract.mjs";
import { RELEASE_PROFILE_ENV, resolveReleaseProfile } from "./release-profile.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const viteBin = path.join(path.dirname(require.resolve("vite/package.json")), "bin", "vite.js");

if (process.argv.length > 3) {
  console.error("Usage: node scripts/build-extension.mjs [interaction-only|research-reputation]");
  process.exit(1);
}

let profile;
try {
  // An ambient shell variable must not silently turn the normal release build
  // into a research artifact. Positional profile selection is explicit; no
  // argument resolves the committed default even when the parent environment
  // contains NAVSENTINEL_BUILD_PROFILE.
  profile = resolveReleaseProfile(process.argv[2] ?? "");
} catch (error) {
  console.error(`[build] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

function runNode(scriptPath, args = [], extraEnv = {}) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function compactPackagedHtml() {
  const distSrc = path.join(root, "extension", "dist", "src");
  for (const relative of fs.readdirSync(distSrc, { recursive: true })) {
    if (!relative.endsWith(".html")) continue;
    const file = path.join(distSrc, relative);
    const html = fs.readFileSync(file, "utf8");
    // Comments are source guidance, not extension payload. Keep conditional
    // comments if one is ever added, and make artifact bytes platform-stable.
    const compacted = html
      .replace(/\r\n?/g, "\n")
      .replace(/<!--(?!\[if\b)[\s\S]*?-->/gi, "");
    if (compacted !== html) fs.writeFileSync(file, compacted, "utf8");
  }
}

function installEarlyUiFence() {
  const dist = path.join(root, "extension", "dist");
  const manifestPath = path.join(dist, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const captureEntry = manifest.content_scripts?.find(
    (entry) => entry.world === "ISOLATED" && /capture_isolated/.test(entry.js?.[0] ?? ""),
  );
  const captureScript = captureEntry?.js?.[0];
  if (!captureScript) throw new Error("Isolated-world capture content-script loader is missing");
  const loaderPath = path.join(dist, captureScript);
  const generated = fs.readFileSync(loaderPath, "utf8");
  const chunkPath = generated.match(/chrome\.runtime\.getURL\(\s*["']([^"']+)["']\s*\)/)?.[1];
  if (!chunkPath) throw new Error("Isolated-world capture content-script chunk import is missing");

  // CRXJS loads the bundled isolated entry through an async import. The page can
  // register capture listeners during that gap, before capture_isolated.ts
  // executes. Keep this synchronous fence in the generated document_start
  // loader. It runs in the extension's isolated world, whose DOM prototypes are
  // unreachable from page script, so it needs no captured accessors. It fences
  // trusted pointer, mouse, touch, click, and keyboard input whose composed path
  // includes the extension-owned toast host before any page listener can observe
  // it, then hands a click or keyboard activation to the module in the same
  // world. The module accepts the host only by identity and resolves the control
  // from its own WeakMap, so a page-forged host or attribute never activates a
  // real control, and the user's own controls do not depend on the MAIN-world
  // bridge.
  const fencedLoaderTemplate = `(function(){'use strict';document.documentElement?.setAttribute('data-navsentinel-ui-guard','${UI_GUARD_REVISION_PLACEHOLDER}');let sink=null;const guard=e=>{if(!e.isTrusted)return;const path=e.composedPath();let host=null;for(let i=0;i<path.length;i++){const n=path[i];if(n instanceof Element&&n.id==='__navsentinel_toast_host'){host=n;break}}if(!host)return;const type=e.type,key=(type==='keydown'||type==='keyup')&&(e.key==='Enter'||e.key===' ');if(type==='click'||type==='auxclick'||type==='contextmenu'||key)e.preventDefault();e.stopImmediatePropagation();if(sink&&(type==='click'||type==='keyup'&&key))sink(host,path)};for(const type of ['pointerdown','pointerup','pointercancel','mousedown','mouseup','touchstart','touchend','touchcancel','click','dblclick','auxclick','contextmenu','keydown','keyup'])window.addEventListener(type,guard,{capture:true,passive:false});const injectTime=performance.now();(async()=>{const m=await import(chrome.runtime.getURL(${JSON.stringify(chunkPath)}));sink=m.activateUiControl??null;m.onExecute?.({perf:{injectTime,loadTime:performance.now()-injectTime}})})().catch(console.error)})();\n`;
  const { content: fencedLoader, revision } = finalizeUiGuardLoader(fencedLoaderTemplate);
  const finalCaptureScript = contentAddressedLoaderPath(captureScript, fencedLoader);
  const finalLoaderPath = path.join(dist, finalCaptureScript);
  fs.writeFileSync(finalLoaderPath, fencedLoader, "utf8");
  if (finalLoaderPath !== loaderPath) fs.rmSync(loaderPath, { force: true });
  captureEntry.js[0] = finalCaptureScript;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return revision;
}

console.log(`[build] profile=${profile.id}; releaseEligible=${profile.releaseEligible}`);
const env = { [RELEASE_PROFILE_ENV]: profile.id };
runNode(viteBin, ["build"], env);
const uiGuardRevision = installEarlyUiFence();
runNode(path.join(root, "scripts", "check-content-loader-identity.mjs"));
compactPackagedHtml();
runNode(path.join(root, "scripts", "check-mv3-worker-imports.mjs"));
runNode(path.join(root, "scripts", "check-release-profile.mjs"), [`--expect=${profile.id}`]);

console.log(
  "[build] owner action for unpacked Chrome: load or reload extension/dist before reloading target pages."
);
console.log(
  `[build] expected runtime markers: capture=1, bridge=1, ui-guard=${uiGuardRevision}; ` +
  "browser automation cannot prove that Chrome accepted this artifact."
);
