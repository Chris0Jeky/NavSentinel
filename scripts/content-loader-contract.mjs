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
// the browser submits against another. Only a real getter is stored.
export const EARLY_MAIN_BASE_URI =
  "try{const baseGetter=Object.getOwnPropertyDescriptor(Node.prototype,'baseURI').get;if(typeof baseGetter==='function')Object.defineProperty(globalThis,'__navsentinelMainBaseURI',{value:baseGetter,writable:false,configurable:false})}catch(_){}";

// #1055: the platform HTMLFormElement target getter, captured before the async
// guard import. The subframe self-exemption must not trust a getter an early
// page script replaced. Only a real getter is stored.
export const EARLY_MAIN_FORM_TARGET =
  "try{const targetGetter=Object.getOwnPropertyDescriptor(HTMLFormElement.prototype,'target').get;if(typeof targetGetter==='function')Object.defineProperty(globalThis,'__navsentinelMainFormTarget',{value:targetGetter,writable:false,configurable:false})}catch(_){}";

// #1061: Element.prototype.getAttribute, captured before the async guard import.
// Action and method decisions must not trust a method an early page script replaced.
export const EARLY_MAIN_GET_ATTRIBUTE =
  "try{const getAttribute=Element.prototype.getAttribute;if(typeof getAttribute==='function')Object.defineProperty(globalThis,'__navsentinelMainGetAttribute',{value:getAttribute,writable:false,configurable:false})}catch(_){}";

// #1063: Element.prototype.closest, captured before the async guard import.
// Popup-intent ancestor checks must not trust a method an early page script replaced.
export const EARLY_MAIN_CLOSEST =
  "try{const closest=Element.prototype.closest;if(typeof closest==='function')Object.defineProperty(globalThis,'__navsentinelMainClosest',{value:closest,writable:false,configurable:false})}catch(_){}";

// #1060/#1062/#1065: captured DOM functions remain page-visible objects.
// Capture the invocation primitive too; callers use its [[Call]] directly,
// never a mutable .call/.apply property on a captured function or Reflect.
export const EARLY_MAIN_APPLY =
  "try{const apply=Reflect.apply;if(typeof apply==='function')Object.defineProperty(globalThis,'__navsentinelMainApply',{value:apply,writable:false,configurable:false})}catch(_){}";

/** Every early native capture, in order: installed and asserted as one block. */
export const EARLY_MAIN_PRELUDE = `${EARLY_MAIN_CLOCK}${EARLY_MAIN_BASE_URI}${EARLY_MAIN_FORM_TARGET}${EARLY_MAIN_GET_ATTRIBUTE}${EARLY_MAIN_CLOSEST}${EARLY_MAIN_APPLY}`;

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
  const applyFirst = loader.indexOf(EARLY_MAIN_APPLY);
  if (applyFirst < 0) throw new Error("MAIN-world guard loader is missing early apply capture");
  if (loader.indexOf(EARLY_MAIN_APPLY, applyFirst + EARLY_MAIN_APPLY.length) >= 0) {
    throw new Error("MAIN-world guard loader has more than one early apply capture");
  }
  if (applyFirst < closestFirst) {
    throw new Error("MAIN-world early apply capture must follow the closest capture");
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
