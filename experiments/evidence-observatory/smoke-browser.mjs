/** Viewer-only browser qualification; no extension, attack fixture or efficacy claim. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { buildReport } from './model.mjs';
import { sceneDemonstration } from './scene-demo.mjs';
import { writeReport } from './io.mjs';

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'observatory-browser-'));
const screenshots = path.resolve('test-results', 'observatory-viewer-smoke');
fs.mkdirSync(screenshots, { recursive: true });
let browser;
try {
  const report = buildReport([JSON.stringify(sceneDemonstration())]);
  const output = writeReport(path.join(work, 'demo'), report);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage(), errors = [], remoteRequests = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) remoteRequests.push(request.url()); });
  await context.route('https://**/*', route => route.abort());
  await context.route('http://**/*', route => route.abort());
  await page.goto(pathToFileURL(path.join(output, 'index.html')).href);
  await page.locator('.case-button').first().waitFor();
  assert.equal(await page.locator('.case-button').count(), 4);
  assert.match(await page.locator('#verdict').innerText(), /HARM OBSERVED/);
  assert.equal(await page.locator('#scene-panel svg').count(), 0, 'no future geometry at run start');
  await page.locator('.event').filter({hasText:'scene.sample'}).first().click();
  assert.equal(await page.locator('#scene-panel svg .scene-attack').count(), 1);
  assert.match(await page.locator('#scene-panel').innerText(), /harm receiver/);
  await page.locator('#arm-filter').selectOption('protected');
  assert.equal(await page.locator('.case-button').count(), 1);
  await page.locator('.case-button').click();
  assert.match(await page.locator('#verdict').innerText(), /INCONCLUSIVE/);
  await page.locator('#next').click(); assert.match(await page.locator('#step-label').innerText(), /Event 2/);
  await page.locator('#scrub').focus(); await page.keyboard.press('ArrowRight');
  assert.match(await page.locator('#step-label').innerText(), /Event 3/);
  await page.locator('.event').filter({hasText:'scene.sample'}).last().click();
  assert.equal(await page.locator('#scene-panel svg .scene-attack').count(), 0);
  assert.match(await page.locator('#scene-panel').innerText(), /hidden/);
  await page.locator('#arm-filter').selectOption('');
  for (const [name, width, height] of [['desktop', 1440, 1000], ['tablet', 900, 1000], ['mobile', 390, 844]]) {
    await page.setViewportSize({ width, height });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${name} horizontal overflow`);
    await page.screenshot({ path: path.join(screenshots, `${name}.png`), fullPage: true });
  }
  const downloadPromise = page.waitForEvent('download'); await page.locator('#download').click(); const download = await downloadPromise;
  const downloaded = path.join(work, 'download.json'); await download.saveAs(downloaded);
  assert.deepEqual(JSON.parse(fs.readFileSync(downloaded, 'utf8')), report);
  const hostile = structuredClone(report); hostile.cases[0].title = '</script><img src="https://invalid.example/" onerror="globalThis.injected=true">';
  const hostileOutput = writeReport(path.join(work, 'hostile'), hostile);
  await page.goto(pathToFileURL(path.join(hostileOutput, 'index.html')).href);
  await page.locator('.case-button').first().waitFor();
  assert.equal(await page.locator('img').count(), 0);
  assert.equal(await page.evaluate(() => Boolean(globalThis.injected)), false);
  assert.deepEqual(errors, []); assert.deepEqual(remoteRequests, []);
  console.log('Viewer smoke passed: filtering, keyboard scrub, JSON download, desktop/tablet/mobile, hostile text, zero page HTTP requests.');
} finally {
  await browser?.close();
  fs.rmSync(work, { recursive: true, force: true });
}
