#!/usr/bin/env node
/** Fixed runner output only. Does not infer protection from a fault-test pass. */
import fs from 'node:fs';
import path from 'node:path';
import { readInput, writeReport } from './io.mjs';
import { buildReport } from './model.mjs';
import { checkFaultMatrix } from './fault-contract.mjs';

try {
  if (process.argv.length !== 2) throw new Error('LANE_ARGUMENT_INVALID');
  const root = 'test-results/observatory-faults', bytes = [];
  if (fs.existsSync(root)) for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(root, entry.name, 'fault-trace.json');
    if (fs.existsSync(file)) bytes.push(readInput(file));
  }
  const verdict = checkFaultMatrix(bytes.map(b => JSON.parse(b.toString('utf8'))));
  const report = buildReport(bytes);
  report.faultQualification = verdict;
  const output = writeReport('test-results/observatory-fault-review', report);
  fs.writeFileSync(path.join(output, 'fault-check.json'), JSON.stringify(verdict, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(verdict));
  if (!verdict.passed) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ error: /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'FAULT_QUALIFICATION_FAILED' }));
  process.exitCode = 1;
}
