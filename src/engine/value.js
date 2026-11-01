// Core value types for the MATLAB engine.
// Numeric/char/logical arrays are 2-D, column-major, stored in Float64Array.

export class MError extends Error {
  constructor(message, identifier = '', fname = '') {
    super(message);
    this.identifier = identifier;
    this.fname = fname;          // "Error using <fname>" header
    this.mstack = [];            // [{name, line, src}]
  }
}

export const INT_RANGES = {
  int8: [-128, 127], uint8: [0, 255], int16: [-32768, 32767], uint16: [0, 65535],
  int32: [-2147483648, 2147483647], uint32: [0, 4294967295],
  int64: [-9223372036854775808, 9223372036854775807], uint64: [0, 18446744073709551615],
};
export const isIntCls = (c) => c in INT_RANGES;

export class Tensor {
  constructor(rows, cols, re, im = null, cls = 'double') {
    this.type = 'num';
    this.rows = rows; this.cols = cols;
    this.re = re; this.im = im; this.cls = cls;
  }
  get numel() { return this.rows * this.cols; }
  get isComplex() { return this.im !== null; }
}

export class Cell {
  constructor(rows, cols, data) {
    this.type = 'cell'; this.rows = rows; this.cols = cols;
    this.data = data || new Array(rows * cols).fill(null).map(() => empty());
  }
  get numel() { return this.rows * this.cols; }
}

export class Struct {
  // struct array; data is array of Map(fieldName -> value)
  constructor(rows = 1, cols = 1, fields = [], data = null) {
    this.type = 'struct'; this.rows = rows; this.cols = cols;
    this.fields = fields.slice();
    this.data = data || Array.from({ length: rows * cols }, () => new Map(fields.map(f => [f, empty()])));
  }
  get numel() { return this.rows * this.cols; }
}

export class FHandle {
  constructor({ name = null, params = null, body = null, env = null, src = '' }) {
    this.type = 'fh'; this.rows = 1; this.cols = 1;
    this.name = name; this.params = params; this.body = body; this.env = env; this.src = src;
  }
  get numel() { return 1; }
}

export class Sym {
  // scalar or matrix of symbolic expressions; exprs is array of strings (column-major)
  constructor(exprs, rows = 1, cols = 1) {
    this.type = 'sym'; this.rows = rows; this.cols = cols;
    this.exprs = Array.isArray(exprs) ? exprs : [exprs];
  }
  get numel() { return this.rows * this.cols; }
}

export class StrArr {
  // MATLAB string array ("double quoted"); data is array of JS strings
  constructor(rows, cols, data) { this.type = 'string'; this.rows = rows; this.cols = cols; this.data = data; }
  get numel() { return this.rows * this.cols; }
}

export class Table {
  constructor(varNames, columns, nrows) {
    this.type = 'table'; this.varNames = varNames; this.columns = columns;
    this.rows = nrows; this.cols = varNames.length;
  }
  get numel() { return this.rows * this.cols; }
}

// ---------- constructors ----------
export const num = (v) => new Tensor(1, 1, Float64Array.of(v));
export const cplx = (r, i) => new Tensor(1, 1, Float64Array.of(r), Float64Array.of(i));
export const bool = (b) => new Tensor(1, 1, Float64Array.of(b ? 1 : 0), null, 'logical');
export const empty = (cls = 'double') => new Tensor(0, 0, new Float64Array(0), null, cls);
export const zeros = (r, c, cls = 'double') => new Tensor(r, c, new Float64Array(r * c), null, cls);
export const str = (s) => {
  const a = new Float64Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return new Tensor(s.length ? 1 : 0, s.length, a, null, 'char');
};
export const rowVec = (arr, cls = 'double') => new Tensor(1, arr.length, Float64Array.from(arr), null, cls);
export const colVec = (arr, cls = 'double') => new Tensor(arr.length, 1, Float64Array.from(arr), null, cls);
export const mat = (rows, cols, arr, cls = 'double') => new Tensor(rows, cols, Float64Array.from(arr), null, cls);
export function fromRows(rowsArr) {
  const r = rowsArr.length, c = r ? rowsArr[0].length : 0;
  const t = zeros(r, c);
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) t.re[j * r + i] = rowsArr[i][j];
  return t;
}
export const cellRow = (vals) => new Cell(1, vals.length, vals);
export const cellCol = (vals) => new Cell(vals.length, 1, vals);

// ---------- helpers ----------
export function className(v) {
  switch (v.type) {
    case 'num': return v.cls;
    case 'cell': return 'cell';
    case 'struct': return 'struct';
    case 'fh': return 'function_handle';
    case 'sym': return 'sym';
    case 'string': return 'string';
    case 'table': return 'table';
  }
  return 'double';
}
export const isNum = (v) => v && v.type === 'num';
export const isChar = (v) => v && v.type === 'num' && v.cls === 'char';
export const isStringLike = (v) => isChar(v) || (v && v.type === 'string' && v.numel === 1);
export const isEmpty = (v) => v.numel === 0;
export const isScalar = (v) => v.rows === 1 && v.cols === 1;

export function toStr(v) {
  if (v.type === 'string') return v.data[0] ?? '';
  if (v.type !== 'num') throw new MError(`Expected a character vector, got ${className(v)}.`);
  // char matrix -> rows concatenated (row-major reading)
  if (v.rows <= 1) return String.fromCharCode(...v.re);
  let s = '';
  for (let i = 0; i < v.rows; i++) { for (let j = 0; j < v.cols; j++) s += String.fromCharCode(v.re[j * v.rows + i]); }
  return s;
}
export function charRows(v) {
  const out = [];
  for (let i = 0; i < v.rows; i++) {
    let s = '';
    for (let j = 0; j < v.cols; j++) s += String.fromCharCode(v.re[j * v.rows + i]);
    out.push(s);
  }
  return out;
}

export function toNumber(v, what = '') {
  if (v.type === 'num') {
    if (v.numel < 1) throw new MError(`${what || 'Value'} must not be empty.`);
    return v.re[0];
  }
  if (v.type === 'sym') {
    const n = Number(v.exprs[0]);
    if (!isNaN(n)) return n;
  }
  throw new MError(`Conversion to double from ${className(v)} is not possible.`);
}
export function toInt(v, what) { return Math.round(toNumber(v, what)); }
export function toBool(v) {
  // MATLAB truthiness for if/while: all elements nonzero and nonempty
  if (v.type === 'num') {
    if (v.numel === 0) return false;
    for (let i = 0; i < v.numel; i++) {
      if (v.re[i] === 0 && (!v.im || v.im[i] === 0)) return false;
      if (Number.isNaN(v.re[i])) throw new MError("NaN's cannot be converted to logicals.");
    }
    return true;
  }
  if (v.type === 'sym') { return toNumber(v) !== 0; }
  if (v.type === 'string') return v.numel > 0;
  throw new MError(`Conversion to logical from ${className(v)} is not possible.`);
}
export function toArray(v) {
  if (v.type !== 'num') throw new MError(`Conversion to double from ${className(v)} is not possible.`);
  return Array.from(v.re);
}

export function copyTensor(t) {
  return new Tensor(t.rows, t.cols, Float64Array.from(t.re), t.im ? Float64Array.from(t.im) : null, t.cls);
}
export function cloneValue(v) {
  // value semantics: copy-on-assign for mutable containers
  switch (v.type) {
    case 'num': return v; // tensors are treated immutable by ops; index-assign copies
    case 'cell': return new Cell(v.rows, v.cols, v.data.slice());
    case 'struct': return new Struct(v.rows, v.cols, v.fields, v.data.map(m => new Map(m)));
    default: return v;
  }
}

export function dropImagIfZero(t) {
  if (t.im) {
    for (let i = 0; i < t.im.length; i++) if (t.im[i] !== 0) return t;
    t.im = null;
  }
  return t;
}

export function sizeStr(v) { return `${v.rows}×${v.cols}`; }

export function saturate(x, cls) {
  if (isIntCls(cls)) {
    const [lo, hi] = INT_RANGES[cls];
    if (Number.isNaN(x)) return 0;
    // MATLAB rounds half away from zero
    let r = Math.sign(x) * Math.round(Math.abs(x));
    return r < lo ? lo : r > hi ? hi : r;
  }
  if (cls === 'single') return Math.fround(x);
  if (cls === 'logical') return x !== 0 ? 1 : 0;
  return x;
}
export function castTensor(t, cls) {
  if (cls === 'logical') {
    for (let i = 0; i < t.numel; i++) if (Number.isNaN(t.re[i])) throw new MError("NaN's cannot be converted to logicals.");
  }
  const re = new Float64Array(t.numel);
  for (let i = 0; i < re.length; i++) re[i] = saturate(t.re[i], cls);
  const im = t.im && !isIntCls(cls) && cls !== 'logical' && cls !== 'char' ? t.im.map(x => saturate(x, cls)) : null;
  return new Tensor(t.rows, t.cols, re, im, cls);
}
