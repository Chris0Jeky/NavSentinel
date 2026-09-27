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
  "const earlyNow=Date.now.bind(Date);try{Object.defineProperty(globalThis,'__navsentinelMainDateNow',{value:earlyNow,writable:false,configurable:false})}catch(_){}";

const STRICT_MARKER = "'use strict';";
const ASYNC_IMPORT = "await import(";

/** Insert the early clock capture right after the loader's single 'use strict'. */
export function installEarlyMainClockText(generated) {
  if (generated.split(STRICT_MARKER).length !== 2 || !generated.includes(ASYNC_IMPORT)) {
    throw new Error("MAIN-world guard loader shape changed; early clock capture was not installed");
  }
  const finalLoader = generated.replace(STRICT_MARKER, `${STRICT_MARKER}\n  ${EARLY_MAIN_CLOCK}`);
  assertEarlyMainClock(finalLoader);
  return finalLoader;
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
