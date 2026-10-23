// Step 8 intake: move every atlas/inbox/*.targets.json into the queue, then archive it.
// Usage: node atlas/tools/ingest.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './lib.mjs';

const inbox = path.join(ROOT, 'inbox');
const done = path.join(inbox, 'processed');
fs.mkdirSync(done, { recursive: true });
for (const f of fs.readdirSync(inbox).filter(f => f.endsWith('.targets.json'))) {
  const p = path.join(inbox, f);
  try {
    const items = JSON.parse(fs.readFileSync(p, 'utf8'))
      .map(it => ({ source: 'discovery', ...it, source_type: undefined }));
    fs.writeFileSync(p, JSON.stringify(items));
    const out = execFileSync(process.execPath, [path.join(ROOT, 'tools', 'queue.mjs'), 'add', p], { encoding: 'utf8' });
    console.log(`${f}: ${out.trim().split('\n').pop()}`);
    fs.renameSync(p, path.join(done, f));
  } catch (e) { console.log(`${f}: ERROR ${e.message}`); }
}
