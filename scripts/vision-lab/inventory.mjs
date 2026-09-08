import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const source = path.resolve(process.argv[2] || 'RESOURCES/NavSentinel-Vision-Lab');
const destination = path.resolve(process.argv[3] || 'docs/vision-overhaul/RESOURCE_INVENTORY.json');
const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true}).sort((a,b)=>a.name.localeCompare(b.name))) {
    if (['.local', 'node_modules', '__pycache__', '.git'].includes(entry.name)) continue;
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Inventory refuses links: ${filename}`);
    if (entry.isDirectory()) { walk(filename); continue; }
    const relative = path.relative(source, filename).split(path.sep).join('/');
    const bytes = fs.readFileSync(filename);
    const category = relative.startsWith('artifacts/') ? 'historical-validation' :
      /^NavSentinel-.*\.html$/.test(relative) ? 'generated-prototype' :
      relative.includes('/') ? relative.split('/')[0] : 'entrypoint-or-package';
    files.push({path:relative,category,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
  }
}
walk(source);
const inventory = {schema:1,source:'NavSentinel-Vision-Lab',recordedAt:new Date().toISOString(),
  note:'Original owner-provided bundle. Hashes identify files; historical validation is not a current pass. Local credentials, dependencies and caches excluded.',
  fileCount:files.length,totalBytes:files.reduce((sum,file)=>sum+file.bytes,0),files};
fs.mkdirSync(path.dirname(destination), {recursive:true});
fs.writeFileSync(destination,JSON.stringify(inventory,null,2)+'\n');
console.log(`Mapped ${inventory.fileCount} files (${inventory.totalBytes} bytes).`);
