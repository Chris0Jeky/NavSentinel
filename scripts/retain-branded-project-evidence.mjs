import { cpSync, existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Preserve reports before the next Playwright project replaces their paths. */
export function retainBrandedProjectEvidence(project, root = process.cwd()) {
  if (!['smoke', 'regression', 'phase2'].includes(project)) throw new Error('Invalid branded project');
  const parent = join(root, 'artifacts', 'branded');
  const destination = join(parent, project);
  mkdirSync(parent, { recursive: true });
  // A second attempt must not silently replace the earlier evidence.
  mkdirSync(destination);
  const missing = [];
  for (const directory of ['test-results', 'playwright-report']) {
    const source = join(root, directory);
    if (!existsSync(source) || !lstatSync(source).isDirectory()) {
      missing.push(directory);
      continue;
    }
    cpSync(source, join(destination, directory), { recursive: true, force: false, errorOnExist: true });
  }
  for (const file of ['test-results/e2e-junit.xml', 'playwright-report/index.html']) {
    const saved = join(destination, file);
    if (!existsSync(saved) || !lstatSync(saved).isFile() || lstatSync(saved).size === 0) missing.push(file);
  }
  writeFileSync(join(destination, 'retention.json'), JSON.stringify({
    schema: 'navsentinel.branded-project-retention.v1', project,
    retentionComplete: missing.length === 0, missing,
  }, null, 2) + '\n', { flag: 'wx' });
  if (missing.length) throw new Error(`Missing branded project evidence: ${missing.join(', ')}`);
  return destination;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: retain-branded-project-evidence.mjs <smoke|regression|phase2>');
    retainBrandedProjectEvidence(process.argv[2]);
    console.log(`Retained branded ${process.argv[2]} evidence before the next project.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
