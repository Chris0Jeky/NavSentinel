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
    throw new Error("MAIN-world loader must contain exactly one UI guard placeholder");
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
    throw new Error("MAIN-world loader must contain exactly one valid UI guard revision");
  }
  const revision = matches[0][1];
  const loaderTemplate = String(content).replace(
    uiGuardMarker(revision),
    uiGuardMarker(UI_GUARD_REVISION_PLACEHOLDER),
  );
  const expected = contentLoaderDigest(loaderTemplate);
  if (revision !== expected) {
    throw new Error(
      `MAIN-world loader UI guard revision is stale: found ${revision}, expected ${expected}`,
    );
  }
  return revision;
}
