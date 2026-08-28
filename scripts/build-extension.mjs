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

function installEarlyMainUiGuard() {
  const dist = path.join(root, "extension", "dist");
  const manifestPath = path.join(dist, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const mainEntry = manifest.content_scripts?.find((entry) => entry.world === "MAIN");
  const mainScript = mainEntry?.js?.[0];
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
  // guard module is ready. Page-visible composed paths can retarget a shadow
  // control to its host, so resolve the owned control by bounds/focus using the
  // pristine DOM methods captured before page script runs. The queue is private
  // and bounded.
  const guardedLoaderTemplate = `(function(){'use strict';document.documentElement?.setAttribute('data-navsentinel-ui-guard','${UI_GUARD_REVISION_PLACEHOLDER}');let sink=null,q=[];const D=(p,k)=>Object.getOwnPropertyDescriptor(p,k).get,EP=Event.prototype,P=EP.composedPath,T=D(EP,'type'),V=EP.preventDefault,O=EP.stopImmediatePropagation,MP=MouseEvent.prototype,X=D(MP,'clientX'),Y=D(MP,'clientY'),KP=KeyboardEvent.prototype,J=D(KP,'key'),G=Element.prototype.getAttribute,B=Element.prototype.getBoundingClientRect,Q=DocumentFragment.prototype.querySelectorAll,S=D(Element.prototype,'shadowRoot'),A=D(ShadowRoot.prototype,'activeElement'),N=NodeList.prototype.item,L=D(NodeList.prototype,'length'),RP=DOMRectReadOnly.prototype,RX=D(RP,'x'),RY=D(RP,'y'),RW=D(RP,'width'),RH=D(RP,'height'),guard=e=>{if(!e.isTrusted)return;let host=null,id='',path=P.call(e);for(let i=0;i<path.length;i++)try{if(G.call(path[i],'id')==='__navsentinel_toast_host'){host=path[i];break}}catch{}if(!host)return;const type=T.call(e),key=(type==='keydown'||type==='keyup')&&(J.call(e)==='Enter'||J.call(e)===' '),run=type==='click'||type==='keyup'&&key;if(type==='click'||type==='auxclick'||type==='contextmenu'||key)V.call(e);O.call(e);if(run){const root=S.call(host);if(key){const t=A.call(root);if(t)id=G.call(t,'data-ns-ui-action')??''}else if(root){const controls=Q.call(root,'[data-ns-ui-action]'),x=X.call(e),y=Y.call(e);for(let i=0,n=L.call(controls);i<n;i++){const t=N.call(controls,i),r=B.call(t),rx=RX.call(r),ry=RY.call(r),rw=RW.call(r),rh=RH.call(r);if(rw>0&&rh>0&&x>=rx&&x<=rx+rw&&y>=ry&&y<=ry+rh){id=G.call(t,'data-ns-ui-action')??'';break}}}if(id&&id.length<=16){if(sink)sink(id);else if(q.length<16)q[q.length]=id}}};for(const type of ['pointerdown','pointerup','pointercancel','mousedown','mouseup','touchstart','touchend','touchcancel','click','dblclick','auxclick','contextmenu','keydown','keyup'])window.addEventListener(type,guard,{capture:true,passive:false});const injectTime=performance.now();(async()=>{const m=await import(${JSON.stringify(importPath)});sink=m.activateMainUiControl??null;if(sink)for(let i=0;i<q.length;i++)sink(q[i]);q=[];m.onExecute?.({perf:{injectTime,loadTime:performance.now()-injectTime}})})().catch(console.error)})();\n`;
  const { content: guardedLoader, revision } = finalizeUiGuardLoader(guardedLoaderTemplate);
  const finalMainScript = contentAddressedLoaderPath(mainScript, guardedLoader);
  const finalLoaderPath = path.join(dist, finalMainScript);
  fs.writeFileSync(finalLoaderPath, guardedLoader, "utf8");
  if (finalLoaderPath !== loaderPath) fs.rmSync(loaderPath, { force: true });
  mainEntry.js[0] = finalMainScript;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return revision;
}

console.log(`[build] profile=${profile.id}; releaseEligible=${profile.releaseEligible}`);
const env = { [RELEASE_PROFILE_ENV]: profile.id };
runNode(viteBin, ["build"], env);
const uiGuardRevision = installEarlyMainUiGuard();
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
