import type { CDPSession } from '@playwright/test';
export type WorkerSnapshot = { epoch: string | null; decisions: Array<{ code: 'overlay-suppressed' | 'overlay-reasserted' }> };
export function readWorkerSnapshot(root: CDPSession, scriptURL: string, options?: { timeoutMs?: number }): Promise<WorkerSnapshot>;
