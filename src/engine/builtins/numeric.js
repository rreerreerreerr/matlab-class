// Polynomials, numerical calculus (integration, root finding, ODEs) and statistics.
import { Tensor, Cell, Struct, MError, num, bool, str, empty, zeros, rowVec, colVec, toStr, toNumber, isChar, dropImagIfZero, className } from '../value.js';
import { eigGeneral, meanOf, medianOf, varOf, erf } from './core.js';
import { isStr } from './util.js';
import { cmul, cdiv } from '../ops.js';

const vec = (v) => Array.from(v.re);
const trimLead = (p) => { let k = 0; while (k < p.length - 1 && p[k] === 0) k++; return p.slice(k); };

export function convArr(a, b) {
  const out = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
  return out;
}
export function deconvArr(b, a) {
  // b = conv(a,q) + r
  a = trimLead(a);
  if (a[0] === 0) throw new MError('First coefficient of A must be non-zero.', '', 'deconv');
  const n = b.length - a.length + 1;
  if (n < 1) return [[0], b.slice()];
  const r = b.slice(); const q = new Array(n).fill(0);
  for (let k = 0; k < n; k++) { q[k] = r[k] / a[0]; for (let j = 0; j < a.length; j++) r[k + j] -= q[k] * a[j]; }
  for (let k = 0; k < n; k++) r[k] = 0;
  return [q, r];
}
export function polyderArr(p) { const n = p.length - 1; if (n < 1) return [0]; const d = []; for (let k = 0; k < n; k++) d.push(p[k] * (n - k)); return trimLead(d); }
export function rootsArr(p) {
  // strip leading zeros and trailing zeros (zero roots)
  let k = 0; while (k < p.length && p[k] === 0) k++;
  p = p.slice(k);
  let zerosCount = 0; while (p.length > 1 && p[p.length - 1] === 0) { p = p.slice(0, -1); zerosCount++; }
  const n = p.length - 1;
  const out = [];
  if (n >= 1) {
    if (n === 1) out.push([-p[1] / p[0], 0]);
    else if (n === 2) {
      const [a, b, c] = p; const D = b * b - 4 * a * c;
      if (D >= 0) { const s = Math.sqrt(D); const q = -0.5 * (b + Math.sign(b || 1) * s); const r1 = q / a, r2 = q !== 0 ? c / q : -b / a - r1; out.push([r1, 0], [r2, 0]); }
      else { out.push([-b / (2 * a), Math.sqrt(-D) / (2 * a)], [-b / (2 * a), -Math.sqrt(-D) / (2 * a)]); }
    } else {
      const C = Array.from({ length: n }, () => new Array(n).fill(0));
      for (let j = 0; j < n; j++) C[0][j] = -p[j + 1] / p[0];
      for (let i = 1; i < n; i++) C[i][i - 1] = 1;
      const ev = eigGeneral(C);
      // polish with Newton iterations
      for (const z of ev) out.push(polish(p, z));
    }
  }
  for (let q = 0; q < zerosCount; q++) out.push([0, 0]);
  // MATLAB-like order: descending magnitude, conjugate pairs with +imag first
  out.sort((x, y) => {
    const mx = Math.hypot(x[0], x[1]), my = Math.hypot(y[0], y[1]);
    if (Math.abs(mx - my) > 1e-9 * Math.max(1, mx)) return my - mx;
    if (Math.abs(x[0] - y[0]) > 1e-9) return y[0] - x[0];
    return y[1] - x[1];
  });
  for (const z of out) { if (Math.abs(z[1]) < 1e-12 * Math.max(1, Math.abs(z[0]))) z[1] = 0; if (Math.abs(z[0]) < 1e-14) z[0] = 0; }
  return out;
}
function polish(p, z) {
  let [zr, zi] = z;
  for (let it = 0; it < 20; it++) {
    let fr = 0, fi = 0, dr = 0, di = 0;
    for (let k = 0; k < p.length; k++) {
      [dr, di] = cmul(dr, di, zr, zi); dr += fr; di += fi;
      [fr, fi] = cmul(fr, fi, zr, zi); fr += p[k];
    }
    if (dr === 0 && di === 0) break;
    const [sr, si] = cdiv(fr, fi, dr, di);
    zr -= sr; zi -= si;
    if (Math.hypot(sr, si) < 1e-15 * Math.max(1, Math.hypot(zr, zi))) break;
  }
  return [zr, zi];
}
function cplxCol(list) {
  const t = colVec(list.map(z => z[0]));
  if (list.some(z => z[1] !== 0)) t.im = Float64Array.from(list.map(z => z[1]));
  return t;
}

// adaptive Gauss-Kronrod (7-15) integration
const GK = {
  xk: [0.991455371120812639, 0.949107912342758525, 0.864864423359769073, 0.741531185599394440, 0.586087235467691130, 0.405845151377397167, 0.207784955007898468, 0],
  wk: [0.022935322010529225, 0.063092092629978553, 0.104790010322250184, 0.140653259715525919, 0.169004726639267903, 0.190350578064785410, 0.204432940075298892, 0.209482141084727828],
  wg: [0.129484966168869693, 0.279705391489276668, 0.381830050505118945, 0.417959183673469388],
};
export function integrate(f, a, b, tol = 1e-10) {
  if (a === b) return 0;
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    // map infinite interval via x = t/(1-t^2)
    const g = (t) => { const x = t / (1 - t * t); const dx = (1 + t * t) / ((1 - t * t) ** 2); return f(x) * dx; };
    const ta = a === -Infinity ? -1 : Number.isFinite(a) ? solveMap(a) : 1;
    const tb = b === Infinity ? 1 : Number.isFinite(b) ? solveMap(b) : -1;
    return integrate((t) => { const v = g(t); return Number.isFinite(v) ? v : 0; }, ta + 1e-12 * Math.sign(tb - ta), tb - 1e-12 * Math.sign(tb - ta), tol);
  }
  let total = 0, err = 0;
  const stack = [[a, b, 0]];
  let evals = 0;
  while (stack.length) {
    const [lo, hi, depth] = stack.pop();
    const c = (lo + hi) / 2, h = (hi - lo) / 2;
    let kr = 0, gs = 0;
    const fc = f(c); kr = GK.wk[7] * fc; gs = GK.wg[3] * fc;
    for (let k = 0; k < 7; k++) {
      const x = h * GK.xk[k]; const f1 = f(c - x), f2 = f(c + x);
      kr += GK.wk[k] * (f1 + f2);
      if (k % 2 === 1) gs += GK.wg[(k - 1) / 2] * (f1 + f2);
    }
    evals += 15;
    kr *= h; gs *= h;
    const e = Math.abs(kr - gs);
    if (e <= Math.max(tol * Math.abs(kr), 1e-14 * Math.abs(h)) || depth > 40 || evals > 2e6) { total += kr; err += e; }
    else { stack.push([lo, c, depth + 1], [c, hi, depth + 1]); }
  }
  return total;
}
function solveMap(x) { if (x === 0) return 0; return (-1 + Math.sqrt(1 + 4 * x * x)) / (2 * x); }

function studentTcdf(t, v) { const x = v / (v + t * t); const p = 0.5 * betainc(x, v / 2, 0.5); return t > 0 ? 1 - p : p; }
export function betainc(x, a, b) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const lbeta = lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  if (x < (a + 1) / (a + b + 2)) return Math.exp(lbeta) * betacf(x, a, b) / a;
  return 1 - Math.exp(lbeta) * betacf(1 - x, b, a) / b;
}
function betacf(x, a, b) {
  let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < 1e-300) d = 1e-300; d = 1 / d; let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m; let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300; c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300; c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d;
    const del = d * c; h *= del; if (Math.abs(del - 1) < 3e-16) break;
  }
  return h;
}
export function lgamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5; tmp -= (x + 0.5) * Math.log(tmp); let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}
function gammainc(x, a) {
  if (x <= 0) return 0;
  if (x < a + 1) { let sum = 1 / a, del = sum, ap = a; for (let n = 0; n < 500; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-15) break; } return sum * Math.exp(-x + a * Math.log(x) - lgamma(a)); }
  let b = x + 1 - a, c = 1e300, d = 1 / b, h = d;
  for (let i = 1; i < 500; i++) { const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300; c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-15) break; }
  return 1 - Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
}
const normcdf = (x, m = 0, s = 1) => 0.5 * (1 + erf((x - m) / (s * Math.SQRT2)));
function norminv(p) {
  // Acklam's algorithm + Newton refinement
  if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  let q, r, x;
  if (p < 0.02425) { q = Math.sqrt(-2 * Math.log(p)); x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  else if (p <= 1 - 0.02425) { q = p - 0.5; r = q * q; x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
  else { q = Math.sqrt(-2 * Math.log(1 - p)); x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  for (let k = 0; k < 2; k++) { const e = normcdf(x) - p; x -= e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2); }
  return x;
}
function kolmogorovQ(lambda) {
  if (lambda < 1e-8) return 1;
  let s = 0; for (let k = 1; k < 200; k++) { const t = 2 * Math.pow(-1, k - 1) * Math.exp(-2 * k * k * lambda * lambda); s += t; if (Math.abs(t) < 1e-12) break; }
  return Math.max(0, Math.min(1, s));
}

export function installNumeric(I) {
  const R = (name, fn, opts) => I.register(name, fn, opts);
  const asFunc = (f, nargs = 1, varNames = ['x', 'y', 'z']) => {
    // returns JS function taking numbers/tensors -> tensor
    if (f.type === 'fh') return (...xs) => { const r = I.callHandle(f, xs, 1); if (!r.length) throw new MError('Function returned no value.'); return r[0]; };
    if (isStr(f)) {
      const s = toStr(f);
      const fh = I.evalString(`@(${varNames.slice(0, nargs).join(',')}) ${s}`);
      return (...xs) => I.callHandle(fh, xs, 1)[0];
    }
    if (f.type === 'sym') return I.symToFunc(f, nargs);
    throw new MError('First input argument must be a function handle.');
  };
  const scalarFn = (f, n = 1) => { const g = asFunc(f, n); return (...xs) => { const r = g(...xs.map(num)); return r.re[0]; }; };

  // ---------- polynomials ----------
  R('polyval', (a) => {
    const p = vec(a[0]); const x = a[1];
    const out = new Tensor(x.rows, x.cols, new Float64Array(x.numel));
    if (x.im) { out.im = new Float64Array(x.numel); for (let k = 0; k < x.numel; k++) { let yr = 0, yi = 0; for (const c of p) { [yr, yi] = cmul(yr, yi, x.re[k], x.im[k]); yr += c; } out.re[k] = yr; out.im[k] = yi; } return dropImagIfZero(out); }
    for (let k = 0; k < x.numel; k++) { let y = 0; for (const c of p) y = y * x.re[k] + c; out.re[k] = y; }
    return out;
  }, { minArgs: 2 });
  R('polyvalm', (a) => { const p = vec(a[0]); let Y = zeros(a[1].rows, a[1].cols); const E = I.builtins.get('eye').fn([num(a[1].rows)]); for (const c of p) { Y = I.builtins.get('mtimes').fn([Y, a[1]]); Y = I.builtins.get('plus').fn([Y, I.builtins.get('times').fn([num(c), E])]); } return Y; });
  R('roots', (a) => {
    const v = a[0];
    if (v.rows > 1 && v.cols > 1) throw new MError('Input must be a vector.', '', 'roots');
    const p = vec(v);
    if (p.some(x => !Number.isFinite(x))) throw new MError('Input to ROOTS must not contain NaN or Inf.', '', 'roots');
    const r = rootsArr(p);
    if (!r.length) return zeros(0, 1);
    return cplxCol(r);
  });
  R('poly', (a) => {
    const v = a[0];
    let rts;
    if (v.rows === v.cols && v.rows > 1) rts = eigGeneral(I.toRowsArr(v));
    else rts = Array.from(v.re, (x, k) => [x, v.im ? v.im[k] : 0]);
    let cr = [1], ci = [0];
    for (const [zr, zi] of rts) {
      const nr = new Array(cr.length + 1).fill(0), ni = new Array(cr.length + 1).fill(0);
      for (let k = 0; k < cr.length; k++) { nr[k] += cr[k]; ni[k] += ci[k]; const [pr, pi] = cmul(cr[k], ci[k], -zr, -zi); nr[k + 1] += pr; ni[k + 1] += pi; }
      cr = nr; ci = ni;
    }
    const t = rowVec(cr);
    if (ci.some(x => Math.abs(x) > 1e-12)) t.im = Float64Array.from(ci);
    return t;
  });
  R('conv', (a) => {
    const x = vec(a[0]), y = vec(a[1]);
    if (!x.length || !y.length) return zeros(1, 0);
    const out = convArr(x, y);
    return a[0].cols === 1 && a[0].rows > 1 ? colVec(out) : rowVec(out);
  });
  R('deconv', (a) => { const [q, r] = deconvArr(vec(a[0]), vec(a[1])); return [rowVec(q), rowVec(r)]; });
  R('polyder', (a, nout) => {
    if (a.length === 1) return rowVec(polyderArr(vec(a[0])));
    const b = vec(a[0]), c = vec(a[1]);
    if (nout < 2) return rowVec(polyderArr(convArr(b, c)));
    // quotient rule: (b'c - bc') / c^2
    const db = polyderArr(b), dc = polyderArr(c);
    const n1 = convArr(db, c), n2 = convArr(b, dc);
    const L = Math.max(n1.length, n2.length);
    const pad = (p) => new Array(L - p.length).fill(0).concat(p);
    const q = trimLead(pad(n1).map((x, k) => x - pad(n2)[k]));
    return [rowVec(q), rowVec(convArr(c, c))];
  });
  R('polyint', (a) => { const p = vec(a[0]); const k = a.length > 1 ? toNumber(a[1]) : 0; const n = p.length; const out = p.map((c, i) => c / (n - i)); out.push(k); return rowVec(out); });
  R('polyfit', (a, nout) => {
    const x = vec(a[0]), y = vec(a[1]), n = toNumber(a[2]);
    if (x.length !== y.length) throw new MError('The first two inputs must have the same number of elements.', '', 'polyfit');
    const A = x.map(xi => Array.from({ length: n + 1 }, (_, j) => Math.pow(xi, n - j)));
    const p = I.leastSquares(A, y.map(v => [v])).map(r => r[0]);
    if (x.length <= n) I.warn('Polynomial is not unique; degree >= number of data points.');
    if (nout > 1) { const S = new Struct(1, 1, ['normr', 'df']); S.data[0].set('df', num(Math.max(0, x.length - n - 1))); const res = y.map((yi, k) => yi - p.reduce((s, c) => s * x[k] + c, 0)); S.data[0].set('normr', num(Math.sqrt(res.reduce((s, r) => s + r * r, 0)))); return [rowVec(p), S]; }
    return rowVec(p);
  });
  R('residue', (a, nout) => {
    if (a.length === 3) {
      // [b,a] = residue(r,p,k)
      const r = Array.from(a[0].re, (x, k) => [x, a[0].im ? a[0].im[k] : 0]), p = Array.from(a[1].re, (x, k) => [x, a[1].im ? a[1].im[k] : 0]);
      const kk = vec(a[2]);
      let den = [[1, 0]];
      const cmulPoly = (P, Q) => { const out = Array.from({ length: P.length + Q.length - 1 }, () => [0, 0]); for (let i = 0; i < P.length; i++) for (let j = 0; j < Q.length; j++) { const [x, y] = cmul(P[i][0], P[i][1], Q[j][0], Q[j][1]); out[i + j][0] += x; out[i + j][1] += y; } return out; };
      for (const z of p) den = cmulPoly(den, [[1, 0], [-z[0], -z[1]]]);
      let numer = Array.from({ length: den.length - 1 }, () => [0, 0]);
      r.forEach((ri, i) => {
        let term = [[ri[0], ri[1]]];
        p.forEach((pj, j) => { if (j !== i) term = cmulPoly(term, [[1, 0], [-pj[0], -pj[1]]]); });
        const off = numer.length - term.length;
        term.forEach((c, k) => { numer[off + k][0] += c[0]; numer[off + k][1] += c[1]; });
      });
      let nb = numer.map(c => c[0]);
      if (kk.length) { const kd = convArr(kk, den.map(c => c[0])); const off = kd.length - nb.length; nb = kd.map((c, k) => c + (k >= off ? nb[k - off] : 0)); }
      return [rowVec(trimLead(nb.map(x => (Math.abs(x) < 1e-12 ? 0 : x)))), rowVec(den.map(c => c[0]))];
    }
    let b = trimLead(vec(a[0])), d = trimLead(vec(a[1]));
    let k = [];
    if (b.length >= d.length) { const [q, r] = deconvArr(b, d); k = q; b = trimLead(r); }
    const lead = d[0]; d = d.map(x => x / lead); b = b.map(x => x / lead);
    const poles = rootsArr(d);
    // group repeated poles
    const groups = [];
    for (const z of poles) {
      const g = groups.find(gr => Math.hypot(gr.z[0] - z[0], gr.z[1] - z[1]) < 1e-6 * Math.max(1, Math.hypot(z[0], z[1])));
      if (g) g.m++; else groups.push({ z: z.slice(), m: 1 });
    }
    const rs = [], ps = [];
    for (const g of groups) {
      // Taylor coefficients of b(s)/q(s) at s = z where q = d / (s-z)^m
      const [zr, zi] = g.z;
      // evaluate via complex polynomial division: compute q(s) coefficients
      let q = d.map(c => [c, 0]);
      for (let t = 0; t < g.m; t++) {
        const out = []; let carry = [0, 0];
        for (let i = 0; i < q.length - 1; i++) { const [mr, mi] = cmul(carry[0], carry[1], zr, zi); carry = [q[i][0] + mr, q[i][1] + mi]; out.push(carry); }
        q = out;
      }
      const shift = (P) => {
        // coefficients of P(s) in powers of (s-z), ascending
        const n = P.length; let c = P.map(x => x.slice());
        const res = [];
        for (let k2 = 0; k2 < n; k2++) {
          // synthetic division by (s - z): remainder is coefficient
          const out = []; let carry = [0, 0];
          for (let i = 0; i < c.length; i++) { const [mr, mi] = cmul(carry[0], carry[1], zr, zi); carry = [c[i][0] + mr, c[i][1] + mi]; out.push(carry); }
          res.push(out.pop()); c = out;
          if (!c.length) break;
        }
        return res;
      };
      const B = shift(b.map(x => [x, 0])), Q = shift(q);
      // series division B/Q
      const cser = [];
      for (let n2 = 0; n2 < g.m; n2++) {
        let s = B[n2] ? B[n2].slice() : [0, 0];
        for (let j = 1; j <= n2; j++) { const qj = Q[j] || [0, 0]; const [pr, pi] = cmul(qj[0], qj[1], cser[n2 - j][0], cser[n2 - j][1]); s[0] -= pr; s[1] -= pi; }
        cser.push(cdiv(s[0], s[1], Q[0][0], Q[0][1]));
      }
      for (let j = 0; j < g.m; j++) { rs.push(cser[g.m - 1 - j]); ps.push(g.z); }
      // MATLAB lists residues for repeated pole in increasing power order
    }
    const clean = (z) => [Math.abs(z[0]) < 1e-12 ? 0 : z[0], Math.abs(z[1]) < 1e-12 ? 0 : z[1]];
    const rr = cplxCol(rs.map(clean)), pp = cplxCol(ps.map(clean));
    return [rr, pp, k.length ? rowVec(k) : zeros(0, 0)];
  });

  // ---------- calculus ----------
  const integralFn = (fname) => (a) => {
    const f = asFunc(a[0]); const lo = toNumber(a[1]), hi = toNumber(a[2]);
    // MATLAB integral expects vectorized f; evaluate pointwise with scalars for robustness
    const g = (x) => { const r = f(num(x)); if (r.numel !== 1) throw new MError('Output of the function must be the same size as the input. If FUN is an array-valued integrand, set the \'ArrayValued\' option to true.', '', fname); return r.re[0]; };
    return num(integrate(g, lo, hi));
  };
  R('integral', integralFn('integral')); R('quad', integralFn('quad')); R('quadl', integralFn('quadl')); R('quadgk', integralFn('quadgk'));
  const dbl = (fname) => (a) => {
    const f = asFunc(a[0], 2, ['x', 'y']);
    const [x0, x1, y0, y1] = [1, 2, 3, 4].map(k => toNumber(a[k]));
    const g = (x, y) => f(num(x), num(y)).re[0];
    return num(integrate((y) => integrate((x) => g(x, y), x0, x1, 1e-9), y0, y1, 1e-9));
  };
  R('dblquad', dbl('dblquad'));
  R('integral2', (a) => {
    const f = asFunc(a[0], 2, ['x', 'y']);
    const x0 = toNumber(a[1]), x1 = toNumber(a[2]);
    const yl = a[3].type === 'fh' ? (x) => I.callHandle(a[3], [num(x)], 1)[0].re[0] : () => toNumber(a[3]);
    const yu = a[4].type === 'fh' ? (x) => I.callHandle(a[4], [num(x)], 1)[0].re[0] : () => toNumber(a[4]);
    return num(integrate((x) => integrate((y) => f(num(x), num(y)).re[0], yl(x), yu(x), 1e-9), x0, x1, 1e-9));
  });
  const tri = (a) => {
    const f = asFunc(a[0], 3, ['x', 'y', 'z']);
    const [x0, x1, y0, y1, z0, z1] = [1, 2, 3, 4, 5, 6].map(k => toNumber(a[k]));
    return num(integrate((z) => integrate((y) => integrate((x) => f(num(x), num(y), num(z)).re[0], x0, x1, 1e-8), y0, y1, 1e-8), z0, z1, 1e-8));
  };
  R('triplequad', tri); R('integral3', tri);
  R('fzero', (a) => {
    const f = scalarFn(a[0]);
    let x0 = a[1];
    let lo, hi;
    if (x0.numel === 2) { lo = x0.re[0]; hi = x0.re[1]; if (Math.sign(f(lo)) === Math.sign(f(hi))) throw new MError('The function values at the interval endpoints must differ in sign.', '', 'fzero'); }
    else {
      const x = x0.re[0]; const fx = f(x); if (fx === 0) return num(x);
      let dx = x === 0 ? 1 / 50 : x / 50; let found = false;
      for (let k = 0; k < 100; k++) {
        lo = x - dx; hi = x + dx;
        if (Math.sign(f(lo)) !== Math.sign(fx)) { hi = x; found = true; break; }
        if (Math.sign(f(hi)) !== Math.sign(fx)) { lo = x; found = true; break; }
        dx *= Math.SQRT2;
        if (!Number.isFinite(f(lo)) || !Number.isFinite(f(hi))) break;
      }
      if (!found) { I.warn(`Exiting fzero: aborting search for an interval containing a sign change\n    because NaN or Inf function value encountered during search.`); return num(NaN); }
    }
    // Brent's method
    let fa = f(lo), fb = f(hi), c = lo, fc = fa, d = hi - lo, e = d;
    let b = hi, A = lo;
    for (let it = 0; it < 200; it++) {
      if (Math.sign(fb) === Math.sign(fc)) { c = A; fc = fa; d = b - A; e = d; }
      if (Math.abs(fc) < Math.abs(fb)) { A = b; b = c; c = A; fa = fb; fb = fc; fc = fa; }
      const tol = 2 * 2.2e-16 * Math.abs(b) + 1e-16, m = 0.5 * (c - b);
      if (Math.abs(m) <= tol || fb === 0) break;
      if (Math.abs(e) >= tol && Math.abs(fa) > Math.abs(fb)) {
        let s = fb / fa, p, q;
        if (A === c) { p = 2 * m * s; q = 1 - s; }
        else { const qq = fa / fc, r = fb / fc; p = s * (2 * m * qq * (qq - r) - (b - A) * (r - 1)); q = (qq - 1) * (r - 1) * (s - 1); }
        if (p > 0) q = -q; else p = -p;
        if (2 * p < Math.min(3 * m * q - Math.abs(tol * q), Math.abs(e * q))) { e = d; d = p / q; } else { d = m; e = m; }
      } else { d = m; e = m; }
      A = b; fa = fb;
      b += Math.abs(d) > tol ? d : (m > 0 ? tol : -tol);
      fb = f(b);
    }
    return [num(b), num(fb)];
  });
  R('fminsearch', (a) => {
    const f = asFunc(a[0]); const x0 = vec(a[1]); const n = x0.length;
    const F = (x) => f(new Tensor(a[1].rows, a[1].cols, Float64Array.from(x))).re[0];
    let simplex = [x0]; for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] = x[i] !== 0 ? x[i] * 1.05 : 0.00025; simplex.push(x); }
    let vals = simplex.map(F);
    for (let it = 0; it < 200 * n; it++) {
      const ord = vals.map((v, k) => k).sort((p, q) => vals[p] - vals[q]); simplex = ord.map(k => simplex[k]); vals = ord.map(k => vals[k]);
      if (Math.abs(vals[n] - vals[0]) < 1e-4 && Math.max(...simplex.slice(1).map(s => Math.max(...s.map((x, k) => Math.abs(x - simplex[0][k]))))) < 1e-4) break;
      const xb = new Array(n).fill(0); for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) xb[k] += simplex[i][k] / n;
      const xr = xb.map((x, k) => 2 * x - simplex[n][k]); const fr = F(xr);
      if (fr < vals[0]) { const xe = xb.map((x, k) => 3 * x - 2 * simplex[n][k]); const fe = F(xe); if (fe < fr) { simplex[n] = xe; vals[n] = fe; } else { simplex[n] = xr; vals[n] = fr; } }
      else if (fr < vals[n - 1]) { simplex[n] = xr; vals[n] = fr; }
      else {
        const xc = fr < vals[n] ? xb.map((x, k) => 1.5 * x - 0.5 * simplex[n][k]) : xb.map((x, k) => 0.5 * x + 0.5 * simplex[n][k]); const fc = F(xc);
        if (fc < Math.min(fr, vals[n])) { simplex[n] = xc; vals[n] = fc; }
        else for (let i = 1; i <= n; i++) { simplex[i] = simplex[i].map((x, k) => simplex[0][k] + 0.5 * (x - simplex[0][k])); vals[i] = F(simplex[i]); }
      }
    }
    return [new Tensor(a[1].rows, a[1].cols, Float64Array.from(simplex[0])), num(vals[0])];
  });
  R('fminbnd', (a) => {
    const f = scalarFn(a[0]); let lo = toNumber(a[1]), hi = toNumber(a[2]); const g = (Math.sqrt(5) - 1) / 2;
    let c = hi - g * (hi - lo), d = lo + g * (hi - lo);
    for (let k = 0; k < 200 && Math.abs(hi - lo) > 1e-10; k++) { if (f(c) < f(d)) hi = d; else lo = c; c = hi - g * (hi - lo); d = lo + g * (hi - lo); }
    const x = (lo + hi) / 2; return [num(x), num(f(x))];
  });
  const odeSolve = (fname) => (a, nout) => {
    const f = a[0]; const tspan = vec(a[1]); const y0 = vec(a[2]);
    const F = (t, y) => { const r = I.callHandle(f, [num(t), colVec(y)], 1)[0]; if (r.numel !== y.length) throw new MError(`${fname}: the function must return a column vector of length ${y.length}.`); return Array.from(r.re); };
    const t0 = tspan[0], tf = tspan[tspan.length - 1]; const dir = Math.sign(tf - t0) || 1;
    let h = (tf - t0) / 100, t = t0, y = y0.slice();
    const T = [t], Y = [y.slice()];
    const c = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1];
    const A = [[], [1 / 5], [3 / 40, 9 / 40], [44 / 45, -56 / 15, 32 / 9], [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729], [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656], [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84]];
    const b5 = [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0], b4 = [5179 / 57600, 0, 7571 / 16695, 393 / 640, -92097 / 339200, 187 / 2100, 1 / 40];
    let steps = 0;
    while (dir * (tf - t) > 1e-12 && steps < 100000) {
      steps++; I.host.checkInterrupt();
      if (dir * (t + h - tf) > 0) h = tf - t;
      const K = [];
      for (let s = 0; s < 7; s++) { const ys = y.map((yi, i) => yi + h * A[s].reduce((acc, aij, j) => acc + aij * K[j][i], 0)); K.push(F(t + c[s] * h, ys)); }
      const y5 = y.map((yi, i) => yi + h * b5.reduce((acc, bj, j) => acc + bj * K[j][i], 0));
      const y4 = y.map((yi, i) => yi + h * b4.reduce((acc, bj, j) => acc + bj * K[j][i], 0));
      const err = Math.max(...y5.map((v, i) => Math.abs(v - y4[i]) / Math.max(1e-6, 1e-3 * Math.max(Math.abs(v), Math.abs(y[i])))));
      if (err <= 1 || Math.abs(h) < 1e-12) {
        // dense output: 4 points per step like MATLAB refine
        for (const th of [0.25, 0.5, 0.75]) { const ym = y.map((yi, i) => yi + th * h * b5.reduce((acc, bj, j) => acc + bj * K[j][i], 0)); T.push(t + th * h); Y.push(ym); }
        t += h; y = y5; T.push(t); Y.push(y.slice());
      }
      h *= Math.min(5, Math.max(0.2, 0.9 * Math.pow(1 / Math.max(err, 1e-10), 0.2)));
    }
    let To = T, Yo = Y;
    if (tspan.length > 2) {
      To = tspan; Yo = tspan.map(tq => { let k = 0; while (k < T.length - 2 && dir * (T[k + 1] - tq) < 0) k++; const w = (tq - T[k]) / ((T[k + 1] - T[k]) || 1); return Y[k].map((v, i) => v + w * (Y[k + 1][i] - v)); });
    }
    const tt = colVec(To);
    const yy = zeros(To.length, y0.length); Yo.forEach((row, i) => row.forEach((v, j) => (yy.re[j * To.length + i] = v)));
    if (nout === 0) { I.plot.command('plot', [tt, yy]); return; }
    return [tt, yy];
  };
  R('ode45', odeSolve('ode45')); R('ode23', odeSolve('ode23')); R('ode113', odeSolve('ode113')); R('ode15s', odeSolve('ode15s'));
  R('gradient', (a) => { const y = vec(a[0]); const h = a.length > 1 ? toNumber(a[1]) : 1; const n = y.length; const g = y.map((v, k) => (k === 0 ? y[1] - y[0] : k === n - 1 ? y[n - 1] - y[n - 2] : (y[k + 1] - y[k - 1]) / 2) / h); return a[0].rows === 1 ? rowVec(g) : colVec(g); });

  // ---------- statistics ----------
  const colwise = (v, f) => {
    if (v.rows === 1 || v.cols === 1) return num(f(vec(v)));
    const out = zeros(1, v.cols); for (let j = 0; j < v.cols; j++) out.re[j] = f(Array.from(v.re.slice(j * v.rows, (j + 1) * v.rows))); return out;
  };
  const moment = (x, k) => { const m = meanOf(x); return x.reduce((s, y) => s + (y - m) ** k, 0) / x.length; };
  R('skewness', (a) => colwise(a[0], (x) => { const flag = a.length > 1 ? toNumber(a[1]) : 1; const n = x.length; let s = moment(x, 3) / Math.pow(moment(x, 2), 1.5); if (flag === 0) s *= Math.sqrt(n * (n - 1)) / (n - 2); return s; }));
  R('kurtosis', (a) => colwise(a[0], (x) => { const flag = a.length > 1 ? toNumber(a[1]) : 1; const n = x.length; let k = moment(x, 4) / moment(x, 2) ** 2; if (flag === 0) k = 3 + (n - 1) / ((n - 2) * (n - 3)) * ((n + 1) * k - 3 * (n - 1)); return k; }));
  R('prctile', (a) => { const x = vec(a[0]).filter(v => !Number.isNaN(v)).sort((p, q) => p - q); const ps = a[1]; const n = x.length; const f = (p) => { const r = n * p / 100 + 0.5; if (r < 1) return x[0]; if (r >= n) return x[n - 1]; const k = Math.floor(r); return x[k - 1] + (r - k) * (x[k] - x[k - 1]); }; return new Tensor(ps.rows, ps.cols, Float64Array.from(ps.re, f)); });
  R('quantile', (a) => { const p = a[1]; const pr = new Tensor(p.rows, p.cols, p.re.map(x => x * 100)); return I.builtins.get('prctile').fn([a[0], pr]); });
  R('iqr', (a) => { const q = I.builtins.get('prctile').fn([a[0], rowVec([25, 75])]); return num(q.re[1] - q.re[0]); });
  R('mad', (a) => colwise(a[0], (x) => { const m = meanOf(x); return meanOf(x.map(v => Math.abs(v - m))); }));
  R('zscore', (a) => { const x = vec(a[0]); const m = meanOf(x), s = Math.sqrt(varOf(x)); return new Tensor(a[0].rows, a[0].cols, Float64Array.from(x, v => (v - m) / s)); });
  R('cov', (a) => {
    if (a.length === 2) { const x = vec(a[0]), y = vec(a[1]); const mx = meanOf(x), my = meanOf(y); const n = x.length; const c = (p, q, mp, mq) => p.reduce((s, v, k) => s + (v - mp) * (q[k] - mq), 0) / (n - 1); const M = zeros(2, 2); M.re[0] = c(x, x, mx, mx); M.re[3] = c(y, y, my, my); M.re[1] = M.re[2] = c(x, y, mx, my); return M; }
    const v = a[0]; if (v.rows === 1 || v.cols === 1) return num(varOf(vec(v)));
    const n = v.rows, p = v.cols; const cols = Array.from({ length: p }, (_, j) => Array.from(v.re.slice(j * n, (j + 1) * n))); const ms = cols.map(meanOf);
    const M = zeros(p, p); for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) M.re[j * p + i] = cols[i].reduce((s, x, k) => s + (x - ms[i]) * (cols[j][k] - ms[j]), 0) / (n - 1); return M;
  });
  R('corrcoef', (a) => {
    const C = I.builtins.get('cov').fn(a); const p = C.rows; const R2 = zeros(p, p);
    for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) R2.re[j * p + i] = C.re[j * p + i] / Math.sqrt(C.re[i * p + i] * C.re[j * p + j]);
    return R2;
  });
  R('corr', (a) => { const r = I.builtins.get('corrcoef').fn(a); return num(r.re[1]); });
  R('normpdf', (a) => { const x = a[0], m = a.length > 1 ? toNumber(a[1]) : 0, s = a.length > 2 ? toNumber(a[2]) : 1; return new Tensor(x.rows, x.cols, Float64Array.from(x.re, v => Math.exp(-0.5 * ((v - m) / s) ** 2) / (s * Math.sqrt(2 * Math.PI)))); });
  R('normcdf', (a) => { const x = a[0], m = a.length > 1 ? toNumber(a[1]) : 0, s = a.length > 2 ? toNumber(a[2]) : 1; return new Tensor(x.rows, x.cols, Float64Array.from(x.re, v => normcdf(v, m, s))); });
  R('norminv', (a) => { const p = a[0], m = a.length > 1 ? toNumber(a[1]) : 0, s = a.length > 2 ? toNumber(a[2]) : 1; return new Tensor(p.rows, p.cols, Float64Array.from(p.re, v => m + s * norminv(v))); });
  R('tcdf', (a) => { const x = a[0], v = toNumber(a[1]); return new Tensor(x.rows, x.cols, Float64Array.from(x.re, t => studentTcdf(t, v))); });
  R('tinv', (a) => { const p = toNumber(a[0]), v = toNumber(a[1]); let lo = -1e3, hi = 1e3; for (let k = 0; k < 200; k++) { const m = (lo + hi) / 2; if (studentTcdf(m, v) < p) lo = m; else hi = m; } return num((lo + hi) / 2); });
  R('fcdf', (a) => { const x = toNumber(a[0]), d1 = toNumber(a[1]), d2 = toNumber(a[2]); return num(x <= 0 ? 0 : betainc(d1 * x / (d1 * x + d2), d1 / 2, d2 / 2)); });
  R('chi2cdf', (a) => { const x = toNumber(a[0]), k = toNumber(a[1]); return num(gammainc(x / 2, k / 2)); });
  R('ttest2', (a, nout) => {
    const x = vec(a[0]).filter(v => !Number.isNaN(v)), y = vec(a[1]).filter(v => !Number.isNaN(v));
    const nx = x.length, ny = y.length; const mx = meanOf(x), my = meanOf(y); const vx = varOf(x), vy = varOf(y);
    const df = nx + ny - 2; const sp = Math.sqrt(((nx - 1) * vx + (ny - 1) * vy) / df);
    const t = (mx - my) / (sp * Math.sqrt(1 / nx + 1 / ny));
    const p = 2 * (1 - studentTcdf(Math.abs(t), df));
    const alpha = 0.05;
    const tc = I.builtins.get('tinv').fn([num(1 - alpha / 2), num(df)]).re[0];
    const ci = rowVec([mx - my - tc * sp * Math.sqrt(1 / nx + 1 / ny), mx - my + tc * sp * Math.sqrt(1 / nx + 1 / ny)]);
    const st = new Struct(1, 1, ['tstat', 'df', 'sd']); st.data[0].set('tstat', num(t)); st.data[0].set('df', num(df)); st.data[0].set('sd', num(sp));
    return [num(p < alpha ? 1 : 0), num(p), ci, st];
  });
  R('ttest', (a) => {
    let x = vec(a[0]); const m0 = a.length > 1 && a[1].numel === 1 ? toNumber(a[1]) : 0;
    if (a.length > 1 && a[1].numel > 1) { const y = vec(a[1]); x = x.map((v, k) => v - y[k]); }
    const n = x.length, m = meanOf(x), s = Math.sqrt(varOf(x)); const t = (m - m0) / (s / Math.sqrt(n)); const p = 2 * (1 - studentTcdf(Math.abs(t), n - 1));
    return [num(p < 0.05 ? 1 : 0), num(p)];
  });
  R('vartest2', (a) => {
    const x = vec(a[0]), y = vec(a[1]); const F = varOf(x) / varOf(y); const d1 = x.length - 1, d2 = y.length - 1;
    const cdf = betainc(d1 * F / (d1 * F + d2), d1 / 2, d2 / 2); const p = 2 * Math.min(cdf, 1 - cdf);
    return [num(p < 0.05 ? 1 : 0), num(p)];
  });
  R('kstest2', (a) => {
    const x = vec(a[0]).sort((p, q) => p - q), y = vec(a[1]).sort((p, q) => p - q); const n1 = x.length, n2 = y.length;
    const all = [...new Set([...x, ...y])].sort((p, q) => p - q); let D = 0;
    const cdf = (arr, v) => { let k = 0; while (k < arr.length && arr[k] <= v) k++; return k / arr.length; };
    for (const v of all) D = Math.max(D, Math.abs(cdf(x, v) - cdf(y, v)));
    const ne = n1 * n2 / (n1 + n2); const lambda = Math.max((Math.sqrt(ne) + 0.12 + 0.11 / Math.sqrt(ne)) * D, 0);
    const p = kolmogorovQ(lambda);
    return [num(p < 0.05 ? 1 : 0), num(p), num(D)];
  });
  R('ranksum', (a) => {
    const x = vec(a[0]), y = vec(a[1]); const nx = x.length, ny = y.length;
    const all = [...x.map(v => [v, 0]), ...y.map(v => [v, 1])].sort((p, q) => p[0] - q[0]);
    const ranks = new Array(all.length); let tieAdj = 0;
    for (let i = 0; i < all.length;) { let j = i; while (j < all.length && all[j][0] === all[i][0]) j++; const r = (i + j + 1) / 2; for (let k = i; k < j; k++) ranks[k] = r; const t = j - i; tieAdj += t * t * t - t; i = j; }
    let W = 0; all.forEach((e, k) => { if (e[1] === 0) W += ranks[k]; });
    const [ns, wsum] = nx <= ny ? [nx, W] : [ny, ranks.reduce((s, r, k) => s + (all[k][1] === 1 ? r : 0), 0)];
    const N = nx + ny; const mu = ns * (N + 1) / 2;
    const sigma = Math.sqrt(nx * ny / 12 * ((N + 1) - tieAdj / (N * (N - 1))));
    const z = (wsum - mu - 0.5 * Math.sign(wsum - mu)) / sigma;
    const p = 2 * (1 - normcdf(Math.abs(z)));
    const st = new Struct(1, 1, ['zval', 'ranksum']); st.data[0].set('zval', num(z)); st.data[0].set('ranksum', num(wsum));
    return [num(p), num(p < 0.05 ? 1 : 0), st];
  });
  R('histcounts', (a, nout) => {
    const x = vec(a[0]).filter(v => Number.isFinite(v));
    let edges;
    if (a.length > 1 && a[1].numel > 1) edges = vec(a[1]);
    else { const nb = a.length > 1 ? toNumber(a[1]) : autoBins(x); const lo = Math.min(...x), hi = Math.max(...x); edges = Array.from({ length: nb + 1 }, (_, k) => lo + (hi - lo) * k / nb); }
    const counts = new Array(edges.length - 1).fill(0);
    for (const v of x) { for (let k = edges.length - 2; k >= 0; k--) if (v >= edges[k] && (v < edges[k + 1] || (k === edges.length - 2 && v === edges[k + 1]))) { counts[k]++; break; } }
    return [rowVec(counts), rowVec(edges)];
  });
}
function autoBins(x) { return Math.max(1, Math.min(50, Math.ceil(Math.sqrt(x.length)))); }
void Cell; void bool; void str; void empty; void isChar; void className; void medianOf;
