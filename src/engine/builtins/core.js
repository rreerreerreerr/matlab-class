// Core numeric builtins: constants, construction, elementwise math, reductions, linear algebra.
import {
  Tensor, Cell, Struct, StrArr, MError, num, bool, str, empty, zeros, rowVec, colVec, className, toStr, isChar,
  castTensor, isIntCls, INT_RANGES, saturate, toNumber, dropImagIfZero, cplx,
} from '../value.js';
import { binaryOp, arith, transpose, mtimes, mldivide, inv as minv, eye as meye, toRows, fromRowsArr, cabs, csqrt, cexp, clog, cmul, cdiv, cpow, unaryOp, compare, logicalOp } from '../ops.js';
import { subsref, COLON } from '../indexing.js';
import { catValues } from '../interp.js';
import { mapReal, mapComplex, getDim, reduce, cumulate, sizeArgs, isStr, rand01, randn01, setSeed, defaultDim, needNum } from './util.js';

export function installCore(I) {
  const R = (name, fn, opts) => I.register(name, fn, opts);

  // ---------- constants ----------
  const constant = (name, val) => R(name, (a) => {
    if (a.length) {
      const [r, c, cls] = sizeArgs(a, name);
      const t = zeros(r, c, cls === 'double' ? 'double' : cls); t.re.fill(val); return t;
    }
    return num(val);
  });
  constant('pi', Math.PI); constant('Inf', Infinity); constant('inf', Infinity); constant('NaN', NaN); constant('nan', NaN);
  R('eps', (a) => {
    if (a.length && a[0].type === 'num' && !isChar(a[0])) {
      const x = Math.abs(a[0].re[0]);
      if (!Number.isFinite(x)) return num(NaN);
      if (x === 0) return num(Math.pow(2, -1074));
      const e = Math.floor(Math.log2(x)); return num(Math.pow(2, e - 52));
    }
    if (a.length && isStr(a[0]) && toStr(a[0]) === 'single') return new Tensor(1, 1, Float64Array.of(Math.pow(2, -23)), null, 'single');
    return num(2.220446049250313e-16);
  });
  R('realmax', () => num(1.7976931348623157e308));
  R('realmin', () => num(2.2250738585072014e-308));
  R('intmax', (a) => { const c = a.length ? toStr(a[0]) : 'int32'; return new Tensor(1, 1, Float64Array.of(INT_RANGES[c][1]), null, c); });
  R('intmin', (a) => { const c = a.length ? toStr(a[0]) : 'int32'; return new Tensor(1, 1, Float64Array.of(INT_RANGES[c][0]), null, c); });
  R('flintmax', () => num(9007199254740992));
  R('i', () => cplx(0, 1)); R('j', () => cplx(0, 1)); R('1i', () => cplx(0, 1));
  R('true', (a) => { if (a.length) { const [r, c] = sizeArgs(a, 'true'); const t = zeros(r, c, 'logical'); t.re.fill(1); return t; } return bool(true); });
  R('false', (a) => { if (a.length) { const [r, c] = sizeArgs(a, 'false'); return zeros(r, c, 'logical'); } return bool(false); });

  // ---------- construction ----------
  R('zeros', (a) => { const [r, c, cls] = sizeArgs(a, 'zeros'); return zeros(r, c, cls); });
  R('ones', (a) => { const [r, c, cls] = sizeArgs(a, 'ones'); const t = zeros(r, c, cls); t.re.fill(1); return t; });
  R('eye', (a) => { const [r, c, cls] = sizeArgs(a, 'eye'); const t = zeros(r, c, cls); for (let k = 0; k < Math.min(r, c); k++) t.re[k * r + k] = 1; return t; });
  R('cell', (a) => { const [r, c] = sizeArgs(a, 'cell'); return new Cell(r, c); });
  R('rand', (a) => {
    if (a.length && isStr(a[0]) && ['seed', 'state', 'twister'].includes(toStr(a[0]))) { setSeed(a[1] ? toNumber(a[1]) : 0); return; }
    const [r, c] = sizeArgs(a, 'rand'); const t = zeros(r, c); for (let k = 0; k < t.numel; k++) t.re[k] = rand01(); return t;
  });
  R('randn', (a) => { const [r, c] = sizeArgs(a, 'randn'); const t = zeros(r, c); for (let k = 0; k < t.numel; k++) t.re[k] = randn01(); return t; });
  R('randi', (a) => {
    if (!a.length) throw new MError('Not enough input arguments.', '', 'randi');
    let lo = 1, hi;
    if (a[0].numel === 2) { lo = a[0].re[0]; hi = a[0].re[1]; } else hi = a[0].re[0];
    if (hi < lo) throw new MError('First input must be a positive scalar integer value IMAX, or two integer values [IMIN IMAX] with IMIN less than or equal to IMAX.', '', 'randi');
    const [r, c] = a.length > 1 ? sizeArgs(a.slice(1), 'randi') : [1, 1];
    const t = zeros(r, c); for (let k = 0; k < t.numel; k++) t.re[k] = lo + Math.floor(rand01() * (hi - lo + 1)); return t;
  });
  R('rng', (a) => { if (a.length && a[0].type === 'num') setSeed(a[0].re[0]); else if (a.length && isStr(a[0]) && toStr(a[0]) === 'shuffle') setSeed(Date.now()); else setSeed(0); });
  R('randperm', (a) => {
    const n = toNumber(a[0]); const k = a.length > 1 ? toNumber(a[1]) : n;
    const p = Array.from({ length: n }, (_, i) => i + 1);
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand01() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
    return rowVec(p.slice(0, k));
  });
  R('magic', (a) => {
    const n = toNumber(a[0]);
    const M = magic(n);
    return fromRowsArr(M);
  });
  R('linspace', (a) => {
    const lo = toNumber(a[0]), hi = toNumber(a[1]); const n = a.length > 2 ? Math.floor(toNumber(a[2])) : 100;
    if (n < 1) return zeros(1, 0);
    const t = zeros(1, n);
    for (let k = 0; k < n; k++) t.re[k] = n === 1 ? hi : lo + (hi - lo) * k / (n - 1);
    if (n > 1) { t.re[0] = lo; t.re[n - 1] = hi; }
    return t;
  });
  R('logspace', (a) => {
    const lo = toNumber(a[0]), hi = toNumber(a[1]); const n = a.length > 2 ? toNumber(a[2]) : 50;
    const t = zeros(1, n); for (let k = 0; k < n; k++) t.re[k] = Math.pow(10, n === 1 ? hi : lo + (hi - lo) * k / (n - 1)); return t;
  });
  R('colon', (a) => {
    const s = toNumber(a[0]); const st = a.length > 2 ? toNumber(a[1]) : 1; const e = toNumber(a[a.length - 1]);
    const n = Math.max(0, Math.floor((e - s) / st + 1e-10) + 1); const t = zeros(1, n); for (let k = 0; k < n; k++) t.re[k] = s + k * st; return t;
  });
  R('repmat', (a) => {
    const v = a[0];
    let m, n;
    if (a.length === 2) { if (a[1].numel >= 2) { m = a[1].re[0]; n = a[1].re[1]; } else { m = n = toNumber(a[1]); } }
    else { m = toNumber(a[1]); n = toNumber(a[2]); }
    const rows = []; const row = new Array(n).fill(v);
    const r = n ? catValues(row, 2, I) : subsref(v, [COLON, zeros(1, 0)]);
    for (let k = 0; k < m; k++) rows.push(r);
    return m ? catValues(rows, 1, I) : subsref(r, [zeros(1, 0), COLON]);
  });
  R('cat', (a) => { const d = toNumber(a[0]); if (d > 2) throw new MError('N-D arrays are not supported in this environment.', '', 'cat'); return catValues(a.slice(1), d, I); });
  R('horzcat', (a) => catValues(a, 2, I));
  R('vertcat', (a) => catValues(a, 1, I));
  R('reshape', (a) => {
    const v = a[0]; let r, c;
    if (a.length === 2) { r = a[1].re[0]; c = a[1].re[1]; if (a[1].numel > 2 && a[1].re.slice(2).some(x => x !== 1)) throw new MError('N-D arrays are not supported in this environment.', '', 'reshape'); }
    else {
      const d1 = a[1].numel ? a[1].re[0] : null, d2 = a[2].numel ? a[2].re[0] : null;
      if (d1 === null) { c = d2; r = v.numel / c; } else if (d2 === null) { r = d1; c = v.numel / r; } else { r = d1; c = d2; }
      if (!Number.isInteger(r) || !Number.isInteger(c)) throw new MError(`Product of known dimensions, ${d1 ?? d2}, not divisible into total number of elements, ${v.numel}.`, '', 'reshape');
    }
    if (r * c !== v.numel) throw new MError('Number of elements must not change. Use [] as one of the size inputs to automatically calculate the appropriate size for that dimension.', '', 'reshape');
    if (v.type === 'num') return new Tensor(r, c, v.re, v.im, v.cls);
    if (v.type === 'cell') return new Cell(r, c, v.data.slice());
    if (v.type === 'sym') return new v.constructor(v.exprs.slice(), r, c);
    if (v.type === 'string') return new StrArr(r, c, v.data.slice());
    return v;
  });
  R('diag', (a) => {
    const v = a[0]; const k = a.length > 1 ? toNumber(a[1]) : 0;
    if (v.rows === 1 || v.cols === 1) {
      const n = v.numel + Math.abs(k); const t = zeros(n, n, v.cls === 'logical' ? 'double' : v.cls);
      for (let q = 0; q < v.numel; q++) { const i = k >= 0 ? q : q - k, j = k >= 0 ? q + k : q; t.re[j * n + i] = v.re[q]; }
      return t;
    }
    const out = [];
    for (let i = 0; i < v.rows; i++) { const j = i + k; if (j >= 0 && j < v.cols) out.push(v.re[j * v.rows + i]); }
    return colVec(out);
  });
  const triFn = (lower) => (a) => {
    const v = a[0]; const k = a.length > 1 ? toNumber(a[1]) : 0; const t = new Tensor(v.rows, v.cols, Float64Array.from(v.re), v.im ? Float64Array.from(v.im) : null, v.cls);
    for (let i = 0; i < v.rows; i++) for (let j = 0; j < v.cols; j++) { const keep = lower ? j - i <= k : j - i >= k; if (!keep) { t.re[j * v.rows + i] = 0; if (t.im) t.im[j * v.rows + i] = 0; } }
    return t;
  };
  R('tril', triFn(true)); R('triu', triFn(false));
  R('rot90', (a) => {
    let v = a[0]; let k = a.length > 1 ? toNumber(a[1]) : 1; k = ((k % 4) + 4) % 4;
    for (let q = 0; q < k; q++) v = flipud(transpose(v, false));
    return v;
  });
  const fliplr = (v) => subsref(v, [COLON, rowVec(Array.from({ length: v.cols }, (_, j) => v.cols - j))]);
  const flipud = (v) => subsref(v, [colVec(Array.from({ length: v.rows }, (_, i) => v.rows - i)), COLON]);
  R('fliplr', (a) => fliplr(a[0])); R('flipud', (a) => flipud(a[0]));
  R('flip', (a) => { const v = a[0]; const d = a.length > 1 ? toNumber(a[1]) : defaultDim(v); return d === 1 ? flipud(v) : fliplr(v); });
  R('circshift', (a) => {
    const v = a[0]; let k = toNumber(a[1]); const d = a.length > 2 ? toNumber(a[2]) : (a[1].numel > 1 ? 1 : defaultDim(v));
    const n = d === 1 ? v.rows : v.cols; k = ((k % n) + n) % n;
    const idx = Array.from({ length: n }, (_, i) => ((i - k + n) % n) + 1);
    return d === 1 ? subsref(v, [colVec(idx), COLON]) : subsref(v, [COLON, rowVec(idx)]);
  });
  R('kron', (a) => {
    const A = a[0], B = a[1]; const r = A.rows * B.rows, c = A.cols * B.cols; const t = zeros(r, c);
    for (let i = 0; i < A.rows; i++) for (let j = 0; j < A.cols; j++) for (let k = 0; k < B.rows; k++) for (let l = 0; l < B.cols; l++)
      t.re[(j * B.cols + l) * r + i * B.rows + k] = A.re[j * A.rows + i] * B.re[l * B.rows + k];
    return t;
  });
  R('meshgrid', (a, nout) => {
    const x = a[0], y = a.length > 1 ? a[1] : a[0];
    const nx = x.numel, ny = y.numel;
    const X = zeros(ny, nx), Y = zeros(ny, nx);
    for (let i = 0; i < ny; i++) for (let j = 0; j < nx; j++) { X.re[j * ny + i] = x.re[j]; Y.re[j * ny + i] = y.re[i]; }
    return [X, Y];
  });
  R('ndgrid', (a) => {
    const x = a[0], y = a.length > 1 ? a[1] : a[0];
    const nx = x.numel, ny = y.numel; const X = zeros(nx, ny), Y = zeros(nx, ny);
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) { X.re[j * nx + i] = x.re[i]; Y.re[j * nx + i] = y.re[j]; }
    return [X, Y];
  });

  // ---------- size & type queries ----------
  R('size', (a, nout) => {
    const v = a[0];
    const dims = [v.rows, v.cols];
    if (a.length > 1) {
      const d = toNumber(a[1]); return num(d <= 2 ? dims[d - 1] : 1);
    }
    if (nout <= 1) return rowVec(dims);
    const out = [num(v.rows)];
    if (nout === 2) out.push(num(v.cols)); else { out.push(num(v.cols)); for (let k = 2; k < nout; k++) out.push(num(1)); }
    return out;
  }, { minArgs: 1 });
  R('length', (a) => { const v = a[0]; return num(v.numel === 0 ? 0 : Math.max(v.rows, v.cols)); }, { minArgs: 1, maxArgs: 1 });
  R('numel', (a) => num(a[0].numel), { minArgs: 1 });
  R('ndims', () => num(2));
  R('isempty', (a) => bool(a[0].numel === 0), { minArgs: 1, maxArgs: 1 });
  R('isscalar', (a) => bool(a[0].numel === 1));
  R('isvector', (a) => bool((a[0].rows === 1 || a[0].cols === 1) && a[0].numel >= 1));
  R('isrow', (a) => bool(a[0].rows === 1)); R('iscolumn', (a) => bool(a[0].cols === 1));
  R('ismatrix', () => bool(true)); R('issquare', (a) => bool(a[0].rows === a[0].cols));
  R('isnumeric', (a) => bool(a[0].type === 'num' && !['char', 'logical'].includes(a[0].cls)));
  R('isfloat', (a) => bool(a[0].type === 'num' && ['double', 'single'].includes(a[0].cls)));
  R('isinteger', (a) => bool(a[0].type === 'num' && isIntCls(a[0].cls)));
  R('ischar', (a) => bool(isChar(a[0])));
  R('iscell', (a) => bool(a[0].type === 'cell'));
  R('isstruct', (a) => bool(a[0].type === 'struct'));
  R('islogical', (a) => bool(a[0].type === 'num' && a[0].cls === 'logical'));
  R('isstring', (a) => bool(a[0].type === 'string'));
  R('istable', (a) => bool(a[0].type === 'table'));
  R('isreal', (a) => bool(a[0].type === 'num' && !a[0].im));
  R('is_function_handle', (a) => bool(a[0].type === 'fh'));
  R('isa', (a) => {
    const c = toStr(a[1]); const k = className(a[0]);
    if (c === 'numeric') return bool(a[0].type === 'num' && !['char', 'logical'].includes(k));
    if (c === 'float') return bool(['double', 'single'].includes(k));
    if (c === 'integer') return bool(isIntCls(k));
    return bool(c === k);
  });
  R('class', (a) => str(className(a[0])), { minArgs: 1 });
  R('isequal', (a) => { for (let k = 1; k < a.length; k++) if (!isEqual(a[0], a[k])) return bool(false); return bool(true); });
  R('isequaln', (a) => { for (let k = 1; k < a.length; k++) if (!isEqual(a[0], a[k], true)) return bool(false); return bool(true); });
  const pred = (name, f) => R(name, (a) => { const v = needNum(a[0], name); const t = zeros(v.rows, v.cols, 'logical'); for (let k = 0; k < v.numel; k++) t.re[k] = f(v.re[k], v.im ? v.im[k] : 0) ? 1 : 0; return t; }, { minArgs: 1, maxArgs: 1 });
  pred('isnan', (x, y) => Number.isNaN(x) || Number.isNaN(y));
  pred('isinf', (x, y) => (x === Infinity || x === -Infinity || y === Infinity || y === -Infinity));
  pred('isfinite', (x, y) => Number.isFinite(x) && Number.isFinite(y));
  R('isprime', (a) => { const v = a[0]; const t = zeros(v.rows, v.cols, 'logical'); for (let k = 0; k < v.numel; k++) t.re[k] = isPrime(v.re[k]) ? 1 : 0; return t; });

  // ---------- type conversion ----------
  for (const c of ['double', 'single', 'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64']) {
    R(c, (a) => {
      const v = a[0];
      if (v.type === 'sym') return I.symToDouble(v, c);
      if (v.type === 'string') { const t = zeros(v.rows, v.cols); v.data.forEach((s, k) => { const x = parseFloat(s); t.re[k] = Number.isNaN(x) ? NaN : x; }); return c === 'double' ? t : castTensor(t, c); }
      if (v.type !== 'num') throw new MError(`Conversion to ${c} from ${className(v)} is not possible.`, '', c);
      return castTensor(v, c);
    }, { minArgs: 1 });
  }
  R('logical', (a) => { const v = a[0]; if (v.type !== 'num') throw new MError(`Conversion to logical from ${className(v)} is not possible.`); return castTensor(v, 'logical'); });

  // ---------- elementwise math ----------
  const unary = (name, f, cf, domain) => R(name, (a) => {
    const v = a[0];
    if (!v) throw new MError('Not enough input arguments.', 'MATLAB:minrhs', name);
    if (v.type === 'sym') return I.symFunc(name, a);
    if (v.type !== 'num') throw new MError(`Undefined function '${name}' for input arguments of type '${className(v)}'.`, 'MATLAB:UndefinedFunction');
    if (isIntCls(v.cls)) { const t = mapReal(v, f); return castTensor(t, v.cls); }
    let needC = !!v.im;
    if (!needC && domain) for (let k = 0; k < v.numel; k++) if (!domain(v.re[k])) { needC = true; break; }
    if (needC && cf) return mapComplex(v, cf);
    return mapReal(v, f);
  }, { minArgs: 1, maxArgs: 1 });
  unary('sqrt', Math.sqrt, csqrt, (x) => x >= 0 || Number.isNaN(x));
  unary('exp', Math.exp, cexp);
  unary('log', Math.log, clog, (x) => x >= 0 || Number.isNaN(x));
  unary('log10', Math.log10, (a, b) => { const [r, i] = clog(a, b); return [r / Math.LN10, i / Math.LN10]; }, (x) => x >= 0 || Number.isNaN(x));
  unary('log2', Math.log2, (a, b) => { const [r, i] = clog(a, b); return [r / Math.LN2, i / Math.LN2]; }, (x) => x >= 0 || Number.isNaN(x));
  unary('log1p', Math.log1p); unary('expm1', Math.expm1);
  unary('sin', Math.sin, (a, b) => [Math.sin(a) * Math.cosh(b), Math.cos(a) * Math.sinh(b)]);
  unary('cos', Math.cos, (a, b) => [Math.cos(a) * Math.cosh(b), -Math.sin(a) * Math.sinh(b)]);
  unary('tan', Math.tan);
  unary('asin', Math.asin, (a, b) => casin(a, b), (x) => Math.abs(x) <= 1);
  unary('acos', Math.acos, (a, b) => { const [r, i] = casin(a, b); return [Math.PI / 2 - r, -i]; }, (x) => Math.abs(x) <= 1);
  unary('atan', Math.atan);
  unary('sinh', Math.sinh); unary('cosh', Math.cosh); unary('tanh', Math.tanh);
  unary('asinh', Math.asinh); unary('acosh', Math.acosh); unary('atanh', Math.atanh);
  unary('sec', (x) => 1 / Math.cos(x)); unary('csc', (x) => 1 / Math.sin(x)); unary('cot', (x) => 1 / Math.tan(x));
  unary('asec', (x) => Math.acos(1 / x)); unary('acsc', (x) => Math.asin(1 / x)); unary('acot', (x) => Math.atan(1 / x));
  unary('sech', (x) => 1 / Math.cosh(x)); unary('csch', (x) => 1 / Math.sinh(x)); unary('coth', (x) => 1 / Math.tanh(x));
  const d2r = Math.PI / 180;
  const sinD = (x) => { const r = ((x % 360) + 360) % 360; if (r === 0 || r === 180) return 0; if (r === 90) return 1; if (r === 270) return -1; return Math.sin(x * d2r); };
  const cosD = (x) => { const r = ((x % 360) + 360) % 360; if (r === 90 || r === 270) return 0; if (r === 0) return 1; if (r === 180) return -1; return Math.cos(x * d2r); };
  unary('sind', sinD); unary('cosd', cosD); unary('tand', (x) => { const c = cosD(x); return c === 0 ? (sinD(x) > 0 ? Infinity : -Infinity) : sinD(x) / c; });
  unary('asind', (x) => Math.asin(x) / d2r); unary('acosd', (x) => Math.acos(x) / d2r); unary('atand', (x) => Math.atan(x) / d2r);
  unary('secd', (x) => 1 / cosD(x)); unary('cscd', (x) => 1 / sinD(x)); unary('cotd', (x) => cosD(x) / sinD(x));
  unary('deg2rad', (x) => x * d2r); unary('rad2deg', (x) => x / d2r);
  unary('gamma', gammaFn); unary('gammaln', (x) => Math.log(gammaFn(x)));
  unary('erf', erf); unary('erfc', (x) => 1 - erf(x));
  R('abs', (a) => {
    const v = a[0];
    if (v.type === 'sym') return I.symFunc('abs', a);
    if (v.type !== 'num') throw new MError(`Undefined function 'abs' for input arguments of type '${className(v)}'.`);
    if (v.im) { const t = zeros(v.rows, v.cols); for (let k = 0; k < v.numel; k++) t.re[k] = cabs(v.re[k], v.im[k]); return t; }
    const t = mapReal(v, Math.abs, v.cls === 'char' || v.cls === 'logical' ? 'double' : v.cls);
    return t;
  }, { minArgs: 1, maxArgs: 1 });
  R('sign', (a) => { const v = a[0]; if (v.type === 'sym') return I.symFunc('sign', a); return mapReal(v, (x) => (x > 0 ? 1 : x < 0 ? -1 : x === 0 ? 0 : NaN), isIntCls(v.cls) ? v.cls : undefined); });
  const roundish = (name, f) => R(name, (a) => {
    const v = a[0];
    if (v.type === 'sym') return I.symFunc(name, a);
    if (v.type !== 'num') throw new MError(`Undefined function '${name}' for input arguments of type '${className(v)}'.`);
    if (name === 'round' && a.length > 1) {
      const n = toNumber(a[1]); const p = Math.pow(10, n);
      return mapReal(v, (x) => roundHalfAway(x * p) / p);
    }
    const t = mapReal(v, f, isIntCls(v.cls) ? v.cls : v.cls === 'single' ? 'single' : 'double');
    if (v.im) t.im = Float64Array.from(v.im, f);
    return dropImagIfZero(t);
  }, { minArgs: 1 });
  roundish('floor', Math.floor); roundish('ceil', Math.ceil); roundish('fix', Math.trunc); roundish('round', roundHalfAway);
  const binNum = (name, f) => R(name, (a) => {
    if (a.length < 2) throw new MError('Not enough input arguments.', 'MATLAB:minrhs', name);
    const x = a[0], y = a[1];
    if (x.type !== 'num' || y.type !== 'num') throw new MError(`Undefined function '${name}' for input arguments of type '${className(x.type !== 'num' ? x : y)}'.`);
    return arithElem(x, y, f);
  }, { minArgs: 2, maxArgs: 2 });
  const arithElem = (x, y, f) => {
    // reuse broadcasting from ops via a dummy op
    const res = binaryOp('+', x, zerosLike(y));
    const shape = binaryOp('+', zerosLike(x), zerosLike(y));
    const out = zeros(shape.rows, shape.cols, isIntCls(x.cls) ? x.cls : isIntCls(y.cls) ? y.cls : 'double');
    const xr = x.rows, yr = y.rows;
    for (let j = 0; j < out.cols; j++) for (let i = 0; i < out.rows; i++) {
      const xi = (x.cols === 1 ? 0 : j) * xr + (x.rows === 1 ? 0 : i);
      const yi = (y.cols === 1 ? 0 : j) * yr + (y.rows === 1 ? 0 : i);
      out.re[j * out.rows + i] = f(x.re[xi], y.re[yi]);
    }
    void res;
    return out;
  };
  binNum('rem', (x, y) => (y === 0 ? NaN : x - Math.trunc(x / y) * y));
  binNum('mod', (x, y) => { if (y === 0) return x; const r = x - Math.floor(x / y) * y; return Math.abs(r - y) < 1e-14 * Math.abs(y) ? 0 : r; });
  binNum('atan2', Math.atan2); binNum('atan2d', (y, x) => Math.atan2(y, x) / d2r);
  binNum('hypot', Math.hypot);
  binNum('nthroot', (x, n) => { if (x < 0 && n % 2 === 1) return -Math.pow(-x, 1 / n); if (x < 0) throw new MError('If X is negative, N must be an odd integer.', '', 'nthroot'); return Math.pow(x, 1 / n); });
  binNum('gcd', (x, y) => { x = Math.abs(x); y = Math.abs(y); while (y) [x, y] = [y, x % y]; return x; });
  binNum('lcm', (x, y) => { let p = Math.abs(x), q = Math.abs(y); let g = p, h = q; while (h) [g, h] = [h, g % h]; return g ? p * q / g : 0; });
  binNum('bitand', (x, y) => Number(BigInt(x) & BigInt(y)));
  binNum('bitor', (x, y) => Number(BigInt(x) | BigInt(y)));
  binNum('bitxor', (x, y) => Number(BigInt(x) ^ BigInt(y)));
  binNum('idivide', (x, y) => Math.trunc(x / y));
  R('power', (a) => binaryOp('.^', a[0], a[1])); R('mpower', (a) => binaryOp('^', a[0], a[1]));
  R('plus', (a) => binaryOp('+', a[0], a[1])); R('minus', (a) => binaryOp('-', a[0], a[1]));
  R('times', (a) => binaryOp('.*', a[0], a[1])); R('mtimes', (a) => binaryOp('*', a[0], a[1]));
  R('rdivide', (a) => binaryOp('./', a[0], a[1])); R('ldivide', (a) => binaryOp('.\\', a[0], a[1]));
  R('mrdivide', (a) => binaryOp('/', a[0], a[1])); R('mldivide', (a) => binaryOp('\\', a[0], a[1]));
  R('uminus', (a) => unaryOp('-', a[0])); R('uplus', (a) => a[0]);
  R('eq', (a) => compare('==', a[0], a[1])); R('ne', (a) => compare('~=', a[0], a[1]));
  R('lt', (a) => compare('<', a[0], a[1])); R('le', (a) => compare('<=', a[0], a[1]));
  R('gt', (a) => compare('>', a[0], a[1])); R('ge', (a) => compare('>=', a[0], a[1]));
  R('and', (a) => logicalOp('&', a[0], a[1])); R('or', (a) => logicalOp('|', a[0], a[1]));
  R('not', (a) => unaryOp('~', a[0]));
  R('xor', (a) => { const x = castTensor(a[0], 'logical'), y = castTensor(a[1], 'logical'); return compare('~=', x, y); });
  R('transpose', (a) => transpose(a[0], false)); R('ctranspose', (a) => transpose(a[0], true));
  R('pow2', (a) => { if (a.length === 2) return arith('.*', a[0], mapReal(a[1], (x) => Math.pow(2, x))); return mapReal(a[0], (x) => Math.pow(2, x)); });
  R('real', (a) => { const v = a[0]; if (v.type === 'sym') return I.symFunc('real', a); return new Tensor(v.rows, v.cols, Float64Array.from(v.re), null, v.cls === 'char' || v.cls === 'logical' ? 'double' : v.cls); });
  R('imag', (a) => { const v = a[0]; if (v.type === 'sym') return I.symFunc('imag', a); return new Tensor(v.rows, v.cols, v.im ? Float64Array.from(v.im) : new Float64Array(v.numel), null, 'double'); });
  R('conj', (a) => { const v = a[0]; if (v.type === 'sym') return I.symFunc('conj', a); return new Tensor(v.rows, v.cols, Float64Array.from(v.re), v.im ? v.im.map(x => -x) : null, v.cls); });
  R('angle', (a) => { const v = a[0]; const t = zeros(v.rows, v.cols); for (let k = 0; k < v.numel; k++) t.re[k] = Math.atan2(v.im ? v.im[k] : 0, v.re[k]); return t; });
  R('complex', (a) => { const re = a[0], im = a.length > 1 ? a[1] : zeros(re.rows, re.cols); const s = binaryOp('+', re, zerosLike(im)); const t = new Tensor(s.rows, s.cols, Float64Array.from(s.re), Float64Array.from(binaryOp('+', im, zerosLike(re)).re)); return t; });
  R('isreal', (a) => bool(a[0].type === 'num' && !a[0].im));
  R('factorial', (a) => { const v = a[0]; if (v.type === 'sym') return I.symFunc('factorial', a); return mapReal(v, (n) => { if (n < 0 || !Number.isInteger(n)) throw new MError('N must be an array of real non-negative integers.', '', 'factorial'); let r = 1; for (let k = 2; k <= n; k++) r *= k; return r; }); });
  R('nchoosek', (a) => {
    const v = a[0], k = toNumber(a[1]);
    if (v.numel === 1) { const n = v.re[0]; let r = 1; for (let q = 1; q <= k; q++) r = r * (n - k + q) / q; return num(Math.round(r)); }
    const items = Array.from(v.re); const combs = [];
    const rec = (start, cur) => { if (cur.length === k) { combs.push(cur.slice()); return; } for (let q = start; q < items.length; q++) { cur.push(items[q]); rec(q + 1, cur); cur.pop(); } };
    rec(0, []);
    return fromRowsArr(combs.length ? combs : [[]]);
  });
  R('primes', (a) => { const n = toNumber(a[0]); const out = []; for (let k = 2; k <= n; k++) if (isPrime(k)) out.push(k); return rowVec(out); });
  R('factor', (a) => {
    if (a[0].type === 'sym') return I.symFunc('factor', a);
    let n = toNumber(a[0]); const out = [];
    if (n < 4) return rowVec([n]);
    for (let p = 2; p * p <= n; p++) while (n % p === 0) { out.push(p); n /= p; }
    if (n > 1) out.push(n);
    return rowVec(out);
  });

  // ---------- reductions ----------
  R('sum', (a) => {
    const v = a[0];
    if (v.type === 'sym') return I.symFunc('sum', a);
    if (v.type !== 'num') throw new MError(`Invalid data type. First argument must be numeric or logical.`, '', 'sum');
    if (v.numel === 0 && a.length < 2) return num(0);
    const dim = getDim(a, 1, v, 'sum');
    if (v.im) {
      const re = reduce(new Tensor(v.rows, v.cols, v.re), dim, (x) => x.reduce((s, y) => s + y, 0));
      const im = reduce(new Tensor(v.rows, v.cols, v.im), dim, (x) => x.reduce((s, y) => s + y, 0));
      return dropImagIfZero(new Tensor(re.rows, re.cols, re.re, im.re));
    }
    const isI = isIntCls(v.cls);
    const r = reduce(v, dim, (x) => { let s = 0; for (const y of x) s += y; return s; }, isI ? v.cls : v.cls === 'single' ? 'single' : 'double');
    if (isI) for (let k = 0; k < r.numel; k++) r.re[k] = saturate(r.re[k], v.cls);
    return r;
  }, { minArgs: 1 });
  R('prod', (a) => { const v = a[0]; if (v.numel === 0) return num(1); return reduce(v, getDim(a, 1, v, 'prod'), (x) => x.reduce((s, y) => s * y, 1)); }, { minArgs: 1 });
  R('cumsum', (a) => { const v = a[0]; return cumulate(v, getDim(a, 1, v, 'cumsum'), (p, q) => p + q); });
  R('cumprod', (a) => { const v = a[0]; return cumulate(v, getDim(a, 1, v, 'cumprod'), (p, q) => p * q); });
  R('cummax', (a) => { const v = a[0]; return cumulate(v, getDim(a, 1, v, 'cummax'), Math.max); });
  R('cummin', (a) => { const v = a[0]; return cumulate(v, getDim(a, 1, v, 'cummin'), Math.min); });
  R('mean', (a) => {
    const v = a[0];
    if (v.type === 'sym') return I.symFunc('mean', a);
    if (v.type !== 'num') throw new MError(`Invalid data type. First argument must be numeric or logical.`, '', 'mean');
    let args = a.slice(); let omit = false;
    while (args.length > 1 && isStr(args[args.length - 1])) { const s = toStr(args.pop()); if (s === 'omitnan') omit = true; if (s === 'all') return num(meanOf(Array.from(v.re), omit)); }
    if (v.numel === 0 && args.length < 2) return num(NaN);
    return reduce(v, getDim(args, 1, v, 'mean'), (x) => meanOf(x, omit));
  }, { minArgs: 1 });
  R('median', (a) => { const v = a[0]; if (v.numel === 0) return num(NaN); return reduce(v, getDim(a, 1, v, 'median'), medianOf); }, { minArgs: 1 });
  R('mode', (a) => { const v = a[0]; return reduce(v, getDim(a, 1, v, 'mode'), modeOf); }, { minArgs: 1 });
  R('var', (a) => {
    const v = a[0]; const w = a.length > 1 && a[1].numel ? toNumber(a[1]) : 0;
    if (v.numel === 1) return num(0);
    return reduce(v, getDim(a, 2, v, 'var'), (x) => varOf(x, w));
  }, { minArgs: 1 });
  R('std', (a) => {
    const v = a[0]; const w = a.length > 1 && a[1].numel ? toNumber(a[1]) : 0;
    if (v.numel === 1) return num(0);
    return reduce(v, getDim(a, 2, v, 'std'), (x) => Math.sqrt(varOf(x, w)));
  }, { minArgs: 1 });
  R('range', (a) => { const v = a[0]; return reduce(v, getDim(a, 1, v, 'range'), (x) => Math.max(...x) - Math.min(...x)); });
  const minmax = (name, better) => R(name, (a, nout) => {
    const v = a[0];
    if (v.type !== 'num') throw new MError(`Invalid data type. First argument must be numeric or logical.`, '', name);
    if (a.length >= 2 && a[1].numel > 0) {
      // elementwise max(A,B)
      const B = a[1];
      const shape = binaryOp('+', zerosLike(v), zerosLike(B));
      const out = zeros(shape.rows, shape.cols, isIntCls(v.cls) ? v.cls : isIntCls(B.cls) ? B.cls : 'double');
      for (let j = 0; j < out.cols; j++) for (let i = 0; i < out.rows; i++) {
        const x = v.re[(v.cols === 1 ? 0 : j) * v.rows + (v.rows === 1 ? 0 : i)];
        const y = B.re[(B.cols === 1 ? 0 : j) * B.rows + (B.rows === 1 ? 0 : i)];
        out.re[j * out.rows + i] = Number.isNaN(x) ? y : Number.isNaN(y) ? x : (better(x, y) ? x : y);
      }
      return out;
    }
    if (v.numel === 0) return [empty(), empty()];
    let dim = a.length >= 3 ? toNumber(a[2]) : defaultDim(v);
    if (a.length >= 3 && isStr(a[2]) && toStr(a[2]) === 'all') { dim = 0; }
    const mags = v.im ? Array.from(v.re, (x, k) => cabs(x, v.im[k])) : null;
    const pick = (idxs) => {
      let best = -1;
      for (const k of idxs) {
        const x = mags ? mags[k] : v.re[k];
        if (Number.isNaN(x)) continue;
        if (best < 0 || better(x, mags ? mags[best] : v.re[best])) best = k;
      }
      return best < 0 ? idxs[0] : best;
    };
    const vals = [], inds = [];
    let rr, cc;
    if (dim === 0) { const b = pick([...Array(v.numel).keys()]); vals.push(b); inds.push(b + 1); rr = cc = 1; }
    else if (dim === 1) { for (let j = 0; j < v.cols; j++) { const idxs = []; for (let i = 0; i < v.rows; i++) idxs.push(j * v.rows + i); const b = pick(idxs); vals.push(b); inds.push(b - j * v.rows + 1); } rr = 1; cc = v.cols; }
    else { for (let i = 0; i < v.rows; i++) { const idxs = []; for (let j = 0; j < v.cols; j++) idxs.push(j * v.rows + i); const b = pick(idxs); vals.push(b); inds.push(Math.floor(b / v.rows) + 1); } rr = v.rows; cc = 1; }
    const M = new Tensor(rr, cc, Float64Array.from(vals, k => v.re[k]), v.im ? Float64Array.from(vals, k => v.im[k]) : null, v.cls === 'logical' || v.cls === 'char' ? 'double' : v.cls);
    return [dropImagIfZero(M), new Tensor(rr, cc, Float64Array.from(inds))];
  }, { minArgs: 1, maxOut: 2 });
  minmax('max', (x, y) => x > y); minmax('min', (x, y) => x < y);
  R('bounds', (a) => { const v = a[0]; return [num(Math.min(...v.re)), num(Math.max(...v.re))]; });
  R('sort', (a, nout) => {
    const v = a[0];
    if (v.type === 'cell') {
      const strs = v.data.map(x => toStr(x)); const idx = strs.map((_, k) => k).sort((p, q) => (strs[p] < strs[q] ? -1 : strs[p] > strs[q] ? 1 : p - q));
      return [new Cell(v.rows, v.cols, idx.map(k => v.data[k])), new Tensor(v.rows, v.cols, Float64Array.from(idx, k => k + 1))];
    }
    let dim = defaultDim(v), desc = false;
    for (const x of a.slice(1)) { if (isStr(x)) desc = toStr(x).toLowerCase() === 'descend'; else dim = toNumber(x); }
    const out = new Tensor(v.rows, v.cols, new Float64Array(v.numel), v.im ? new Float64Array(v.numel) : null, v.cls);
    const ind = zeros(v.rows, v.cols);
    const key = v.im ? (k) => cabs(v.re[k], v.im[k]) : (k) => v.re[k];
    const sortIdx = (idxs) => {
      const s = idxs.slice().sort((p, q) => {
        let x = key(p), y = key(q);
        if (Number.isNaN(x)) return desc ? -1 : 1; if (Number.isNaN(y)) return desc ? 1 : -1;
        if (x === y) return p - q;
        return desc ? y - x : x - y;
      });
      return s;
    };
    if (dim === 1) for (let j = 0; j < v.cols; j++) { const idxs = []; for (let i = 0; i < v.rows; i++) idxs.push(j * v.rows + i); sortIdx(idxs).forEach((k, i) => { out.re[j * v.rows + i] = v.re[k]; if (v.im) out.im[j * v.rows + i] = v.im[k]; ind.re[j * v.rows + i] = k - j * v.rows + 1; }); }
    else for (let i = 0; i < v.rows; i++) { const idxs = []; for (let j = 0; j < v.cols; j++) idxs.push(j * v.rows + i); sortIdx(idxs).forEach((k, j) => { out.re[j * v.rows + i] = v.re[k]; if (v.im) out.im[j * v.rows + i] = v.im[k]; ind.re[j * v.rows + i] = Math.floor(k / v.rows) + 1; }); }
    return [out, ind];
  });
  R('sortrows', (a, nout) => {
    const v = a[0]; let col = a.length > 1 ? Array.from(a[1].re) : [1];
    const rows = toRows(v); const idx = rows.map((_, k) => k);
    idx.sort((p, q) => { for (const c of col) { const cc = Math.abs(c) - 1; const d = rows[p][cc] - rows[q][cc]; if (d !== 0) return c < 0 ? -d : d; } return p - q; });
    return [fromRowsArr(idx.map(k => rows[k])), colVec(idx.map(k => k + 1))];
  });
  R('unique', (a, nout) => {
    const v = a[0];
    if (v.type === 'cell') {
      const strs = v.data.map(x => toStr(x)); const u = [...new Set(strs)].sort();
      return [new Cell(u.length, 1, u.map(str)), colVec(u.map(s => strs.lastIndexOf(s) + 1)), colVec(strs.map(s => u.indexOf(s) + 1))];
    }
    const vals = Array.from(v.re);
    const stable = a.slice(1).some(x => isStr(x) && toStr(x) === 'stable');
    let u = [...new Set(vals)]; if (!stable) u.sort((x, y) => x - y);
    const ia = u.map(x => (stable ? vals.indexOf(x) : vals.lastIndexOf(x)) + 1);
    const ic = vals.map(x => u.indexOf(x) + 1);
    const mk = (arr) => (v.rows === 1 ? rowVec(arr, v.cls) : colVec(arr, v.cls));
    return [mk(u), colVec(ia), colVec(ic)];
  });
  R('find', (a, nout) => {
    const v = a[0];
    if (v.type !== 'num') throw new MError(`Undefined function 'find' for input arguments of type '${className(v)}'.`);
    let k = Infinity, last = false;
    if (a.length > 1) k = toNumber(a[1]);
    if (a.length > 2) last = toStr(a[2]) === 'last';
    let idx = [];
    for (let q = 0; q < v.numel; q++) if (v.re[q] !== 0 || (v.im && v.im[q] !== 0)) idx.push(q);
    if (last) idx = idx.slice(Math.max(0, idx.length - k)); else idx = idx.slice(0, k);
    if (nout >= 2) {
      const r = idx.map(q => (q % v.rows) + 1), c = idx.map(q => Math.floor(q / v.rows) + 1);
      const mk = (arr) => (v.rows === 1 && v.cols !== 1 ? rowVec(arr) : colVec(arr));
      return [mk(r), mk(c), mk(idx.map(q => v.re[q]))];
    }
    const vals = idx.map(q => q + 1);
    if (v.rows === 1 && v.cols !== 1) return rowVec(vals);
    if (v.numel === 0 || (v.rows === 0)) return zeros(0, v.rows === 1 ? 0 : 1);
    if (!vals.length) return v.rows === 1 && v.cols === 1 ? zeros(0, 0) : zeros(0, 1);
    return colVec(vals);
  });
  const anyAll = (name, isAny) => R(name, (a) => {
    const v = a[0];
    if (v.type !== 'num') throw new MError(`Undefined function '${name}' for input arguments of type '${className(v)}'.`);
    if (v.numel === 0) return bool(!isAny);
    if (a.length > 1 && isStr(a[1]) && toStr(a[1]) === 'all') { let r = !isAny; for (const x of v.re) { if (isAny ? x !== 0 && !Number.isNaN(x) : x === 0) { r = isAny; break; } } return bool(r); }
    const dim = getDim(a, 1, v, name);
    return reduce(v, dim, (x) => { for (const y of x) { if (isAny && y !== 0 && !Number.isNaN(y)) return 1; if (!isAny && y === 0) return 0; } return isAny ? 0 : 1; }, 'logical');
  });
  anyAll('any', true); anyAll('all', false);
  R('nnz', (a) => { let c = 0; for (const x of a[0].re) if (x !== 0) c++; return num(c); });
  R('diff', (a) => {
    let v = a[0];
    if (v.type === 'sym' || a.some(x => x.type === 'sym')) return I.symFunc('diff', a);
    let n = a.length > 1 ? toNumber(a[1]) : 1;
    const dim = a.length > 2 ? toNumber(a[2]) : defaultDim(v);
    for (let q = 0; q < n; q++) {
      if (dim === 1) { const t = zeros(Math.max(0, v.rows - 1), v.cols); for (let j = 0; j < v.cols; j++) for (let i = 0; i < v.rows - 1; i++) t.re[j * t.rows + i] = v.re[j * v.rows + i + 1] - v.re[j * v.rows + i]; v = t; }
      else { const t = zeros(v.rows, Math.max(0, v.cols - 1)); for (let j = 0; j < v.cols - 1; j++) for (let i = 0; i < v.rows; i++) t.re[j * v.rows + i] = v.re[(j + 1) * v.rows + i] - v.re[j * v.rows + i]; v = t; }
    }
    return v;
  });
  R('dot', (a) => {
    const x = a[0], y = a[1];
    if (x.numel !== y.numel) throw new MError('A and B must be same size.', '', 'dot');
    if ((x.rows === 1 || x.cols === 1)) { let s = 0; for (let k = 0; k < x.numel; k++) s += x.re[k] * y.re[k]; return num(s); }
    return reduce(arith('.*', x, y), 1, (c) => c.reduce((s, z) => s + z, 0));
  });
  R('cross', (a) => {
    const x = a[0], y = a[1];
    if (x.numel !== 3 || y.numel !== 3) throw new MError('A and B must be of length 3 in the dimension in which the cross product is taken.', '', 'cross');
    const [a1, a2, a3] = x.re, [b1, b2, b3] = y.re;
    const r = [a2 * b3 - a3 * b2, a3 * b1 - a1 * b3, a1 * b2 - a2 * b1];
    return x.rows === 1 ? rowVec(r) : colVec(r);
  });
  R('norm', (a) => {
    const v = a[0]; let p = 2;
    if (a.length > 1) p = isStr(a[1]) ? (toStr(a[1]) === 'fro' ? 'fro' : toStr(a[1]) === 'inf' ? Infinity : 2) : toNumber(a[1]);
    const absv = v.im ? Array.from(v.re, (x, k) => cabs(x, v.im[k])) : Array.from(v.re, Math.abs);
    if (v.rows === 1 || v.cols === 1 || p === 'fro') {
      if (p === 'fro' || p === 2) return num(Math.sqrt(absv.reduce((s, x) => s + x * x, 0)));
      if (p === Infinity) return num(Math.max(...absv));
      if (p === -Infinity) return num(Math.min(...absv));
      if (p === 1) return num(absv.reduce((s, x) => s + x, 0));
      return num(Math.pow(absv.reduce((s, x) => s + Math.pow(x, p), 0), 1 / p));
    }
    if (p === 1) { let m = 0; for (let j = 0; j < v.cols; j++) { let s = 0; for (let i = 0; i < v.rows; i++) s += absv[j * v.rows + i]; m = Math.max(m, s); } return num(m); }
    if (p === Infinity) { let m = 0; for (let i = 0; i < v.rows; i++) { let s = 0; for (let j = 0; j < v.cols; j++) s += absv[j * v.rows + i]; m = Math.max(m, s); } return num(m); }
    // 2-norm: sqrt of largest eigenvalue of A'A
    const ata = mtimes(transpose(v), v);
    const ev = symEig(toRows(ata));
    return num(Math.sqrt(Math.max(...ev)));
  });
  R('det', (a) => {
    const v = a[0];
    if (v.type === 'sym') return I.symFunc('det', a);
    if (v.rows !== v.cols) throw new MError('Matrix must be square.', '', 'det');
    return num(det(toRows(v)));
  });
  R('inv', (a) => {
    const v = a[0];
    if (v.type === 'sym') return I.symFunc('inv', a);
    if (v.rows !== v.cols) throw new MError('Matrix must be square.', '', 'inv');
    if (det(toRows(v)) === 0) { I.warn('Matrix is singular to working precision.'); const t = zeros(v.rows, v.cols); t.re.fill(Infinity); return t; }
    return minv(v);
  });
  R('pinv', (a) => { const v = a[0]; const At = transpose(v); return mtimes(minv(mtimes(At, v)), At); });
  R('trace', (a) => { const v = a[0]; let s = 0; for (let k = 0; k < Math.min(v.rows, v.cols); k++) s += v.re[k * v.rows + k]; return num(s); });
  R('rank', (a) => num(rank(toRows(a[0]))));
  R('eig', (a, nout) => {
    const v = a[0];
    if (v.rows !== v.cols) throw new MError('Input matrix must be square.', '', 'eig');
    const A = toRows(v);
    const sym = A.every((row, i) => row.every((x, j) => Math.abs(x - A[j][i]) < 1e-12));
    if (sym) {
      const { values, vectors } = jacobiEig(A);
      const order = values.map((x, k) => k).sort((p, q) => values[p] - values[q]);
      const vals = order.map(k => values[k]);
      if (nout >= 2) {
        const V = vectors.map(row => order.map(k => row[k]));
        // normalize sign like MATLAB (not guaranteed)
        const D = vals.map((x, i) => vals.map((_, j) => (i === j ? x : 0)));
        return [fromRowsArr(V), fromRowsArr(D)];
      }
      return colVec(vals);
    }
    const ev = eigGeneral(A);
    const re = colVec(ev.map(z => z[0])); re.im = Float64Array.from(ev.map(z => z[1]));
    return dropImagIfZero(re);
  });
  R('lu', (a) => { const A = toRows(a[0]); const n = A.length; const L = A.map((_, i) => A.map((_, j) => (i === j ? 1 : 0))); const U = A.map(r => r.slice()); for (let k = 0; k < n; k++) for (let i = k + 1; i < n; i++) { const f = U[i][k] / U[k][k]; L[i][k] = f; for (let j = k; j < n; j++) U[i][j] -= f * U[k][j]; } return [fromRowsArr(L), fromRowsArr(U)]; });
  R('chol', (a) => { const A = toRows(a[0]); const n = A.length; const L = A.map(() => new Array(n).fill(0)); for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) { let s = A[i][j]; for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k]; if (i === j) { if (s <= 0) throw new MError('Matrix must be positive definite.', '', 'chol'); L[i][i] = Math.sqrt(s); } else L[i][j] = s / L[j][j]; } return transpose(fromRowsArr(L)); });
  R('null', (a) => zeros(a[0].cols, 0));
  R('expm', (a) => { let v = a[0]; let res = meye(v.rows), term = meye(v.rows); for (let k = 1; k < 30; k++) { term = arith('./', mtimes(term, v), num(k)); res = arith('+', res, term); } return res; });
  R('abs2', (a) => a[0]);
  R('numel', (a) => num(a[0].numel));
  R('accumarray', (a) => { const subs = a[0], vals = a[1]; const n = Math.max(...subs.re); const t = zeros(n, 1); for (let k = 0; k < subs.numel; k++) t.re[subs.re[k] - 1] += vals.numel === 1 ? vals.re[0] : vals.re[k]; return t; });
  R('histc', (a) => { const x = a[0], edges = a[1]; const t = zeros(edges.rows, edges.cols); for (const v of x.re) { for (let k = edges.numel - 1; k >= 0; k--) { if (k === edges.numel - 1 ? v === edges.re[k] : v >= edges.re[k] && v < edges.re[k + 1]) { t.re[k]++; break; } } } return t; });
  R('interp1', (a) => {
    const x = Array.from(a[0].re), y = Array.from(a[1].re), xi = a[2];
    const method = a.length > 3 && isStr(a[3]) ? toStr(a[3]) : 'linear';
    const out = new Tensor(xi.rows, xi.cols, new Float64Array(xi.numel));
    for (let k = 0; k < xi.numel; k++) {
      const q = xi.re[k];
      let j = -1; for (let m = 0; m < x.length - 1; m++) if (q >= x[m] && q <= x[m + 1]) { j = m; break; }
      if (j < 0) { out.re[k] = NaN; continue; }
      if (method === 'nearest') out.re[k] = q - x[j] < x[j + 1] - q ? y[j] : y[j + 1];
      else if (method === 'previous') out.re[k] = y[j];
      else if (method === 'next') out.re[k] = y[j + 1];
      else out.re[k] = y[j] + (y[j + 1] - y[j]) * (q - x[j]) / (x[j + 1] - x[j]);
    }
    return out;
  });
  R('trapz', (a) => {
    let x, y;
    if (a.length === 1) { y = a[0]; x = null; } else { x = a[0]; y = a[1]; }
    const integ = (ys, xs) => { let s = 0; for (let k = 0; k < ys.length - 1; k++) s += ((xs ? xs[k + 1] - xs[k] : 1) * (ys[k] + ys[k + 1])) / 2; return s; };
    if (y.rows === 1 || y.cols === 1) return num(integ(Array.from(y.re), x ? Array.from(x.re) : null));
    return reduce(y, 1, (c) => integ(Array.from(c), x ? Array.from(x.re) : null));
  });
  R('cumtrapz', (a) => {
    let x = a.length > 1 ? a[0] : null; const y = a.length > 1 ? a[1] : a[0];
    const out = new Tensor(y.rows, y.cols, new Float64Array(y.numel)); let s = 0;
    for (let k = 1; k < y.numel; k++) { s += ((x ? x.re[k] - x.re[k - 1] : 1) * (y.re[k] + y.re[k - 1])) / 2; out.re[k] = s; }
    return out;
  });
}

// ------------ helpers ------------
function zerosLike(v) { return zeros(v.rows, v.cols); }
export function roundHalfAway(x) { return Math.sign(x) * Math.round(Math.abs(x)); }
function isPrime(n) { if (n < 2 || !Number.isInteger(n)) return false; for (let p = 2; p * p <= n; p++) if (n % p === 0) return false; return true; }
export function meanOf(x, omit = false) { let s = 0, c = 0; for (const y of x) { if (omit && Number.isNaN(y)) continue; s += y; c++; } return c ? s / c : NaN; }
export function medianOf(x) { const s = Array.from(x).filter(v => !Number.isNaN(v)); if (s.length < x.length) return NaN; s.sort((p, q) => p - q); const n = s.length; if (!n) return NaN; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }
export function modeOf(x) { const m = new Map(); for (const y of x) m.set(y, (m.get(y) || 0) + 1); let best = NaN, bc = 0; for (const [k, c] of [...m.entries()].sort((p, q) => p[0] - q[0])) if (c > bc) { best = k; bc = c; } return best; }
export function varOf(x, w = 0) { const n = x.length; if (n === 1) return 0; const m = meanOf(x); let s = 0; for (const y of x) s += (y - m) * (y - m); return s / (w === 1 ? n : n - 1); }
function casin(a, b) {
  // asin(z) = -i*log(iz + sqrt(1-z^2))
  const [z2r, z2i] = cmul(a, b, a, b);
  const [sr, si] = csqrt(1 - z2r, -z2i);
  const [lr, li] = clog(-b + sr, a + si);
  return [li, -lr];
}
function gammaFn(x) {
  if (Number.isInteger(x) && x <= 0) return Infinity;
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gammaFn(1 - x));
  if (Number.isInteger(x) && x < 171) { let r = 1; for (let k = 2; k < x; k++) r *= k; return r; }
  x -= 1;
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  let s = c[0]; for (let k = 1; k < g + 2; k++) s += c[k] / (x + k);
  const t = x + g + 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * s;
}
export function erf(x) {
  // high precision erf via series / continued fraction
  const ax = Math.abs(x);
  if (ax < 2.5) {
    let sum = x, term = x, n = 0;
    while (Math.abs(term) > 1e-17 * Math.abs(sum)) { n++; term *= -x * x / n; sum += term / (2 * n + 1); if (n > 200) break; }
    return 2 / Math.sqrt(Math.PI) * sum;
  }
  // continued fraction for erfc
  let f = 0; for (let k = 60; k >= 1; k--) f = k / 2 / (ax + f);
  const erfc = Math.exp(-ax * ax) / Math.sqrt(Math.PI) / (ax + f);
  return x > 0 ? 1 - erfc : erfc - 1;
}
export function det(A) {
  const n = A.length; const M = A.map(r => r.slice()); let d = 1;
  for (let k = 0; k < n; k++) {
    let p = k; for (let i = k + 1; i < n; i++) if (Math.abs(M[i][k]) > Math.abs(M[p][k])) p = i;
    if (M[p][k] === 0) return 0;
    if (p !== k) { [M[p], M[k]] = [M[k], M[p]]; d = -d; }
    d *= M[k][k];
    for (let i = k + 1; i < n; i++) { const f = M[i][k] / M[k][k]; for (let j = k; j < n; j++) M[i][j] -= f * M[k][j]; }
  }
  return d;
}
function rank(A) {
  const M = A.map(r => r.slice()); const m = M.length, n = m ? M[0].length : 0; let r = 0;
  const tol = Math.max(m, n) * 2.2e-16 * Math.max(1, ...A.flat().map(Math.abs));
  for (let c = 0; c < n && r < m; c++) {
    let p = r; for (let i = r + 1; i < m; i++) if (Math.abs(M[i][c]) > Math.abs(M[p][c])) p = i;
    if (Math.abs(M[p][c]) <= tol) continue;
    [M[p], M[r]] = [M[r], M[p]];
    for (let i = r + 1; i < m; i++) { const f = M[i][c] / M[r][c]; for (let j = c; j < n; j++) M[i][j] -= f * M[r][j]; }
    r++;
  }
  return r;
}
function jacobiEig(A) {
  const n = A.length; const a = A.map(r => r.slice()); const V = A.map((_, i) => A.map((_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] ** 2;
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
      for (let k = 0; k < n; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < n; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
    }
  }
  return { values: a.map((r, i) => r[i]), vectors: V };
}
function symEig(A) { return jacobiEig(A).values; }
export function eigGeneral(A) {
  // QR algorithm on Hessenberg form (real Schur), returns complex pairs
  const n = A.length;
  let H = A.map(r => r.slice());
  const out = [];
  let m = n;
  let iter = 0;
  while (m > 0 && iter < 10000) {
    iter++;
    if (m === 1) { out.push([H[0][0], 0]); m = 0; break; }
    // check for small subdiagonal
    let l = m - 1;
    while (l > 0 && Math.abs(H[l][l - 1]) > 1e-14 * (Math.abs(H[l][l]) + Math.abs(H[l - 1][l - 1]))) l--;
    if (l === m - 1) { out.push([H[m - 1][m - 1], 0]); m--; continue; }
    if (l === m - 2) {
      const a = H[m - 2][m - 2], b = H[m - 2][m - 1], c = H[m - 1][m - 2], d = H[m - 1][m - 1];
      const tr = a + d, dt = a * d - b * c, disc = tr * tr / 4 - dt;
      if (disc >= 0) { out.push([tr / 2 + Math.sqrt(disc), 0], [tr / 2 - Math.sqrt(disc), 0]); }
      else { out.push([tr / 2, Math.sqrt(-disc)], [tr / 2, -Math.sqrt(-disc)]); }
      m -= 2; continue;
    }
    // shifted QR step on active block
    const mu = H[m - 1][m - 1] + (iter % 11 === 0 ? 1e-3 * Math.abs(H[m - 1][m - 2]) : 0);
    const k0 = l;
    const sz = m - k0;
    const B = []; for (let i = 0; i < sz; i++) { B.push(H[k0 + i].slice(k0, m)); B[i][i] -= mu; }
    const { Q, R } = qr(B);
    const RQ = matmul(R, Q);
    for (let i = 0; i < sz; i++) for (let j = 0; j < sz; j++) H[k0 + i][k0 + j] = RQ[i][j] + (i === j ? mu : 0);
  }
  return out.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
}
function qr(A) {
  const m = A.length, n = A[0].length;
  const Q = A.map((_, i) => A.map((_, j) => (i === j ? 1 : 0)));
  const R = A.map(r => r.slice());
  for (let j = 0; j < Math.min(m - 1, n); j++) {
    for (let i = j + 1; i < m; i++) {
      const a = R[j][j], b = R[i][j]; if (b === 0) continue;
      const r = Math.hypot(a, b), c = a / r, s = b / r;
      for (let k = 0; k < n; k++) { const x = R[j][k], y = R[i][k]; R[j][k] = c * x + s * y; R[i][k] = -s * x + c * y; }
      for (let k = 0; k < m; k++) { const x = Q[k][j], y = Q[k][i]; Q[k][j] = c * x + s * y; Q[k][i] = -s * x + c * y; }
    }
  }
  return { Q, R };
}
function matmul(A, B) { return A.map(r => B[0].map((_, j) => r.reduce((s, x, k) => s + x * B[k][j], 0))); }

function magic(n) {
  if (n < 1) return [[]];
  if (n === 1) return [[1]];
  if (n === 2) return [[4, 3], [1, 2]];
  const M = Array.from({ length: n }, () => new Array(n).fill(0));
  if (n % 2 === 1) {
    // MATLAB's odd algorithm
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const I = i + 1, J = j + 1;
      const A = ((I + J - (n + 3) / 2) % n + n) % n;
      const B = ((I + 2 * J - 2) % n + n) % n;
      M[i][j] = n * A + B + 1;
    }
    return M;
  }
  if (n % 4 === 0) {
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const v = i * n + j + 1;
      const keep = (Math.floor(((i + 1) % 4) / 2) === Math.floor(((j + 1) % 4) / 2));
      M[i][j] = keep ? n * n + 1 - v : v;
    }
    return M;
  }
  // singly even (LUX method as in MATLAB)
  const p = n / 2; const A = magic(p);
  for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) {
    const a = A[i][j];
    M[i][j] = a; M[i + p][j + p] = a + p * p; M[i][j + p] = a + 2 * p * p; M[i + p][j] = a + 3 * p * p;
  }
  const k = (n - 2) / 4;
  for (let i = 0; i < p; i++) {
    const cols = [];
    for (let j = 0; j < k; j++) cols.push(j);
    for (let j = n - k + 1; j < n; j++) cols.push(j);
    for (const j of cols) { const t = M[i][j]; M[i][j] = M[i + p][j]; M[i + p][j] = t; }
  }
  for (const j of [0, k]) { const i = k; const t = M[i][j]; M[i][j] = M[i + p][j]; M[i + p][j] = t; }
  return M;
}

export function isEqual(a, b, nanEq = false) {
  if (a.type !== b.type) {
    if (a.type === 'num' && b.type === 'num') {} else return false;
  }
  if (a.rows !== b.rows || a.cols !== b.cols) return false;
  switch (a.type) {
    case 'num':
      for (let k = 0; k < a.numel; k++) {
        const x = a.re[k], y = b.re[k];
        if (x !== y && !(nanEq && Number.isNaN(x) && Number.isNaN(y))) return false;
        if ((a.im ? a.im[k] : 0) !== (b.im ? b.im[k] : 0)) return false;
      }
      return true;
    case 'cell': return a.data.every((v, k) => isEqual(v, b.data[k], nanEq));
    case 'struct':
      if (a.fields.length !== b.fields.length) return false;
      return a.data.every((m, k) => a.fields.every(f => b.data[k].has(f) && isEqual(m.get(f), b.data[k].get(f), nanEq)));
    case 'string': return a.data.every((s, k) => s === b.data[k]);
    case 'sym': return a.exprs.every((e, k) => e === b.exprs[k]);
    case 'fh': return a === b;
  }
  return false;
}
