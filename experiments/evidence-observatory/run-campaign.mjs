#!/usr/bin/env node
/** Explicit opt-in campaign: build current exact inputs, then run inert local tests. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { captureInputs, hashArtifact } from './source-inputs.mjs';

try {
  if (process.argv.length !== 2 || process.env.EXTENSION_PATH || process.env.GYM_BASE_URL) throw new Error('EXTERNAL_ARTIFACT_OR_ARGUMENT_REFUSED');
  const source = captureInputs();
  const report = path.resolve('test-results/observatory-campaign-report');
  if (fs.existsSync(report)) throw new Error('REPORT_ALREADY_EXISTS_USE_FRESH_WORKSPACE');
  execFileSync(process.execPath, ['scripts/build-extension.mjs'], { stdio: 'inherit' });
  const after = captureInputs();
  if (source.digest !== after.digest || source.head !== after.head) throw new Error('SOURCE_CHANGED_DURING_BUILD');
  const artifact = hashArtifact('extension/dist');
  const input = path.resolve('test-results/observatory-input-binding.json');
  fs.mkdirSync(path.dirname(input), { recursive: true });
  fs.writeFileSync(input, JSON.stringify({ source, artifact }), { mode: 0o600 });
  execFileSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '-c', 'experiments/evidence-observatory/playwright.config.mjs'],
    { stdio: 'inherit', env: { ...process.env, NAVSENTINEL_OBSERVATORY_INPUTS: input } });
} catch (error) {
  console.error(JSON.stringify({ error: /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'CAMPAIGN_FAILED', exitStatus: error.status ?? 1 }));
  process.exitCode = 1;
}
