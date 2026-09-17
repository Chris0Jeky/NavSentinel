import path from 'node:path';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: path.resolve(import.meta.dirname, '../../tests/e2e'),
  testMatch: 'observatory-overlay.spec.ts',
  fullyParallel: false, workers: 1, retries: 0, failOnFlakyTests: true,
  outputDir: path.resolve('test-results/observatory-campaign'),
  reporter: [['list'], [path.resolve(import.meta.dirname, 'reporter.mjs'), { output: path.resolve('test-results/observatory-campaign-report') }]],
});
