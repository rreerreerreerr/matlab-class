import { makeEngine } from './run.mjs';
import fs from 'fs';
const { run } = makeEngine();
const src = fs.readFileSync(process.argv[2], 'utf8');
// chunks: lines, except blocks between "%{{" and "%}}" run together
const chunks = []; let block = null;
for (const line of src.split('\n')) {
  if (line.trim() === '%{{') { block = []; continue; }
  if (line.trim() === '%}}') { chunks.push(block.join('\n')); block = null; continue; }
  if (block) block.push(line); else if (line.trim()) chunks.push(line);
}
for (const c of chunks) process.stdout.write('>> ' + c + '\n' + run(c));
