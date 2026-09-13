export function selectReplacementWorker<T extends { url(): string }>(workers: readonly T[], previous: T, scriptURL: string): T | undefined;
