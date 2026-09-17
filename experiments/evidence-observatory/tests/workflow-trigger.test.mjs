import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const workflowPath = '.github/workflows/observatory-campaign.yml';
const specPath = 'tests/e2e/observatory-overlay.spec.ts';

function pullRequestFilters(workflow) {
  const block = /pull_request:\s*\n\s+paths:\s*\n((?:\s+-\s+['"][^'"\n]+['"]\s*\n)+)/u.exec(workflow)?.[1];
  assert.ok(block, 'pull_request.paths must remain explicit');
  return [...block.matchAll(/-\s+['"]([^'"]+)['"]/gu)].map(match => match[1]);
}

function globMatches(pattern, value) {
  let source = '^';
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index];
    if (character === '*' && pattern[index + 1] === '*') {
      source += '.*';
      index++;
    } else if (character === '*') {
      source += '[^/]*';
    } else {
      source += character.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    }
  }
  return new RegExp(`${source}$`, 'u').test(value);
}

function directCampaignDependencies(spec) {
  const dependencies = new Set([specPath]);
  for (const match of spec.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/gu)) {
    const specifier = match[1];
    let resolved = path.posix.normalize(path.posix.join(path.posix.dirname(specPath), specifier));
    if (!path.posix.extname(resolved)) resolved += '.ts';
    dependencies.add(resolved);
  }
  for (const match of spec.matchAll(/["'](gym\/[^"']+)["']/gu)) dependencies.add(match[1]);
  return [...dependencies].sort();
}

test('recorded campaign trigger covers every direct fixture and bootstrap dependency', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const spec = fs.readFileSync(specPath, 'utf8');
  const filters = pullRequestFilters(workflow);
  const uncovered = directCampaignDependencies(spec).filter(
    dependency => !filters.some(filter => globMatches(filter, dependency)),
  );
  assert.deepEqual(uncovered, []);
});
