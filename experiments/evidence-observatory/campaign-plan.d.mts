export const CHALLENGES: readonly { id: string; churn: boolean; clickDelayMs: number; viewport: { width: number; height: number } }[];
export function selectLane(args: string[]): { id: string; config: string; output: string; report: string; binding: string };
