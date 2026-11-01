// Node harness: run MATLAB code and print the command-window output.
import { createEngine } from '../src/engine/index.js';
import fs from 'fs';
export function makeEngine(files = {}) {
  let outBuf = '';
  const inputs = [];
  const host = {
    write: (t, k) => { outBuf += (k === 'err' ? '' : '') + t; },
    input: (p) => { outBuf += p; const v = inputs.shift(); outBuf += (v ?? '') + '\n'; return v ?? ''; },
    readText: (n) => (n in files ? files[n] : null),
    fileExists: (n) => n in files,
    writeFile: (n, d) => { files[n] = d; },
    readBinary: (n) => files[n] ?? null,
    listFiles: () => Object.keys(files),
    deleteFile: (n) => { delete files[n]; },
    checkInterrupt: () => {},
    sleep: () => {}, waitKey: () => {}, clearScreen: () => { outBuf += '<<clc>>\n'; },
    plot: () => {},
  };
  const I = createEngine(host);
  return { I, run: (code) => { outBuf = ''; I.runCommand(code); return outBuf; }, script: (name, code) => { outBuf = ''; I.runScriptFile(name, code); return outBuf; }, inputs, files };
}
if (process.argv[1] && process.argv[1].endsWith('run.mjs') && process.argv[2]) {
  const { run } = makeEngine();
  const code = process.argv[2] === '-' ? fs.readFileSync(0, 'utf8') : process.argv[2];
  process.stdout.write(run(code));
}
