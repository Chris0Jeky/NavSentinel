#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
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

function installEarlyMainUiGuard() {
  const dist = path.join(root, "extension", "dist");
  const manifest = JSON.parse(fs.readFileSync(path.join(dist, "manifest.json"), "utf8"));
  const mainScript = manifest.content_scripts?.find((entry) => entry.world === "MAIN")?.js?.[0];
  if (!mainScript) throw new Error("MAIN-world content-script loader is missing");
  const loaderPath = path.join(dist, mainScript);
  const generated = fs.readFileSync(loaderPath, "utf8");
  const importPath = generated.match(/await import\([\s\S]*?["'](\.\/[^"']+)["']\s*\)/)?.[1];
  if (!importPath) throw new Error("MAIN-world content-script chunk import is missing");

  // CRXJS loads the bundled MAIN entry through an async import. The page can
  // register capture listeners during that gap, before main_guard.ts executes.
  // Keep this synchronous fence in the generated document_start loader; its
  // closure fences only trusted input inside the extension host, queues click
  // or keyboard activation, and hands it to the verified bridge once the real
  // guard module is ready. The queue is private and bounded.
  const guardedLoader = `(function(){'use strict';let sink=null,q=[];const guard=e=>{if(!e.isTrusted)return;let id='',owned=false;for(const t of e.composedPath())if(t instanceof HTMLElement){if(t.id==='__navsentinel_toast_host')owned=true;if(t.dataset.nsUiAction)id=t.dataset.nsUiAction}if(!owned)return;const key=e instanceof KeyboardEvent&&(e.key==='Enter'||e.key===' '),run=e.type==='click'||e.type==='keyup'&&key;if(e.type==='click'||e.type==='auxclick'||e.type==='contextmenu'||key)e.preventDefault();e.stopImmediatePropagation();if(run&&id&&id.length<=16){if(sink)sink(id);else if(q.length<16)q.push(id)}};for(const type of ['pointerdown','pointerup','pointercancel','mousedown','mouseup','touchstart','touchend','touchcancel','click','dblclick','auxclick','contextmenu','keydown','keyup'])window.addEventListener(type,guard,{capture:true,passive:false});const injectTime=performance.now();(async()=>{const m=await import(${JSON.stringify(importPath)});sink=m.activateMainUiControl??null;if(sink)for(const id of q)sink(id);q=[];m.onExecute?.({perf:{injectTime,loadTime:performance.now()-injectTime}})})().catch(console.error)})();\n`;
  fs.writeFileSync(loaderPath, guardedLoader, "utf8");
}

console.log(`[build] profile=${profile.id}; releaseEligible=${profile.releaseEligible}`);
const env = { [RELEASE_PROFILE_ENV]: profile.id };
runNode(viteBin, ["build"], env);
installEarlyMainUiGuard();
compactPackagedHtml();
runNode(path.join(root, "scripts", "check-mv3-worker-imports.mjs"));
runNode(path.join(root, "scripts", "check-release-profile.mjs"), [`--expect=${profile.id}`]);

console.log(
  "[build] unpacked Chrome: reload NavSentinel at chrome://extensions before reloading Gym pages."
);
console.log(
  "[build] A page reload alone can retain a stale hashed loader; both NavSentinel readiness markers must be 1."
);
