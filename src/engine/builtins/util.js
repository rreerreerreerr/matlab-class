// Shared helpers for builtin implementations.
import { Tensor, MError, num, zeros, className, toStr, isChar, Cell, StrArr } from '../value.js';

export function argNum(v, fname, what = 'Input') {
  if (v.type === 'num') return v;
  if (v.type === 'sym') return v;
  throw new MError(`Invalid data type. ${what} must be numeric.`, '', fname);
}
export function needNum(v, fname) {
  if (v.type !== 'num') throw new MError(`Undefined function '${fname}' for input arguments of type '${className(v)}'.`, 'MATLAB:UndefinedFunction');
  return v;
}
export function scalar(v, fname, what) {
  if (v.type !== 'num' || v.numel < 1) throw new MError(`${what || 'Input'} must be a numeric scalar.`, '', fname);
  return v.re[0];
}
export function isStr(v) { return isChar(v) || (v && v.type === 'string' && v.numel === 1); }
export function sval(v) { return toStr(v); }

// apply real function elementwise; cfun optional for complex/out-of-domain
export function mapReal(t, f, outCls) {
  const re = new Float64Array(t.numel);
  for (let i = 0; i < re.length; i++) re[i] = f(t.re[i]);
  const cls = outCls || (t.cls === 'single' ? 'single' : 'double');
  return new Tensor(t.rows, t.cols, re, null, cls);
}
export function mapComplex(t, f) {
  // f(re, im) -> [re, im]
  const re = new Float64Array(t.numel), im = new Float64Array(t.numel);
  let any = false;
  for (let i = 0; i < re.length; i++) {
    const z = f(t.re[i], t.im ? t.im[i] : 0);
    re[i] = z[0]; im[i] = z[1]; if (z[1] !== 0) any = true;
  }
  return new Tensor(t.rows, t.cols, re, any ? im : null, t.cls === 'single' ? 'single' : 'double');
}

// dimension to operate on: first non-singleton
export function defaultDim(t) { return t.rows !== 1 ? 1 : 2; }
export function getDim(args, k, t, fname) {
  if (args.length > k) {
    const d = args[k];
    if (d.type !== 'num' || d.numel !== 1 || !(d.re[0] >= 1) || !Number.isInteger(d.re[0])) throw new MError('Dimension argument must be a positive integer scalar within indexing range.', '', fname);
    return d.re[0];
  }
  return defaultDim(t);
}

// reduce along dim with f(arrayOfValues) -> number
export function reduce(t, dim, f, outCls = 'double') {
  if (dim === 1) {
    const out = new Float64Array(t.cols);
    const col = new Float64Array(t.rows);
    for (let j = 0; j < t.cols; j++) { for (let i = 0; i < t.rows; i++) col[i] = t.re[j * t.rows + i]; out[j] = f(col); }
    return new Tensor(1, t.cols, out, null, outCls);
  }
  if (dim === 2) {
    const out = new Float64Array(t.rows);
    const row = new Float64Array(t.cols);
    for (let i = 0; i < t.rows; i++) { for (let j = 0; j < t.cols; j++) row[j] = t.re[j * t.rows + i]; out[i] = f(row); }
    return new Tensor(t.rows, 1, out, null, outCls);
  }
  // dim >= 3: identity-ish
  const out = new Float64Array(t.numel);
  for (let i = 0; i < t.numel; i++) out[i] = f(Float64Array.of(t.re[i]));
  return new Tensor(t.rows, t.cols, out, null, outCls);
}
// cumulative along dim
export function cumulate(t, dim, f) {
  const out = new Float64Array(t.numel);
  if (dim === 1) for (let j = 0; j < t.cols; j++) { let acc; for (let i = 0; i < t.rows; i++) { const k = j * t.rows + i; acc = i === 0 ? t.re[k] : f(acc, t.re[k]); out[k] = acc; } }
  else if (dim === 2) for (let i = 0; i < t.rows; i++) { let acc; for (let j = 0; j < t.cols; j++) { const k = j * t.rows + i; acc = j === 0 ? t.re[k] : f(acc, t.re[k]); out[k] = acc; } }
  else out.set(t.re);
  return new Tensor(t.rows, t.cols, out, null, 'double');
}

export function sizeArgs(args, fname) {
  // zeros(n), zeros(m,n), zeros([m n]), with optional class name / 'like'
  let cls = 'double';
  const a = args.slice();
  while (a.length && isStr(a[a.length - 1])) {
    const s = toStr(a.pop());
    if (s === 'like') continue;
    cls = s;
  }
  if (a.length === 0) return [1, 1, cls];
  const toDim = (v) => {
    if (v.type !== 'num') throw new MError('Size inputs must be numeric.', '', fname);
    const x = v.re[0];
    if (!Number.isFinite(x) || !Number.isInteger(x)) {
      if (Number.isNaN(x)) throw new MError('Size inputs must be integers.', '', fname);
      if (!Number.isInteger(x)) throw new MError('Size inputs must be integers.', '', fname);
    }
    return Math.max(0, x);
  };
  if (a.length === 1) {
    const v = a[0];
    if (v.type === 'num' && v.numel >= 2) {
      const dims = Array.from(v.re); for (const d of dims.slice(2)) if (d !== 1) throw new MError('N-D arrays are not supported in this environment.', '', fname);
      return [Math.max(0, dims[0]), Math.max(0, dims[1]), cls];
    }
    const n = toDim(v); return [n, n, cls];
  }
  for (const d of a.slice(2)) if (toDim(d) !== 1) throw new MError('N-D arrays are not supported in this environment.', '', fname);
  return [toDim(a[0]), toDim(a[1]), cls];
}

export const cellOfStrings = (arr, col = false) => col ? new Cell(arr.length, 1, arr) : new Cell(1, arr.length, arr);

export function toStringList(v, fname) {
  if (isChar(v)) {
    const out = []; for (let i = 0; i < v.rows; i++) { let s = ''; for (let j = 0; j < v.cols; j++) s += String.fromCharCode(v.re[j * v.rows + i]); out.push(s); }
    return v.rows === 0 ? [''] : out;
  }
  if (v.type === 'cell') return v.data.map(x => { if (!isStr(x)) throw new MError('Cell array must contain only character vectors.', '', fname); return toStr(x); });
  if (v.type === 'string') return v.data.slice();
  throw new MError('Input must be a character vector, cell array of character vectors, or string array.', '', fname);
}

// rng: mulberry32 seeded
let seed = 5489;
export function setSeed(s) { seed = (s >>> 0) || 5489; }
export function rand01() {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
let spare = null;
export function randn01() {
  if (spare !== null) { const s = spare; spare = null; return s; }
  let u, v, s;
  do { u = rand01() * 2 - 1; v = rand01() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
  const m = Math.sqrt(-2 * Math.log(s) / s);
  spare = v * m; return u * m;
}
