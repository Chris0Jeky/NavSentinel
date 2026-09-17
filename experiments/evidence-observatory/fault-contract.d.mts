export type FaultId = 'receiver-unavailable' | 'primary-frame-detached' | 'primary-document-replaced' | 'worker-restarted' | 'page-report-flood' | 'receiver-observer-error';
export const FAULT_IDS: readonly FaultId[];
export type FaultResult = { faultId: FaultId | null; status: 'FAULT_DETECTED' | 'FAULT_NOT_ESTABLISHED'; preventionSupported: boolean; reasons: string[]; assessment: string; gaps: string[]; sourceDigest: string | null; evidencePolicy: string };
export function assessFaultTrace(trace: unknown): FaultResult;
export function checkFaultMatrix(traces: unknown[]): { passed: boolean; trials: FaultResult[]; evidencePolicy: string };
