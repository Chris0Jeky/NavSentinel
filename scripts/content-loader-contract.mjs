import { createHash } from "node:crypto";

export const CONTENT_LOADER_HASH_LENGTH = 12;
export const UI_GUARD_REVISION_PLACEHOLDER = "__NAVSENTINEL_UI_GUARD_REVISION__";

const UI_GUARD_ATTRIBUTE = "data-navsentinel-ui-guard";

function uiGuardMarker(revision) {
  return `setAttribute('${UI_GUARD_ATTRIBUTE}','${revision}')`;
}

export function contentLoaderDigest(content) {
  return createHash("sha256")
    .update(content)
    .digest("hex")
    .slice(0, CONTENT_LOADER_HASH_LENGTH);
}

export function contentAddressedLoaderPath(loaderPath, content) {
  const normalized = loaderPath.replace(/\\/g, "/");
  const match = normalized.match(/^(.*-loader)-[^/]+(\.js)$/);
  if (!match) {
    throw new Error(`Content-script loader path is not hash-addressable: ${loaderPath}`);
  }
  return `${match[1]}-${contentLoaderDigest(content)}${match[2]}`;
}

export function assertContentAddressedLoader(loaderPath, content) {
  const expected = contentAddressedLoaderPath(loaderPath, content);
  if (loaderPath.replace(/\\/g, "/") !== expected) {
    throw new Error(
      `Final content-script loader bytes do not match their manifest URL: ` +
      `found ${loaderPath}, expected ${expected}`,
    );
  }
  return contentLoaderDigest(content);
}

/** Isolated-world global the focus fence publishes its record under (#1242). */
export const UI_FENCE_STATE = "__navsentinelUiFence";

// #1242: window blur/focus/visibility, recorded at document_start before any
// page script can register a capture listener that stops those events. The
// record lives in an isolated-world global: the page's JS realm cannot read or
// write it, and capture_isolated (near its cap) does not grow by another entry
// export, which the minified shared chunk would otherwise need.
// ui_action_visibility reads it; its own window state is a fallback for frames
// without this loader.
// #1244: Picture-in-Picture is asked, not pushed. The service worker asks every
// frame of the tab, and this frame answers from ground truth at query time.
// Page script cannot remove a chrome.runtime listener (document.open() erases
// only DOM listeners), and Chrome reports a detached video as
// pictureInPictureElement and a shadow-root one as its host.
// webNavigation.getAllFrames omits some frames that never navigated (a blob:
// frame, #1249 review), so the answer also covers every descendant frame this
// one can read; a cross-origin one throws here, but it navigated and answers itself.
export const UI_FOCUS_FENCE =
  `const S={h:top===window||document.hasFocus(),u:-1/0,a:false};try{Object.defineProperty(globalThis,'${UI_FENCE_STATE}',{value:S})}catch(_){}` +
  "const fc=e=>{const t=e.type;if(t==='visibilitychange'){if(document.hidden)S.u=performance.now();return}if(e.target instanceof Node)return;S.h=true;if(t==='blur')S.a=!document.hasFocus();if(S.a)S.u=performance.now();if(t==='focus')S.a=false};for(const t of ['blur','focus','visibilitychange'])addEventListener(t,fc,true);" +
  "const pf=w=>{try{if(w.document.pictureInPictureElement||w.documentPictureInPicture?.window)return true}catch(_){}try{for(let i=0;i<w.length;i++)if(pf(w[i]))return true}catch(_){}return false};" +
  "chrome.runtime.onMessage.addListener((m,_,r)=>{if(m?.type==='ns-pip')r(pf(self))});";

/**
 * The synchronous document_start loader for capture_isolated. CRXJS loads the
 * bundled isolated entry through an async import, and the page can register
 * capture listeners during that gap. This loader runs in the extension's
 * isolated world, whose DOM prototypes are unreachable from page script, so it
 * needs no captured accessors. It fences trusted pointer, mouse, touch, click,
 * and keyboard input whose composed path includes the extension-owned toast
 * host before any page listener can observe it, then hands a press, click or
 * keyboard activation to the module in the same world (the press pins the
 * click to the pressed control, #1203). The module accepts the host only by
 * identity and resolves the control from its own WeakMap, so a page-forged host
 * or attribute never activates a real control.
 */
export function uiGuardLoaderTemplate(chunkPath) {
  return `(function(){'use strict';document.documentElement?.setAttribute('data-navsentinel-ui-guard','${UI_GUARD_REVISION_PLACEHOLDER}');let sink=null;const guard=e=>{if(!e.isTrusted)return;const path=e.composedPath();let host=null;for(let i=0;i<path.length;i++){const n=path[i];if(n instanceof Element&&n.id==='__navsentinel_toast_host'){host=n;break}}if(!host)return;const type=e.type,key=(type==='keydown'||type==='keyup')&&(e.key==='Enter'||e.key===' ');if(type==='click'||type==='auxclick'||type==='contextmenu'||key)e.preventDefault();e.stopImmediatePropagation();if(sink&&(type==='click'||type==='pointerdown'||type==='keyup'&&key))sink(host,path,e)};for(const type of ['pointerdown','pointerup','pointercancel','mousedown','mouseup','touchstart','touchend','touchcancel','click','dblclick','auxclick','contextmenu','keydown','keyup'])window.addEventListener(type,guard,{capture:true,passive:false});${UI_FOCUS_FENCE}const injectTime=performance.now();(async()=>{const m=await import(chrome.runtime.getURL(${JSON.stringify(chunkPath)}));sink=m.activateUiControl??null;m.onExecute?.({perf:{injectTime,loadTime:performance.now()-injectTime}})})().catch(console.error)})();\n`;
}

/** The focus fence must appear exactly once and run before the async module import. */
export function assertUiFocusFence(loader) {
  const text = String(loader);
  const first = text.indexOf(UI_FOCUS_FENCE);
  if (first < 0) throw new Error("UI-guard loader is missing the focus/PiP fence");
  if (text.indexOf(UI_FOCUS_FENCE, first + UI_FOCUS_FENCE.length) >= 0) {
    throw new Error("UI-guard loader has more than one focus/PiP fence");
  }
  const asyncImport = text.indexOf(ASYNC_IMPORT);
  if (asyncImport < 0 || first > asyncImport) {
    throw new Error("UI-guard focus/PiP fence must run before the async module import");
  }
}

export function finalizeUiGuardLoader(loaderTemplate) {
  const placeholderMarker = uiGuardMarker(UI_GUARD_REVISION_PLACEHOLDER);
  if (loaderTemplate.split(placeholderMarker).length !== 2) {
    throw new Error("UI-guard loader must contain exactly one UI guard placeholder");
  }
  const revision = contentLoaderDigest(loaderTemplate);
  return {
    content: loaderTemplate.replace(placeholderMarker, uiGuardMarker(revision)),
    revision,
  };
}

export function assertUiGuardRevision(content) {
  const markerPattern = new RegExp(
    `setAttribute\\('${UI_GUARD_ATTRIBUTE}','([0-9a-f]{${CONTENT_LOADER_HASH_LENGTH}})'\\)`,
    "g",
  );
  const matches = [...String(content).matchAll(markerPattern)];
  if (matches.length !== 1 || !matches[0]?.[1]) {
    throw new Error("UI-guard loader must contain exactly one valid UI guard revision");
  }
  const revision = matches[0][1];
  const loaderTemplate = String(content).replace(
    uiGuardMarker(revision),
    uiGuardMarker(UI_GUARD_REVISION_PLACEHOLDER),
  );
  const expected = contentLoaderDigest(loaderTemplate);
  if (revision !== expected) {
    throw new Error(
      `UI-guard loader revision is stale: found ${revision}, expected ${expected}`,
    );
  }
  return revision;
}

// #877/#942: the MAIN-world guard loader captures Date.now before its async
// module import, so an early inline page script cannot replace the guard's
// clock. The capture is guarded: a second evaluation of the loader in the same
// realm (the property already exists) must not throw and kill the loader before
// the guard import.
export const EARLY_MAIN_CLOCK =
  "try{const earlyNow=Date.now.bind(Date);Object.defineProperty(globalThis,'__navsentinelMainDateNow',{value:earlyNow,writable:false,configurable:false})}catch(_){}";

// #900: the platform `Node.prototype.baseURI` getter, captured the same way.
// The guard resolves relative form actions and window.open URLs against the
// base URL; a getter an early page script replaced could report one base while
// the browser submits against another. Bind the invoker before page tampering.
export const EARLY_MAIN_BASE_URI =
  "try{const baseGetter=Object.getOwnPropertyDescriptor(Node.prototype,'baseURI').get;if(typeof baseGetter==='function'){const read=Function.prototype.call.bind(baseGetter);Object.defineProperty(globalThis,'__navsentinelMainBaseURI',{value:read,writable:false,configurable:false})}}catch(_){}";

// #1055: the platform HTMLFormElement target getter, captured before the async
// guard import. The subframe self-exemption must not trust a getter an early
// page script replaced. Bind the invoker before page tampering.
export const EARLY_MAIN_FORM_TARGET =
  "try{const targetGetter=Object.getOwnPropertyDescriptor(HTMLFormElement.prototype,'target').get;if(typeof targetGetter==='function'){const read=Function.prototype.call.bind(targetGetter);Object.defineProperty(globalThis,'__navsentinelMainFormTarget',{value:read,writable:false,configurable:false})}}catch(_){}";

// #1061: Element.prototype.getAttribute, captured before the async guard import.
// Action and method decisions must not trust a method an early page script replaced.
export const EARLY_MAIN_GET_ATTRIBUTE =
  "try{const getAttribute=Element.prototype.getAttribute;if(typeof getAttribute==='function')Object.defineProperty(globalThis,'__navsentinelMainGetAttribute',{value:Function.prototype.call.bind(getAttribute),writable:false,configurable:false})}catch(_){}";

// #1063: popup-intent ancestry must use the document-start method and invoker,
// including when the page replaces Function.prototype.call during the import.
export const EARLY_MAIN_CLOSEST =
  "try{const closest=Element.prototype.closest;if(typeof closest==='function')Object.defineProperty(globalThis,'__navsentinelMainClosest',{value:Function.prototype.call.bind(closest),writable:false,configurable:false})}catch(_){}";

// Capture invokers before the async import, including the bridge's listener
// setter: calling a page replacement with the genuine port leaks its authority.
// Freeze the record, not browser prototypes. Public invokers confer no port.
export const EARLY_MAIN_NATIVES = `try{const bind=fn=>Function.prototype.call.bind(fn),get=(p,k)=>bind(Object.getOwnPropertyDescriptor(p,k).get),define=Reflect.defineProperty,push=(a,v)=>{define(a,a.length,{value:v,writable:true,enumerable:true,configurable:true});return a.length},port=MessagePort.prototype,U=URL,M=Map,W=WeakSet,keys=bind(M.prototype.keys),next=bind(Object.getPrototypeOf(new M().keys()).next),exec=bind(RegExp.prototype.exec),indexOf=bind(String.prototype.indexOf),slice=bind(String.prototype.slice),href=get(U.prototype,'href'),origin=get(U.prototype,'origin'),pathname=get(U.prototype,'pathname'),protocol=get(U.prototype,'protocol');Object.defineProperty(globalThis,'__navsentinelMainNatives',{value:Object.freeze({apply:Reflect.apply,lower:bind(String.prototype.toLowerCase),trim:bind(String.prototype.trim),includes:bind(String.prototype.includes),starts:bind(String.prototype.startsWith),split:(s,sep)=>{if(sep==='')return[s];const a=[];let i=0,j;while((j=indexOf(s,sep,i))>=0){push(a,slice(s,i,j));i=j+sep.length}push(a,slice(s,i));return a},define,push,setHas:bind(Set.prototype.has),test:(r,s)=>exec(r,s)!==null,map:()=>new M(),mapGet:bind(M.prototype.get),mapSet:bind(M.prototype.set),mapDelete:bind(M.prototype.delete),mapEach:bind(M.prototype.forEach),mapSize:get(M.prototype,'size'),oldest:m=>next(keys(m)),weak:()=>new W(),weakHas:bind(W.prototype.has),weakAdd:bind(W.prototype.add),weakDelete:bind(W.prototype.delete),finite:Number.isFinite,min:Math.min,max:Math.max,parseFloat:Number.parseFloat,decode:decodeURIComponent,url:(s,b)=>{const u=b===undefined?new U(s):new U(s,b);return{href:href(u),origin:origin(u),pathname:pathname(u),protocol:protocol(u)}},post:bind(port.postMessage),start:bind(port.start),close:bind(port.close),listen:bind(Object.getOwnPropertyDescriptor(port,'onmessage').set),data:get(MessageEvent.prototype,'data'),source:get(MessageEvent.prototype,'source'),ports:get(MessageEvent.prototype,'ports'),stop:bind(Event.prototype.stopImmediatePropagation),on:bind(EventTarget.prototype.addEventListener)}),writable:false,configurable:false})}catch(_){} `;

/** Every early native capture, in order: installed and asserted as one block. */
export const EARLY_MAIN_PRELUDE = `${EARLY_MAIN_CLOCK}${EARLY_MAIN_BASE_URI}${EARLY_MAIN_FORM_TARGET}${EARLY_MAIN_GET_ATTRIBUTE}${EARLY_MAIN_CLOSEST}${EARLY_MAIN_NATIVES}`;

const STRICT_MARKER = "'use strict';";
const ASYNC_IMPORT = "await import(";

/** Insert the early native captures right after the loader's single 'use strict'. */
export function installEarlyMainClockText(generated) {
  if (generated.split(STRICT_MARKER).length !== 2 || !generated.includes(ASYNC_IMPORT)) {
    throw new Error("MAIN-world guard loader shape changed; early clock capture was not installed");
  }
  const finalLoader = generated.replace(STRICT_MARKER, `${STRICT_MARKER}\n  ${EARLY_MAIN_PRELUDE}`);
  assertEarlyMainPrelude(finalLoader);
  return finalLoader;
}

/**
 * The whole prelude must appear exactly once, directly after 'use strict', and
 * before the first async import; each capture must appear exactly once too, so
 * a stray second copy elsewhere in the loader is rejected (#900, #942).
 */
export function assertEarlyMainPrelude(loader) {
  assertEarlyMainClock(loader);
  const nativesFirst = loader.indexOf(EARLY_MAIN_NATIVES);
  if (nativesFirst < 0 || loader.indexOf(EARLY_MAIN_NATIVES, nativesFirst + EARLY_MAIN_NATIVES.length) >= 0) {
    throw new Error("MAIN-world guard loader needs exactly one early natives capture");
  }
  const baseFirst = loader.indexOf(EARLY_MAIN_BASE_URI);
  if (baseFirst < 0) throw new Error("MAIN-world guard loader is missing early baseURI capture");
  if (loader.indexOf(EARLY_MAIN_BASE_URI, baseFirst + EARLY_MAIN_BASE_URI.length) >= 0) {
    throw new Error("MAIN-world guard loader has more than one early baseURI capture");
  }
  const targetFirst = loader.indexOf(EARLY_MAIN_FORM_TARGET);
  if (targetFirst < 0) throw new Error("MAIN-world guard loader is missing early form target capture");
  if (loader.indexOf(EARLY_MAIN_FORM_TARGET, targetFirst + EARLY_MAIN_FORM_TARGET.length) >= 0) {
    throw new Error("MAIN-world guard loader has more than one early form target capture");
  }
  if (targetFirst < baseFirst) {
    throw new Error("MAIN-world early form target capture must follow the baseURI capture");
  }
  const attrFirst = loader.indexOf(EARLY_MAIN_GET_ATTRIBUTE);
  if (attrFirst < 0) throw new Error("MAIN-world guard loader is missing early getAttribute capture");
  if (loader.indexOf(EARLY_MAIN_GET_ATTRIBUTE, attrFirst + EARLY_MAIN_GET_ATTRIBUTE.length) >= 0) {
    throw new Error("MAIN-world guard loader has more than one early getAttribute capture");
  }
  if (attrFirst < targetFirst) {
    throw new Error("MAIN-world early getAttribute capture must follow the form target capture");
  }
  const closestFirst = loader.indexOf(EARLY_MAIN_CLOSEST);
  if (closestFirst < 0) throw new Error("MAIN-world guard loader is missing early closest capture");
  if (loader.indexOf(EARLY_MAIN_CLOSEST, closestFirst + EARLY_MAIN_CLOSEST.length) >= 0) {
    throw new Error("MAIN-world guard loader has more than one early closest capture");
  }
  if (closestFirst < attrFirst) {
    throw new Error("MAIN-world early closest capture must follow the getAttribute capture");
  }
  const strict = loader.indexOf(STRICT_MARKER);
  const prelude = loader.indexOf(EARLY_MAIN_PRELUDE);
  if (prelude < 0 || loader.slice(strict + STRICT_MARKER.length, prelude).trim() !== "") {
    throw new Error("MAIN-world early native prelude must directly follow 'use strict', in order");
  }
  if (prelude > loader.indexOf(ASYNC_IMPORT)) {
    throw new Error("MAIN-world early native prelude must run before the async guard import");
  }
}

/**
 * The capture must appear exactly once, directly after 'use strict', and before
 * the first async import. A substring check alone would accept a capture that a
 * future emitter change moved after the async gap (#942).
 */
export function assertEarlyMainClock(loader) {
  const first = loader.indexOf(EARLY_MAIN_CLOCK);
  if (first < 0) throw new Error("MAIN-world guard loader is missing early clock capture");
  if (loader.indexOf(EARLY_MAIN_CLOCK, first + EARLY_MAIN_CLOCK.length) >= 0) {
    throw new Error("MAIN-world guard loader has more than one early clock capture");
  }
  const strict = loader.indexOf(STRICT_MARKER);
  if (strict < 0 || loader.slice(strict + STRICT_MARKER.length, first).trim() !== "") {
    throw new Error("MAIN-world early clock capture must directly follow 'use strict'");
  }
  const asyncImport = loader.indexOf(ASYNC_IMPORT);
  if (asyncImport < 0 || first > asyncImport) {
    throw new Error("MAIN-world early clock capture must run before the async guard import");
  }
}
