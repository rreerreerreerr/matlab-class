// String and text formatting builtins (sprintf, num2str, strcmp, ...).
import { Tensor, Cell, StrArr, Struct, MError, num, bool, str, empty, zeros, rowVec, colVec, className, toStr, isChar, charRows } from '../value.js';
import { expFmt, gFmt } from '../format.js';
import { isStr, toStringList } from './util.js';
import { catValues } from '../interp.js';

// ---------------- printf engine ----------------
export function processEscapes(s) {
  return s.replace(/\\(n|t|r|\\|a|b|f|v|x[0-9a-fA-F]+|[0-7]{1,3}|'|")/g, (m, c) => {
    switch (c[0]) {
      case 'n': return '\n'; case 't': return '\t'; case 'r': return '\r'; case '\\': return '\\';
      case 'a': return '\x07'; case 'b': return '\b'; case 'f': return '\f'; case 'v': return '\v';
      case "'": return "'"; case '"': return '"';
      case 'x': return String.fromCharCode(parseInt(c.slice(1), 16));
      default: return String.fromCharCode(parseInt(c, 8));
    }
  });
}

function flattenArgs(args) {
  const items = [];
  for (const v of args) {
    if (v.type === 'num' && v.cls === 'char') { items.push({ s: toStr(v), codes: Array.from(v.re) }); continue; }
    if (v.type === 'num') { for (let k = 0; k < v.numel; k++) items.push(v.re[k]); continue; }
    if (v.type === 'string') { for (const s of v.data) items.push({ s, codes: Array.from(s, c => c.charCodeAt(0)) }); continue; }
    if (v.type === 'cell') throw new MError('Function is not defined for \'cell\' inputs.');
    if (v.type === 'sym') { for (const e of v.exprs) items.push({ s: e, codes: [] }); continue; }
    if (v.type === 'struct') throw new MError("Function is not defined for 'struct' inputs.");
    if (v.type === 'fh') throw new MError("Function is not defined for 'function_handle' inputs.");
    throw new MError(`Function is not defined for '${className(v)}' inputs.`);
  }
  return items;
}

function padStr(s, width, left, zero) {
  if (width === undefined || s.length >= width) return s;
  if (left) return s + ' '.repeat(width - s.length);
  if (zero) {
    const m = s.match(/^([+\- ]?)(.*)$/);
    return m[1] + '0'.repeat(width - s.length) + m[2];
  }
  return ' '.repeat(width - s.length) + s;
}

function fmtNumber(conv, x, flags, width, prec) {
  const left = flags.includes('-'), plus = flags.includes('+'), space = flags.includes(' '), zero = flags.includes('0') && !left, alt = flags.includes('#');
  let s;
  const sign = (v, body) => (v < 0 || Object.is(v, -0) && false ? '-' : plus ? '+' : space ? ' ' : '') + body;
  if (Number.isNaN(x)) s = 'NaN';
  else if (!Number.isFinite(x)) s = x > 0 ? (plus ? '+Inf' : 'Inf') : '-Inf';
  if (s) return padStr(s, width, left, false);
  switch (conv) {
    case 'd': case 'i': case 'u':
      if (!Number.isInteger(x)) {
        // MATLAB switches to %e for non-integers
        return fmtNumber('e', x, flags, width, prec);
      }
      s = sign(x, Math.abs(x).toString().replace(/e\+?/, 'e+'));
      if (Math.abs(x) >= 1e21) s = sign(x, BigInt(Math.round(Math.abs(x))).toString());
      break;
    case 'f': case 'F':
      s = sign(x, Math.abs(x).toFixed(prec === undefined ? 6 : Math.min(prec, 100)));
      break;
    case 'e': case 'E': {
      let t = expFmt(Math.abs(x), prec === undefined ? 6 : prec);
      if (conv === 'E') t = t.toUpperCase();
      s = sign(x, t);
      break;
    }
    case 'g': case 'G': {
      let p = prec === undefined ? 6 : prec === 0 ? 1 : prec;
      let t = gFmt(Math.abs(x), p);
      if (alt && !t.includes('.')) t += '.';
      if (conv === 'G') t = t.toUpperCase();
      s = sign(x, t);
      break;
    }
    case 'x': case 'X': s = Math.round(x).toString(16); if (conv === 'X') s = s.toUpperCase(); break;
    case 'o': s = Math.round(x).toString(8); break;
    case 'c': s = String.fromCharCode(x); break;
    case 's':
      if (Number.isInteger(x)) s = String.fromCharCode(x);
      else s = fmtNumber('e', x, '', undefined, 6).trim();
      if (prec !== undefined) s = s.slice(0, prec);
      break;
  }
  return padStr(s, width, left, zero && conv !== 's' && conv !== 'c');
}

export function sprintfImpl(fmtRaw, args) {
  const fmt = processEscapes(fmtRaw);
  const specRe = /%(%|([-+ 0#]*)(\*|\d+)?(?:\.(\*|\d+))?([diuoxXfFeEgGcs]))/g;
  const pieces = []; // {lit} or {conv, flags, width, prec}
  let last = 0, m;
  while ((m = specRe.exec(fmt))) {
    if (m.index > last) pieces.push({ lit: fmt.slice(last, m.index) });
    if (m[1] === '%') pieces.push({ lit: '%' });
    else pieces.push({ conv: m[5], flags: m[2] || '', width: m[3], prec: m[4] });
    last = specRe.lastIndex;
  }
  if (last < fmt.length) pieces.push({ lit: fmt.slice(last) });
  const items = flattenArgs(args);
  const nConv = pieces.filter(p => p.conv).length;
  let out = '';
  if (nConv === 0) { for (const p of pieces) out += p.lit; return out; }
  let k = 0;
  // expand string items for numeric conversions lazily
  const queue = items.slice();
  const take = (forString) => {
    if (!queue.length) return undefined;
    const it = queue[0];
    if (typeof it === 'object') {
      if (forString) { queue.shift(); return it.s; }
      // numeric conversion consumes one char code at a time
      if (!it.codes.length) { queue.shift(); return take(forString); }
      const c = it.codes.shift(); it.s = it.s.slice(1);
      if (!it.codes.length) queue.shift();
      return c;
    }
    queue.shift(); return it;
  };
  let first = true;
  while (first || queue.length) {
    first = false;
    for (let pi = 0; pi < pieces.length; pi++) {
      const p = pieces[pi];
      if (p.lit !== undefined) { out += p.lit; continue; }
      let width = p.width, prec = p.prec;
      if (width === '*') { width = take(false); } else if (width !== undefined) width = +width;
      if (prec === '*') { prec = take(false); } else if (prec !== undefined) prec = +prec;
      if (!queue.length) {
        if (items.length === 0 && pi === pieces.findIndex(q => q.conv)) {
          // no data at all: print literal text up to here and stop (MATLAB prints format with empty conversions)
          if (p.conv === 's' || p.conv === 'c') { continue; }
          continue;
        }
        return out;
      }
      const isS = p.conv === 's' || p.conv === 'c';
      const v = take(isS && typeof queue[0] === 'object');
      if (typeof v === 'string') {
        let s = v; if (prec !== undefined && p.conv === 's') s = s.slice(0, prec);
        out += padStr(s, width, p.flags.includes('-'), false);
      } else out += fmtNumber(p.conv, v, p.flags, width, prec);
    }
    if (!queue.length) break;
  }
  return out;
}

// ---------------- num2str ----------------
export function num2strImpl(v, arg) {
  if (isChar(v)) return v;
  if (v.type === 'string') return str(v.data[0]);
  if (v.type === 'sym') return str(v.exprs[0]);
  if (v.type !== 'num') throw new MError(`Input must be numeric or a character vector.`, '', 'num2str');
  if (arg) {
    if (isChar(arg)) {
      const f = toStr(arg);
      const rows = [];
      for (let i = 0; i < v.rows; i++) { const rowVals = []; for (let j = 0; j < v.cols; j++) rowVals.push(v.re[j * v.rows + i]); rows.push(sprintfImpl(f, [rowVec(rowVals)])); }
      return charMatrix(rows);
    }
    const p = arg.re[0];
    const rows = [];
    for (let i = 0; i < v.rows; i++) {
      const parts = [];
      for (let j = 0; j < v.cols; j++) parts.push(gFmt(v.re[j * v.rows + i], p));
      rows.push(parts.join('  '));
    }
    return charMatrix(rows);
  }
  if (v.numel === 0) return str('');
  const isInt = Array.from(v.re).every(x => !Number.isFinite(x) || Number.isInteger(x)) && !v.im;
  const fmtOne = (x, k) => {
    if (v.im) {
      const im = v.im[k];
      const r = fmtReal(x), i = fmtReal(Math.abs(im));
      return `${r}${im < 0 ? '-' : '+'}${i}i`;
    }
    return isInt ? intStr(x) : fmtReal(x);
  };
  const fmtReal = (x) => {
    if (!Number.isFinite(x)) return Number.isNaN(x) ? 'NaN' : x > 0 ? 'Inf' : '-Inf';
    if (Number.isInteger(x) && Math.abs(x) < 1e15) return String(x);
    const d = Math.max(Math.floor(Math.log10(Math.abs(x))), 0) + 5;
    return gFmt(x, Math.min(d, 16));
  };
  if (v.numel === 1) return str(fmtOne(v.re[0], 0));
  // matrix: columns right-aligned, separated by two spaces
  const strs = Array.from(v.re, (x, k) => fmtOne(x, k));
  const w = Math.max(...strs.map(s => s.length));
  const rows = [];
  for (let i = 0; i < v.rows; i++) {
    const parts = [];
    for (let j = 0; j < v.cols; j++) { const s = strs[j * v.rows + i]; parts.push(' '.repeat(w - s.length) + s); }
    rows.push(parts.join(isInt ? '  ' : '    '));
  }
  // strip common leading whitespace
  const minLead = Math.min(...rows.map(r => r.match(/^ */)[0].length));
  return charMatrix(rows.map(r => r.slice(minLead)));
}
function intStr(x) {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? 'NaN' : x > 0 ? 'Inf' : '-Inf';
  if (Math.abs(x) >= 1e21) return BigInt(x).toString();
  return String(x);
}
export function charMatrix(rows) {
  if (!rows.length) return str('');
  const w = Math.max(...rows.map(r => r.length));
  const R = rows.length;
  const t = new Tensor(R, w, new Float64Array(R * w), null, 'char');
  for (let i = 0; i < R; i++) { const r = rows[i].padEnd(w, ' '); for (let j = 0; j < w; j++) t.re[j * R + i] = r.charCodeAt(j); }
  return t;
}

export function mat2strImpl(v, prec = 15) {
  const f = (x, k) => {
    let s;
    if (v.cls === 'logical') s = x ? 'true' : 'false';
    else if (Number.isNaN(x)) s = 'NaN'; else if (!Number.isFinite(x)) s = x > 0 ? 'Inf' : '-Inf';
    else s = gFmt(x, prec);
    if (v.im) { const im = v.im[k]; s += (im < 0 ? '-' : '+') + gFmt(Math.abs(im), prec) + 'i'; }
    return s;
  };
  if (isChar(v)) { const rows = charRows(v); return rows.length === 1 ? `'${rows[0]}'` : '[' + rows.map(r => `'${r}'`).join(';') + ']'; }
  if (v.numel === 1) return f(v.re[0], 0);
  const rows = [];
  for (let i = 0; i < v.rows; i++) { const p = []; for (let j = 0; j < v.cols; j++) p.push(f(v.re[j * v.rows + i], j * v.rows + i)); rows.push(p.join(' ')); }
  return '[' + rows.join(';') + ']';
}

export function installStrings(I) {
  const R = (name, fn, opts) => I.register(name, fn, opts);
  R('sprintf', (a) => {
    if (!a.length) throw new MError('Not enough input arguments.', 'MATLAB:minrhs');
    if (!isStr(a[0])) throw new MError('Format must be a character vector or string scalar.', '', 'sprintf');
    const s = sprintfImpl(toStr(a[0]), a.slice(1));
    return a[0].type === 'string' ? new StrArr(1, 1, [s]) : str(s);
  }, { minArgs: 1 });
  R('num2str', (a) => num2strImpl(a[0], a[1]), { minArgs: 1, maxArgs: 2 });
  R('int2str', (a) => { const v = a[0]; const r = new Tensor(v.rows, v.cols, v.re.map(x => Math.sign(x) * Math.round(Math.abs(x)))); return num2strImpl(r); });
  R('mat2str', (a) => str(mat2strImpl(a[0], a.length > 1 ? a[1].re[0] : 15)));
  R('str2num', (a, nout, ctx) => {
    const s = toStr(a[0]);
    try {
      const v = ctx.interp.evalString(`[${s}]`);
      return [v, bool(true)];
    } catch (e) { return [empty(), bool(false)]; }
  });
  R('str2double', (a) => {
    const conv = (s) => { s = s.trim(); if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return parseFloat(s); if (/^[+-]?inf$/i.test(s)) return s.startsWith('-') ? -Infinity : Infinity; if (/^nan$/i.test(s)) return NaN; return NaN; };
    const v = a[0];
    if (isChar(v)) return num(conv(toStr(v)));
    if (v.type === 'string') return new Tensor(v.rows, v.cols, Float64Array.from(v.data, conv));
    if (v.type === 'cell') return new Tensor(v.rows, v.cols, Float64Array.from(v.data, x => (isStr(x) ? conv(toStr(x)) : NaN)));
    return num(NaN);
  });
  R('num2cell', (a) => { const v = a[0]; const d = []; for (let k = 0; k < v.numel; k++) d.push(new Tensor(1, 1, Float64Array.of(v.re[k]), v.im ? Float64Array.of(v.im[k]) : null, v.cls)); return new Cell(v.rows, v.cols, d); });
  R('blanks', (a) => str(' '.repeat(a[0].re[0])));
  R('char', (a) => {
    if (a.length === 1) {
      const v = a[0];
      if (v.type === 'num') return new Tensor(v.rows, v.cols, Float64Array.from(v.re, x => Math.max(0, Math.round(x))), null, 'char');
      if (v.type === 'cell') return charMatrix(v.data.map(x => toStr(x)));
      if (v.type === 'string') return charMatrix(v.data);
      if (v.type === 'sym') return str(I.symToStr ? I.symToStr(v.exprs[0]) : v.exprs[0]);
      throw new MError(`Conversion to char from ${className(v)} is not possible.`);
    }
    const rows = [];
    for (const v of a) { if (v.type === 'cell') rows.push(...v.data.map(x => toStr(x))); else if (isChar(v)) rows.push(...(v.rows ? charRows(v) : [''])); else if (v.type === 'string') rows.push(...v.data); else rows.push(String.fromCharCode(...v.re)); }
    return charMatrix(rows);
  });
  R('strvcat', (a) => charMatrix(a.filter(v => v.numel > 0).flatMap(v => (v.type === 'cell' ? v.data.map(x => toStr(x)) : charRows(v)))));
  R('cellstr', (a) => { const v = a[0]; if (v.type === 'cell') return v; const rows = v.type === 'string' ? v.data : charRows(v).map(r => r.replace(/\s+$/, '')); return new Cell(rows.length, 1, rows.map(str)); });
  R('string', (a) => {
    const v = a[0];
    if (v.type === 'string') return v;
    if (isChar(v)) return new StrArr(1, 1, [charRows(v).join('')]);
    if (v.type === 'cell') return new StrArr(v.rows, v.cols, v.data.map(x => toStr(x)));
    if (v.type === 'num') return new StrArr(v.rows, v.cols, Array.from(v.re, x => gFmt(x, 5)));
    throw new MError('Conversion to string not possible.');
  });
  R('strlength', (a) => { const v = a[0]; if (v.type === 'string') return new Tensor(v.rows, v.cols, Float64Array.from(v.data, s => s.length)); return num(v.cols); });
  R('strcat', (a) => {
    if (a.some(v => v.type === 'cell')) {
      const n = Math.max(...a.map(v => (v.type === 'cell' ? v.numel : 1)));
      const shape = a.find(v => v.type === 'cell');
      const out = [];
      for (let k = 0; k < n; k++) out.push(str(a.map(v => (v.type === 'cell' ? toStr(v.data[v.numel === 1 ? 0 : k]) : toStr(v))).join('')));
      return new Cell(shape.rows, shape.cols, out);
    }
    if (a.some(v => v.type === 'string')) return new StrArr(1, 1, [a.map(v => toStr(v)).join('')]);
    // char arrays: trailing whitespace removed
    const rows = a.map(v => (isChar(v) ? charRows(v) : [toStr(v)]));
    const nr = Math.max(...rows.map(r => r.length));
    const out = [];
    for (let i = 0; i < nr; i++) out.push(rows.map(r => (r.length === 1 ? r[0] : r[i] || '').replace(/[ \t\n]+$/, '')).join(''));
    return charMatrix(out);
  });
  R('strjoin', (a) => { const list = toStringList(a[0], 'strjoin'); const d = a.length > 1 ? processEscapes(toStr(a[1])) : ' '; return str(list.join(d)); });
  R('strsplit', (a) => {
    const s = toStr(a[0]);
    let parts;
    if (a.length > 1) { const delims = toStringList(a[1], 'strsplit').map(processEscapes); parts = s.split(new RegExp(delims.map(d => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'))); }
    else parts = s.split(/\s+/);
    return new Cell(1, parts.length, parts.map(str));
  });
  const cmp = (name, f) => R(name, (a) => {
    const [x, y] = a;
    const lists = (v) => (v.type === 'cell' ? v.data.map(e => (isStr(e) ? toStr(e) : null)) : v.type === 'string' ? v.data : isChar(v) ? (v.rows <= 1 ? [toStr(v)] : null) : null);
    const n = a[2] ? a[2].re[0] : undefined;
    if (x.type === 'cell' || y.type === 'cell' || (x.type === 'string' && x.numel > 1) || (y.type === 'string' && y.numel > 1)) {
      const X = lists(x), Y = lists(y); const shape = x.type === 'cell' || x.type === 'string' ? x : y;
      const N = Math.max(X ? X.length : 1, Y ? Y.length : 1);
      const t = zeros(shape.rows, shape.cols, 'logical');
      for (let k = 0; k < N; k++) { const p = X ? X[X.length === 1 ? 0 : k] : null, q = Y ? Y[Y.length === 1 ? 0 : k] : null; t.re[k] = p !== null && q !== null && f(p, q, n) ? 1 : 0; }
      return t;
    }
    const X = lists(x), Y = lists(y);
    if (!X || !Y) return bool(false);
    if (isChar(x) && isChar(y) && (x.rows !== y.rows)) return bool(false);
    return bool(f(X[0], Y[0], n));
  }, { minArgs: 2 });
  cmp('strcmp', (p, q) => p === q);
  cmp('strcmpi', (p, q) => p.toLowerCase() === q.toLowerCase());
  cmp('strncmp', (p, q, n) => p.length >= n && q.length >= n && p.slice(0, n) === q.slice(0, n));
  cmp('strncmpi', (p, q, n) => p.length >= n && q.length >= n && p.slice(0, n).toLowerCase() === q.slice(0, n).toLowerCase());
  const findAll = (s, p) => { const out = []; if (!p.length) return out; let k = s.indexOf(p); while (k >= 0) { out.push(k + 1); k = s.indexOf(p, k + 1); } return out; };
  R('strfind', (a) => {
    if (a[0].type === 'cell') return new Cell(a[0].rows, a[0].cols, a[0].data.map(x => { const r = findAll(toStr(x), toStr(a[1])); return r.length ? rowVec(r) : zeros(1, 0); }));
    const r = findAll(toStr(a[0]), toStr(a[1])); return r.length ? rowVec(r) : zeros(1, 0);
  });
  R('findstr', (a) => { let s = toStr(a[0]), p = toStr(a[1]); if (p.length > s.length) [s, p] = [p, s]; const r = findAll(s, p); return r.length ? rowVec(r) : zeros(1, 0); });
  R('strrep', (a) => {
    const f = (s) => s.split(toStr(a[1])).join(toStr(a[2]));
    if (a[0].type === 'cell') return new Cell(a[0].rows, a[0].cols, a[0].data.map(x => str(f(toStr(x)))));
    if (a[0].type === 'string') return new StrArr(a[0].rows, a[0].cols, a[0].data.map(f));
    return str(f(toStr(a[0])));
  });
  const strMap = (name, f) => R(name, (a) => {
    const v = a[0];
    if (v.type === 'cell') return new Cell(v.rows, v.cols, v.data.map(x => str(f(toStr(x)))));
    if (v.type === 'string') return new StrArr(v.rows, v.cols, v.data.map(f));
    if (!isChar(v)) return v;
    if (v.rows > 1) return charMatrix(charRows(v).map(f));
    return str(f(toStr(v)));
  });
  strMap('upper', (s) => s.toUpperCase()); strMap('lower', (s) => s.toLowerCase());
  strMap('deblank', (s) => s.replace(/[\s\0]+$/, '')); strMap('strtrim', (s) => s.replace(/^[\s\0]+|[\s\0]+$/g, ''));
  const charPred = (name, re) => R(name, (a) => { const v = a[0]; const t = zeros(v.rows, v.cols, 'logical'); if (isChar(v)) for (let k = 0; k < v.numel; k++) t.re[k] = re.test(String.fromCharCode(v.re[k])) ? 1 : 0; return t; });
  charPred('isspace', /\s/); charPred('isletter', /[A-Za-zÀ-￿]/); charPred('isdigit', /[0-9]/);
  R('isstrprop', (a) => { const v = a[0]; const kind = toStr(a[1]); const re = { alpha: /[A-Za-z]/, digit: /\d/, wspace: /\s/, upper: /[A-Z]/, lower: /[a-z]/, alphanum: /[A-Za-z0-9]/, punct: /[!-\/:-@\[-`{-~]/ }[kind] || /./; const t = zeros(v.rows, v.cols, 'logical'); for (let k = 0; k < v.numel; k++) t.re[k] = re.test(String.fromCharCode(v.re[k])) ? 1 : 0; return t; });
  R('contains', (a) => { const pats = toStringList(a[1]); const f = (s) => pats.some(p => s.includes(p)); const v = a[0]; if (v.type === 'cell' || (v.type === 'string' && v.numel > 1)) { const l = toStringList(v); return new Tensor(v.rows, v.cols, Float64Array.from(l, s => (f(s) ? 1 : 0)), null, 'logical'); } return bool(f(toStr(v))); });
  R('startsWith', (a) => bool(toStr(a[0]).startsWith(toStr(a[1]))));
  R('endsWith', (a) => bool(toStr(a[0]).endsWith(toStr(a[1]))));
  R('regexprep', (a) => {
    const s = toStr(a[0]); const pat = toStr(a[1]); const rep = toStr(a[2]).replace(/\$(\d)/g, '$$$1');
    const flags = a.slice(3).some(x => toStr(x) === 'ignorecase') ? 'gi' : 'g';
    return str(s.replace(new RegExp(pat.replace(/\(\?<(\w+)>/g, '(?<$1>'), flags), rep));
  });
  R('regexp', (a, nout) => {
    const s = toStr(a[0]); const pat = new RegExp(toStr(a[1]), 'g');
    const opts = a.slice(2).map(x => toStr(x));
    const once = opts.includes('once');
    const matches = [...s.matchAll(pat)];
    const res = {
      match: () => once ? str(matches[0] ? matches[0][0] : '') : new Cell(1, matches.length, matches.map(m => str(m[0]))),
      tokens: () => once ? new Cell(1, matches[0] ? matches[0].length - 1 : 0, matches[0] ? matches[0].slice(1).map(x => str(x || '')) : []) : new Cell(1, matches.length, matches.map(m => new Cell(1, m.length - 1, m.slice(1).map(x => str(x || ''))))),
      start: () => rowVec(matches.map(m => m.index + 1)),
      split: () => { const parts = s.split(new RegExp(toStr(a[1]))); return new Cell(1, parts.length, parts.map(str)); },
      names: () => { return new Struct(1, 1, []); },
    };
    const want = opts.filter(o => res[o]);
    if (want.length) return want.map(o => res[o]());
    return [res.start(), rowVec(matches.map(m => m.index + m[0].length)), res.tokens(), res.match()].slice(0, Math.max(1, nout));
  });
  R('newline', () => str('\n'));
  R('dec2bin', (a) => { const n = a[0].re[0]; let s = Math.round(n).toString(2); if (a[1]) s = s.padStart(a[1].re[0], '0'); return str(s); });
  R('bin2dec', (a) => num(parseInt(toStr(a[0]), 2)));
  R('dec2hex', (a) => str(Math.round(a[0].re[0]).toString(16).toUpperCase()));
  R('hex2dec', (a) => num(parseInt(toStr(a[0]), 16)));
  R('isvarname', (a) => bool(/^[A-Za-z]\w{0,62}$/.test(toStr(a[0]))));
  R('validatestring', (a) => { const s = toStr(a[0]); const opts = toStringList(a[1]); const m = opts.find(o => o.toLowerCase().startsWith(s.toLowerCase())); if (!m) throw new MError(`Expected input to match one of these values:\n\n${opts.map(o => `'${o}'`).join(', ')}\n\nThe input, '${s}', did not match any of the valid values.`); return str(m); });
  R('join', (a) => { const l = toStringList(a[0]); const d = a.length > 1 ? toStr(a[1]) : ' '; return new StrArr(1, 1, [l.join(d)]); });
  R('compose', (a) => new StrArr(1, 1, [sprintfImpl(toStr(a[0]), a.slice(1))]));
  void catValues; void colVec;
}
