// Display formatting that mimics MATLAB's Command Window output.
import { className, charRows, isIntCls } from './value.js';

export const fmtState = { mode: 'short', compact: false, width: 100 };

const X = '×';
const sz = (v) => `${v.rows}${X}${v.cols}`;

function isAllInt(re, n) {
  for (let i = 0; i < n; i++) { const x = re[i]; if (Number.isFinite(x) && !Number.isInteger(x)) return false; }
  return true;
}
function special(x) {
  if (Number.isNaN(x)) return 'NaN';
  if (x === Infinity) return 'Inf';
  if (x === -Infinity) return '-Inf';
  return null;
}
// MATLAB style exponent: e+04 (at least 2 digits)
export function expFmt(x, prec) {
  const s = special(x); if (s) return s;
  let t = x.toExponential(prec);
  return t.replace(/e([+-])(\d)$/, 'e$10$2');
}
function fixed(x, prec) { const s = special(x); return s || x.toFixed(prec); }
export function gFmt(x, prec) {
  // like C %g
  const s = special(x); if (s) return s;
  if (x === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(x)));
  if (e < -5 || e >= prec) {
    let t = x.toExponential(prec - 1);
    let [m, ex] = t.split('e');
    if (m.includes('.')) m = m.replace(/0+$/, '').replace(/\.$/, '');
    const sign = ex[0] === '-' ? '-' : '+'; let d = ex.replace(/^[+-]/, ''); if (d.length < 2) d = '0' + d;
    return `${m}e${sign}${d}`;
  }
  let t = x.toFixed(Math.max(0, prec - 1 - e));
  if (t.includes('.')) t = t.replace(/0+$/, '').replace(/\.$/, '');
  return t;
}
const padL = (s, w) => (s.length >= w ? s : ' '.repeat(w - s.length) + s);
const padR = (s, w) => (s.length >= w ? s : s + ' '.repeat(w - s.length));

// rational approximation like MATLAB rat()
export function ratStr(x) {
  const s = special(x); if (s) return s;
  if (Number.isInteger(x)) return String(x);
  const tol = 1e-6 * Math.abs(x);
  let y = x, a = Math.floor(y), h1 = 1, h0 = 0, k1 = 0, k0 = 1;
  let h = a, k = 1;
  for (let it = 0; it < 20; it++) {
    a = Math.floor(y);
    h = a * h1 + h0; k = a * k1 + k0;
    if (Math.abs(x - h / k) <= tol) break;
    const f = y - a; if (f === 0) break;
    y = 1 / f; h0 = h1; h1 = h; k0 = k1; k1 = k;
  }
  if (k < 0) { h = -h; k = -k; }
  return k === 1 ? String(h) : `${h}/${k}`;
}

// ---------- numeric element formatting ----------
// returns { strs: string[], header: string|null, width: number }
function formatReal(t) {
  const n = t.numel, re = t.re;
  const mode = fmtState.mode;
  const cls = t.cls;
  if (cls === 'logical' || cls === 'char' || isIntCls(cls)) {
    const strs = Array.from(re, x => String(x));
    const w = Math.max(...strs.map(s => s.length)) + 3;
    return { strs, header: null, width: Math.max(w, 4) };
  }
  let maxAbs = 0, minAbs = Infinity;
  for (let i = 0; i < n; i++) { const a = Math.abs(re[i]); if (Number.isFinite(a)) { if (a > maxAbs) maxAbs = a; if (a > 0 && a < minAbs) minAbs = a; } }
  const allInt = isAllInt(re, n);
  if (mode === 'rat') {
    const strs = Array.from(re, ratStr);
    return { strs, header: null, width: Math.max(...strs.map(s => s.length)) + 5 };
  }
  if (mode === 'bank') {
    const strs = Array.from(re, x => fixed(x, 2));
    return { strs, header: null, width: Math.max(...strs.map(s => s.length)) + 6 };
  }
  if (allInt && maxAbs < 1e9 && !['shortE', 'longE'].includes(mode)) {
    const strs = Array.from(re, x => special(x) || String(x === 0 ? 0 : x));
    const w = Math.max(...strs.map(s => s.length));
    let width = maxAbs >= 1000 ? 12 : 6;
    if (w + 2 > width) width = w + 2;
    if (mode === 'shortG' || mode === 'longG') width = Math.max(w + 2, 6);
    return { strs, header: null, width };
  }
  if (mode === 'shortG' || mode === 'longG') {
    const p = mode === 'shortG' ? 5 : 15;
    const strs = Array.from(re, x => gFmt(x, p));
    return { strs, header: null, width: Math.max(...strs.map(s => s.length)) + 3 };
  }
  const long = mode === 'long' || mode === 'longE';
  const prec = long ? 15 : 4;
  if (mode === 'shortE' || mode === 'longE') {
    const strs = Array.from(re, x => expFmt(x, prec));
    return { strs, header: null, width: Math.max(...strs.map(s => s.length)) + 3 };
  }
  // short / long fixed with optional common scale factor
  if (n === 1) {
    const x = re[0];
    const a = Math.abs(x);
    if (special(x)) return { strs: [special(x)], header: null, width: 6 };
    if (long) {
      if (a >= 0.001 && a < 100) { const s = x.toFixed(a < 10 ? 15 : 14); return { strs: [s], header: null, width: s.length + 3 }; }
      const s = expFmt(x, 15); return { strs: [s], header: null, width: s.length + 3 };
    }
    if (a >= 0.001 && a < 1000) return { strs: [x.toFixed(4)], header: null, width: 10 };
    const s = expFmt(x, 4); return { strs: [s], header: null, width: s.length + 3 };
  }
  let scale = 0;
  if (maxAbs >= 1000 || (maxAbs > 0 && maxAbs < 0.001)) scale = Math.floor(Math.log10(maxAbs));
  if (long && maxAbs >= 100) scale = Math.floor(Math.log10(maxAbs));
  // huge dynamic range -> e format like MATLAB
  if (maxAbs >= 1e5 && minAbs < 1e-5 * maxAbs * 1e-5) {
    const strs = Array.from(re, x => expFmt(x, prec));
    return { strs, header: null, width: Math.max(...strs.map(s => s.length)) + 3 };
  }
  const f = Math.pow(10, scale);
  const strs = Array.from(re, x => special(x) || (x === 0 ? '0' : (x / f).toFixed(prec)));
  const w = Math.max(...strs.map(s => s.length));
  const width = long ? Math.max(w + 3, 20) : Math.max(w + 3, 10);
  const header = scale !== 0 ? `   1.0e${scale < 0 ? '-' : '+'}${String(Math.abs(scale)).padStart(2, '0')} *` : null;
  return { strs, header, width };
}

function formatComplex(t) {
  const n = t.numel;
  const long = fmtState.mode === 'long' || fmtState.mode === 'longE';
  const prec = long ? 15 : 4;
  let maxAbs = 0;
  for (let i = 0; i < n; i++) { maxAbs = Math.max(maxAbs, Math.abs(t.re[i]) || 0, Math.abs(t.im[i]) || 0); }
  const useE = maxAbs >= 1e5 || (maxAbs > 0 && maxAbs < 1e-3) || fmtState.mode.endsWith('E');
  let scale = 0;
  if (!useE && maxAbs >= 1000 && n > 1) scale = Math.floor(Math.log10(maxAbs));
  const f = Math.pow(10, scale);
  const fr = (x) => special(x) || (useE ? expFmt(x, prec) : (x / f).toFixed(prec));
  const reS = Array.from(t.re, fr);
  const imS = Array.from(t.im, x => fr(Math.abs(x)) + 'i');
  const signs = Array.from(t.im, x => (x < 0 || Object.is(x, -0) ? ' - ' : ' + '));
  const wr = Math.max(...reS.map(s => s.length)) + 3;
  const wi = Math.max(...imS.map(s => s.length));
  const strs = reS.map((s, i) => padL(s, wr) + signs[i] + padL(imS[i], wi));
  const header = scale !== 0 ? `   1.0e${scale < 0 ? '-' : '+'}${String(Math.abs(scale)).padStart(2, '0')} *` : null;
  return { strs, header, width: Math.max(...strs.map(s => s.length)) + 2, complex: true };
}

// lay out a matrix of formatted strings, splitting columns to the window width
function layoutMatrix(t, strs, width, complex) {
  const lines = [];
  const R = t.rows, C = t.cols;
  const colsPerChunk = Math.max(1, Math.floor((fmtState.width - 2) / width));
  if (C <= colsPerChunk) {
    for (let i = 0; i < R; i++) {
      let s = '';
      for (let j = 0; j < C; j++) s += complex ? (j ? '  ' : '') + strs[j * R + i] : padL(strs[j * R + i], width);
      lines.push(s);
    }
    return lines;
  }
  for (let c0 = 0; c0 < C; c0 += colsPerChunk) {
    const c1 = Math.min(C, c0 + colsPerChunk);
    lines.push(c1 - c0 === 1 ? `  Column ${c0 + 1}` : `  Columns ${c0 + 1} through ${c1}`);
    lines.push('');
    for (let i = 0; i < R; i++) {
      let s = '';
      for (let j = c0; j < c1; j++) s += complex ? (j > c0 ? '  ' : '') + strs[j * R + i] : padL(strs[j * R + i], width);
      lines.push(s);
    }
    if (c1 < C) lines.push('');
  }
  return lines;
}

function emptyDesc(v) {
  const cls = className(v);
  if (v.rows === 0 && v.cols === 0) return `  0${X}0 empty ${cls === 'cell' ? 'cell array' : cls === 'struct' ? 'struct array with no fields' : cls === 'char' ? 'char array' : cls + ''}`;
  const kind = v.rows === 1 ? 'row vector' : v.cols === 1 ? 'column vector' : 'matrix';
  if (cls === 'cell') return `  ${sz(v)} empty cell array`;
  if (cls === 'char') return `  ${sz(v)} empty char array`;
  return `  ${sz(v)} empty ${cls} ${kind}`;
}

// body lines for numeric tensors (without "name =")
export function numericLines(t) {
  if (t.numel === 0) {
    if (t.cls === 'double' && t.rows === 0 && t.cols === 0) return ['     []'];
    return [emptyDesc(t)];
  }
  if (t.cls === 'char') {
    const rows = charRows(t);
    if (t.rows === 1) return [`    '${rows[0]}'`];
    return [`  ${sz(t)} char array`, '', ...rows.map(r => `    '${r}'`)];
  }
  const f = t.im ? formatComplex(t) : formatReal(t);
  const body = layoutMatrix(t, f.strs, f.width, f.complex);
  const out = [];
  if (t.cls === 'logical' || isIntCls(t.cls)) {
    const kind = t.numel === 1 ? null : t.rows === 1 ? 'row vector' : t.cols === 1 ? 'column vector' : 'matrix';
    if (t.cls === 'logical') out.push(kind ? `  ${sz(t)} logical array` : '  logical', '');
    else out.push(kind ? `  ${sz(t)} ${t.cls} ${kind}` : `  ${t.cls}`, '');
    return out.concat(body.map(s => s));
  }
  if (f.header) { out.push(f.header, ''); }
  return out.concat(body);
}

// compact one-line representation used inside cells/structs/workspace
export function shortDesc(v, ctx = 'cell') {
  switch (v.type) {
    case 'num': {
      if (v.cls === 'char') {
        if (v.rows <= 1) return `'${String.fromCharCode(...v.re)}'`;
        return `${sz(v)} char`;
      }
      if (v.numel === 0) return ctx === 'struct' ? '[]' : `${sz(v)} ${v.cls}`;
      if (v.numel === 1) {
        const s = scalarStr(v);
        return ctx === 'cell' ? `[${s}]` : s;
      }
      if (v.rows === 1 && v.numel <= 10 && !v.im) {
        const parts = Array.from(v.re, x => scalarStr({ re: [x], im: null, cls: v.cls, numel: 1 }, true));
        const s = `[${parts.join(' ')}]`;
        if (s.length < 40) return s;
      }
      return ctx === 'struct' ? `[${sz(v)} ${v.cls}]` : `${sz(v)} ${v.cls}`;
    }
    case 'cell': return ctx === 'struct' ? `{${sz(v)} cell}` : `${sz(v)} cell`;
    case 'struct': return ctx === 'struct' ? `[${sz(v)} struct]` : `${sz(v)} struct`;
    case 'fh': return ctx === 'cell' ? v.src || '@' + v.name : (v.src || '@' + v.name);
    case 'sym': return v.numel === 1 && ctx !== 'cell' ? `[${sz(v)} sym]` : `${sz(v)} sym`;
    case 'string': return v.numel === 1 ? `"${v.data[0]}"` : `${sz(v)} string`;
    case 'table': return `${sz(v)} table`;
  }
  return '?';
}
export function scalarStr(v, inArray = false) {
  const x = v.re[0];
  if (v.im && v.im[0] !== 0) {
    const im = v.im[0];
    const r = Number.isInteger(x) && Number.isInteger(im) ? String(x) : x.toFixed(4);
    const i = Number.isInteger(x) && Number.isInteger(im) ? String(Math.abs(im)) : Math.abs(im).toFixed(4);
    return `${r} ${im < 0 ? '-' : '+'} ${i}i`;
  }
  if (special(x)) return special(x);
  if (Number.isInteger(x) && Math.abs(x) < 1e10) return String(x);
  if (v.cls && v.cls !== 'double' && v.cls !== 'single') return String(x);
  const a = Math.abs(x);
  if (a >= 0.001 && a < 1000) return x.toFixed(4);
  return expFmt(x, 4);
}

function cellLines(c) {
  if (c.numel === 0) return [emptyDesc(c)];
  const R = c.rows, C = c.cols;
  const strs = c.data.map(v => `{${shortDesc(v, 'cell')}}`);
  const widths = [];
  for (let j = 0; j < C; j++) { let w = 0; for (let i = 0; i < R; i++) w = Math.max(w, strs[j * R + i].length); widths.push(w); }
  const out = [`  ${sz(c)} cell array`, ''];
  for (let i = 0; i < R; i++) {
    let s = '    ';
    for (let j = 0; j < C; j++) s += padR(strs[j * R + i], widths[j]) + (j < C - 1 ? '    ' : '');
    out.push(s.replace(/\s+$/, ''));
  }
  return out;
}

function structLines(s) {
  if (s.numel !== 1) {
    const out = [`  ${sz(s)} struct array with fields:`, ''];
    for (const f of s.fields) out.push(`    ${f}`);
    if (!s.fields.length) out[0] = `  ${sz(s)} struct array with no fields.`;
    return out;
  }
  if (!s.fields.length) return ['  struct with no fields.'];
  const w = Math.max(...s.fields.map(f => f.length));
  const out = ['  struct with fields:', ''];
  const m = s.data[0];
  for (const f of s.fields) out.push(`    ${padL(f, w)}: ${shortDesc(m.get(f), 'struct')}`);
  return out;
}

function tableLines(t) {
  const out = [`  ${t.rows}${X}${t.cols} table`, ''];
  const cols = t.varNames.map((name, k) => {
    const col = t.columns[k];
    const cells = [];
    for (let i = 0; i < t.rows; i++) cells.push(tableCellStr(col, i));
    const w = Math.max(name.length, ...cells.map(c => c.length));
    return { name, cells, w };
  });
  out.push('    ' + cols.map(c => padR(centerish(c.name, c.w), c.w)).join('    '));
  out.push('    ' + cols.map(c => padR('_'.repeat(c.name.length), c.w).replace(/^/, ' '.repeat(Math.floor((c.w - c.name.length) / 2))).slice(0, c.w)).join('    '));
  out.push('');
  const maxRows = Math.min(t.rows, 200);
  for (let i = 0; i < maxRows; i++) out.push('    ' + cols.map(c => padL(c.cells[i], c.w)).join('    '));
  if (t.rows > maxRows) out.push(`    ... (${t.rows - maxRows} more rows)`);
  return out;
}
function centerish(s, w) { const l = Math.floor((w - s.length) / 2); return ' '.repeat(Math.max(0, l)) + s; }
export function tableCellStr(col, i) {
  if (col.type === 'cell') { const v = col.data[i]; return v.type === 'num' && v.cls === 'char' ? `{'${String.fromCharCode(...v.re)}'}` : `{${shortDesc(v, 'cell')}}`; }
  if (col.type === 'string') return `"${col.data[i]}"`;
  if (col.type === 'num') {
    const x = col.re[i];
    if (col.cls === 'logical') return x ? 'true' : 'false';
    if (special(x)) return special(x);
    return Number.isInteger(x) ? String(x) : gFmt(x, 5);
  }
  return '?';
}

function symLines(s, toStrFn) {
  if (s.numel === 1) return [toStrFn(s.exprs[0])];
  if (s.numel === 0) return ['[ empty sym ]'];
  if (s.cols === 1) {
    const strs = s.exprs.map(toStrFn); const w = Math.max(...strs.map(x => x.length));
    return strs.map(x => ' ' + padL(x, w));
  }
  const rows = [];
  const strs = s.exprs.map(toStrFn);
  const widths = [];
  for (let j = 0; j < s.cols; j++) { let w = 0; for (let i = 0; i < s.rows; i++) w = Math.max(w, strs[j * s.rows + i].length); widths.push(w); }
  for (let i = 0; i < s.rows; i++) {
    const parts = [];
    for (let j = 0; j < s.cols; j++) parts.push(padR(strs[j * s.rows + i], widths[j]));
    rows.push('[' + parts.join(', ') + ']');
  }
  return rows;
}

let symToStr = (e) => e;
export function setSymPrinter(f) { symToStr = f; }

// full display "name = ..." as MATLAB prints it for unsuppressed statements
export function display(name, v) {
  const loose = !fmtState.compact;
  const L = [];
  if (v.type === 'sym') {
    L.push(`${name} =`);
    if (loose) L.push(' ');
    L.push(...symLines(v, symToStr));
    if (loose) L.push(' ');
    return L.join('\n') + '\n';
  }
  if (v.type === 'struct' && v.numel === 1) L.push(`${name} = `); else L.push(`${name} =`);
  if (loose) L.push('');
  let body;
  switch (v.type) {
    case 'num': body = numericLines(v); break;
    case 'cell': body = cellLines(v); break;
    case 'struct': body = structLines(v); break;
    case 'fh': body = ['  function_handle with value:', '', '    ' + (v.src || '@' + v.name)]; break;
    case 'string':
      if (v.numel === 1) body = [`    "${v.data[0]}"`];
      else if (v.numel === 0) body = [`  ${sz(v)} empty string array`];
      else {
        const R = v.rows; const lines = [];
        for (let i = 0; i < R; i++) { const parts = []; for (let j = 0; j < v.cols; j++) parts.push(`"${v.data[j * R + i]}"`); lines.push('    ' + parts.join('    ')); }
        body = [`  ${sz(v)} string array`, '', ...lines];
      }
      break;
    case 'table': body = tableLines(v); break;
    default: body = ['  ?'];
  }
  L.push(...body);
  if (loose) L.push('');
  return L.join('\n') + '\n';
}

// output of disp(v)
export function dispText(v) {
  switch (v.type) {
    case 'num':
      if (v.numel === 0) return '';
      if (v.cls === 'char') return charRows(v).join('\n') + '\n';
      {
        const lines = numericLines(v);
        // disp omits "logical"/class headers
        let body = lines;
        if (v.cls === 'logical' || isIntCls(v.cls)) body = lines.slice(2);
        return body.join('\n') + '\n';
      }
    case 'cell': return cellLines(v).slice(2).join('\n') + '\n';
    case 'struct': return structLines(v).slice(2).join('\n') + '\n';
    case 'fh': return (v.src || '@' + v.name) + '\n';
    case 'sym': return symLines(v, symToStr).join('\n') + '\n';
    case 'string': return v.data.join('\n') + '\n';
    case 'table': return tableLines(v).slice(2).join('\n') + '\n';
  }
  return '\n';
}
