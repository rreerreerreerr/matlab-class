// Arithmetic, relational and logical operators with MATLAB semantics
// (implicit expansion, class rules, complex numbers, saturation for integers).
import { Tensor, MError, className, isIntCls, saturate, dropImagIfZero, num, zeros, StrArr } from './value.js';

export const OPNAME = { '+': 'plus', '-': 'minus', '.*': 'times', './': 'rdivide', '.\\': 'ldivide', '.^': 'power',
  '*': 'mtimes', '/': 'mrdivide', '\\': 'mldivide', '^': 'mpower', '==': 'eq', '~=': 'ne', '<': 'lt', '<=': 'le',
  '>': 'gt', '>=': 'ge', '&': 'and', '|': 'or' };

let symHook = null; // set by sym module: (op, a, b) => value
export function setSymHook(f) { symHook = f; }

function notSupported(op, a, b) {
  const ta = className(a), tb = b ? className(b) : null;
  const bad = (a.type !== 'num') ? ta : tb;
  if (tb && ta !== tb && a.type !== 'num' && b.type !== 'num')
    return new MError(`Operator '${op}' is not supported for operands of type '${bad}'.`);
  return new MError(`Operator '${op}' is not supported for operands of type '${bad}'.`);
}

export function resultClass(a, b, op) {
  const ca = a.cls, cb = b.cls;
  const ia = isIntCls(ca), ib = isIntCls(cb);
  if (ia || ib) {
    if (ia && ib && ca !== cb) throw new MError('Integers can only be combined with integers of the same class, or scalar doubles.');
    const ic = ia ? ca : cb;
    const other = ia ? b : a;
    if (!(isIntCls(other.cls)) && other.cls === 'single') return ic;
    if (other.im || (ia ? a.im : b.im)) throw new MError('Complex integer arithmetic is not supported.');
    return ic;
  }
  if (ca === 'single' || cb === 'single') return 'single';
  return 'double';
}

function bcastShape(a, b, opSym) {
  const r = a.rows === b.rows ? a.rows : a.rows === 1 ? b.rows : b.rows === 1 ? a.rows : -1;
  const c = a.cols === b.cols ? a.cols : a.cols === 1 ? b.cols : b.cols === 1 ? a.cols : -1;
  if (r < 0 || c < 0) throw new MError('Arrays have incompatible sizes for this operation.', 'MATLAB:sizeDimensionsMustMatch');
  return [r, c];
}

// generic elementwise binary op over real parts; f(x,y)
export function elementwise(a, b, f, cls, opSym) {
  const [r, c] = bcastShape(a, b, opSym);
  const out = new Float64Array(r * c);
  const ar = a.rows, br = b.rows;
  const aS = a.numel === 1, bS = b.numel === 1;
  if (aS && bS) out[0] = f(a.re[0], b.re[0]);
  else if (bS) { const y = b.re[0]; if (a.rows === r && a.cols === c) for (let k = 0; k < out.length; k++) out[k] = f(a.re[k], y); else bc(); }
  else if (aS) { const x = a.re[0]; if (b.rows === r && b.cols === c) for (let k = 0; k < out.length; k++) out[k] = f(x, b.re[k]); else bc(); }
  else if (a.rows === b.rows && a.cols === b.cols) for (let k = 0; k < out.length; k++) out[k] = f(a.re[k], b.re[k]);
  else bc();
  function bc() {
    for (let j = 0; j < c; j++) for (let i = 0; i < r; i++) {
      const ai = (a.cols === 1 ? 0 : j) * ar + (a.rows === 1 ? 0 : i);
      const bi = (b.cols === 1 ? 0 : j) * br + (b.rows === 1 ? 0 : i);
      out[j * r + i] = f(a.re[ai], b.re[bi]);
    }
  }
  if (cls && cls !== 'double' && cls !== 'logical') for (let k = 0; k < out.length; k++) out[k] = saturate(out[k], cls);
  return new Tensor(r, c, out, null, cls || 'double');
}

// complex elementwise: f(ar, ai, br, bi) -> [re, im]
function elementwiseC(a, b, f, cls, opSym) {
  const [r, c] = bcastShape(a, b, opSym);
  const re = new Float64Array(r * c), im = new Float64Array(r * c);
  const aim = a.im, bim = b.im;
  for (let j = 0; j < c; j++) for (let i = 0; i < r; i++) {
    const ai = (a.cols === 1 ? 0 : j) * a.rows + (a.rows === 1 ? 0 : i);
    const bi = (b.cols === 1 ? 0 : j) * b.rows + (b.rows === 1 ? 0 : i);
    const z = f(a.re[ai], aim ? aim[ai] : 0, b.re[bi], bim ? bim[bi] : 0);
    re[j * r + i] = z[0]; im[j * r + i] = z[1];
  }
  if (cls === 'single') { for (let k = 0; k < re.length; k++) { re[k] = Math.fround(re[k]); im[k] = Math.fround(im[k]); } }
  return dropImagIfZero(new Tensor(r, c, re, im, cls || 'double'));
}

// ---- complex helpers
export const cmul = (a, b, c, d) => [a * c - b * d, a * d + b * c];
export function cdiv(a, b, c, d) {
  if (d === 0) return [a / c, b === 0 ? 0 : b / c];
  if (Math.abs(c) >= Math.abs(d)) { const r = d / c, den = c + d * r; return [(a + b * r) / den, (b - a * r) / den]; }
  const r = c / d, den = c * r + d; return [(a * r + b) / den, (b * r - a) / den];
}
export const cabs = (a, b) => Math.hypot(a, b);
export function cexp(a, b) { const e = Math.exp(a); return b === 0 ? [e, 0] : [e * Math.cos(b), e * Math.sin(b)]; }
export function clog(a, b) { return [Math.log(Math.hypot(a, b)), Math.atan2(b, a)]; }
export function csqrt(a, b) {
  if (b === 0) return a >= 0 ? [Math.sqrt(a), 0] : [0, Math.sqrt(-a)];
  const m = Math.hypot(a, b); const re = Math.sqrt((m + a) / 2); const im = Math.sign(b) * Math.sqrt((m - a) / 2);
  return [re, im];
}
export function cpow(a, b, c, d) {
  if (a === 0 && b === 0) {
    if (c === 0 && d === 0) return [1, 0];
    if (d === 0 && c > 0) return [0, 0];
  }
  if (b === 0 && d === 0 && (a >= 0 || Number.isInteger(c))) return [Math.pow(a, c), 0];
  if (d === 0 && Number.isInteger(c) && Math.abs(c) <= 64) {
    // exact integer power by repeated multiplication
    let rr = 1, ri = 0, br = a, bi = b, n = Math.abs(c);
    while (n) { if (n & 1) [rr, ri] = cmul(rr, ri, br, bi); [br, bi] = cmul(br, bi, br, bi); n >>= 1; }
    return c < 0 ? cdiv(1, 0, rr, ri) : [rr, ri];
  }
  const [lr, li] = clog(a, b);
  const [er, ei] = cmul(lr, li, c, d);
  return cexp(er, ei);
}

function toNumeric(v, op) {
  if (v.type === 'num') return v;
  if (v.type === 'string') throw new MError(`Operator '${op}' is not supported for operands of type 'string'.`);
  throw notSupported(op, v);
}

const ARITH = {
  '+': { f: (x, y) => x + y, c: (a, b, c, d) => [a + c, b + d] },
  '-': { f: (x, y) => x - y, c: (a, b, c, d) => [a - c, b - d] },
  '.*': { f: (x, y) => x * y, c: cmul },
  './': { f: (x, y) => x / y, c: cdiv },
  '.\\': { f: (x, y) => y / x, c: (a, b, c, d) => cdiv(c, d, a, b) },
  '.^': { f: null, c: cpow },
};

export function binaryOp(op, a, b) {
  if (a.type === 'sym' || b.type === 'sym') {
    if (!symHook) throw new MError('Symbolic Math Toolbox not available.');
    return symHook(op, a, b);
  }
  if (a.type === 'string' || b.type === 'string') return stringOp(op, a, b);
  switch (op) {
    case '+': case '-': case '.*': case './': case '.\\': case '.^': return arith(op, toNumeric(a, op), toNumeric(b, op));
    case '*': return mtimes(toNumeric(a, op), toNumeric(b, op));
    case '/': return mrdivide(toNumeric(a, op), toNumeric(b, op));
    case '\\': return mldivide(toNumeric(a, op), toNumeric(b, op));
    case '^': return mpower(toNumeric(a, op), toNumeric(b, op));
    case '==': case '~=': case '<': case '<=': case '>': case '>=': return compare(op, a, b);
    case '&': case '|': return logicalOp(op, toNumeric(a, op), toNumeric(b, op));
  }
  throw new MError(`Unknown operator ${op}`);
}

export function arith(op, a, b) {
  const cls = resultClass(a, b, op);
  const intMode = isIntCls(cls);
  if (!a.im && !b.im) {
    if (op === '.^') {
      // negative base with fractional power -> complex
      let needC = false;
      if (!intMode) {
        const aS = a.numel === 1, bS = b.numel === 1;
        outer: for (let i = 0; i < a.numel; i++) if (a.re[i] < 0) {
          if (bS) { if (!Number.isInteger(b.re[0])) { needC = true; break; } }
          else for (let j = 0; j < b.numel; j++) if (!Number.isInteger(b.re[j])) { needC = true; break outer; }
        }
      }
      if (!needC) {
        const f = intMode ? (x, y) => Math.pow(x, y) : powReal;
        return elementwise(a, b, f, cls, op);
      }
      return elementwiseC(a, b, cpow, cls, op);
    }
    let f = ARITH[op].f;
    if (intMode && (op === './' || op === '.\\')) {
      // integer division rounds; x/0 saturates
      const g = f; f = (x, y) => { const q = g(x, y); return Number.isNaN(q) ? 0 : q; };
    }
    return elementwise(a, b, f, cls, op);
  }
  return elementwiseC(a, b, ARITH[op].c, cls, op);
}
function powReal(x, y) {
  if (Number.isInteger(y) && y >= 0 && y <= 32) {
    // exact repeated multiplication like MATLAB for small ints
    let r = 1, base = x, n = y;
    while (n) { if (n & 1) r *= base; base *= base; n >>= 1; }
    return r;
  }
  return Math.pow(x, y);
}

export function compare(op, a, b) {
  // char vs char comparisons allowed; cells not
  if (a.type !== 'num' || b.type !== 'num') {
    if (a.type === 'string' || b.type === 'string') return stringOp(op, a, b);
    const bad = a.type !== 'num' ? a : b;
    throw new MError(`Operator '${op}' is not supported for operands of type '${className(bad)}'.`);
  }
  let f;
  switch (op) {
    case '==': f = (x, y) => (x === y ? 1 : 0); break;
    case '~=': f = (x, y) => (x !== y ? 1 : 0); break;
    case '<': f = (x, y) => (x < y ? 1 : 0); break;
    case '<=': f = (x, y) => (x <= y ? 1 : 0); break;
    case '>': f = (x, y) => (x > y ? 1 : 0); break;
    case '>=': f = (x, y) => (x >= y ? 1 : 0); break;
  }
  if ((a.im || b.im) && (op === '==' || op === '~=')) {
    const t = elementwiseC(a, b, (p, q, r, s) => [((p === r && q === s) === (op === '==')) ? 1 : 0, 0], 'double', op);
    t.cls = 'logical'; t.im = null; return t;
  }
  const t = elementwise(a, b, f, 'logical', op);
  return t;
}

export function logicalOp(op, a, b) {
  for (const v of [a, b]) for (let i = 0; i < v.numel; i++) if (Number.isNaN(v.re[i])) throw new MError("NaN's cannot be converted to logicals.");
  const f = op === '&' ? (x, y) => (x !== 0 && y !== 0 ? 1 : 0) : (x, y) => (x !== 0 || y !== 0 ? 1 : 0);
  return elementwise(a, b, f, 'logical', op);
}

export function unaryOp(op, a) {
  if (a.type === 'sym') return symHook('u' + op, a);
  if (a.type !== 'num') throw new MError(`Operator '${op === '~' ? '~' : op}' is not supported for operands of type '${className(a)}'.`);
  if (op === '+') {
    if (a.cls === 'char' || a.cls === 'logical') return new Tensor(a.rows, a.cols, a.re, a.im, 'double');
    return a;
  }
  if (op === '-') {
    const cls = a.cls === 'char' || a.cls === 'logical' ? 'double' : a.cls;
    const re = new Float64Array(a.numel);
    for (let i = 0; i < re.length; i++) re[i] = saturate(-a.re[i], cls) + 0;
    return new Tensor(a.rows, a.cols, re, a.im ? a.im.map(x => -x) : null, cls);
  }
  if (op === '~') {
    const re = new Float64Array(a.numel);
    for (let i = 0; i < re.length; i++) {
      if (Number.isNaN(a.re[i])) throw new MError("NaN's cannot be converted to logicals.");
      re[i] = (a.re[i] === 0 && (!a.im || a.im[i] === 0)) ? 1 : 0;
    }
    return new Tensor(a.rows, a.cols, re, null, 'logical');
  }
}

export function transpose(a, conj = true) {
  if (a.type === 'sym') return symHook('transpose', a);
  if (a.type === 'cell') {
    const out = new Array(a.numel);
    for (let i = 0; i < a.rows; i++) for (let j = 0; j < a.cols; j++) out[i * a.cols + j] = a.data[j * a.rows + i];
    return new a.constructor(a.cols, a.rows, out);
  }
  if (a.type === 'string') {
    const out = new Array(a.numel);
    for (let i = 0; i < a.rows; i++) for (let j = 0; j < a.cols; j++) out[i * a.cols + j] = a.data[j * a.rows + i];
    return new a.constructor(a.cols, a.rows, out);
  }
  if (a.type === 'struct') {
    const out = new Array(a.numel);
    for (let i = 0; i < a.rows; i++) for (let j = 0; j < a.cols; j++) out[i * a.cols + j] = a.data[j * a.rows + i];
    return new a.constructor(a.cols, a.rows, a.fields, out);
  }
  if (a.type !== 'num') throw new MError(`Operator ''' is not supported for operands of type '${className(a)}'.`);
  const r = a.rows, c = a.cols;
  const re = new Float64Array(r * c);
  const im = a.im ? new Float64Array(r * c) : null;
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) {
    re[i * c + j] = a.re[j * r + i];
    if (im) im[i * c + j] = conj ? -a.im[j * r + i] : a.im[j * r + i];
  }
  return new Tensor(c, r, re, im, a.cls);
}

export function mtimes(a, b) {
  if (a.numel === 1 || b.numel === 1) return arith('.*', a, b);
  if (a.cols !== b.rows) throw new MError('Incorrect dimensions for matrix multiplication. Check that the number of columns in the first matrix matches the number of rows in the second matrix. To operate on each element of the matrix individually, use TIMES (.*) for elementwise multiplication.', 'MATLAB:innerdim', ' * ');
  const cls = resultClass(a, b, '*');
  const m = a.rows, n = b.cols, K = a.cols;
  const re = new Float64Array(m * n);
  if (!a.im && !b.im) {
    for (let j = 0; j < n; j++) for (let k = 0; k < K; k++) {
      const bv = b.re[j * K + k]; if (bv === 0) continue;
      const ao = k * m, ro = j * m;
      for (let i = 0; i < m; i++) re[ro + i] += a.re[ao + i] * bv;
    }
    const t = new Tensor(m, n, re, null, cls);
    if (cls !== 'double') for (let i = 0; i < re.length; i++) re[i] = saturate(re[i], cls);
    return t;
  }
  const im = new Float64Array(m * n);
  for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) {
    let sr = 0, si = 0;
    for (let k = 0; k < K; k++) {
      const [pr, pi] = cmul(a.re[k * m + i], a.im ? a.im[k * m + i] : 0, b.re[j * K + k], b.im ? b.im[j * K + k] : 0);
      sr += pr; si += pi;
    }
    re[j * m + i] = sr; im[j * m + i] = si;
  }
  return dropImagIfZero(new Tensor(m, n, re, im, cls));
}

// ---- linear algebra helpers (real) ----
export function toRows(t) {
  const A = [];
  for (let i = 0; i < t.rows; i++) { const row = new Array(t.cols); for (let j = 0; j < t.cols; j++) row[j] = t.re[j * t.rows + i]; A.push(row); }
  return A;
}
export function fromRowsArr(A, cls = 'double') {
  const r = A.length, c = r ? A[0].length : 0;
  const t = zeros(r, c, cls);
  for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) t.re[j * r + i] = A[i][j];
  return t;
}

let warnHook = (msg) => {};
export function setWarnHook(f) { warnHook = f; }

export function solveSquare(A, B) {
  // Gaussian elimination with partial pivoting; A n×n, B n×m (arrays of rows)
  const n = A.length, m = B[0].length;
  const M = A.map((row, i) => row.concat(B[i]));
  let singular = false;
  let maxAbs = 0; for (const row of A) for (const v of row) maxAbs = Math.max(maxAbs, Math.abs(v));
  for (let k = 0; k < n; k++) {
    let p = k, best = Math.abs(M[k][k]);
    for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > best) { best = Math.abs(M[i][k]); p = i; }
    if (best <= 1e-14 * Math.max(1, maxAbs)) { singular = true; continue; }
    if (p !== k) [M[k], M[p]] = [M[p], M[k]];
    for (let i = k + 1; i < n; i++) {
      const f = M[i][k] / M[k][k]; if (f === 0) continue;
      for (let j = k; j < n + m; j++) M[i][j] -= f * M[k][j];
    }
  }
  if (singular) warnHook('Matrix is singular to working precision.');
  const X = Array.from({ length: n }, () => new Array(m).fill(0));
  for (let c = 0; c < m; c++) for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n + c];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * X[j][c];
    X[i][c] = s / M[i][i];
  }
  return X;
}
export function leastSquares(A, B) {
  // solve min ||AX - B|| via normal equations with QR (Householder)
  const m = A.length, n = A[0].length, k = B[0].length;
  const R = A.map(r => r.slice()); const Q = B.map(r => r.slice());
  for (let j = 0; j < Math.min(m - 1, n); j++) {
    let norm = 0; for (let i = j; i < m; i++) norm += R[i][j] ** 2;
    norm = Math.sqrt(norm); if (norm === 0) continue;
    const alpha = R[j][j] > 0 ? -norm : norm;
    const v = new Array(m).fill(0); v[j] = R[j][j] - alpha; for (let i = j + 1; i < m; i++) v[i] = R[i][j];
    const vv = v.reduce((s, x) => s + x * x, 0); if (vv === 0) continue;
    for (let c = 0; c < n; c++) { let s = 0; for (let i = j; i < m; i++) s += v[i] * R[i][c]; s = 2 * s / vv; for (let i = j; i < m; i++) R[i][c] -= s * v[i]; }
    for (let c = 0; c < k; c++) { let s = 0; for (let i = j; i < m; i++) s += v[i] * Q[i][c]; s = 2 * s / vv; for (let i = j; i < m; i++) Q[i][c] -= s * v[i]; }
  }
  const X = Array.from({ length: n }, () => new Array(k).fill(0));
  for (let c = 0; c < k; c++) for (let i = Math.min(n, m) - 1; i >= 0; i--) {
    let s = Q[i][c]; for (let j = i + 1; j < n; j++) s -= R[i][j] * X[j][c];
    X[i][c] = Math.abs(R[i][i]) < 1e-14 ? 0 : s / R[i][i];
  }
  return X;
}

export function mldivide(a, b) {
  if (a.numel === 1) return arith('.\\', a, b);
  if (a.rows !== b.rows) throw new MError('Matrix dimensions must agree.', '', '\\');
  if (a.im || b.im) throw new MError('Complex matrix division is not supported in this environment.');
  const A = toRows(a), B = toRows(b);
  const X = a.rows === a.cols ? solveSquare(A, B) : leastSquares(A, B);
  return fromRowsArr(X);
}
export function mrdivide(a, b) {
  if (b.numel === 1) return arith('./', a, b);
  if (a.cols !== b.cols) throw new MError('Matrix dimensions must agree.', '', '/');
  return transpose(mldivide(transpose(b), transpose(a)));
}
export function eye(n) { const t = zeros(n, n); for (let i = 0; i < n; i++) t.re[i * n + i] = 1; return t; }
export function inv(a) {
  if (a.rows !== a.cols) throw new MError('Matrix must be square.', '', 'inv');
  return mldivide(a, eye(a.rows));
}
export function mpower(a, b) {
  if (a.numel === 1 && b.numel === 1) return arith('.^', a, b);
  if (b.numel === 1 && a.rows === a.cols) {
    const p = b.re[0];
    if (Number.isInteger(p)) {
      let base = p < 0 ? inv(a) : a; let n = Math.abs(p);
      let res = eye(a.rows);
      while (n) { if (n & 1) res = mtimes(res, base); base = mtimes(base, base); n >>= 1; }
      return res;
    }
  }
  throw new MError('Incorrect dimensions for raising a matrix to a power. Check that the matrix is square and the power is a scalar. To operate on each element of the matrix individually, use POWER (.^) for elementwise power.', 'MATLAB:mpower', ' ^ ');
}

function stringOp(op, a, b) {
  // string arrays: + concatenates, == compares
  const toS = (v) => {
    if (v.type === 'string') return v;
    if (v.type === 'num' && v.cls === 'char') return { rows: 1, cols: 1, data: [String.fromCharCode(...v.re)] };
    if (v.type === 'num') return { rows: v.rows, cols: v.cols, data: Array.from(v.re, x => String(x)) };
    throw new MError(`Operator '${op}' is not supported for operands of type '${className(v)}'.`);
  };
  const A = toS(a), B = toS(b);
  const n = Math.max(A.data.length, B.data.length);
  const pick = (S, i) => S.data.length === 1 ? S.data[0] : S.data[i];
  if (op === '+') {
    const data = []; for (let i = 0; i < n; i++) data.push(pick(A, i) + pick(B, i));
    const shape = A.data.length >= B.data.length ? A : B;
    return new StrArr(shape.rows, shape.cols, data);
  }
  if (op === '==' || op === '~=') {
    const out = []; for (let i = 0; i < n; i++) out.push((pick(A, i) === pick(B, i)) === (op === '==') ? 1 : 0);
    const shape = A.data.length >= B.data.length ? A : B;
    return new Tensor(shape.rows, shape.cols, Float64Array.from(out), null, 'logical');
  }
  throw new MError(`Operator '${op}' is not supported for operands of type 'string'.`);
}
