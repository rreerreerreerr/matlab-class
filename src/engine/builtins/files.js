// File I/O: MAT-files (v5), text/CSV, Excel, and table support.
import * as XLSX from 'xlsx';
import { unzlibSync, zlibSync } from 'fflate';
import { Tensor, Cell, Struct, StrArr, Table, MError, num, bool, str, empty, zeros, rowVec, colVec, toStr, toNumber, isChar, className, charRows } from '../value.js';
import { isStr, toStringList } from './util.js';
import { subsref, COLON } from '../indexing.js';
import { display, tableCellStr } from '../format.js';
import { charMatrix } from './strings.js';
import { meanOf, medianOf, varOf } from './core.js';

const CLASS_IDS = { 1: 'cell', 2: 'struct', 3: 'object', 4: 'char', 5: 'sparse', 6: 'double', 7: 'single', 8: 'int8', 9: 'uint8', 10: 'int16', 11: 'uint16', 12: 'int32', 13: 'uint32', 14: 'int64', 15: 'uint64' };

// ---------------- MAT v5 reader ----------------
export function readMat(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length < 128) throw new MError('Unable to read MAT-file: file may be corrupt.', '', 'load');
  const head = new TextDecoder('latin1').decode(u8.slice(0, 116));
  if (/MATLAB 7\.3/.test(head) || (u8[0] === 0x89 && u8[1] === 0x48)) throw new MError("This MAT-file was saved in version 7.3 (HDF5) format, which is not supported here. In MATLAB, re-save it with: save('file.mat', '-v7')", '', 'load');
  if (!/^MATLAB 5\.0 MAT-file/.test(head)) throw new MError('Unable to read MAT-file: not a binary MAT-file. Try LOAD -ASCII to read as text.', '', 'load');
  const little = String.fromCharCode(u8[126], u8[127]) === 'IM';
  const vars = [];
  let off = 128;
  while (off + 8 <= u8.length) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const type = dv.getUint32(off, little); const nbytes = dv.getUint32(off + 4, little);
    const body = u8.subarray(off + 8, off + 8 + nbytes);
    off += 8 + nbytes; if (type !== 15) off += (8 - (nbytes % 8)) % 8;
    let elType = type, elBody = body;
    if (type === 15) {
      const inflated = unzlibSync(body);
      const dv2 = new DataView(inflated.buffer, inflated.byteOffset, inflated.byteLength);
      elType = dv2.getUint32(0, little); const n2 = dv2.getUint32(4, little);
      elBody = inflated.subarray(8, 8 + n2);
    }
    if (elType !== 14) continue;
    try {
      const { name, value } = parseMatrix(elBody, little);
      if (value) vars.push([name, value]);
    } catch (e) { if (e instanceof MError) throw e; throw new MError('Unable to read MAT-file: ' + e.message, '', 'load'); }
  }
  return vars;
}
function readElement(u8, off, little) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const first = dv.getUint32(off, little);
  const small = (first >>> 16) !== 0;
  if (small) { const type = first & 0xffff, n = first >>> 16; return { type, data: u8.subarray(off + 4, off + 4 + n), next: off + 8 }; }
  const n = dv.getUint32(off + 4, little);
  const next = off + 8 + n + ((8 - (n % 8)) % 8);
  return { type: first, data: u8.subarray(off + 8, off + 8 + n), next };
}
function typedValues(type, data, little) {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const sizes = { 1: 1, 2: 1, 3: 2, 4: 2, 5: 4, 6: 4, 7: 4, 9: 8, 12: 8, 13: 8, 16: 1, 17: 2, 18: 4 };
  const sz = sizes[type] || 1; const n = Math.floor(data.length / sz); const out = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const o = k * sz;
    switch (type) {
      case 1: out[k] = dv.getInt8(o); break; case 2: case 16: out[k] = dv.getUint8(o); break;
      case 3: out[k] = dv.getInt16(o, little); break; case 4: case 17: out[k] = dv.getUint16(o, little); break;
      case 5: out[k] = dv.getInt32(o, little); break; case 6: case 18: out[k] = dv.getUint32(o, little); break;
      case 7: out[k] = dv.getFloat32(o, little); break; case 9: out[k] = dv.getFloat64(o, little); break;
      case 12: out[k] = Number(dv.getBigInt64(o, little)); break; case 13: out[k] = Number(dv.getBigUint64(o, little)); break;
    }
  }
  return out;
}
function parseMatrix(u8, little) {
  if (u8.length === 0) return { name: '', value: empty() };
  let e = readElement(u8, 0, little);
  const flags = typedValues(e.type, e.data, little);
  const cls = CLASS_IDS[flags[0] & 0xff]; const complex = !!(flags[0] & 0x800); const logical = !!(flags[0] & 0x200);
  e = readElement(u8, e.next, little);
  const dims = Array.from(typedValues(e.type, e.data, little));
  e = readElement(u8, e.next, little);
  const name = new TextDecoder('latin1').decode(e.data);
  let off = e.next;
  const rows = dims[0], cols = dims.slice(1).reduce((p, q) => p * q, 1);
  if (dims.length > 2 && dims.slice(2).some(d => d !== 1)) {
    // flatten N-D into 2-D (rows x rest)
  }
  if (cls === 'cell') {
    const data = [];
    for (let k = 0; k < rows * cols; k++) { const el = readElement(u8, off, little); data.push(parseMatrix(el.data, little).value); off = el.next; }
    return { name, value: new Cell(rows, cols, data) };
  }
  if (cls === 'struct') {
    let el = readElement(u8, off, little); const flen = typedValues(el.type, el.data, little)[0]; off = el.next;
    el = readElement(u8, off, little); const names = []; for (let k = 0; k < el.data.length / flen; k++) names.push(new TextDecoder('latin1').decode(el.data.subarray(k * flen, (k + 1) * flen)).replace(/\0.*$/, '')); off = el.next;
    const data = [];
    for (let k = 0; k < rows * cols; k++) {
      const m = new Map();
      for (const f of names) { const el2 = readElement(u8, off, little); m.set(f, parseMatrix(el2.data, little).value); off = el2.next; }
      data.push(m);
    }
    return { name, value: new Struct(rows, cols, names, data) };
  }
  if (cls === 'object') return { name, value: null };
  if (cls === 'sparse') {
    let el = readElement(u8, off, little); const ir = typedValues(el.type, el.data, little); off = el.next;
    el = readElement(u8, off, little); const jc = typedValues(el.type, el.data, little); off = el.next;
    el = readElement(u8, off, little); const pr = typedValues(el.type, el.data, little);
    const t = zeros(rows, cols);
    for (let j = 0; j < cols; j++) for (let k = jc[j]; k < jc[j + 1]; k++) t.re[j * rows + ir[k]] = logical ? 1 : pr[k];
    if (logical) t.cls = 'logical';
    return { name, value: t };
  }
  let el = readElement(u8, off, little);
  let re = typedValues(el.type, el.data, little); off = el.next;
  let im = null;
  if (complex) { el = readElement(u8, off, little); im = typedValues(el.type, el.data, little); }
  if (re.length < rows * cols) { const r2 = new Float64Array(rows * cols); r2.set(re); re = r2; }
  const t = new Tensor(rows, cols, re.length === rows * cols ? re : re.slice(0, rows * cols), im, logical ? 'logical' : cls);
  return { name, value: t };
}

// ---------------- MAT v5 writer ----------------
export function writeMat(vars) {
  const chunks = [];
  const header = new Uint8Array(128);
  const text = `MATLAB 5.0 MAT-file, Platform: WEB, Created on: ${new Date().toUTCString()}`;
  for (let k = 0; k < 116; k++) header[k] = k < text.length ? text.charCodeAt(k) : 32;
  header[124] = 0x00; header[125] = 0x01; header[126] = 'I'.charCodeAt(0); header[127] = 'M'.charCodeAt(0);
  chunks.push(header);
  for (const [name, v] of vars) {
    const el = matrixElement(name, v);
    if (!el) continue;
    const comp = zlibSync(elem(14, el));
    const tag = new Uint8Array(8); const dv = new DataView(tag.buffer); dv.setUint32(0, 15, true); dv.setUint32(4, comp.length, true);
    chunks.push(tag, comp);
  }
  const total = chunks.reduce((s, c) => s + c.length, 0); const out = new Uint8Array(total); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
function elem(type, bytes) {
  const pad = (8 - (bytes.length % 8)) % 8;
  const out = new Uint8Array(8 + bytes.length + pad); const dv = new DataView(out.buffer);
  dv.setUint32(0, type, true); dv.setUint32(4, bytes.length, true); out.set(bytes, 8);
  return out;
}
const concatU8 = (arrs) => { const n = arrs.reduce((s, a) => s + a.length, 0); const o = new Uint8Array(n); let k = 0; for (const a of arrs) { o.set(a, k); k += a.length; } return o; };
function matrixElement(name, v) {
  const CLS = { cell: 1, struct: 2, char: 4, double: 6, single: 7, int8: 8, uint8: 9, int16: 10, uint16: 11, int32: 12, uint32: 13, int64: 14, uint64: 15, logical: 9 };
  let cls = v.type === 'num' ? v.cls : v.type;
  if (v.type === 'string') { v = charMatrix(v.data); cls = 'char'; }
  if (!(cls in CLS)) return null;
  const flagsB = new Uint8Array(8); const fdv = new DataView(flagsB.buffer);
  fdv.setUint32(0, CLS[cls] | (v.type === 'num' && v.im ? 0x800 : 0) | (cls === 'logical' ? 0x200 : 0), true);
  const dimsB = new Uint8Array(8); const ddv = new DataView(dimsB.buffer); ddv.setInt32(0, v.rows, true); ddv.setInt32(4, v.cols, true);
  const parts = [elem(6, flagsB), elem(5, dimsB), elem(1, new TextEncoder().encode(name))];
  if (v.type === 'num') {
    const f64 = (arr) => { if (cls === 'char') { const b = new Uint8Array(arr.length * 2); const dv = new DataView(b.buffer); arr.forEach((x, k) => dv.setUint16(k * 2, x, true)); return elem(4, b); } if (cls === 'logical') return elem(2, Uint8Array.from(arr)); const b = new Uint8Array(arr.length * 8); const dv = new DataView(b.buffer); arr.forEach((x, k) => dv.setFloat64(k * 8, x, true)); return elem(9, b); };
    parts.push(f64(v.re)); if (v.im) parts.push(f64(v.im));
  } else if (v.type === 'cell') {
    for (const x of v.data) { const e = matrixElement('', x) || matrixElement('', empty()); parts.push(elem(14, e)); }
  } else if (v.type === 'struct') {
    const flen = Math.max(...v.fields.map(f => f.length), 0) + 1;
    const lb = new Uint8Array(4); new DataView(lb.buffer).setInt32(0, flen, true);
    parts.push(concatU8([new Uint8Array([5, 0, 4, 0]), lb]));
    const names = new Uint8Array(flen * v.fields.length); v.fields.forEach((f, k) => { for (let q = 0; q < f.length; q++) names[k * flen + q] = f.charCodeAt(q); });
    parts.push(elem(1, names));
    for (const m of v.data) for (const f of v.fields) { const e = matrixElement('', m.get(f)) || matrixElement('', empty()); parts.push(elem(14, e)); }
  }
  return concatU8(parts);
}

// ---------------- text parsing ----------------
function parseNumberCell(s) {
  const t = s.trim();
  if (t === '') return NaN;
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eEdD][+-]?\d+)?$/.test(t)) return parseFloat(t.replace(/[dD]/, 'e'));
  if (/^[+-]?inf$/i.test(t)) return t.startsWith('-') ? -Infinity : Infinity;
  if (/^(nan|na|n\/a)$/i.test(t)) return NaN;
  return null;
}
function splitCSVLine(line, delim) {
  const out = []; let cur = '', q = false;
  for (let k = 0; k < line.length; k++) {
    const c = line[k];
    if (q) { if (c === '"') { if (line[k + 1] === '"') { cur += '"'; k++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (delim === ' ' ? /\s/.test(c) : c === delim) { if (!(delim === ' ' && cur === '')) { out.push(cur); cur = ''; } }
    else cur += c;
  }
  out.push(cur);
  return out;
}
function detectDelim(text) {
  const line = text.split(/\r?\n/).find(l => l.trim()) || '';
  if (line.includes(',')) return ','; if (line.includes('\t')) return '\t'; if (line.includes(';')) return ';'; return ' ';
}
function textToGrid(text, delim) {
  delim = delim || detectDelim(text);
  return text.split(/\r?\n/).filter(l => l.trim() !== '').map(l => splitCSVLine(l, delim));
}
function sanitizeName(s, k) {
  let n = s.trim().replace(/[^A-Za-z0-9_]/g, '_');
  if (!/^[A-Za-z]/.test(n)) n = n ? 'x' + n : `Var${k + 1}`;
  return n.slice(0, 63);
}
export function gridToTable(grid, header = true) {
  if (!grid.length) return new Table([], [], 0);
  const width = Math.max(...grid.map(r => r.length));
  let names, rows;
  const firstNumeric = grid[0].every(c => parseNumberCell(c) !== null);
  if (header && !firstNumeric) { names = grid[0].map(sanitizeName); rows = grid.slice(1); }
  else { names = Array.from({ length: width }, (_, k) => `Var${k + 1}`); rows = grid; }
  while (names.length < width) names.push(`Var${names.length + 1}`);
  const seen = new Set(); names = names.map(n => { let m = n, k = 1; while (seen.has(m)) m = `${n}_${k++}`; seen.add(m); return m; });
  const n = rows.length;
  const columns = names.map((_, j) => {
    const cells = rows.map(r => (r[j] ?? '').trim());
    const nums = cells.map(parseNumberCell);
    if (nums.every(x => x !== null)) return colVec(nums);
    return new Cell(n, 1, cells.map(s => str(s)));
  });
  return new Table(names, columns, n);
}
function gridToNumeric(grid, r0 = 0, c0 = 0) {
  const rows = grid.slice(r0).map(r => r.slice(c0));
  const w = Math.max(0, ...rows.map(r => r.length));
  const t = zeros(rows.length, w);
  rows.forEach((r, i) => { for (let j = 0; j < w; j++) { const v = r[j] === undefined ? 0 : parseNumberCell(r[j]); t.re[j * rows.length + i] = v === null ? NaN : (Number.isNaN(v) && (r[j] ?? '').trim() === '' ? 0 : v); } });
  return t;
}

// ---------------- Excel ----------------
function readWorkbook(I, name) {
  const bin = I.host.readBinary(name);
  if (!bin) throw new MError(`Unable to open file '${name}'. File '${name}' not found.`, '', 'xlsread');
  if (/\.(csv|txt)$/i.test(name)) return XLSX.read(new TextDecoder().decode(bin), { type: 'string' });
  return XLSX.read(bin, { type: 'array' });
}
function sheetCells(wb, sheet, range) {
  const ws = typeof sheet === 'number' ? wb.Sheets[wb.SheetNames[sheet - 1]] : wb.Sheets[sheet || wb.SheetNames[0]];
  if (!ws) throw new MError(`Worksheet '${sheet}' not found.`, '', 'xlsread');
  const ref = range || ws['!ref'];
  if (!ref) return [];
  const rg = XLSX.utils.decode_range(ref);
  const grid = [];
  for (let r = rg.s.r; r <= rg.e.r; r++) {
    const row = [];
    for (let c = rg.s.c; c <= rg.e.c; c++) { const cell = ws[XLSX.utils.encode_cell({ r, c })]; row.push(cell ? cell.v : null); }
    grid.push(row);
  }
  return grid;
}

export function installFiles(I) {
  const R = (name, fn, opts) => I.register(name, fn, opts);

  R('save', (a, nout, ctx) => {
    let args = a.map(x => toStr(x));
    let fname = 'matlab.mat';
    const opts = args.filter(s => s.startsWith('-')); args = args.filter(s => !s.startsWith('-'));
    if (args.length) { fname = args.shift(); }
    if (!/\.\w+$/.test(fname)) fname += '.mat';
    const ws = ctx.frame.ws;
    let names = args.length ? args : [...ws.vars.keys()];
    const vars = [];
    for (const n of names) {
      if (n.includes('*')) { const re = new RegExp('^' + n.replace(/\*/g, '.*') + '$'); for (const k of ws.vars.keys()) if (re.test(k)) vars.push([k, ws.vars.get(k)]); continue; }
      const v = I.lookupVar(ctx.frame, n);
      if (v === undefined) throw new MError(`Variable '${n}' not found.`, '', 'save');
      vars.push([n, v]);
    }
    if (opts.includes('-ascii')) {
      const lines = [];
      for (const [, v] of vars) for (let i = 0; i < v.rows; i++) { const r = []; for (let j = 0; j < v.cols; j++) r.push(' ' + v.re[j * v.rows + i].toExponential(7).replace(/e([+-])(\d)$/, 'e$10$2')); lines.push(r.join('  ')); }
      I.host.writeFile(fname, lines.join('\n') + '\n');
      return;
    }
    const tables = vars.filter(([, v]) => v.type === 'table' || v.type === 'sym' || v.type === 'fh');
    if (tables.length) I.warn(`Variables of class ${className(tables[0][1])} are not saved to MAT-files in this environment.`);
    I.host.writeFile(fname, writeMat(vars));
    if (ctx.isStatement && !args.length && a.length <= 1) I.write(`Saving to: /MATLAB Drive/${fname}\n`);
  });
  R('load', (a, nout, ctx) => {
    const args = a.map(x => toStr(x)).filter(s => !s.startsWith('-'));
    let fname = args.length ? args.shift() : 'matlab.mat';
    let bin = I.host.readBinary(fname);
    if (!bin && !/\.\w+$/.test(fname)) { const alt = fname + '.mat'; bin = I.host.readBinary(alt); if (bin) fname = alt; }
    if (!bin) throw new MError(`Unable to find file or directory '${fname}'.`, 'MATLAB:load:couldNotReadFile', 'load');
    const isMat = /\.mat$/i.test(fname) && bin.length >= 128 && /MATLAB/.test(new TextDecoder('latin1').decode(bin.slice(0, 20)));
    if (!isMat) {
      const text = new TextDecoder().decode(bin);
      const grid = textToGrid(text.split('\n').filter(l => !/^\s*%/.test(l)).join('\n'));
      const t = gridToNumeric(grid);
      for (let k = 0; k < t.numel; k++) if (Number.isNaN(t.re[k])) throw new MError(`Unable to read file '${fname}'. Input must be a MAT-file or an ASCII file containing numeric data with same number of columns in each row.`, '', 'load');
      if (nout) return t;
      const vname = sanitizeName(fname.replace(/\.[^.]*$/, '').replace(/^.*\//, ''), 0);
      I.setVar(ctx.frame, vname, t); return;
    }
    let vars = readMat(bin);
    if (args.length) vars = vars.filter(([n]) => args.includes(n));
    if (nout) { const s = new Struct(1, 1, vars.map(v => v[0])); vars.forEach(([n, v]) => s.data[0].set(n, v)); return s; }
    for (const [n, v] of vars) I.setVar(ctx.frame, n, v);
    if (!vars.length) I.warn('Variable(s) not found or file contains objects that cannot be loaded here (e.g. tables).');
  });
  R('whos_file', () => {});

  const readText = (name, fname) => { const t = I.host.readText(name); if (t == null) throw new MError(`File '${name}' not found.`, '', fname); return t; };
  R('csvread', (a) => { const name = toStr(a[0]); const grid = textToGrid(readText(name, 'csvread'), ','); const r0 = a.length > 1 ? toNumber(a[1]) : 0, c0 = a.length > 2 ? toNumber(a[2]) : 0; return gridToNumeric(grid, r0, c0); });
  R('dlmread', (a) => { const name = toStr(a[0]); const d = a.length > 1 && isStr(a[1]) ? toStr(a[1]).replace('\\t', '\t') : undefined; const grid = textToGrid(readText(name, 'dlmread'), d); const r0 = a.length > 2 ? toNumber(a[a.length - 2]) : 0, c0 = a.length > 2 ? toNumber(a[a.length - 1]) : 0; return gridToNumeric(grid, r0, c0); });
  R('readmatrix', (a) => {
    const name = toStr(a[0]);
    if (/\.xlsx?$/i.test(name)) { const g = sheetCells(readWorkbook(I, name)); const nums = g.filter(r => r.some(v => typeof v === 'number')); const t = zeros(nums.length, Math.max(...nums.map(r => r.length))); nums.forEach((r, i) => r.forEach((v, j) => (t.re[j * nums.length + i] = typeof v === 'number' ? v : NaN))); return t; }
    const grid = textToGrid(readText(name, 'readmatrix'));
    const first = grid[0] && grid[0].some(c => parseNumberCell(c) === null) ? 1 : 0;
    return gridToNumeric(grid, first, 0);
  });
  R('csvwrite', (a) => { const v = a[1]; const lines = []; for (let i = 0; i < v.rows; i++) { const r = []; for (let j = 0; j < v.cols; j++) r.push(String(+v.re[j * v.rows + i].toPrecision(5))); lines.push(r.join(',')); } I.host.writeFile(toStr(a[0]), lines.join('\n') + '\n'); });
  R('dlmwrite', (a) => { const v = a[1]; const d = a.length > 2 && isStr(a[2]) ? toStr(a[2]).replace('\\t', '\t') : ','; const lines = []; for (let i = 0; i < v.rows; i++) { const r = []; for (let j = 0; j < v.cols; j++) r.push(String(+v.re[j * v.rows + i].toPrecision(5))); lines.push(r.join(d)); } I.host.writeFile(toStr(a[0]), lines.join('\n') + '\n'); });
  R('writematrix', (a) => { const v = a[0]; const name = a.length > 1 ? toStr(a[1]) : 'matrix.txt'; const lines = []; for (let i = 0; i < v.rows; i++) { const r = []; for (let j = 0; j < v.cols; j++) r.push(String(v.re[j * v.rows + i])); lines.push(r.join(',')); } I.host.writeFile(name, lines.join('\n') + '\n'); });
  R('readtable', (a) => {
    const name = toStr(a[0]);
    if (/\.xlsx?$/i.test(name)) {
      const g = sheetCells(readWorkbook(I, name)).map(r => r.map(v => (v === null ? '' : String(v))));
      return gridToTable(g);
    }
    let delim;
    for (let k = 1; k + 1 < a.length; k += 2) if (toStr(a[k]).toLowerCase() === 'delimiter') delim = toStr(a[k + 1]).replace('\\t', '\t');
    return gridToTable(textToGrid(readText(name, 'readtable'), delim));
  });
  R('writetable', (a) => {
    const T = a[0]; const name = a.length > 1 ? toStr(a[1]) : 'table.txt';
    const lines = [T.varNames.join(',')];
    for (let i = 0; i < T.rows; i++) lines.push(T.columns.map(c => (c.type === 'cell' ? toStr(c.data[i]) : String(c.re[i]))).join(','));
    I.host.writeFile(name, lines.join('\n') + '\n');
  });
  R('xlsread', (a, nout) => {
    const name = toStr(a[0]);
    let sheet, range;
    for (const x of a.slice(1)) { if (isStr(x)) { const s = toStr(x); if (/^[A-Z]+\d+(:[A-Z]+\d+)?$/i.test(s)) range = s; else sheet = s; } else if (x.type === 'num' && x.numel === 1 && x.re[0] !== -1) sheet = x.re[0]; }
    const g = sheetCells(readWorkbook(I, name), sheet, range);
    // num: numeric block trimmed of leading/trailing all-text rows/cols
    let r0 = 0, r1 = g.length - 1, c0 = 0, c1 = Math.max(0, ...g.map(r => r.length)) - 1;
    const isN = (v) => typeof v === 'number';
    while (r0 <= r1 && !g[r0].some(isN)) r0++;
    while (r1 >= r0 && !g[r1].some(isN)) r1--;
    while (c0 <= c1 && !g.slice(r0, r1 + 1).some(r => isN(r[c0]))) c0++;
    while (c1 >= c0 && !g.slice(r0, r1 + 1).some(r => isN(r[c1]))) c1--;
    const nr = Math.max(0, r1 - r0 + 1), nc = Math.max(0, c1 - c0 + 1);
    const numT = zeros(nr, nc);
    for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) { const v = g[r0 + i][c0 + j]; numT.re[j * nr + i] = isN(v) ? v : NaN; }
    const R0 = g.length, C0 = Math.max(0, ...g.map(r => r.length));
    // txt: cell with text, trimmed to region containing text
    let tr1 = -1, tc1 = -1; g.forEach((r, i) => r.forEach((v, j) => { if (typeof v === 'string') { tr1 = Math.max(tr1, i); tc1 = Math.max(tc1, j); } }));
    const txt = new Cell(tr1 + 1, tc1 + 1, []);
    for (let i = 0; i <= tr1; i++) for (let j = 0; j <= tc1; j++) { const v = g[i][j]; txt.data[j * (tr1 + 1) + i] = str(typeof v === 'string' ? v : ''); }
    const raw = new Cell(R0, C0, []);
    for (let i = 0; i < R0; i++) for (let j = 0; j < C0; j++) { const v = g[i][j]; raw.data[j * R0 + i] = v === null || v === undefined ? num(NaN) : isN(v) ? num(v) : typeof v === 'boolean' ? bool(v) : str(String(v)); }
    return [numT, txt, raw];
  });
  R('xlswrite', (a) => {
    const name = toStr(a[0]); const data = a[1];
    let sheet = 'Sheet1', start = 'A1';
    for (const x of a.slice(2)) { if (isStr(x)) { const s = toStr(x); if (/^[A-Z]+\d+/i.test(s)) start = s.split(':')[0]; else sheet = s; } else if (x.type === 'num') sheet = 'Sheet' + x.re[0]; }
    let wb;
    const bin = I.host.readBinary(name);
    wb = bin ? XLSX.read(bin, { type: 'array' }) : XLSX.utils.book_new();
    let ws = wb.Sheets[sheet];
    if (!ws) { ws = XLSX.utils.aoa_to_sheet([]); XLSX.utils.book_append_sheet(wb, ws, sheet); }
    const aoa = [];
    for (let i = 0; i < data.rows; i++) {
      const r = [];
      for (let j = 0; j < data.cols; j++) {
        if (data.type === 'cell') { const v = data.data[j * data.rows + i]; r.push(isChar(v) ? toStr(v) : v.type === 'num' && v.numel ? v.re[0] : null); }
        else if (data.type === 'num' && data.cls === 'char') { r.push(charRows(data)[i]); break; }
        else r.push(data.re[j * data.rows + i]);
      }
      aoa.push(r);
    }
    XLSX.utils.sheet_add_aoa(ws, aoa, { origin: start });
    const outB = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    I.host.writeFile(name, new Uint8Array(outB));
  });
  R('writecell', (a) => I.builtins.get('xlswrite').fn([a[1], a[0]]));

  // ---------------- tables ----------------
  R('table', (a, nout, ctx) => {
    let names = null; const cols = [];
    const args = a.slice();
    for (let k = 0; k < args.length; k++) if (isStr(args[k]) && toStr(args[k]) === 'VariableNames') { names = toStringList(args[k + 1]); args.splice(k, 2); break; }
    for (const v of args) cols.push(v.rows === 1 && v.cols > 1 && v.type !== 'num' ? v : v.rows === 1 && v.cols > 1 ? I.builtins.get('transpose').fn([v]) : v);
    const n = cols.length ? cols[0].rows : 0;
    for (const c of cols) if (c.rows !== n) throw new MError('All table variables must have the same number of rows.', '', 'table');
    names = names || cols.map((_, k) => `Var${k + 1}`);
    return new Table(names, cols, n);
  });
  R('array2table', (a) => {
    const v = a[0]; let names = null;
    for (let k = 1; k + 1 < a.length; k++) if (toStr(a[k]) === 'VariableNames') names = toStringList(a[k + 1]);
    const cols = []; for (let j = 0; j < v.cols; j++) cols.push(subsref(v, [COLON, num(j + 1)]));
    return new Table(names || cols.map((_, k) => `${'v'}${k + 1}`.replace(/^v/, 'Var')), cols, v.rows);
  });
  R('cell2table', (a) => {
    const c = a[0]; const cols = [];
    for (let j = 0; j < c.cols; j++) { const items = []; for (let i = 0; i < c.rows; i++) items.push(c.data[j * c.rows + i]); cols.push(items.every(x => x.type === 'num' && x.cls !== 'char' && x.numel === 1) ? colVec(items.map(x => x.re[0])) : new Cell(c.rows, 1, items)); }
    let names = null; for (let k = 1; k + 1 < a.length; k++) if (toStr(a[k]) === 'VariableNames') names = toStringList(a[k + 1]);
    return new Table(names || cols.map((_, k) => `Var${k + 1}`), cols, c.rows);
  });
  R('table2array', (a) => { const T = a[0]; return I.hcat(T.columns); });
  R('table2cell', (a) => { const T = a[0]; const c = new Cell(T.rows, T.cols, []); T.columns.forEach((col, j) => { for (let i = 0; i < T.rows; i++) c.data[j * T.rows + i] = col.type === 'cell' ? col.data[i] : num(col.re[i]); }); return c; });
  R('height', (a) => num(a[0].rows)); R('width', (a) => num(a[0].type === 'table' ? a[0].cols : a[0].cols));
  const sliceRows = (T, idx) => new Table(T.varNames, T.columns.map(c => subsref(c, [colVec(idx.map(i => i + 1)), COLON])), idx.length);
  R('head', (a) => { const T = a[0]; const k = Math.min(T.rows, a.length > 1 ? toNumber(a[1]) : 8); if (T.type !== 'table') return subsref(T, [rowVec(Array.from({ length: k }, (_, i) => i + 1)), COLON]); return sliceRows(T, [...Array(k).keys()]); });
  R('tail', (a) => { const T = a[0]; const k = Math.min(T.rows, a.length > 1 ? toNumber(a[1]) : 8); return sliceRows(T, [...Array(k).keys()].map(i => T.rows - k + i)); });
  R('summary', (a) => {
    const T = a[0];
    let s = `\nVariables:\n\n`;
    T.varNames.forEach((n, k) => {
      const c = T.columns[k];
      s += `    ${n}: ${c.rows}×1 ${className(c)}\n\n`;
      if (c.type === 'num') {
        const x = Array.from(c.re).filter(v => !Number.isNaN(v)); const sorted = x.slice().sort((p, q) => p - q);
        const nmiss = c.numel - x.length;
        s += `        Values:\n\n            Min       ${fmtG(sorted[0])}\n            Median    ${fmtG(medianOf(sorted))}\n            Max       ${fmtG(sorted[sorted.length - 1])}\n${nmiss ? `            NumMissing    ${nmiss}\n` : ''}\n`;
      }
    });
    I.write(s);
  });
  R('ismissing', (a) => {
    const v = a[0];
    if (v.type === 'table') { const t = zeros(v.rows, v.cols, 'logical'); v.columns.forEach((c, j) => { for (let i = 0; i < v.rows; i++) t.re[j * v.rows + i] = c.type === 'num' ? (Number.isNaN(c.re[i]) ? 1 : 0) : c.type === 'cell' ? (toStr(c.data[i]) === '' ? 1 : 0) : 0; }); return t; }
    if (v.type === 'cell') return new Tensor(v.rows, v.cols, Float64Array.from(v.data, x => (isChar(x) && x.numel === 0 ? 1 : 0)), null, 'logical');
    return new Tensor(v.rows, v.cols, Float64Array.from(v.re, x => (Number.isNaN(x) ? 1 : 0)), null, 'logical');
  });
  R('rmmissing', (a) => {
    const v = a[0];
    if (v.type === 'table') { const keep = []; for (let i = 0; i < v.rows; i++) if (v.columns.every(c => (c.type === 'num' ? !Number.isNaN(c.re[i]) : c.type === 'cell' ? toStr(c.data[i]) !== '' && toStr(c.data[i]) !== 'NA' : true))) keep.push(i); return sliceRows(v, keep); }
    const vals = Array.from(v.re).filter(x => !Number.isNaN(x)); return v.rows === 1 ? rowVec(vals) : colVec(vals);
  });
  R('groupsummary', (a) => {
    const T = a[0]; const g = toStr(a[1]); const method = a.length > 2 ? toStr(a[2]) : 'none'; const dataVars = a.length > 3 ? toStringList(a[3]) : T.varNames.filter(n => n !== g && T.columns[T.varNames.indexOf(n)].type === 'num');
    const gcol = T.columns[T.varNames.indexOf(g)];
    if (!gcol) throw new MError(`Unrecognized table variable name '${g}'.`, '', 'groupsummary');
    const keys = []; const groups = new Map();
    for (let i = 0; i < T.rows; i++) { const k = gcol.type === 'cell' ? toStr(gcol.data[i]) : gcol.re[i]; if (!groups.has(k)) { groups.set(k, []); keys.push(k); } groups.get(k).push(i); }
    keys.sort((p, q) => (p < q ? -1 : p > q ? 1 : 0));
    const fns = { mean: (x) => meanOf(x), median: medianOf, std: (x) => Math.sqrt(varOf(x)), var: varOf, min: (x) => Math.min(...x), max: (x) => Math.max(...x), sum: (x) => x.reduce((s, y) => s + y, 0) };
    const names = [g, 'GroupCount']; const cols = [gcol.type === 'cell' ? new Cell(keys.length, 1, keys.map(str)) : colVec(keys), colVec(keys.map(k => groups.get(k).length))];
    if (fns[method]) for (const dv of dataVars) { const c = T.columns[T.varNames.indexOf(dv)]; names.push(`${method}_${dv}`); cols.push(colVec(keys.map(k => fns[method](groups.get(k).map(i => c.re[i]).filter(x => !Number.isNaN(x)))))); }
    return new Table(names, cols, keys.length);
  });
  R('categorical', (a) => a[0]);
  R('categories', (a) => { const l = toStringList(a[0]); const u = [...new Set(l)].sort(); return new Cell(u.length, 1, u.map(str)); });

  // hooks for table indexing in interpreter
  I.tableBrace = (T, args) => {
    const [ri, ci] = tableIdx(T, args);
    const cols = ci.map(j => subsref(T.columns[j], [ri, COLON]));
    return cols.length === 1 ? cols[0] : I.hcat(cols);
  };
  I.tableParen = (T, args) => {
    const [ri, ci] = tableIdx(T, args);
    const cols = ci.map(j => subsref(T.columns[j], [ri, COLON]));
    return new Table(ci.map(j => T.varNames[j]), cols, cols.length ? cols[0].rows : 0);
  };
  I.tableCat = (vals, dim) => {
    if (dim === 2) { const names = vals.flatMap(t => t.varNames); return new Table(names, vals.flatMap(t => t.columns), vals[0].rows); }
    const T0 = vals[0]; return new Table(T0.varNames, T0.columns.map((c, j) => I.vcat(vals.map(t => t.columns[j]))), vals.reduce((s, t) => s + t.rows, 0));
  };
  function tableIdx(T, args) {
    if (args.length !== 2) throw new MError('Subscripting into a table using one subscript (as in t(i)) is not supported. Specify a row subscript and a variable subscript, as in t(rows,vars).');
    const ri = args[0];
    let ci;
    const c = args[1];
    if (c === COLON || c.colon) ci = T.varNames.map((_, k) => k);
    else if (isStr(c) || c.type === 'cell') ci = toStringList(c).map(n => { const k = T.varNames.indexOf(n); if (k < 0) throw new MError(`Unrecognized table variable name '${n}'.`); return k; });
    else if (c.cls === 'logical') ci = Array.from(c.re).map((v, k) => (v ? k : -1)).filter(k => k >= 0);
    else ci = Array.from(c.re, v => v - 1);
    for (const k of ci) if (k < 0 || k >= T.cols) throw new MError(`Variable index exceeds table dimensions. Index must not exceed ${T.cols}.`);
    return [ri, ci];
  }
  void display; void tableCellStr; void StrArr; void empty;
}
function fmtG(x) { return x === undefined ? 'NaN' : Number.isInteger(x) ? String(x) : (+x.toPrecision(5)).toString(); }
