// Web Worker host for the MATLAB engine.
// Blocking operations (input, pause, keyboard wait) use SharedArrayBuffer + Atomics.
import { createEngine } from './index.js';
import { MError, className } from './value.js';
import { fmtState } from './format.js';
import { bytesOf } from './builtins/lang.js';
import { shortDesc } from './format.js';

let ctl = null, buf = null; // Int32Array control, Uint8Array data
let files = new Map();      // name -> string | Uint8Array
let interruptCounter = 0;
const post = (m, t) => self.postMessage(m, t || []);

function blockingRequest(msg) {
  if (!ctl) throw new MError('This browser does not allow blocking input here. Please reload the page (cross-origin isolation is required).');
  Atomics.store(ctl, 0, 0);
  post(msg);
  while (Atomics.load(ctl, 0) === 0) Atomics.wait(ctl, 0, 0, 500);
  const state = Atomics.load(ctl, 0);
  Atomics.store(ctl, 0, 0);
  if (state === 2) return null; // cancelled
  const len = Atomics.load(ctl, 2);
  return new TextDecoder().decode(buf.slice(0, len));
}

const host = {
  write(text, kind = 'out') { post({ type: 'out', text, kind }); },
  input(prompt) { return blockingRequest({ type: 'input', prompt }); },
  waitKey() { blockingRequest({ type: 'waitKey' }); },
  sleep(ms) {
    if (!ctl) return;
    const end = Date.now() + ms;
    while (Date.now() < end) {
      Atomics.wait(ctl, 3, 0, Math.min(100, end - Date.now()));
      if (Atomics.load(ctl, 1)) break;
    }
    host.checkInterrupt(true);
  },
  checkInterrupt(force) {
    if (!ctl) return;
    if (!force && (++interruptCounter & 1023)) return;
    if (Atomics.load(ctl, 1)) {
      Atomics.store(ctl, 1, 0);
      const e = new MError('Operation terminated by user.', 'MATLAB:interrupted');
      e.noHeader = true;
      throw e;
    }
  },
  clearScreen() { post({ type: 'clc' }); },
  readText(name) { const f = files.get(name); if (f == null) return null; return typeof f === 'string' ? f : new TextDecoder().decode(f); },
  readBinary(name) { const f = files.get(name); if (f == null) return null; return typeof f === 'string' ? new TextEncoder().encode(f) : f; },
  fileExists(name) { return files.has(name); },
  writeFile(name, data) { files.set(name, data); post({ type: 'writeFile', name, data }); },
  deleteFile(name) { files.delete(name); post({ type: 'deleteFile', name }); },
  listFiles() { return [...files.keys()].sort(); },
  plot(payload) { post({ type: 'plot', payload }); },
  saveFigure(id, name) { blockingRequest({ type: 'saveFigure', id, name }); },
  varsChanged() { varsDirty = true; },
};
let varsDirty = true;
const I = createEngine(host);

function workspaceList() {
  const out = [];
  for (const [name, v] of I.base.vars) {
    let value;
    try {
      if (v.type === 'num' && v.cls !== 'char' && (v.numel > 10 || v.rows > 1)) value = `${v.rows}×${v.cols} ${v.cls}${v.im ? ' (complex)' : ''}`;
      else if (v.type === 'cell' || v.type === 'struct' || v.type === 'table') value = `${v.rows}×${v.cols} ${className(v)}`;
      else value = shortDesc(v, 'struct');
      if (v.type === 'sym' && v.numel === 1) value = I.symToStr(v.exprs[0]);
    } catch (e) { value = '?'; }
    let min = '', max = '';
    if (v.type === 'num' && v.numel > 0 && v.cls !== 'char' && !v.im) { let a = Infinity, b = -Infinity; for (const x of v.re) { if (x < a) a = x; if (x > b) b = x; } min = fmtNum(a); max = fmtNum(b); }
    out.push({ name, value, size: `${v.rows}x${v.cols}`, cls: className(v), bytes: bytesOf(v), min, max });
  }
  return out.sort((p, q) => (p.name.toLowerCase() < q.name.toLowerCase() ? -1 : 1));
}
function fmtNum(x) { return Number.isInteger(x) ? String(x) : (+x.toPrecision(5)).toString(); }

self.onmessage = (ev) => {
  const m = ev.data;
  switch (m.type) {
    case 'init':
      if (m.sab) { ctl = new Int32Array(m.sab, 0, 4); buf = new Uint8Array(m.sab, 16); }
      if (m.width) fmtState.width = m.width;
      post({ type: 'ready', isolated: !!ctl });
      break;
    case 'files':
      files = new Map(Object.entries(m.files));
      I.fileCache.clear();
      break;
    case 'setFile':
      if (m.data == null) files.delete(m.name); else files.set(m.name, m.data);
      break;
    case 'width': fmtState.width = m.width; break;
    case 'run': {
      if (m.width) fmtState.width = m.width;
      if (ctl) Atomics.store(ctl, 1, 0);
      let ok = true;
      try {
        if (m.mode === 'script') ok = I.runScriptFile(m.name, m.code);
        else ok = I.runCommand(m.code);
      } catch (e) {
        ok = false;
        post({ type: 'out', text: `Internal error: ${e && e.message}\n`, kind: 'err' });
      }
      try { I.flushPlots(); } catch (e) { /* ignore */ }
      if (varsDirty) { post({ type: 'vars', list: workspaceList() }); varsDirty = false; }
      post({ type: 'done', id: m.id, ok });
      break;
    }
    case 'complete': {
      const names = [...I.base.vars.keys(), ...I.builtins.keys(), ...[...files.keys()].filter(f => f.endsWith('.m')).map(f => f.slice(0, -2))];
      post({ type: 'completions', id: m.id, list: [...new Set(names)].filter(n => n.startsWith(m.prefix) && !n.startsWith('__')).sort().slice(0, 50) });
      break;
    }
    case 'vars': post({ type: 'vars', list: workspaceList() }); break;
    case 'getVar': {
      const v = I.base.vars.get(m.name);
      let text = '';
      try { const { display } = m; void display; text = I.builtins.has('__display') ? '' : ''; } catch (e) { /* */ }
      post({ type: 'varView', name: m.name, text: v ? displayText(m.name, v) : '' });
      break;
    }
  }
};
import { display as displayText } from './format.js';
post({ type: 'loaded' });
