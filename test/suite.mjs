// Regression suite: runs every test/cases/*.m chunk by chunk and compares the
// Command Window output with test/golden/*.txt.  Use --update to rewrite goldens.
import fs from 'fs';
import path from 'path';
import { makeEngine } from './run.mjs';
const dir = path.dirname(new URL(import.meta.url).pathname);
const update = process.argv.includes('--update');
let failed = 0;
fs.mkdirSync(path.join(dir, 'golden'), { recursive: true });
for (const f of fs.readdirSync(path.join(dir, 'cases')).filter(f => f.endsWith('.m')).sort()) {
  const { run } = makeEngine();
  const src = fs.readFileSync(path.join(dir, 'cases', f), 'utf8');
  const chunks = []; let block = null;
  for (const line of src.split('\n')) {
    if (line.trim() === '%{{') { block = []; continue; }
    if (line.trim() === '%}}') { chunks.push(block.join('\n')); block = null; continue; }
    if (block) block.push(line); else if (line.trim()) chunks.push(line);
  }
  let out = '';
  for (const c of chunks) out += '>> ' + c + '\n' + run(c);
  out = out.replace(/\d{2}-[A-Z][a-z]{2}-\d{4} \d{2}:\d{2}:\d{2}/g, '<date>');
  const gold = path.join(dir, 'golden', f.replace(/\.m$/, '.txt'));
  if (update || !fs.existsSync(gold)) { fs.writeFileSync(gold, out); console.log(`wrote ${path.basename(gold)}`); continue; }
  const exp = fs.readFileSync(gold, 'utf8');
  if (exp === out) console.log(`ok   ${f}`);
  else {
    failed++;
    const a = exp.split('\n'), b = out.split('\n');
    const k = a.findIndex((l, i) => l !== b[i]);
    console.log(`FAIL ${f} (first difference at line ${k + 1})\n  expected: ${a[k]}\n  actual:   ${b[k]}`);
  }
}
process.exit(failed ? 1 : 0);
