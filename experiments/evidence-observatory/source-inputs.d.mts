export type SourceInputs = { head: string; tree: string; digest: string; lockSha256: string; files: number; bytes: number };
export function captureInputs(root?: string): SourceInputs;
export function hashArtifact(root: string): string;
