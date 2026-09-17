/** Read-only browser checks on this job's actual fault evidence. No simulated receipts. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { FAULT_IDS } from './fault-contract.mjs';

const output = path.resolve('test-results/observatory-fault-review');
const report = JSON.parse(fs.readFileSync(path.join(output, 'report.json'), 'utf8'));
assert.equal(report.faultQualification.passed, true, 'fault matrix must qualify before viewer checks');
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('http://**/*', route => route.abort());
  await context.route('https://**/*', route => route.abort());
  const page = await context.newPage(), errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  await page.goto(pathToFileURL(path.join(output, 'index.html')).href);
  await page.locator('.case-button').first().waitFor();
  assert.match(await page.locator('.notice').innerText(), /OBSERVER FAULT CHECKS/);
  assert.equal(await page.locator('.case-button').count(), FAULT_IDS.length);
  for (const id of FAULT_IDS) {
    await page.locator('#search').fill(`fault-${id}`);
    assert.equal(await page.locator('.case-button').count(), 1);
    await page.locator('.case-button').click();
    await page.locator('.event').last().click();
    assert.doesNotMatch(await page.locator('#verdict').innerText(), /BOUNDED PREVENTION SUPPORTED/);
    if (id === 'primary-frame-detached' || id === 'primary-document-replaced') {
      assert.equal(await page.locator('#scene-panel svg').count(), 0, 'removed/replaced frame invalidates old geometry');
    }
    await page.screenshot({ path: path.join(output, `${id}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.screenshot({ path: path.join(output, 'fault-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  console.log('Actual fault viewer: six trials, separate evidence labels, no stale-frame rendering, mobile layout, no page HTTP requests.');
} finally { await browser?.close(); }
