/** Optional Playwright reporter. Observes attachments only; never touches the browser or test policy. */
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildReport, LIMITS } from './model.mjs';
import { readInput, writeReport } from './io.mjs';

export default class ObservatoryReporter {
  constructor(options = {}) {
    this.output = options.output ?? path.join('test-results', `observatory-${randomUUID()}`);
    this.inputs = []; this.totalBytes = 0; this.errors = [];
    this.execution = { attempts: 0, passed: 0, failed: 0, skipped: 0, retried: 0, withoutJson: 0 };
  }
  onTestEnd(_test, result) {
    this.execution.attempts++;
    if (result.status === 'passed') this.execution.passed++;
    else if (result.status === 'skipped') this.execution.skipped++;
    else this.execution.failed++;
    if (result.retry > 0) this.execution.retried++;
    const attachments = (result.attachments ?? []).filter(a => a.contentType === 'application/json');
    if (!attachments.length) this.execution.withoutJson++;
    for (const a of attachments) {
      try {
        if (this.inputs.length >= LIMITS.files) throw new Error('FILE_COUNT_LIMIT');
        const bytes = a.body !== undefined ? a.body : readInput(a.path);
        if (!Buffer.isBuffer(bytes) || bytes.length > LIMITS.bytes || this.totalBytes + bytes.length > LIMITS.totalBytes) throw new Error('INPUT_SIZE_LIMIT');
        this.inputs.push(bytes); this.totalBytes += bytes.length;
      } catch { this.errors.push('ATTACHMENT_NOT_COLLECTED'); }
    }
  }
  onError() { this.errors.push('RUNNER_ERROR'); }
  onEnd(result) {
    // Failed earlier attempts, skipped tests and missing receipts remain visible even
    // when the framework's final status is passed. No retry masks a failed campaign.
    const incomplete = this.execution.failed || this.execution.skipped || this.execution.retried || this.execution.withoutJson || this.errors.length;
    const report = buildReport(this.inputs, { producerStatus: incomplete ? 'failed' : result.status });
    report.execution = { ...this.execution, collectionErrors: this.errors.length, finalFrameworkStatus: ['passed', 'failed', 'timedout', 'interrupted'].includes(result.status) ? result.status : 'unknown' };
    const output = writeReport(this.output, report);
    console.log(`Evidence Observatory: ${output}; diagnostic only; ${report.summary.invalidCases} invalid cases.`);
  }
}
