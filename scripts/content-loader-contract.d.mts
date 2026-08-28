export const CONTENT_LOADER_HASH_LENGTH: number;
export const UI_GUARD_REVISION_PLACEHOLDER: string;
export function contentLoaderDigest(content: string | Uint8Array): string;
export function contentAddressedLoaderPath(
  loaderPath: string,
  content: string | Uint8Array,
): string;
export function assertContentAddressedLoader(
  loaderPath: string,
  content: string | Uint8Array,
): string;
export function finalizeUiGuardLoader(loaderTemplate: string): {
  content: string;
  revision: string;
};
export function assertUiGuardRevision(content: string | Uint8Array): string;
