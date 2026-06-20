// Type declarations for the testable exports of build-brand-templates.mjs (the build
// script itself is plain JS; main() is guarded so importing it does not write the
// output file). (#322)
export interface BrandTemplateRecord {
  id: string;
  displayName: string;
  aHash: number[];
  bHash: number[];
  version: number;
}

export interface BrandTemplateFile {
  version: number;
  templates: BrandTemplateRecord[];
}

export function buildTemplateFile(): BrandTemplateFile;
