// Links the browser's ES modules (viewer/app/*.js and what they import) without running them, so a missing file or an
// import of a name that no module exports fails here, before any browser starts. Run by atlas/tools/check-all.mjs.
// Usage: node --experimental-vm-modules viewer/test/link.mjs
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');
const cache = new Map(), context = vm.createContext({});
function load(file) {
  if (!cache.has(file)) {
    if (!fs.existsSync(file)) throw new Error(`missing module ${path.relative(path.dirname(APP), file)}`);
    cache.set(file, new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { identifier: file, context }));
  }
  return cache.get(file);
}
const problems = [];
for (const f of fs.readdirSync(APP).filter(f => f.endsWith('.js'))) {
  const m = load(path.join(APP, f));
  if (m.status !== 'unlinked') continue;   // already linked as an import of an earlier module
  try { await m.link((spec, ref) => load(path.resolve(path.dirname(ref.identifier), spec))); }
  catch (e) { if (!problems.includes(e.message)) problems.push(e.message); }
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log(`linked ${cache.size} modules`);
