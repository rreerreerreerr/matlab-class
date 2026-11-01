// Language-level and I/O builtins: disp, fprintf, input, error, eval, cellfun,
// workspace commands (who, whos, clear, format), timing, structs and cells.
import {
  Tensor, Cell, Struct, FHandle, StrArr, MError, num, bool, str, empty, zeros, rowVec, colVec, className, toStr, isChar,
  toNumber, charRows, cloneValue,
} from '../value.js';
import { display, dispText, fmtState } from '../format.js';
import { sprintfImpl, processEscapes } from './strings.js';
import { isStr, toStringList } from './util.js';
import { parse } from '../parser.js';
import { catValues } from '../interp.js';
import { HELP, helpFor } from './helptext.js';

export function installLang(I) {
  const R = (name, fn, opts) => I.register(name, fn, opts);
  const out = (s) => I.write(s, 'out');

  // ---------- output ----------
  R('disp', (a) => { if (a.length !== 1) throw new MError(a.length ? 'Too many input arguments.' : 'Not enough input arguments.'); out(dispText(a[0])); }, { maxOut: 0 });
  R('display', (a) => { out(display('ans', a[0])); }, { maxOut: 0 });
  R('fprintf', (a, nout, ctx) => {
    if (!a.length) throw new MError('Not enough input arguments.', 'MATLAB:minrhs');
    let fid = 1, args = a;
    if (a[0].type === 'num' && a[0].cls !== 'char' && a[0].numel === 1 && a.length >= 1 && (a.length === 1 ? false : true)) { fid = a[0].re[0]; args = a.slice(1); }
    if (!isStr(args[0])) {
      // fprintf(x) with numeric -> prints like %d? MATLAB requires format
      if (args[0].type === 'num') { const s = sprintfImpl('%g', [args[0]]); writeFid(fid, s); return nout ? num(s.length) : undefined; }
      throw new MError('Invalid file identifier. Use fopen to generate a valid file identifier.');
    }
    const s = sprintfImpl(toStr(args[0]), args.slice(1));
    writeFid(fid, s);
    if (nout) return num(s.length);
  });
  const files = new Map(); let nextFid = 3;
  function writeFid(fid, s) {
    if (fid === 1) out(s);
    else if (fid === 2) I.write(s, 'err');
    else {
      const f = files.get(fid);
      if (!f) throw new MError('Invalid file identifier. Use fopen to generate a valid file identifier.', '', 'fprintf');
      f.content += s;
    }
  }
  R('fopen', (a) => {
    const name = toStr(a[0]); const mode = a.length > 1 ? toStr(a[1]) : 'r';
    let content = '';
    if (mode.startsWith('r')) { const t = I.host.readText(name); if (t == null) return num(-1); content = t; }
    else if (mode.startsWith('a')) content = I.host.readText(name) || '';
    const fid = nextFid++; files.set(fid, { name, mode, content, pos: 0 }); return num(fid);
  });
  R('fclose', (a) => {
    if (isStr(a[0]) && toStr(a[0]) === 'all') { for (const [k, f] of files) if (!f.mode.startsWith('r')) I.host.writeFile(f.name, f.content); files.clear(); return num(0); }
    const fid = a[0].re[0]; const f = files.get(fid);
    if (!f) throw new MError('Invalid file identifier. Use fopen to generate a valid file identifier.', '', 'fclose');
    if (!f.mode.startsWith('r')) I.host.writeFile(f.name, f.content);
    files.delete(fid); return num(0);
  });
  R('fgetl', (a) => { const f = files.get(a[0].re[0]); if (f.pos >= f.content.length) return num(-1); let e = f.content.indexOf('\n', f.pos); if (e < 0) e = f.content.length; const line = f.content.slice(f.pos, e).replace(/\r$/, ''); f.pos = e + 1; return str(line); });
  R('fgets', (a) => { const f = files.get(a[0].re[0]); if (f.pos >= f.content.length) return num(-1); let e = f.content.indexOf('\n', f.pos); e = e < 0 ? f.content.length : e + 1; const line = f.content.slice(f.pos, e); f.pos = e; return str(line); });
  R('feof', (a) => { const f = files.get(a[0].re[0]); return bool(f.pos >= f.content.length); });
  R('fscanf', (a) => { const f = files.get(a[0].re[0]); const nums = f.content.slice(f.pos).match(/[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/g) || []; f.pos = f.content.length; return colVec(nums.map(Number)); });
  R('fileread', (a) => { const t = I.host.readText(toStr(a[0])); if (t == null) throw new MError(`Could not open file ${toStr(a[0])}. No such file or directory.`, '', 'fileread'); return str(t); });

  // ---------- input / control ----------
  R('input', (a, nout, ctx) => {
    const prompt = a.length ? processEscapes(toStr(a[0])) : '';
    const asStr = a.length > 1 && toStr(a[1]) === 's';
    I.flushPlots();
    while (true) {
      const line = I.host.input(prompt);
      if (line === null) throw new MError('Operation terminated by user during input.', 'MATLAB:interrupted');
      if (asStr) return str(line);
      if (line.trim() === '') return empty();
      try { return I.evalString(line, ctx.frame); }
      catch (e) {
        if (e instanceof MError) { I.reportError(e); continue; }
        throw e;
      }
    }
  });
  R('keyboard', () => { I.warn('keyboard is not supported in this environment.'); });
  R('pause', (a) => {
    I.flushPlots();
    if (a.length && isStr(a[0])) return;
    if (a.length) { const s = toNumber(a[0]); if (s > 0) I.host.sleep(Math.min(s, 600) * 1000); return; }
    I.host.waitKey();
  });
  R('waitforbuttonpress', () => { I.flushPlots(); I.host.waitKey(); return num(1); });
  R('drawnow', () => { I.flushPlots(); });
  R('beep', () => {});
  R('error', (a, nout, ctx) => {
    if (!a.length) return;
    if (a[0].type === 'struct') { const e = new MError(toStr(a[0].data[0].get('message'))); e.identifier = a[0].data[0].has('identifier') ? toStr(a[0].data[0].get('identifier')) : ''; throw tagUserError(e, ctx); }
    let id = '', msg;
    const first = toStr(a[0]);
    if (a.length === 1) msg = first;
    else if (/^[A-Za-z][\w-]*(:[\w-]+)+$/.test(first) && !/\s/.test(first)) { id = first; msg = sprintfImpl(toStr(a[1]), a.slice(2)); }
    else msg = sprintfImpl(first, a.slice(1));
    throw tagUserError(new MError(msg, id), ctx);
  });
  function tagUserError(e, ctx) {
    const fr = ctx.frame;
    if (fr && fr.funcName) e.fname = `${fr.funcName} (line ${fr.curLine || 1})`;
    else e.noHeader = true;
    e.fromUser = true;
    return e;
  }
  R('warning', (a) => {
    if (!a.length) return;
    const first = toStr(a[0]);
    if (['on', 'off', 'query', 'error'].includes(first)) return;
    let msg;
    if (a.length > 1 && /^[A-Za-z][\w-]*(:[\w-]+)+$/.test(first)) msg = sprintfImpl(toStr(a[1]), a.slice(2));
    else msg = a.length > 1 ? sprintfImpl(first, a.slice(1)) : first;
    I.warn(msg);
  });
  R('lastwarn', () => str(I.lastWarning));
  R('rethrow', (a) => { const s = a[0]; const e = new MError(toStr(s.data[0].get('message')), toStr(s.data[0].get('identifier'))); e.noHeader = true; throw e; });
  R('MException', (a) => { const s = new Struct(1, 1, ['identifier', 'message', 'stack']); s.data[0].set('identifier', a[0]); s.data[0].set('message', str(sprintfImpl(toStr(a[1]), a.slice(2)))); s.data[0].set('stack', new Struct(0, 1, [], [])); return s; });
  R('throw', (a) => { const s = a[0]; const e = new MError(toStr(s.data[0].get('message')), toStr(s.data[0].get('identifier'))); e.noHeader = true; throw e; });
  R('assert', (a) => {
    const c = a[0];
    let ok = c.type === 'num' && c.numel > 0 && Array.from(c.re).every(x => x !== 0);
    if (!ok) {
      if (a.length > 1) { const first = toStr(a[1]); const isId = a.length > 2 && /^[A-Za-z][\w-]*(:[\w-]+)+$/.test(first); throw new MError(isId ? sprintfImpl(toStr(a[2]), a.slice(3)) : sprintfImpl(first, a.slice(2)), isId ? first : ''); }
      throw new MError('Assertion failed.', 'MATLAB:assertion:failed');
    }
  });
  R('eval', (a, nout, ctx) => {
    const code = toStr(a[0]);
    try {
      if (nout > 0) return I.evalString(code, ctx.frame, nout);
      I.execString(code, ctx.frame);
    } catch (e) {
      if (a.length > 1 && e instanceof MError) { I.execString(toStr(a[1]), ctx.frame); return; }
      throw e;
    }
  });
  R('evalin', (a, nout, ctx) => { const code = toStr(a[1]); I.execString(code, { ws: I.base, functions: new Map() }); });
  R('assignin', (a) => { I.base.vars.set(toStr(a[1]), a[2]); });
  R('feval', (a, nout, ctx) => {
    const f = a[0];
    if (f.type === 'fh') return I.callHandle(f, a.slice(1), nout);
    return I.callFunction(toStr(f), a.slice(1), nout, ctx.frame);
  }, { minArgs: 1 });
  R('func2str', (a) => str(a[0].src || a[0].name));
  R('str2func', (a) => {
    const s = toStr(a[0]);
    if (s.startsWith('@')) return I.evalString(s);
    return new FHandle({ name: s, src: s });
  });
  R('nargin', (a, nout, ctx) => {
    if (a.length) { const r = I.resolveFunction(isStr(a[0]) ? toStr(a[0]) : a[0].name, ctx.frame); if (r && r.def && r.def.params) return num(r.def.params.includes('varargin') ? -r.def.params.length : r.def.params.length); return num(-1); }
    if (ctx.frame.ws.nargin === undefined) throw new MError('You can only call nargin from within a MATLAB function.');
    return num(ctx.frame.ws.nargin);
  });
  R('nargout', (a, nout, ctx) => {
    if (ctx.frame.ws.nargout === undefined) throw new MError('You can only call nargout from within a MATLAB function.');
    return num(ctx.frame.ws.nargout);
  });
  R('narginchk', (a, n, ctx) => { const k = ctx.frame.ws.nargin; if (k < toNumber(a[0])) throw new MError('Not enough input arguments.'); if (k > toNumber(a[1])) throw new MError('Too many input arguments.'); });
  R('exist', (a, nout, ctx) => {
    const name = toStr(a[0]); const kind = a.length > 1 ? toStr(a[1]) : '';
    if ((!kind || kind === 'var') && I.lookupVar(ctx.frame, name) !== undefined) return num(1);
    if (kind === 'var') return num(0);
    if (I.host.readText(name.endsWith('.m') ? name : name + '.m') != null || I.host.fileExists(name)) return num(2);
    if (I.builtins.has(name)) return num(5);
    return num(0);
  });
  R('isvarname', (a) => bool(/^[A-Za-z]\w{0,62}$/.test(toStr(a[0]))));
  R('iskeyword', (a) => bool(['if', 'elseif', 'else', 'end', 'for', 'while', 'switch', 'case', 'otherwise', 'try', 'catch', 'break', 'continue', 'return', 'function', 'global', 'persistent', 'parfor', 'spmd', 'classdef'].includes(toStr(a[0]))));

  // ---------- functional ----------
  const applyFun = (fname, a, nout, ctx, getN, getItem, shapeOf) => {
    let f = a[0];
    let uniform = true, errH = null;
    let args = a.slice(1);
    for (let k = 0; k < args.length; k++) {
      if (isStr(args[k]) && ['UniformOutput', 'ErrorHandler'].includes(toStr(args[k])) && k + 1 < args.length) {
        if (toStr(args[k]) === 'UniformOutput') uniform = args[k + 1].re[0] !== 0; else errH = args[k + 1];
        args.splice(k, 2); k--;
      }
    }
    const call = (fargs, no) => {
      if (f.type === 'fh') return I.callHandle(f, fargs, no);
      const name = toStr(f);
      if (fname === 'cellfun' && name === 'isempty') return [bool(fargs[0].numel === 0)];
      if (fname === 'cellfun' && name === 'length') return [num(fargs[0].numel ? Math.max(fargs[0].rows, fargs[0].cols) : 0)];
      return I.callFunction(name, fargs, no, ctx.frame);
    };
    const n = getN(args[0]);
    for (const x of args) if (getN(x) !== n) throw new MError('All of the input arguments must be of the same size and shape.\nPrevious inputs had size ' + `${args[0].rows} in dimension 1. Input #${args.indexOf(x) + 2} has size ${x.rows}`, '', fname);
    const nouts = Math.max(1, nout);
    const results = Array.from({ length: nouts }, () => []);
    for (let k = 0; k < n; k++) {
      const fargs = args.map(x => getItem(x, k));
      let r = call(fargs, nout === 0 && uniform ? (f.type === 'fh' && f.params ? 1 : 1) : nouts);
      if (nout === 0 && !r.length) continue;
      for (let q = 0; q < nouts; q++) {
        if (r[q] === undefined) throw new MError('Too many output arguments.');
        results[q].push(r[q]);
      }
    }
    const shape = args[0];
    return results.map(list => {
      if (!uniform) return new Cell(shape.rows, shape.cols, list);
      const t = zeros(shape.rows, shape.cols, list.length && list[0].type === 'num' ? list[0].cls : 'double');
      list.forEach((v, k) => {
        if (v.type !== 'num' || v.numel !== 1) throw new MError(`Non-scalar in Uniform output, at index ${k + 1}, output 1.\nSet 'UniformOutput' to false.`, '', fname);
        t.re[k] = v.re[0];
      });
      if (list.length === 0) return zeros(shape.rows, shape.cols);
      return t;
    });
  };
  R('cellfun', (a, nout, ctx) => {
    for (const x of a.slice(1)) if (x.type === 'cell' || isStr(x)) {} else if (x.type !== 'num') {}
    if (a[1].type !== 'cell') throw new MError('Input #2 expected to be a cell array, was ' + className(a[1]) + ' instead.', '', 'cellfun');
    return applyFun('cellfun', a, nout, ctx, (x) => (x.type === 'cell' ? x.numel : 1), (x, k) => (x.type === 'cell' ? x.data[k] : x));
  });
  R('arrayfun', (a, nout, ctx) => applyFun('arrayfun', a, nout, ctx, (x) => x.numel, (x, k) => {
    if (x.type === 'num') return new Tensor(1, 1, Float64Array.of(x.re[k]), x.im ? Float64Array.of(x.im[k]) : null, x.cls);
    if (x.type === 'struct') return new Struct(1, 1, x.fields, [x.data[k]]);
    if (x.type === 'cell') return new Cell(1, 1, [x.data[k]]);
    return x;
  }));
  R('structfun', (a, nout, ctx) => {
    const s = a[1]; const vals = s.fields.map(f => s.data[0].get(f));
    const c = new Cell(vals.length, 1, vals);
    const r = applyFun('structfun', [a[0], c, ...a.slice(2)], nout, ctx, (x) => x.numel, (x, k) => x.data[k]);
    return r;
  });

  // ---------- structs & cells ----------
  R('struct', (a) => {
    if (!a.length) return new Struct(1, 1, []);
    if (a.length % 2) throw new MError('Field and value input arguments must come in pairs.', '', 'struct');
    const fields = [], vals = [];
    let n = 1, shape = null;
    for (let k = 0; k < a.length; k += 2) {
      fields.push(toStr(a[k])); vals.push(a[k + 1]);
      if (a[k + 1].type === 'cell' && a[k + 1].numel !== 1) { n = a[k + 1].numel; shape = a[k + 1]; }
    }
    if (shape && n === 0) return new Struct(shape.rows, shape.cols, fields, []);
    const data = [];
    for (let q = 0; q < n; q++) {
      const m = new Map();
      fields.forEach((f, k) => { const v = vals[k]; m.set(f, v.type === 'cell' ? v.data[v.numel === 1 ? 0 : q] : v); });
      data.push(m);
    }
    return new Struct(shape ? shape.rows : 1, shape ? shape.cols : 1, fields, data);
  });
  R('fieldnames', (a) => { const s = a[0]; if (s.type === 'table') return new Cell(s.varNames.length, 1, s.varNames.map(str)); if (s.type !== 'struct') throw new MError('Invalid input argument of type \'' + className(s) + '\'. Input must be a structure or a Java or COM object.', '', 'fieldnames'); return new Cell(s.fields.length, 1, s.fields.map(str)); });
  R('isfield', (a) => {
    const s = a[0]; if (s.type !== 'struct') return bool(false);
    if (a[1].type === 'cell') return new Tensor(a[1].rows, a[1].cols, Float64Array.from(a[1].data, x => (s.fields.includes(toStr(x)) ? 1 : 0)), null, 'logical');
    return bool(s.fields.includes(toStr(a[1])));
  });
  R('rmfield', (a) => {
    const s = a[0]; const names = toStringList(a[1]);
    for (const n of names) if (!s.fields.includes(n)) throw new MError(`A field named '${n}' doesn't exist.`, '', 'rmfield');
    const fields = s.fields.filter(f => !names.includes(f));
    return new Struct(s.rows, s.cols, fields, s.data.map(m => { const nm = new Map(m); names.forEach(n => nm.delete(n)); return nm; }));
  });
  R('setfield', (a) => { const s = cloneValue(a[0]); const f = toStr(a[1]); if (!s.fields.includes(f)) s.fields.push(f); s.data[0].set(f, a[2]); return s; });
  R('getfield', (a) => { const s = a[0]; const f = toStr(a[1]); if (!s.fields.includes(f)) throw new MError(`Unrecognized field name "${f}".`); return s.data[0].get(f); });
  R('orderfields', (a) => { const s = a[0]; const f = s.fields.slice().sort(); return new Struct(s.rows, s.cols, f, s.data); });
  R('struct2cell', (a) => { const s = a[0]; return new Cell(s.fields.length, 1, s.fields.map(f => s.data[0].get(f))); });
  R('cell2struct', (a) => { const c = a[0]; const f = toStringList(a[1]); const s = new Struct(1, 1, f); f.forEach((n, k) => s.data[0].set(n, c.data[k])); return s; });
  R('cell2mat', (a) => {
    const c = a[0];
    if (c.type !== 'cell') throw new MError('cell2mat: C must be a cell array.', '', 'cell2mat');
    if (c.numel === 0) return empty();
    const rows = [];
    for (let i = 0; i < c.rows; i++) { const items = []; for (let j = 0; j < c.cols; j++) items.push(c.data[j * c.rows + i]); rows.push(catValues(items, 2, I)); }
    return catValues(rows, 1, I);
  });
  R('iscellstr', (a) => bool(a[0].type === 'cell' && a[0].data.every(x => isChar(x))));
  R('deal', (a, nout) => {
    const n = Math.max(1, nout);
    if (a.length === 1) return Array.from({ length: n }, () => a[0]);
    if (a.length !== n) throw new MError('The number of outputs should match the number of inputs.', '', 'deal');
    return a;
  });
  R('ismember', (a) => {
    const x = a[0], s = a[1];
    if (isStr(x) || x.type === 'cell') {
      const set = toStringList(s); const xs = x.type === 'cell' ? toStringList(x) : [toStr(x)];
      const tf = xs.map(v => set.includes(v)), loc = xs.map(v => set.indexOf(v) + 1);
      if (x.type !== 'cell') return [bool(tf[0]), num(loc[0])];
      return [new Tensor(x.rows, x.cols, Float64Array.from(tf, b => (b ? 1 : 0)), null, 'logical'), new Tensor(x.rows, x.cols, Float64Array.from(loc))];
    }
    const vals = Array.from(s.re);
    const tf = new Tensor(x.rows, x.cols, Float64Array.from(x.re, v => (vals.includes(v) ? 1 : 0)), null, 'logical');
    const loc = new Tensor(x.rows, x.cols, Float64Array.from(x.re, v => vals.indexOf(v) + 1));
    return [tf, loc];
  });
  R('intersect', (a) => { const A = [...new Set(a[0].re)], B = new Set(a[1].re); return rowVec(A.filter(x => B.has(x)).sort((p, q) => p - q)); });
  R('union', (a) => rowVec([...new Set([...a[0].re, ...a[1].re])].sort((p, q) => p - q)));
  R('setdiff', (a) => { const B = new Set(a[1].re); return rowVec([...new Set(a[0].re)].filter(x => !B.has(x)).sort((p, q) => p - q)); });

  // ---------- workspace ----------
  R('clc', () => { I.host.clearScreen(); });
  R('home', () => { I.host.clearScreen(); });
  R('format', (a) => {
    const words = a.map(x => toStr(x).toLowerCase());
    if (!words.length) { fmtState.mode = 'short'; fmtState.compact = false; return; }
    const w = words.join(' ');
    const map = { short: 'short', long: 'long', 'short e': 'shortE', 'long e': 'longE', 'short g': 'shortG', 'long g': 'longG', shorte: 'shortE', longe: 'longE', shortg: 'shortG', longg: 'longG', bank: 'bank', rat: 'rat', rational: 'rat' };
    if (w === 'compact') { fmtState.compact = true; return; }
    if (w === 'loose') { fmtState.compact = false; return; }
    if (map[w]) { fmtState.mode = map[w]; return; }
    if (['hex', '+', 'shorteng', 'longeng'].includes(w)) { fmtState.mode = 'short'; return; }
    throw new MError(`Unknown command option.`, '', 'format');
  });
  R('more', () => {}); R('diary', () => {}); R('echo', () => {}); R('clf', () => I.plot.clf()); R('commandwindow', () => {});
  R('who', (a, nout, ctx) => {
    const names = [...ctx.frame.ws.vars.keys()].sort((p, q) => p.toLowerCase() < q.toLowerCase() ? -1 : 1);
    if (nout) return new Cell(names.length, 1, names.map(str));
    if (!names.length) return;
    const w = Math.max(...names.map(n => n.length)) + 2;
    let s = '\nYour variables are:\n\n';
    const perLine = Math.max(1, Math.floor(80 / w));
    for (let k = 0; k < names.length; k += perLine) s += names.slice(k, k + perLine).map(n => n.padEnd(w)).join('') + '\n';
    out(s + '\n');
  });
  R('whos', (a, nout, ctx) => {
    let names = [...ctx.frame.ws.vars.keys()].sort((p, q) => p.toLowerCase() < q.toLowerCase() ? -1 : 1);
    if (a.length) { const want = a.map(x => toStr(x)); names = names.filter(n => want.includes(n)); }
    if (!names.length) return;
    const rows = names.map(n => { const v = ctx.frame.ws.vars.get(n); return [n, `${v.rows}x${v.cols}`, String(bytesOf(v)), className(v), v.type === 'num' && v.im ? 'complex' : '']; });
    const wN = Math.max(4, ...rows.map(r => r[0].length)) + 6;
    let s = '  ' + 'Name'.padEnd(wN) + 'Size'.padEnd(16) + 'Bytes'.padStart(5) + '  ' + 'Class'.padEnd(10) + 'Attributes\n\n';
    for (const r of rows) s += '  ' + r[0].padEnd(wN) + r[1].padEnd(16) + r[2].padStart(5) + '  ' + r[3].padEnd(10) + r[4] + '\n';
    out(s + '\n');
  });
  R('clear', (a, nout, ctx) => {
    const ws = ctx.frame.ws;
    const words = a.map(x => toStr(x));
    if (!words.length || words.includes('all') || words.includes('-all') || words.includes('variables') || words.includes('-v')) {
      ws.vars.clear();
      if (words.includes('all')) { I.globalVars.clear(); ws.globals.clear(); I.fileCache.clear(); }
    } else if (words[0] === '-regexp') {
      const res = words.slice(1).map(w => new RegExp(w));
      for (const k of [...ws.vars.keys()]) if (res.some(r => r.test(k))) ws.vars.delete(k);
    } else if (words.includes('global') || words.includes('-global')) { I.globalVars.clear(); ws.globals.clear(); }
    else if (words.includes('functions')) I.fileCache.clear();
    else {
      for (const w of words) {
        if (w.includes('*')) { const re = new RegExp('^' + w.replace(/\*/g, '.*') + '$'); for (const k of [...ws.vars.keys()]) if (re.test(k)) ws.vars.delete(k); }
        else ws.vars.delete(w);
      }
    }
    if (ws === I.base && I.host.varsChanged) I.host.varsChanged();
  });
  R('clearvars', (a, n, ctx) => I.builtins.get('clear').fn(a, n, ctx));
  R('inputname', () => str(''));

  // ---------- time ----------
  let ticTime = Date.now();
  R('tic', (a, nout) => { ticTime = performance.now(); if (nout) return new Tensor(1, 1, Float64Array.of(ticTime * 1000), null, 'uint64'); });
  R('toc', (a, nout) => {
    const start = a.length ? a[0].re[0] / 1000 : ticTime;
    const el = (performance.now() - start) / 1000;
    if (nout) return num(el);
    out(`Elapsed time is ${el.toFixed(6)} seconds.\n`);
  });
  R('clock', () => { const d = new Date(); return rowVec([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds() + d.getMilliseconds() / 1000]); });
  R('etime', (a) => { const t1 = a[0].re, t0 = a[1].re; const f = (t) => new Date(t[0], t[1] - 1, t[2], t[3], t[4], 0).getTime() / 1000 + t[5]; return num(f(t1) - f(t0)); });
  R('cputime', () => num(performance.now() / 1000));
  R('now', () => num(datenum(new Date())));
  R('date', () => str(fmtDate(new Date(), 1)));
  R('datestr', (a) => { const d = a.length && a[0].type === 'num' ? (a[0].numel >= 6 ? new Date(a[0].re[0], a[0].re[1] - 1, a[0].re[2], a[0].re[3], a[0].re[4], a[0].re[5]) : fromDatenum(a[0].re[0])) : new Date(); return str(fmtDate(d, 0)); });
  R('datenum', (a) => { if (!a.length) return num(datenum(new Date())); const v = a.map(x => x.re[0]); return num(datenum(new Date(v[0], (v[1] || 1) - 1, v[2] || 1, v[3] || 0, v[4] || 0, v[5] || 0))); });
  R('weekday', (a) => { const d = fromDatenum(a[0].re[0]); const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; return [num(d.getDay() + 1), str(names[d.getDay()])]; });
  R('calendar', (a, nout) => {
    const d = new Date();
    let y = d.getFullYear(), m = d.getMonth();
    if (a.length === 1) { const dn = fromDatenum(a[0].re[0]); y = dn.getFullYear(); m = dn.getMonth(); }
    if (a.length >= 2) { y = a[0].re[0]; m = a[1].re[0] - 1; }
    const first = new Date(y, m, 1).getDay(); const days = new Date(y, m + 1, 0).getDate();
    const M = Array.from({ length: 6 }, () => new Array(7).fill(0));
    for (let k = 1; k <= days; k++) { const p = first + k - 1; M[Math.floor(p / 7)][p % 7] = k; }
    if (nout) { const t = zeros(6, 7); M.forEach((r, i) => r.forEach((v, j) => (t.re[j * 6 + i] = v))); return t; }
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let s = `                   ${months[m]} ${y}\n`;
    s += ['S', 'M', 'Tu', 'W', 'Th', 'F', 'S'].map(x => x.padStart(6)).join('') + '\n';
    for (const r of M) s += r.map(v => String(v).padStart(6)).join('') + '\n';
    out(s);
  });
  R('version', () => str('9.11.0 (R2021b) — web edition'));
  R('ver', () => out('-----------------------------------------------------------------------------------------------------\nMATLAB Version: 9.11 (R2021b) — browser-based educational edition\n-----------------------------------------------------------------------------------------------------\n'));
  R('computer', () => str('GLNXA64'));
  R('pwd', () => str('/MATLAB Drive'));
  R('cd', () => str('/MATLAB Drive'));
  R('userpath', () => str('/MATLAB Drive'));
  R('ls', () => { out(I.host.listFiles().join('  ') + '\n'); });
  R('dir', (a, nout) => { const f = I.host.listFiles(); if (nout) { const s = new Struct(f.length, 1, ['name', 'bytes', 'isdir'], f.map(n => new Map([['name', str(n)], ['bytes', num(0)], ['isdir', bool(false)]]))); return s; } out('\n' + ['.', '..', ...f].join('  ') + '\n\n'); });
  R('what', () => {
    const f = I.host.listFiles();
    const ms = f.filter(n => n.endsWith('.m')).map(n => n.slice(0, -2)), mats = f.filter(n => n.endsWith('.mat')).map(n => n.slice(0, -4));
    let s = '';
    if (ms.length) s += `\nMATLAB Code files in the current folder /MATLAB Drive\n\n${ms.join('  ')}\n`;
    if (mats.length) s += `\nMAT-files in the current folder /MATLAB Drive\n\n${mats.join('  ')}\n`;
    out(s + '\n');
  });
  R('type', (a) => { const n = toStr(a[0]); const t = I.host.readText(n) ?? I.host.readText(n + '.m'); if (t == null) throw new MError(`File '${n}' not found.`, '', 'type'); out('\n' + t + '\n'); });
  R('delete', (a) => { I.host.deleteFile(toStr(a[0])); });
  R('edit', () => {}); R('addpath', () => {}); R('rmpath', () => {}); R('path', () => {}); R('savepath', () => {});

  // ---------- help ----------
  R('help', (a, nout, ctx) => {
    if (!a.length) { out(HELP.__general || 'Type help followed by a function name, e.g. help plot\n'); return; }
    const name = toStr(a[0]);
    // user function help
    const r = I.resolveFunction(name, ctx.frame);
    if (r && (r.kind === 'user' || r.kind === 'local') && r.def.help) { out(' ' + r.def.help.split('\n').join('\n ') + '\n\n'); return; }
    const h = helpFor(name);
    if (h) { out(h); return; }
    out(`${name} not found.\n\nUse the Help browser search field to search the documentation, or\ntype "help help" for help command options, such as help for methods.\n\n`);
  });
  R('doc', (a, nout, ctx) => I.builtins.get('help').fn(a, nout, ctx));
  R('helpwin', (a, nout, ctx) => I.builtins.get('help').fn(a, nout, ctx));
  R('lookfor', (a) => {
    const kw = toStr(a[0]).toLowerCase();
    const hits = Object.entries(HELP).filter(([k, v]) => !k.startsWith('__') && (k.includes(kw) || v.toLowerCase().split('\n')[0].includes(kw)));
    out(hits.map(([k, v]) => `${k.padEnd(20)} - ${v.split('\n')[0].replace(/^\s*\S+\s+/, '').trim()}`).join('\n') + '\n');
  });
}

export function bytesOf(v) {
  switch (v.type) {
    case 'num': {
      const per = { double: 8, single: 4, char: 2, logical: 1, int8: 1, uint8: 1, int16: 2, uint16: 2, int32: 4, uint32: 4, int64: 8, uint64: 8 }[v.cls] || 8;
      return v.numel * per * (v.im ? 2 : 1);
    }
    case 'cell': return v.data.reduce((s, x) => s + 112 + bytesOf(x), 0);
    case 'struct': return v.data.reduce((s, m) => s + [...m.values()].reduce((q, x) => q + 104 + bytesOf(x), 0), 0) + 64 * v.fields.length;
    case 'string': return 150 + v.data.reduce((s, x) => s + 2 * x.length, 0);
    case 'sym': return 8;
    case 'fh': return 32;
    case 'table': return v.columns.reduce((s, c) => s + bytesOf(c), 1000);
  }
  return 0;
}

function datenum(d) {
  const ms = d.getTime() - d.getTimezoneOffset() * 60000;
  return ms / 86400000 + 719529;
}
function fromDatenum(n) { const ms = (n - 719529) * 86400000; const d = new Date(ms); return new Date(d.getTime() + d.getTimezoneOffset() * 60000); }
function fmtDate(d, kind) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dd = String(d.getDate()).padStart(2, '0');
  const base = `${dd}-${months[d.getMonth()]}-${d.getFullYear()}`;
  if (kind === 1) return base;
  const p = (x) => String(x).padStart(2, '0');
  return `${base} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
void parse; void charRows;
