/** Read-only viewer qualification against this job's actual captured campaign. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { buildReport, supportsCompleteSet } from './model.mjs';
import { readInput, writeReport } from './io.mjs';

const input = path.resolve('test-results/observatory-campaign');
const traces = [];
// This directory is produced by the trusted campaign in the same job, not a ZIP
// or arbitrary browsing dump. Input bytes still cross the ordinary bounded reader.
for (const entry of fs.readdirSync(input, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const file = path.join(input, entry.name, 'full-trace.json');
  if (fs.existsSync(file)) traces.push(readInput(file));
}
assert.equal(traces.length, 2, 'both full recorded variants are required');
const report = buildReport(traces);
assert.equal(supportsCompleteSet(report), true, 'do not screenshot an incomplete campaign as a success');
assert.equal(report.cases.length, 8);
const output = writeReport('test-results/observatory-recorded-scenes', report);
const errors = [], requests = [];
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await context.route('http://**/*', route => route.abort());
  await context.route('https://**/*', route => route.abort());
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
  await page.goto(pathToFileURL(path.join(output, 'index.html')).href);
  await page.locator('.case-button').first().waitFor();
  for (const variant of ['stable-full', 'reinsertion-full']) {
    await page.locator('#search').fill(variant);
    assert.equal(await page.locator('.case-button').count(), 4);
    for (const arm of ['baseline', 'protected', 'benign', 'mixed']) {
      await page.locator('#arm-filter').selectOption(arm);
      await page.locator('.case-button').click();
      assert.equal(await page.locator('#scene-panel svg').count(), 0, 'no future geometry at run start');
      assert.equal(await page.locator('.receipt-link').count(), 0, 'no future receiver arrivals at run start');
      await page.locator('.event').filter({ hasText: 'scene.sample' }).last().click();
      assert.equal(await page.locator('#scene-panel svg').count(), 1);
      const attackBoxes = await page.locator('#scene-panel .scene-attack').count();
      assert.equal(arm === 'baseline' ? attackBoxes > 0 : attackBoxes === 0, true);
      await page.locator('.event').last().click();
      const expectedReceipts = arm === 'protected' ? 0 : 1;
      assert.equal(await page.locator('.receipt-link').count(), expectedReceipts);
      if (expectedReceipts) {
        await page.locator('.receipt-link').click();
        assert.equal(await page.locator('#event-detail h3').innerText(), 'sink.receipt');
        await page.locator('.event').last().click();
      }
      if (arm === 'baseline' || arm === 'protected') {
        await page.screenshot({ path: path.join(output, `${variant}-${arm}.png`), fullPage: true });
        await page.locator('#scene-panel').screenshot({ path: path.join(output, `${variant}-${arm}-geometry.png`) });
      }
      await page.locator('#arm-filter').selectOption('');
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.screenshot({ path: path.join(output, 'recorded-mobile.png'), fullPage: true });
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#download').click();
  const download = await downloadPromise;
  const file = path.join(output, 'download-checked.json');
  await download.saveAs(file);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), report);
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  console.log('Recorded viewer: 8 cases, sampled scenes, as-of-event receiver links, mobile overflow, exact JSON download, zero page HTTP requests — passed.');
} finally {
  await browser?.close();
}
