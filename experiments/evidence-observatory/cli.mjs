#!/usr/bin/env node
import { buildReport, supportsCompleteSet } from './model.mjs';
import { demonstration } from './demo.mjs';
import { collectInputs, writeReport } from './io.mjs';

const help = `Evidence Observatory (offline, diagnostic only)
  node experiments/evidence-observatory/cli.mjs demo --out NEW_DIRECTORY
  node experiments/evidence-observatory/cli.mjs inspect --input FILE_OR_DIRECTORY --out NEW_DIRECTORY
  node experiments/evidence-observatory/cli.mjs check --input FILE_OR_DIRECTORY

inspect emits report.json and a standalone index.html; stdout is a JSON summary.
check emits the complete minimized JSON report, with no files or browser needed.
Exit codes: 0 processed, 1 check lacks a supported complete comparison, 2 input/output/rejection error.
A zero inspect exit code means processing succeeded, NOT that a defense works.
Demo is authored illustration, never evidence. Outputs must not already exist.`;
try {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === '--help') { console.log(help); }
  else {
    if (!['demo', 'inspect', 'check'].includes(command) || args.length % 2) throw new Error('INVALID_ARGUMENTS');
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!['--input', '--out'].includes(args[i]) || Object.hasOwn(options, args[i]) || !args[i + 1]) throw new Error('INVALID_ARGUMENTS');
      options[args[i]] = args[i + 1];
    }
    if (command === 'demo' && options['--input'] || command === 'check' && options['--out']) throw new Error('INVALID_ARGUMENTS');
    if (command !== 'demo' && !options['--input'] || command !== 'check' && !options['--out']) throw new Error('MISSING_ARGUMENTS');
    const report = buildReport(command === 'demo' ? [JSON.stringify(demonstration())] : collectInputs(options['--input']));
    if (command === 'check') {
      console.log(JSON.stringify(report));
      process.exitCode = report.rejected.length ? 2 : supportsCompleteSet(report) ? 0 : 1;
    } else {
      const output = writeReport(options['--out'], report);
      console.log(JSON.stringify({ output, ...report.summary, evidencePolicy: report.evidencePolicy }));
      if (report.rejected.length) process.exitCode = 2;
    }
  }
} catch (error) {
  // OS errors can contain private filenames. Emit only a bounded category.
  const code = /^[A-Z0-9_]{1,64}$/.test(error.message) ? error.message : /^[A-Z0-9_]{1,64}$/.test(error.code ?? '') ? error.code : 'INPUT_OUTPUT_FAILURE';
  console.error(JSON.stringify({ error: code }));
  process.exitCode = 2;
}
