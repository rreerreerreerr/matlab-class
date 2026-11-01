// Symbolic Math (subset) built on nerdamer, with MATLAB-style printing.
import nerdamer from 'nerdamer/all.js';
import { Tensor, Sym, Struct, Cell, MError, num, str, zeros, rowVec, colVec, toStr, toNumber, isChar, className, cplx } from '../value.js';
import { setSymHook } from '../ops.js';
import { setSymPrinter } from '../format.js';
import { isStr, toStringList } from './util.js';
import { integrate } from './numeric.js';

// symbolic functions declared with "syms y(t)": name -> argument list
const FUNS = new Map();

// ---------------- rational numbers (BigInt) ----------------
const babs = (a) => (a < 0n ? -a : a);
function bgcd(a, b) { a = babs(a); b = babs(b); while (b) [a, b] = [b, a % b]; return a; }
class Q {
  constructor(n, d = 1n) { if (d < 0n) { n = -n; d = -d; } const g = bgcd(n, d) || 1n; this.n = n / g; this.d = d / g; }
  static of(x) {
    if (x instanceof Q) return x;
    if (typeof x === 'bigint') return new Q(x);
    if (Number.isInteger(x)) return new Q(BigInt(x));
    // decimal -> exact fraction
    const s = String(x);
    if (/e/i.test(s)) { const [m, e] = s.split(/e/i); const q = Q.of(parseFloat(m)); const p = parseInt(e); return p >= 0 ? q.mul(new Q(10n ** BigInt(p))) : q.div(new Q(10n ** BigInt(-p))); }
    const [ip, fp = ''] = s.split('.');
    return new Q(BigInt(ip + fp), 10n ** BigInt(fp.length));
  }
  add(o) { return new Q(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o) { return new Q(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o) { return new Q(this.n * o.n, this.d * o.d); }
  div(o) { if (o.n === 0n) throw new MError('Division by zero.'); return new Q(this.n * o.d, this.d * o.n); }
  neg() { return new Q(-this.n, this.d); }
  isZero() { return this.n === 0n; }
  isOne() { return this.n === 1n && this.d === 1n; }
  isInt() { return this.d === 1n; }
  sign() { return this.n < 0n ? -1 : this.n > 0n ? 1 : 0; }
  abs() { return new Q(babs(this.n), this.d); }
  val() { return Number(this.n) / Number(this.d); }
  toString() { return this.d === 1n ? String(this.n) : `${this.n}/${this.d}`; }
}

// ---------------- expression AST from nerdamer text ----------------
function tokenize(s) {
  const out = []; let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ') { i++; continue; }
    if (/[0-9.]/.test(c)) { let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++; if (s[j] === 'e' && /[-+0-9]/.test(s[j + 1] || '') && /[0-9]/.test(s[j + 2] || s[j + 1])) { j += 2; while (j < s.length && /[0-9]/.test(s[j])) j++; } out.push({ t: 'n', v: s.slice(i, j) }); i = j; continue; }
    if (/[A-Za-z_]/.test(c)) { let j = i; while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++; out.push({ t: 'id', v: s.slice(i, j) }); i = j; continue; }
    out.push({ t: 'op', v: c }); i++;
  }
  return out;
}
function parseExpr(s) {
  const toks = tokenize(s); let p = 0;
  const peek = () => toks[p], eat = (v) => { const t = toks[p]; if (!t || (v && t.v !== v)) throw new Error('parse ' + s); p++; return t; };
  function expr() {
    let terms = [];
    let first = term();
    terms.push(first);
    while (peek() && (peek().v === '+' || peek().v === '-')) { const op = eat().v; const t = term(); terms.push(op === '-' ? { k: 'neg', e: t } : t); }
    return terms.length === 1 ? terms[0] : { k: 'add', terms };
  }
  function term() {
    let f = [unary()];
    while (peek() && (peek().v === '*' || peek().v === '/')) { const op = eat().v; const u = unary(); f.push(op === '/' ? { k: 'pow', b: u, e: { k: 'num', q: new Q(-1n) } } : u); }
    return f.length === 1 ? f[0] : { k: 'mul', factors: f };
  }
  function unary() { if (peek() && peek().v === '-') { eat(); const u = unary(); if (u.k === 'num') return { k: 'num', q: u.q.neg() }; return { k: 'neg', e: u }; } if (peek() && peek().v === '+') { eat(); return unary(); } return power(); }
  function power() {
    const b = atom();
    if (peek() && peek().v === '^') { eat(); const e = unary(); return { k: 'pow', b, e }; }
    return b;
  }
  function atom() {
    const t = eat();
    if (t.t === 'n') return { k: 'num', q: Q.of(parseFloat(t.v)), raw: t.v };
    if (t.t === 'id') {
      if (peek() && peek().v === '(') { eat('('); const args = []; if (peek().v !== ')') { args.push(expr()); while (peek().v === ',') { eat(','); args.push(expr()); } } eat(')'); return { k: 'fn', name: t.v, args }; }
      return { k: 'sym', name: t.v };
    }
    if (t.v === '(') { const e = expr(); eat(')'); return e; }
    if (t.v === '[') { const items = []; if (peek().v !== ']') { items.push(expr()); while (peek().v === ',') { eat(','); items.push(expr()); } } eat(']'); return { k: 'vec', items }; }
    throw new Error('parse ' + s);
  }
  const e = expr();
  if (p !== toks.length) throw new Error('parse trailing ' + s);
  return e;
}

// canonical sum of products: [{coef: Q|null(float), fl: number, factors: [{b: node, e: Q|node}]}]
function toTerms(n) {
  switch (n.k) {
    case 'add': return n.terms.flatMap(toTerms);
    case 'neg': return toTerms(n.e).map(t => ({ ...t, coef: t.coef.neg() }));
    case 'num': return [{ coef: n.q, factors: [] }];
    case 'mul': {
      let coef = new Q(1n); const factors = [];
      for (let f of n.factors) {
        while (f.k === 'neg') { coef = coef.neg(); f = f.e; }
        const ts = toTerms(f);
        if (ts.length === 1) { coef = coef.mul(ts[0].coef); factors.push(...ts[0].factors); }
        else factors.push({ b: f, e: new Q(1n) });
      }
      return [{ coef, factors }];
    }
    case 'pow': {
      if (n.b.k === 'num' && n.e.k === 'num' && n.e.q.isInt()) {
        const k = Number(n.e.q.n); let r = new Q(1n); const base = n.b.q;
        for (let j = 0; j < Math.abs(k); j++) r = r.mul(base);
        return [{ coef: k < 0 ? new Q(1n).div(r) : r, factors: [] }];
      }
      const e = n.e.k === 'num' ? n.e.q : n.e;
      if (n.e.k === 'neg' && n.e.e.k === 'num') return [{ coef: new Q(1n), factors: [{ b: n.b, e: n.e.e.q.neg() }] }];
      return [{ coef: new Q(1n), factors: [{ b: n.b, e }] }];
    }
    default: return [{ coef: new Q(1n), factors: [{ b: n, e: new Q(1n) }] }];
  }
}
function symDegree(t) {
  let d = 0;
  if (t.factors.some(f => f.b.k === 'sym' && f.b.name === 'i')) d -= 0.5;
  for (const f of t.factors) {
    if (f.b.k === 'sym' && f.b.name !== 'i' && f.b.name !== 'pi' && f.b.name !== 'e') d += f.e instanceof Q ? f.e.val() : 1;
    else if (f.b.k === 'add') d += (f.e instanceof Q ? f.e.val() : 1) * Math.max(...toTerms(f.b).map(symDegree));
    else if (f.b.k === 'fn') d += f.e instanceof Q ? Math.max(0, f.e.val()) * 0.5 : 0.5;
  }
  return d;
}
const FN_MAP = { Infinity: 'Inf' };
function printNode(n, ctx = {}) {
  switch (n.k) {
    case 'num': return n.q.toString();
    case 'sym': {
      if (FUNS.has(n.name)) return `${n.name}(${FUNS.get(n.name)})`;
      const dm = n.name.match(/^d__(\w+?)__(\d+)$/);
      if (dm) return `diff(${dm[1]}(${FUNS.get(dm[1]) || 't'}), ${(FUNS.get(dm[1]) || 't').split(',')[0]}${dm[2] === '1' ? '' : ', ' + dm[2]})`;
      return n.name === 'Infinity' ? 'Inf' : n.name === 'e' ? 'exp(1)' : n.name === 'i' ? '1i' : n.name;
    }
    case 'fn': {
      if (n.name === 'sqrt') return powStr(printAtom(n.args[0]), '(1/2)');
      if (n.name === 'vec') return '[' + n.args.map(a => printNode(a)).join(', ') + ']';
      const name = { log10: 'log10', ln: 'log' }[n.name] || n.name;
      return `${name}(${n.args.map(a => printNode(a)).join(', ')})`;
    }
    case 'vec': return '[' + n.items.map(a => printNode(a)).join(', ') + ']';
    default: return printSum(toTerms(n));
  }
}
function printAtom(n) {
  const s = printNode(n);
  if (n.k === 'sym' || (n.k === 'fn' && n.name !== 'sqrt') || (n.k === 'num' && n.q.isInt() && n.q.sign() >= 0)) return s;
  return `(${s})`;
}
const powStr = (b, e) => `${b}^${e}`;
function factorStr(f) {
  // f.e positive here
  if (f.b.k === 'sym' && f.b.name === 'e') { const ex = f.e instanceof Q ? f.e.toString() : printNode(f.e); return `exp(${ex})`; }
  let base = f.b.k === 'add' || f.b.k === 'neg' || f.b.k === 'mul' || f.b.k === 'pow' || (f.b.k === 'fn' && f.b.name === 'sqrt') ? `(${printNode(f.b)})` : printNode(f.b);
  if (f.b.k === 'fn' && f.b.name === 'sqrt') { const inner = printAtom(f.b.args[0]); if (f.e instanceof Q && f.e.isOne()) return `${inner}^(1/2)`; const e2 = f.e instanceof Q ? f.e.mul(new Q(1n, 2n)) : null; if (e2) return e2.isInt() ? `${inner}^${e2}` : `${inner}^(${e2})`; }
  if (f.e instanceof Q) {
    if (f.e.isOne()) return base;
    return f.e.isInt() ? `${base}^${f.e}` : `${base}^(${f.e})`;
  }
  const es = printNode(f.e);
  return /^[A-Za-z0-9_.]+$/.test(es) ? `${base}^${es}` : `${base}^(${es})`;
}
function printTerm(t) {
  // returns { neg, s }
  let coef = t.coef;
  const numF = [], denF = [];
  let imag = false;
  for (let f of t.factors) {
    if (f.b.k === 'add' && f.e instanceof Q && f.e.isOne()) {
      const ts = toTerms(f.b);
      if (ts.length > 1 && ts.every(x => x.coef.sign() < 0)) { coef = coef.neg(); f = { b: { k: 'add', terms: [{ k: 'neg', e: f.b }] }, e: f.e }; }
    }
    if (f.b.k === 'sym' && f.b.name === 'i' && f.e instanceof Q && f.e.isOne()) { imag = true; continue; }
    if (f.b.k === 'sym' && f.b.name === 'e') { numF.push(factorStr(f)); continue; }
    if (f.e instanceof Q && f.e.sign() < 0) denF.push(factorStr({ b: f.b, e: f.e.neg() }));
    else if (!(f.e instanceof Q) && f.e.k === 'neg') denF.push(factorStr({ b: f.b, e: f.e.e }));
    else numF.push(factorStr(f));
  }
  const neg = coef.sign() < 0; coef = coef.abs();
  const cn = String(coef.n), cd = String(coef.d);
  let numParts = [];
  if (imag) numParts.push((cn === '1' && !numF.length ? '' : cn === '1' ? '' : cn) + (numF.length ? '1i' : (cn === '1' ? '1i' : 'i')));
  else if (cn !== '1' || !numF.length) numParts.push(cn);
  numParts.push(...numF);
  if (imag && numF.length && cn !== '1') numParts = [cn + 'i', ...numF];
  let numS = numParts.join('*');
  if (imag && !numF.length) numS = cn === '1' ? '1i' : cn + 'i';
  const denParts = []; if (cd !== '1') denParts.push(cd); denParts.push(...denF);
  if (!denParts.length) return { neg, s: numS };
  const single = numParts.length === 1;
  const numP = single ? numS : `(${numS})`;
  const denS = denParts.length === 1 ? denParts[0] : `(${denParts.join('*')})`;
  return { neg, s: `${numP}/${denS}` };
}
function printSum(terms) {
  terms = terms.filter(t => !t.coef.isZero());
  if (!terms.length) return '0';
  const withDeg = terms.map((t, k) => ({ t, d: symDegree(t), k }));
  withDeg.sort((a, b) => b.d - a.d || (a.t.coef.sign() < 0) - (b.t.coef.sign() < 0) || a.k - b.k);
  const parts = withDeg.map(w => printTerm(w.t));
  if (parts.length === 1) return (parts[0].neg ? '-' : '') + parts[0].s;
  let s = parts[0].neg ? '- ' + parts[0].s : parts[0].s;
  for (const p of parts.slice(1)) s += (p.neg ? ' - ' : ' + ') + p.s;
  return s;
}
export function prettySym(e) {
  if (e === undefined || e === null) return '';
  if (typeof e !== 'string') e = String(e);
  if (e[0] === '\u0001') return e.slice(1);
  if (e.includes('=') && !e.includes('==')) { const [l, r] = e.split('='); return `${prettySym(l)} == ${prettySym(r)}`; }
  if (e.includes('==')) { const [l, r] = e.split('=='); return `${prettySym(l)} == ${prettySym(r)}`; }
  try { return printNode(parseExpr(e)); } catch (err) { return e.replace(/Infinity/g, 'Inf'); }
}

// ---------------- polynomial helpers (univariate, rational coeffs) ----------------
// poly: array of Q, highest degree first
function polyFromExpr(expr, v) {
  // returns array of Q or null if not a polynomial in v with numeric coefficients
  let ex;
  try { ex = nerdamer(`expand(${expr})`).toString(); } catch (e) { return null; }
  const vars = nerdamer(ex).variables();
  if (vars.some(x => x !== v)) return null;
  let terms;
  try { terms = toTerms(parseExpr(ex)); } catch (e) { return null; }
  const coeffs = new Map(); let maxd = 0;
  for (const t of terms) {
    let d = 0;
    for (const f of t.factors) {
      if (f.b.k === 'sym' && f.b.name === v && f.e instanceof Q && f.e.isInt() && f.e.sign() >= 0) d += Number(f.e.n);
      else return null;
    }
    coeffs.set(d, (coeffs.get(d) || new Q(0n)).add(t.coef)); maxd = Math.max(maxd, d);
  }
  const out = []; for (let d = maxd; d >= 0; d--) out.push(coeffs.get(d) || new Q(0n));
  return out;
}
const pTrim = (p) => { let k = 0; while (k < p.length - 1 && p[k].isZero()) k++; return p.slice(k); };
function pSub(a, b) { const n = Math.max(a.length, b.length); const A = Array(n - a.length).fill(new Q(0n)).concat(a), B = Array(n - b.length).fill(new Q(0n)).concat(b); return pTrim(A.map((x, k) => x.sub(B[k]))); }
function pAdd(a, b) { const n = Math.max(a.length, b.length); const A = Array(n - a.length).fill(new Q(0n)).concat(a), B = Array(n - b.length).fill(new Q(0n)).concat(b); return pTrim(A.map((x, k) => x.add(B[k]))); }
function pMul(a, b) { const out = Array(a.length + b.length - 1).fill(null).map(() => new Q(0n)); for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] = out[i + j].add(a[i].mul(b[j])); return pTrim(out); }
function pDivMod(a, b) {
  a = pTrim(a); b = pTrim(b);
  if (a.length < b.length) return [[new Q(0n)], a];
  const q = Array(a.length - b.length + 1).fill(null).map(() => new Q(0n)); let r = a.slice();
  for (let k = 0; k <= a.length - b.length; k++) { const c = r[k].div(b[0]); q[k] = c; for (let j = 0; j < b.length; j++) r[k + j] = r[k + j].sub(c.mul(b[j])); }
  r = pTrim(r.slice(a.length - b.length + 1).length ? r.slice(a.length - b.length + 1) : [new Q(0n)]);
  return [pTrim(q), r];
}
const pIsZero = (p) => p.every(c => c.isZero());
function pGcd(a, b) { a = pTrim(a); b = pTrim(b); while (!pIsZero(b)) { const [, r] = pDivMod(a, b); a = b; b = r; } const lc = a[0]; return a.map(c => c.div(lc)); }
function pToStr(p, v) {
  const parts = [];
  p.forEach((c, k) => { const d = p.length - 1 - k; if (c.isZero()) return; parts.push(`(${c})*${v}^${d}`); });
  return parts.length ? parts.join('+') : '0';
}
function polyEval(p, x) { return p.reduce((s, c) => s * x + c.val(), 0); }

// rational-function representation of an expression in one variable
function ratOf(node, v) {
  // returns {n: poly, d: poly} or null
  switch (node.k) {
    case 'num': return { n: [node.q], d: [new Q(1n)] };
    case 'sym': return node.name === v ? { n: [new Q(1n), new Q(0n)], d: [new Q(1n)] } : null;
    case 'neg': { const r = ratOf(node.e, v); return r && { n: r.n.map(c => c.neg()), d: r.d }; }
    case 'add': { let acc = { n: [new Q(0n)], d: [new Q(1n)] }; for (const t of node.terms) { const r = ratOf(t, v); if (!r) return null; acc = { n: pAdd(pMul(acc.n, r.d), pMul(r.n, acc.d)), d: pMul(acc.d, r.d) }; } return acc; }
    case 'mul': { let acc = { n: [new Q(1n)], d: [new Q(1n)] }; for (const f of node.factors) { const r = ratOf(f, v); if (!r) return null; acc = { n: pMul(acc.n, r.n), d: pMul(acc.d, r.d) }; } return acc; }
    case 'pow': {
      if (node.e.k !== 'num' || !node.e.q.isInt()) { if (node.e.k === 'neg' && node.e.e.k === 'num' && node.e.e.q.isInt()) return ratOf({ k: 'pow', b: node.b, e: { k: 'num', q: node.e.e.q.neg() } }, v); return null; }
      const k = Number(node.e.q.n); const r = ratOf(node.b, v); if (!r) return null;
      let n = [new Q(1n)], d = [new Q(1n)];
      for (let j = 0; j < Math.abs(k); j++) { n = pMul(n, r.n); d = pMul(d, r.d); }
      return k >= 0 ? { n, d } : { n: d, d: n };
    }
  }
  return null;
}
function reduceRat(r) {
  const g = pGcd(r.n, r.d);
  let n = pDivMod(r.n, g)[0], d = pDivMod(r.d, g)[0];
  // integer content normalisation
  const all = [...n, ...d].filter(c => !c.isZero());
  let lcmD = 1n; for (const c of all) lcmD = lcmD * c.d / bgcd(lcmD, c.d);
  n = n.map(c => c.mul(new Q(lcmD))); d = d.map(c => c.mul(new Q(lcmD)));
  let g2 = 0n; for (const c of [...n, ...d]) g2 = bgcd(g2, c.n);
  if (g2 > 1n) { n = n.map(c => c.div(new Q(g2))); d = d.map(c => c.div(new Q(g2))); }
  if (d[0].sign() < 0) { n = n.map(c => c.neg()); d = d.map(c => c.neg()); }
  return { n, d };
}

// ---------------- symbolic helpers ----------------
function nd(s) { return nerdamer(s); }
function canon(s) {
  s = s.replace(/\u0001/g, '').replace(/(\d) \+ ([\d.]+)i/g, '$1+$2*i');
  try { return nd(s).toString(); } catch (e) { throw new MError(`Invalid symbolic expression: ${e.message}`); }
}
export function numToSym(x) {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? 'NaN' : x > 0 ? 'Infinity' : '-Infinity';
  if (Number.isInteger(x)) return String(x);
  // multiple of pi?
  const pk = x / Math.PI;
  for (const d of [1, 2, 3, 4, 6, 8, 12]) { const n = Math.round(pk * d); if (n !== 0 && Math.abs(pk * d - n) < 1e-12) return `(${n}/${d})*pi`; }
  // rational approximation
  let h1 = 1, h0 = 0, k1 = 0, k0 = 1, y = x;
  for (let it = 0; it < 30; it++) {
    const a = Math.floor(y); const h = a * h1 + h0, k = a * k1 + k0;
    if (Math.abs(x - h / k) <= 1e-14 * Math.abs(x) && k < 1e9) return `(${h}/${k})`;
    const f = y - a; if (f === 0) break; y = 1 / f; h0 = h1; h1 = h; k0 = k1; k1 = k;
  }
  return Q.of(x).toString();
}
function valToSymStr(v) {
  if (v.type === 'sym') { if (v.numel !== 1) throw new MError('Expected a scalar symbolic expression.'); return v.exprs[0]; }
  if (v.type === 'num') {
    if (v.cls === 'char') return toStr(v);
    if (v.numel !== 1) throw new MError('Expected a scalar.');
    if (v.im && v.im[0] !== 0) return `(${numToSym(v.re[0])}+${numToSym(v.im[0])}*i)`;
    return numToSym(v.re[0]);
  }
  if (v.type === 'string') return v.data[0];
  throw new MError(`Conversion to sym from ${className(v)} is not possible.`);
}
function toSymArray(v) {
  if (v.type === 'sym') return v;
  if (v.type === 'num' && v.cls !== 'char') return new Sym(Array.from(v.re, (x, k) => (v.im && v.im[k] ? `(${numToSym(x)}+${numToSym(v.im[k])}*i)` : numToSym(x))), v.rows, v.cols);
  return new Sym([valToSymStr(v)]);
}
const mk = (e, rows = 1, cols = 1) => new Sym(Array.isArray(e) ? e : [e], rows, cols);
function symVars(e) { try { return nd(e).variables().filter(x => x !== 'i' && x !== 'e' && x !== 'pi').sort(); } catch (err) { return []; } }
function defaultVar(e) {
  const vars = symVars(e);
  if (!vars.length) return 'x';
  if (vars.includes('x')) return 'x';
  // MATLAB symvar(f,1): closest to x alphabetically
  return vars.slice().sort((a, b) => Math.abs(a.charCodeAt(0) - 120) - Math.abs(b.charCodeAt(0) - 120) || (a < b ? 1 : -1))[0];
}
function evalNumeric(e, subsMap = {}) {
  let s = e;
  try {
    const r = nd(s).evaluate(subsMap).text('decimals');
    return parseComplex(r);
  } catch (err) { return [NaN, 0]; }
}
function parseComplex(r) {
  r = r.replace(/\s/g, '');
  if (r === 'Infinity') return [Infinity, 0]; if (r === '-Infinity') return [-Infinity, 0];
  const n = Number(r); if (!Number.isNaN(n)) return [n, 0];
  // forms: a+b*i, b*i, i
  const m = r.match(/^([-+]?[\d.e+-]+?)?([-+]?[\d.e+-]*)\*?i$/);
  if (m) { const re = m[1] ? Number(m[1]) : 0; const ims = m[2] === '' || m[2] === '+' ? '1' : m[2] === '-' ? '-1' : m[2]; return [re, Number(ims)]; }
  try { const v = Function('"use strict"; const sqrt=Math.sqrt, pi=Math.PI, e=Math.E, abs=Math.abs, exp=Math.exp, log=Math.log, sin=Math.sin, cos=Math.cos, tan=Math.tan, atan=Math.atan, Infinity_=Infinity; return (' + r.replace(/\^/g, '**') + ');')(); if (typeof v === 'number') return [v, 0]; } catch (e2) { /* */ }
  return [NaN, 0];
}

// ---------------- solving ----------------
function rationalRoots(p) {
  // p: array of Q (integer-izable). returns {roots: [Q], rest: poly}
  let lcm = 1n; for (const c of p) lcm = lcm * c.d / bgcd(lcm, c.d);
  let ip = p.map(c => c.mul(new Q(lcm)));
  const roots = [];
  // zero roots
  while (ip.length > 1 && ip[ip.length - 1].isZero()) { roots.push(new Q(0n)); ip = ip.slice(0, -1); }
  const divisors = (n) => { n = babs(n); const out = []; for (let d = 1n; d * d <= n && d < 100000n; d++) if (n % d === 0n) { out.push(d); out.push(n / d); } return out; };
  let changed = true;
  while (changed && ip.length > 2) {
    changed = false;
    const a0 = ip[ip.length - 1].n, an = ip[0].n;
    const cands = [];
    for (const pq of divisors(a0)) for (const qq of divisors(an)) { cands.push(new Q(pq, qq)); cands.push(new Q(-pq, qq)); }
    for (const c of cands) {
      // horner exact
      let acc = new Q(0n); for (const k of ip) acc = acc.mul(c).add(k);
      if (acc.isZero()) { roots.push(c); ip = pDivMod(ip, [new Q(1n), c.neg()])[0]; changed = true; break; }
    }
  }
  return { roots, rest: ip };
}
function sqrtQStr(q) {
  // returns string for sqrt(q), simplified when perfect squares
  if (q.sign() < 0) return `${sqrtQStr(q.neg())}*i`;
  const isq = (n) => { if (n < 0n) return null; let x = BigInt(Math.floor(Math.sqrt(Number(n)))); while (x * x > n) x--; while ((x + 1n) * (x + 1n) <= n) x++; return x * x === n ? x : null; };
  const a = isq(q.n), b = isq(q.d);
  if (a !== null && b !== null) return new Q(a, b).toString();
  return `sqrt(${q})`;
}
function solvePolyExact(p, v) {
  const { roots, rest } = rationalRoots(p);
  const out = roots.map(r => `(${r})`);
  if (rest.length === 2) out.push(`(${rest[1].neg().div(rest[0])})`);
  else if (rest.length === 3) {
    const [a, b, c] = rest; const D = b.mul(b).sub(new Q(4n).mul(a).mul(c));
    const m = b.neg().div(new Q(2n).mul(a)); const sq = sqrtQStr(D.div(new Q(4n).mul(a).mul(a)));
    if (D.isZero()) { out.push(`(${m})`, `(${m})`); }
    else { out.push(`(${m})-(${sq})`, `(${m})+(${sq})`); }
  } else if (rest.length > 3) {
    // numeric fallback
    const coeffs = rest.map(c => c.val());
    const nr = numericRoots(coeffs);
    for (const [re, im] of nr) out.push(im === 0 ? String(re) : `(${re}+(${im})*i)`);
  }
  return out.map(canon);
}
function numericRoots(coeffs) {
  // Durand-Kerner
  const n = coeffs.length - 1; const a = coeffs.map(c => c / coeffs[0]);
  let z = Array.from({ length: n }, (_, k) => [Math.cos(2 * Math.PI * k / n + 0.4) * 0.9, Math.sin(2 * Math.PI * k / n + 0.4) * 0.9]);
  const mul = (p, q) => [p[0] * q[0] - p[1] * q[1], p[0] * q[1] + p[1] * q[0]];
  const div = (p, q) => { const d = q[0] * q[0] + q[1] * q[1]; return [(p[0] * q[0] + p[1] * q[1]) / d, (p[1] * q[0] - p[0] * q[1]) / d]; };
  for (let it = 0; it < 500; it++) {
    z = z.map((zi, i) => { let f = [1, 0]; for (let k = 1; k <= n; k++) { f = mul(f, zi); f[0] += a[k]; } let den = [1, 0]; z.forEach((zj, j) => { if (j !== i) den = mul(den, [zi[0] - zj[0], zi[1] - zj[1]]); }); const d = div(f, den); return [zi[0] - d[0], zi[1] - d[1]]; });
  }
  return z.map(([r, i]) => [r, Math.abs(i) < 1e-10 ? 0 : i]).sort((p, q) => p[0] - q[0]);
}
function solveOne(eqStr, v) {
  // eqStr: expression == 0
  const p = polyFromExpr(eqStr, v);
  if (p && p.length >= 2) return solvePolyExact(pTrim(p), v);
  // quadratic with symbolic coefficients
  try {
    const coeffs = nd(`coeffs(${nd(`expand(${eqStr})`)}, ${v})`).toString();
    const cs = coeffs.slice(1, -1).split(',');
    if (cs.length === 3) {
      const [c, b, a] = cs.map(s => `(${s})`);
      return [`-(${b}+sqrt(${b}^2-4*${a}*${c}))/(2*${a})`, `-(${b}-sqrt(${b}^2-4*${a}*${c}))/(2*${a})`].map(s => s.replace(/\s/g, ''));
    }
    if (cs.length === 2) { const [c, b] = cs; return [canon(`-(${c})/(${b})`)]; }
  } catch (e) { /* fall through */ }
  try {
    const r = nerdamer.solve(eqStr, v).toString();
    const items = r.replace(/^\[|\]$/g, '');
    if (!items) return [];
    return splitTop(items);
  } catch (e) { throw new MError(`Unable to solve: ${e.message}`); }
}
function splitTop(s) { const out = []; let depth = 0, cur = ''; for (const c of s) { if (c === '(' || c === '[') depth++; if (c === ')' || c === ']') depth--; if (c === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += c; } if (cur) out.push(cur); return out; }

// manual inverse for finverse
const INV = { sin: 'asin', asin: 'sin', cos: 'acos', acos: 'cos', tan: 'atan', atan: 'tan', exp: 'log', log: 'exp', sinh: 'asinh', asinh: 'sinh', cosh: 'acosh', tanh: 'atanh', atanh: 'tanh' };
function invertNode(n, v, y) {
  // returns string x = g(y) inverting expression n(v) = y
  if (n.k === 'sym' && n.name === v) return y;
  if (n.k === 'fn' && INV[n.name] && n.args.length === 1) return invertNode(n.args[0], v, `${INV[n.name]}(${y})`);
  if (n.k === 'fn' && n.name === 'sqrt') return invertNode(n.args[0], v, `(${y})^2`);
  if (n.k === 'pow') {
    if (n.b.k === 'sym' && n.b.name === 'e') return invertNode(n.e, v, `log(${y})`);
    if (n.e.k === 'num') return invertNode(n.b, v, `(${y})^(${new Q(1n).div(n.e.q)})`);
  }
  if (n.k === 'neg') return invertNode(n.e, v, `-(${y})`);
  if (n.k === 'mul' || n.k === 'add') {
    const items = n.k === 'mul' ? n.factors : n.terms;
    const has = (nn) => nn && typeof nn === 'object' && (nn.k === 'sym' && nn.name === v || Object.values(nn).some(c => (Array.isArray(c) ? c.some(has) : has(c))));
    const dep = items.filter(has);
    if (dep.length !== 1) return null;
    const rest = items.filter(it => it !== dep[0]).map(it => `(${printNode(it)})`);
    if (!rest.length) return invertNode(dep[0], v, y);
    return invertNode(dep[0], v, n.k === 'mul' ? `(${y})/(${rest.join('*')})` : `(${y})-(${rest.join('+')})`);
  }
  return null;
}

// ---------------- dsolve ----------------
function parseODE(eq, indep) {
  // normalise derivative notation to placeholders
  let s = eq.replace(/\s/g, '').replace(/d__(\w+?)__(\d+)/g, 'D$2$1');
  // new syntax: diff(y(t),t,2) / diff(y(t),t)
  s = s.replace(/diff\((\w+)\(\w+\),\w+,(\d+)\)/g, 'D$2$1').replace(/diff\((\w+)\(\w+\),\w+\)/g, 'D$1').replace(/diff\((\w+)\(\w+\),\w+\)/g, 'D$1');
  s = s.replace(/(\w+)\((\w+)\)/g, (m, f, a) => (a === indep ? f : m));
  return s.replace('==', '=');
}
function dsolveImpl(eqs, conds, indep) {
  const eq = parseODE(eqs[0], indep);
  const m = eq.match(/D(\d*)([A-Za-z]\w*)/);
  if (!m) throw new MError('Unable to find the dependent variable in the differential equation.', '', 'dsolve');
  const y = m[2]; const order = m[1] ? +m[1] : 1;
  const sides = eq.split('='); if (sides.length !== 2) throw new MError('Invalid equation.', '', 'dsolve');
  const expr0 = `(${sides[0]})-(${sides[1]})`;
  const P = (k) => (k === 0 ? 'YY' : `DY${k}`);
  let e = expr0.replace(new RegExp(`D(\\d+)${y}\\b`, 'g'), (mm, k) => P(+k)).replace(new RegExp(`D${y}\\b`, 'g'), P(1)).replace(new RegExp(`\\b${y}\\b`, 'g'), 'YY');
  let sol = null;
  if (order === 1) {
    // solve for DY1 = F(t, YY)
    let F;
    try { const r = nerdamer.solve(e, 'DY1').toString(); F = splitTop(r.replace(/^\[|\]$/g, ''))[0]; } catch (err) { F = null; }
    if (!F) throw new MError('Unable to solve the differential equation.', '', 'dsolve');
    F = canon(F);
    const vars = symVars(F);
    const hasY = vars.includes('YY'), hasT = vars.includes(indep);
    // linear: F = a*YY + b(t) with a constant
    const a = canon(nerdamer.diff(F, 'YY').toString());
    const aVars = symVars(a);
    if (!hasY) sol = `${canon(nerdamer.integrate(F, indep).toString())}+C1`;
    else if (!aVars.includes('YY') && !aVars.includes(indep) && hasY) {
      const b = canon(`${F}-(${a})*YY`);
      if (!symVars(b).includes(indep)) sol = a === '0' ? `C1` : `C1*e^((${a})*${indep})-(${b})/(${a})`;
      else { const integrand = canon(`(${b})*e^(-(${a})*${indep})`); sol = `e^((${a})*${indep})*(${canon(nerdamer.integrate(integrand, indep).toString())}+C1)`; }
    } else {
      // separable: F = g(t)*h(Y)
      const h = canon(F.replace(/\bt\b/g, '1').split(indep).join('(1)'));
      let g = null;
      try { g = canon(`(${F})/(${h})`); } catch (err) { g = null; }
      if (g !== null && !symVars(g).includes('YY')) {
        const G = canon(nerdamer.integrate(g, indep).toString());
        const H = canon(nerdamer.integrate(`1/(${h})`, 'YY').toString());
        const inv = invertNode(parseExpr(H), 'YY', `(${G}+C1)`);
        if (!inv) throw new MError('Explicit solution could not be found.', '', 'dsolve');
        sol = inv;
      } else throw new MError('Explicit solution could not be found.', '', 'dsolve');
    }
  } else if (order === 2) {
    // a*DY2 + b*DY1 + c*YY = 0 (constant coefficients)
    const ex = canon(`expand(${e})`);
    const A = canon(nerdamer.diff(ex, 'DY2').toString()), B = canon(nerdamer.diff(ex, 'DY1').toString()), C = canon(nerdamer.diff(ex, 'YY').toString());
    const rest = canon(`${ex}-(${A})*DY2-(${B})*DY1-(${C})*YY`);
    if (rest !== '0' || [A, B, C].some(z => symVars(z).length)) throw new MError('Only linear constant-coefficient homogeneous second-order equations are supported.', '', 'dsolve');
    const a = Number(A), b = Number(B), c = Number(C); const D = b * b - 4 * a * c;
    if (D > 0) { const r1 = numToSym((-b + Math.sqrt(D)) / (2 * a)), r2 = numToSym((-b - Math.sqrt(D)) / (2 * a)); sol = `C1*e^((${r1})*${indep})+C2*e^((${r2})*${indep})`; }
    else if (D === 0) { const r = numToSym(-b / (2 * a)); sol = `(C1+C2*${indep})*e^((${r})*${indep})`; }
    else { const al = numToSym(-b / (2 * a)), be = numToSym(Math.sqrt(-D) / (2 * a)); sol = `e^((${al})*${indep})*(C1*cos((${be})*${indep})+C2*sin((${be})*${indep}))`; }
  } else throw new MError('Only first and second order differential equations are supported.', '', 'dsolve');
  sol = canon(sol.replace(/YY/g, y));
  // apply initial conditions
  const consts = ['C1', 'C2'].filter(c => symVars(sol).includes(c));
  const eqsC = [];
  for (const cond of conds) {
    const cs = parseODE(cond, indep).replace(/\s/g, '');
    const mm = cs.match(/^(D?)(\d*)([A-Za-z]\w*)\(([^)]+)\)=(.+)$/) || cs.match(/^(D?)(\d*)([A-Za-z]\w*)\(([^)]+)\)==(.+)$/);
    if (!mm) continue;
    const k = mm[1] ? (mm[2] ? +mm[2] : 1) : 0;
    let expr = sol; for (let q = 0; q < k; q++) expr = nerdamer.diff(expr, indep).toString();
    eqsC.push([canon(nd(expr).sub(indep, mm[4]).toString()), mm[5]]);
  }
  if (eqsC.length && consts.length) {
    let vals = {};
    try {
      if (consts.length === 1) {
        const [lhs, rhs] = eqsC[0];
        let inv = null; try { inv = invertNode(parseExpr(lhs), 'C1', `(${rhs})`); } catch (e2) { inv = null; }
        vals.C1 = inv ? canon(inv) : solveOne(canon(`(${lhs})-(${rhs})`), 'C1')[0];
      }
      else {
        // linear system in C1, C2: a11*C1 + a12*C2 = b1 ...
        const rows = eqsC.map(([l, r]) => {
          const e = canon(`(${l})-(${r})`);
          const a1 = evalNumeric(canon(nerdamer.diff(e, 'C1').toString()))[0], a2 = evalNumeric(canon(nerdamer.diff(e, 'C2').toString()))[0];
          const b = -evalNumeric(canon(nd(e).sub('C1', '0').sub('C2', '0').toString()))[0];
          return [a1, a2, b];
        });
        const [[a, b, e1], [c, d, e2]] = rows; const det = a * d - b * c;
        if (Math.abs(det) < 1e-14) throw new Error('singular');
        vals.C1 = numToSym((e1 * d - b * e2) / det); vals.C2 = numToSym((a * e2 - e1 * c) / det);
      }
    } catch (err) { if (process.env.DBG) console.log(err); throw new MError('Unable to apply the initial conditions.', '', 'dsolve'); }
    for (const [cn, cv] of Object.entries(vals)) sol = nd(sol).sub(cn, `(${cv})`).toString();
    sol = canon(sol);
    // tidy atan(1) etc.
    sol = sol.replace(/atan\(1\)/g, '(pi/4)');
    sol = canon(sol);
  }
  return sol;
}

export function installSym(I) {
  const R = (name, fn, opts) => I.register(name, fn, opts);
  const symOf = (v) => toSymArray(v);
  setSymPrinter(prettySym);
  I.symToStr = prettySym;

  setSymHook((op, a, b) => {
    if (op === 'transpose') return new Sym(transposeArr(a.exprs, a.rows, a.cols), a.cols, a.rows);
    if (op === 'u-') return mapSym(a, (e) => canon(`-(${e})`));
    if (op === 'u+') return a;
    if (op === 'u~') throw new MError("Operator '~' is not supported for symbolic expressions.");
    const A = symOf(a), B = symOf(b);
    if (op === '==' || op === '~=') {
      // equation object for solve/dsolve; numeric compare when both evaluate
      return mapSym2(A, B, (x, y) => `${x}=${y}`, true);
    }
    if (['<', '>', '<=', '>='].includes(op)) {
      const r = mapSym2(A, B, (x, y) => { const [u] = evalNumeric(x), [w] = evalNumeric(y); return ({ '<': u < w, '>': u > w, '<=': u <= w, '>=': u >= w })[op] ? '1' : '0'; });
      return new Tensor(r.rows, r.cols, Float64Array.from(r.exprs, Number), null, 'logical');
    }
    const ops = { '+': '+', '-': '-', '.*': '*', './': '/', '.\\': '\\', '.^': '^', '*': '*', '/': '/', '^': '^', '\\': '\\' };
    if ((op === '*' || op === '/' || op === '^') && (A.numel > 1 && B.numel > 1)) {
      if (op === '*') return symMatMul(A, B);
      throw new MError('Symbolic matrix division/power is not supported here.');
    }
    if (op === '\\' || op === '.\\') return mapSym2(B, A, (x, y) => canon(`(${x})/(${y})`));
    return mapSym2(A, B, (x, y) => canon(`(${x})${ops[op]}(${y})`));
  });
  function transposeArr(ex, r, c) { const out = new Array(r * c); for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) out[i * c + j] = ex[j * r + i]; return out; }
  function mapSym(a, f) { return new Sym(a.exprs.map(f), a.rows, a.cols); }
  function mapSym2(A, B, f) {
    if (A.numel === 1) return new Sym(B.exprs.map(y => f(A.exprs[0], y)), B.rows, B.cols);
    if (B.numel === 1) return new Sym(A.exprs.map(x => f(x, B.exprs[0])), A.rows, A.cols);
    if (A.rows !== B.rows || A.cols !== B.cols) throw new MError('Arrays have incompatible sizes for this operation.');
    return new Sym(A.exprs.map((x, k) => f(x, B.exprs[k])), A.rows, A.cols);
  }
  function symMatMul(A, B) {
    if (A.cols !== B.rows) throw new MError('Inner matrix dimensions must agree.');
    const out = [];
    for (let j = 0; j < B.cols; j++) for (let i = 0; i < A.rows; i++) { const terms = []; for (let k = 0; k < A.cols; k++) terms.push(`(${A.exprs[k * A.rows + i]})*(${B.exprs[j * B.rows + k]})`); out[j * A.rows + i] = canon(terms.join('+')); }
    return new Sym(out, A.rows, B.cols);
  }
  I.symCat = (vals, dim) => {
    const S = vals.map(symOf);
    if (dim === 2) { const R0 = S[0].rows; if (S.some(s => s.rows !== R0)) throw new MError('Dimensions of arrays being concatenated are not consistent.', '', 'horzcat'); return new Sym(S.flatMap(s => s.exprs), R0, S.reduce((n, s) => n + s.cols, 0)); }
    const C0 = S[0].cols; if (S.some(s => s.cols !== C0)) throw new MError('Dimensions of arrays being concatenated are not consistent.', '', 'vertcat');
    const rows = S.reduce((n, s) => n + s.rows, 0); const out = new Array(rows * C0); let off = 0;
    for (const s of S) { for (let j = 0; j < C0; j++) for (let i = 0; i < s.rows; i++) out[j * rows + off + i] = s.exprs[j * s.rows + i]; off += s.rows; }
    return new Sym(out, rows, C0);
  };
  I.symIndex = (v, args) => {
    const fname = v.numel === 1 ? v.exprs[0] : null;
    if (fname && FUNS.has(fname)) {
      // y(0) on a symbolic function
      if (args.every(x => x.type === 'num' || x.type === 'sym')) return mk(`${fname}(${args.map(valToSymStr).join(',')})`);
    }
    const idx = Array.from({ length: v.numel }, (_, k) => k + 1);
    const t = new Tensor(v.rows, v.cols, Float64Array.from(idx));
    const r = I.builtins.get('__subsref').fn([t, ...args]);
    return new Sym(Array.from(r.re, k => v.exprs[k - 1]), r.rows, r.cols);
  };
  I.symAssign = (base, args, value) => {
    const B = base.type === 'sym' ? base : symOf(base.numel ? base : new Tensor(0, 0, new Float64Array(0)));
    const idx = new Tensor(B.rows, B.cols, Float64Array.from(B.exprs.map((_, k) => k + 1)));
    const marker = -1;
    const V = symOf(value);
    const tmp = I.builtins.get('__subsasgn').fn([idx, new Tensor(V.rows, V.cols, Float64Array.from(V.exprs.map((_, k) => -(k + 1)))), ...args]);
    const out = Array.from(tmp.re, x => (x < 0 ? V.exprs[-x - 1] : x === 0 ? '0' : B.exprs[x - 1]));
    void marker;
    return new Sym(out, tmp.rows, tmp.cols);
  };
  I.symToDouble = (v, cls) => {
    const t = new Tensor(v.rows, v.cols, new Float64Array(v.numel), null);
    let im = null;
    v.exprs.forEach((e, k) => {
      if (symVars(e).length) throw new MError(`Unable to convert expression containing symbolic variables into double array. Apply 'subs' function first to substitute values for variables.`, '', 'double');
      const [re, ii] = evalNumeric(e); t.re[k] = re; if (ii) { im = im || new Float64Array(v.numel); im[k] = ii; }
    });
    t.im = im;
    return cls && cls !== 'double' ? I.builtins.get(cls).fn([t]) : t;
  };
  I.symToFunc = (f, nargs) => {
    const e = f.exprs[0];
    const vars = symVars(e);
    let fn;
    try { fn = nd(e).buildFunction(vars.length ? vars : ['x']); } catch (err) { fn = null; }
    return (...xs) => {
      const vals = xs.map(x => x);
      const n = Math.max(...vals.map(v => v.numel));
      const out = new Tensor(vals[0].rows, vals[0].cols, new Float64Array(n));
      for (let k = 0; k < n; k++) {
        const args = vals.map(v => v.re[v.numel === 1 ? 0 : k]);
        out.re[k] = fn ? fn(...args) : evalNumeric(e, Object.fromEntries(vars.map((vn, q) => [vn, args[q]])))[0];
      }
      return out;
    };
  };
  I.symFunc = (name, a) => {
    const v = symOf(a[0]);
    const fmap = { sqrt: 'sqrt', exp: 'exp', log: 'log', sin: 'sin', cos: 'cos', tan: 'tan', asin: 'asin', acos: 'acos', atan: 'atan', abs: 'abs', sinh: 'sinh', cosh: 'cosh', tanh: 'tanh', log10: 'log10', sign: 'sign', floor: 'floor', ceil: 'ceil', round: 'round', fix: 'trunc', factorial: 'factorial', sec: 'sec', csc: 'csc', cot: 'cot', real: 're', imag: 'im', conj: 'conj', erf: 'erf' };
    if (name === 'diff') return symDiff(a);
    if (name === 'factor') return symFactor(a);
    if (name === 'sum') return mk(canon(v.exprs.map(e => `(${e})`).join('+')));
    if (name === 'mean') return mk(canon(`(${v.exprs.map(e => `(${e})`).join('+')})/${v.numel}`));
    if (name === 'det') return mk(canon(symDet(v)));
    if (name === 'inv') return symInv(v);
    if (!fmap[name]) throw new MError(`Undefined function '${name}' for input arguments of type 'sym'.`);
    return mapSym(v, (e) => canon(`${fmap[name]}(${e})`));
  };
  function symDet(v) {
    if (v.rows !== v.cols) throw new MError('Matrix must be square.');
    const n = v.rows; const M = (i, j) => v.exprs[j * n + i];
    const det = (rows, cols) => { if (rows.length === 1) return M(rows[0], cols[0]); let terms = []; cols.forEach((c, k) => { const sub = det(rows.slice(1), cols.filter(x => x !== c)); terms.push(`${k % 2 ? '-' : '+'}(${M(rows[0], c)})*(${sub})`); }); return terms.join(''); };
    return det([...Array(n).keys()], [...Array(n).keys()]);
  }
  function symInv(v) {
    const n = v.rows; const d = symDet(v);
    const out = new Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const sub = new Sym([], n - 1, n - 1); const ex = [];
      for (let c = 0; c < n; c++) if (c !== i) for (let r = 0; r < n; r++) if (r !== j) ex.push(v.exprs[c * n + r]);
      sub.exprs = ex; const cof = n === 1 ? '1' : symDet(sub);
      out[j + i * n] = canon(`${(i + j) % 2 ? '-' : ''}(${cof})/(${d})`);
    }
    return new Sym(out, n, n);
  }

  // ---------- construction ----------
  R('syms', (a, nout, ctx) => {
    const names = []; let assume = null;
    for (const x of a) {
      const s = toStr(x);
      if (['real', 'positive', 'integer', 'rational', 'clear', 'nonnegative'].includes(s)) { assume = s; continue; }
      const fm = s.match(/^([A-Za-z]\w*)\(([\w,]+)\)$/);
      if (fm) { FUNS.set(fm[1], fm[2]); names.push([fm[1], fm[1]]); for (const arg of fm[2].split(',')) names.push([arg, arg]); continue; }
      if (!/^[A-Za-z]\w*$/.test(s)) throw new MError(`Invalid variable name '${s}'.`, '', 'syms');
      names.push([s, s]);
    }
    for (const [n, e] of names) { const v = mk(e); if (FUNS.has(e)) v.isFun = true; else FUNS.delete(e); if (assume) v.assume = assume; I.setVar(ctx.frame, n, v); }
    if (nout) return new Sym(names.map(x => x[1]), 1, names.length);
  });
  R('sym', (a) => {
    const v = a[0];
    if (isStr(v)) {
      const s = toStr(v).trim();
      if (/^[A-Za-z]\w*$/.test(s)) return mk(s);
      try { return mk(canon(s.replace(/\*\*/g, '^'))); } catch (e) { throw new MError(`Invalid symbolic expression '${s}'.`, '', 'sym'); }
    }
    if (v.type === 'sym') return v;
    if (v.type === 'num') return toSymArray(v);
    throw new MError(`Conversion to sym from ${className(v)} is not possible.`, '', 'sym');
  });
  R('str2sym', (a) => mk(canon(toStr(a[0]))));
  R('symfun', (a) => a[0]);
  R('vpa', (a) => {
    const v = symOf(a[0]); const d = a.length > 1 ? toNumber(a[1]) : 32;
    return mapSym(v, (e) => { const [re, im] = evalNumeric(e); if (Number.isNaN(re)) return e; const s = (x) => (Number.isInteger(x) ? String(x) : x.toPrecision(Math.min(d, 16)).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')); return '\u0001' + (im ? `${s(re)} + ${s(im)}i` : s(re)); });
  });
  R('digits', () => num(32));
  R('assume', () => {}); R('assumeAlso', () => {});
  R('findsym', (a) => { const v = symOf(a[0]); const vars = [...new Set(v.exprs.flatMap(symVars))].sort(); return str(vars.join(',')); });
  R('symvar', (a) => { const v = symOf(a[0]); const vars = [...new Set(v.exprs.flatMap(symVars))].sort(); return new Sym(vars, 1, vars.length); });
  R('pretty', (a) => { I.write('  ' + symOf(a[0]).exprs.map(prettySym).join('\n  ') + '\n\n'); });
  R('latex', (a) => str(nd(symOf(a[0]).exprs[0]).toTeX()));
  R('isAlways', (a) => { const e = symOf(a[0]).exprs[0]; const [l, r] = e.split('='); return num(canon(`(${l})-(${r ?? 0})`) === '0' ? 1 : 0); });

  // ---------- algebra ----------
  R('expand', (a) => mapSym(symOf(a[0]), (e) => canon(nd(`expand(${e})`).toString())));
  R('collect', (a) => mapSym(symOf(a[0]), (e) => canon(nd(`expand(${e})`).toString())));
  R('simplify', (a) => mapSym(symOf(a[0]), simplifyExpr));
  R('simple', (a) => mapSym(symOf(a[0]), simplifyExpr));
  R('horner', (a) => a[0]);
  function simplifyExpr(e) {
    const cands = [e];
    try { cands.push(canon(nd(`expand(${e})`).toString())); } catch (x) { /* */ }
    try { const v = defaultVar(e); const r = ratOf(parseExpr(e), v); if (r) { const rr = reduceRat(r); const [q, rem] = pDivMod(rr.n, rr.d); if (pIsZero(rem)) cands.push(canon(pToStr(q, v))); else if (rr.d.length > 1) cands.push(canon(`(${pToStr(rr.n, v)})/(${pToStr(rr.d, v)})`)); } } catch (x) { /* */ }
    try { const s = canon(nd(`simplify(${e})`).toString()); const ok = symVars(e).length === 0 || Math.abs(evalNumeric(s, { [defaultVar(e)]: 0.731 })[0] - evalNumeric(e, { [defaultVar(e)]: 0.731 })[0]) < 1e-9; if (ok) cands.push(s); } catch (x) { /* */ }
    // trig identities
    cands.push(e.replace(/sin\((\w+)\)\^2\+cos\(\1\)\^2/g, '1'));
    let best = e, bl = Infinity;
    for (const c of cands) { const l = prettySym(c).length; if (l < bl) { best = c; bl = l; } }
    return best;
  }
  function symFactor(a) {
    const v = symOf(a[0]);
    if (v.numel !== 1) throw new MError('Input must be a scalar.', '', 'factor');
    const e = v.exprs[0];
    let f;
    try { f = nd(`factor(${e})`).toString(); } catch (x) { return v; }
    // split top-level product into factor list (R2021b returns a vector)
    let node; try { node = parseExpr(f); } catch (x) { return mk(f); }
    const terms = toTerms(node);
    if (terms.length !== 1) return mk(canon(f));
    const t = terms[0]; const items = [];
    if (!t.coef.isOne()) items.push(t.coef.toString());
    for (const fac of t.factors) {
      if (fac.e instanceof Q && fac.e.isInt() && fac.e.sign() > 0) { for (let k = 0n; k < fac.e.n; k++) items.push(canon(printNodeRaw(fac.b))); }
      else items.push(canon(`(${printNodeRaw(fac.b)})^(${fac.e instanceof Q ? fac.e : printNodeRaw(fac.e)})`));
    }
    // normalise sign: factors like (-4+4*s+s^2)
    return new Sym(items.length ? items : ['1'], 1, Math.max(1, items.length));
  }
  function printNodeRaw(n) { return prettySym(printNode(n)).replace(/ /g, ''); }
  R('numden', (a) => {
    const e = symOf(a[0]).exprs[0];
    const v = defaultVar(e);
    let r = null; try { r = ratOf(parseExpr(e), v); } catch (x) { r = null; }
    if (r) { const rr = reduceRat(r); return [mk(canon(pToStr(rr.n, v))), mk(canon(pToStr(rr.d, v)))]; }
    // generic split
    const node = parseExpr(e); const terms = toTerms(node);
    if (terms.length === 1) { const t = terms[0]; const n = [t.coef.n.toString()], d = [t.coef.d.toString()]; for (const f of t.factors) { if (f.e instanceof Q && f.e.sign() < 0) d.push(`(${printNodeRaw(f.b)})^(${f.e.neg()})`); else n.push(`(${printNodeRaw(f.b)})^(${f.e instanceof Q ? f.e : printNodeRaw(f.e)})`); } return [mk(canon(n.join('*'))), mk(canon(d.join('*')))]; }
    return [mk(e), mk('1')];
  });
  R('sym2poly', (a) => {
    const e = symOf(a[0]).exprs[0]; const v = defaultVar(e); const p = polyFromExpr(e, v);
    if (!p) throw new MError('Not a polynomial.', '', 'sym2poly');
    return rowVec(pTrim(p).map(c => c.val()));
  });
  R('poly2sym', (a) => { const p = Array.from(a[0].re); const v = a.length > 1 ? valToSymStr(a[1]) : 'x'; return mk(canon(p.map((c, k) => `(${numToSym(c)})*${v}^${p.length - 1 - k}`).join('+') || '0')); });
  R('coeffs', (a) => { const e = symOf(a[0]).exprs[0]; const v = a.length > 1 ? valToSymStr(a[1]) : defaultVar(e); const r = nd(`coeffs(${nd(`expand(${e})`)}, ${v})`).toString(); const items = splitTop(r.slice(1, -1)).map(canon).filter(x => x !== '0'); return new Sym(items, 1, items.length); });
  R('subs', (a) => {
    const v = symOf(a[0]);
    let olds, news;
    if (a.length === 2) { const e0 = v.exprs[0]; olds = [defaultVar(e0)]; news = [a[1]]; }
    else if (a[1].type === 'cell') { olds = a[1].data.map(valToSymStr); news = a[2].data; }
    else { olds = a[1].type === 'sym' ? a[1].exprs : [valToSymStr(a[1])]; news = a[2].type === 'sym' && a[2].numel > 1 ? a[2].exprs.map(x => mk(x)) : [a[2]]; }
    // numeric array substitution: elementwise
    if (news.length === 1 && news[0].type === 'num' && news[0].numel > 1 && v.numel === 1) {
      const nv = news[0]; return new Sym(Array.from(nv.re, x => canon(nd(v.exprs[0]).sub(olds[0], `(${numToSym(x)})`).toString())), nv.rows, nv.cols);
    }
    return mapSym(v, (e) => { let r = e; olds.forEach((o, k) => { r = nd(r).sub(o.replace(/\(.*\)$/, ''), `(${valToSymStr(news[k])})`).toString(); }); return canon(r); });
  });
  R('finverse', (a) => {
    const e = symOf(a[0]).exprs[0]; const v = a.length > 1 ? valToSymStr(a[1]) : defaultVar(e);
    const inv = invertNode(parseExpr(e), v, v);
    if (!inv) { I.warn('Functional inverse cannot be found.'); return mk('[]'); }
    return mk(canon(inv));
  });
  R('compose', (a) => { const f = symOf(a[0]).exprs[0], g = symOf(a[1]).exprs[0]; return mk(canon(nd(f).sub(defaultVar(f), `(${g})`).toString())); });

  // ---------- calculus ----------
  function symDiff(a) {
    const v = symOf(a[0]);
    let varName = null, n = 1;
    for (const x of a.slice(1)) { if (x.type === 'num' && x.cls !== 'char') n = toNumber(x); else varName = valToSymStr(x).replace(/\(.*\)$/, ''); }
    return mapSym(v, (e) => {
      if (FUNS.has(e)) return `d__${e}__${n}`;
      const dm = e.match(/^d__(\w+?)__(\d+)$/);
      if (dm) return `d__${dm[1]}__${+dm[2] + n}`;
      const vn = varName || defaultVar(e);
      let r = e; for (let k = 0; k < n; k++) r = nerdamer.diff(r, vn).toString();
      return canon(r);
    });
  }
  R('int', (a) => {
    const v = symOf(a[0]);
    let varName = null, lo = null, hi = null;
    const rest = a.slice(1).filter(x => !(isStr(x) && /^(IgnoreAnalyticConstraints|Hold|PrincipalValue)$/.test(toStr(x))));
    if (rest.length === 1) varName = valToSymStr(rest[0]);
    else if (rest.length === 2) { lo = valToSymStr(rest[0]); hi = valToSymStr(rest[1]); }
    else if (rest.length >= 3) { varName = valToSymStr(rest[0]); lo = valToSymStr(rest[1]); hi = valToSymStr(rest[2]); }
    return mapSym(v, (e) => {
      const vn = varName || defaultVar(e);
      if (lo === null) {
        try { return canon(nerdamer.integrate(e, vn).toString()); } catch (x) { return `int(${e},${vn})`; }
      }
      const L = lo.replace(/\bInf\b/g, 'Infinity'), H = hi.replace(/\bInf\b/g, 'Infinity');
      if (!/Infinity/.test(L + H)) {
        try {
          const F = nerdamer.integrate(e, vn).toString();
          if (!/integrate|defint/.test(F)) { const r = canon(`(${nd(F).sub(vn, `(${H})`)})-(${nd(F).sub(vn, `(${L})`)})`); if (!/Infinity|NaN/.test(r)) return r; }
        } catch (x) { /* fall through */ }
      }
      try {
        let r = nd(`defint(${e},${L},${H},${vn})`).toString();
        r = r.replace(/erf\(-Infinity[^()]*(\([^()]*\))?[^()]*\)/g, '(-1)').replace(/erf\(Infinity[^()]*(\([^()]*\))?[^()]*\)/g, '(1)');
        r = canon(r);
        if ((/Infinity|NaN|undefined|defint|integrate/.test(r)) && !/^-?Infinity$/.test(r)) throw new Error('bad');
        return r;
      } catch (x) {
        if (symVars(e).filter(z => z !== vn).length) return `int(${e},${vn},${lo},${hi})`;
        const f = nd(e).buildFunction([vn]);
        const val = integrate((t) => f(t), Number(evalNumeric(L)[0]), Number(evalNumeric(H)[0]));
        return String(val);
      }
    });
  });
  R('limit', (a) => {
    const v = symOf(a[0]); const e = v.exprs[0];
    let vn = defaultVar(e), pt = '0', dir = null;
    const rest = a.slice(1);
    const strs = rest.filter(x => isStr(x) && ['left', 'right'].includes(toStr(x)));
    if (strs.length) dir = toStr(strs[0]);
    const r2 = rest.filter(x => !(isStr(x) && ['left', 'right'].includes(toStr(x))));
    if (r2.length === 1) pt = valToSymStr(r2[0]);
    else if (r2.length >= 2) { vn = valToSymStr(r2[0]); pt = valToSymStr(r2[1]); }
    pt = pt.replace(/\bInf\b/g, 'Infinity');
    const f = (() => { try { return nd(e).buildFunction([vn]); } catch (x) { return null; } })();
    const P = Number(evalNumeric(pt)[0]);
    const side = (s) => { if (!f) return NaN; const vals = [1e-4, 1e-6, 1e-8].map(h => f(Number.isFinite(P) ? P + s * h : s * 1 / h)); const last = vals[2]; if (Math.abs(last) > 1e6 && Math.sign(vals[1]) === Math.sign(last) && Math.abs(last) > Math.abs(vals[0])) return last > 0 ? Infinity : -Infinity; return last; };
    if (dir) { const s = side(dir === 'left' ? -1 : 1); if (!Number.isFinite(s)) return mk(s > 0 ? 'Infinity' : '-Infinity'); }
    let res;
    try { res = canon(nd(`limit(${e},${vn},${pt})`).toString()); } catch (x) { res = null; }
    if (Number.isFinite(P) && !dir && f) {
      const l = side(-1), r = side(1);
      if ((!Number.isFinite(l) || !Number.isFinite(r)) && l !== r) return mk('NaN');
    }
    if (dir && res && f) { const s = side(dir === 'left' ? -1 : 1); if (Number.isFinite(s) && Math.abs(Number(evalNumeric(res)[0]) - s) > 1e-3) return mk(numToSym(s)); }
    return mk(res ?? 'NaN');
  });
  R('taylor', (a) => {
    const e = symOf(a[0]).exprs[0]; let vn = defaultVar(e), at = '0', order = 6;
    const rest = a.slice(1);
    for (let k = 0; k < rest.length; k++) { if (isStr(rest[k]) && toStr(rest[k]) === 'Order') { order = toNumber(rest[k + 1]); k++; } else if (isStr(rest[k]) && toStr(rest[k]) === 'ExpansionPoint') { at = valToSymStr(rest[k + 1]); k++; } else if (rest[k].type === 'sym' && k === 0) vn = rest[k].exprs[0]; else if (rest[k].type === 'num') at = valToSymStr(rest[k]); }
    let d = e, fact = 1; const terms = [];
    for (let k = 0; k < order; k++) { if (k > 0) { d = nerdamer.diff(d, vn).toString(); fact *= k; } const c = canon(`(${nd(d).sub(vn, `(${at})`).toString()})/${fact}`); if (c !== '0') terms.push(`(${c})*(${vn}-(${at}))^${k}`); }
    return mk(canon(terms.join('+') || '0'));
  });
  R('solve', (a, nout) => {
    const eqs = [], vars = [];
    for (const x of a) {
      if (isStr(x) && /^(Real|ReturnConditions|IgnoreAnalyticConstraints|PrincipalValue|MaxDegree)$/.test(toStr(x))) break;
      const s = valToSymStr(x);
      if (x.type === 'sym' && /^[A-Za-z]\w*$/.test(s) && !x.isEq) {
        if (eqs.length) { vars.push(s); continue; }
      }
      if (isStr(x) && /^[A-Za-z]\w*$/.test(s) && eqs.length) { vars.push(s); continue; }
      eqs.push(s);
    }
    const norm = eqs.map(s => { const p = s.replace('==', '=').split('='); return p.length === 2 ? canon(`(${p[0]})-(${p[1]})`) : canon(s); });
    if (norm.length === 1) {
      const v = vars[0] || defaultVar(norm[0]);
      const sols = solveOne(norm[0], v);
      if (!sols.length) { I.warn('Unable to find explicit solution.'); return new Sym([], 0, 1); }
      return new Sym(sols, sols.length, 1);
    }
    const vs = vars.length ? vars : [...new Set(norm.flatMap(symVars))].sort();
    let res;
    try { res = nerdamer.solveEquations(norm.map(e => `${e}=0`), vs); } catch (x) { throw new MError('Unable to solve the system of equations.', '', 'solve'); }
    const map = new Map(res.map(([n, v]) => [n, mk(canon(String(v)))]));
    if (nout > 1) return vs.map(n => map.get(n) || mk('[]'));
    const S = new Struct(1, 1, vs); vs.forEach(n => S.data[0].set(n, map.get(n) || mk('[]'))); return S;
  });
  R('dsolve', (a) => {
    const items = a.map(x => (x.type === 'sym' ? x.exprs[0] : toStr(x)));
    let indep = 't';
    const eqs = [], conds = [];
    for (const s of items) {
      if (/^[A-Za-z]$/.test(s.trim()) && eqs.length) { indep = s.trim(); continue; }
      const isCond = /^\s*(D\d*)?[A-Za-z]\w*\(\s*[^)a-zA-Z]*\s*\)\s*==?/.test(s) || /^\s*(D\d*)?[A-Za-z]\w*\(\s*pi[^)]*\)\s*==?/.test(s);
      if (!isCond && /D\d*[A-Za-z]|diff\(|d__\w+__\d/.test(s)) eqs.push(s); else conds.push(s);
    }
    // infer independent variable from symbolic function y(t)
    const fm = items.join(' ').match(/diff\(\w+\((\w+)\)/); if (fm) indep = fm[1];
    const dm = items.join(' ').match(/d__(\w+?)__\d+/); if (dm && FUNS.has(dm[1])) indep = FUNS.get(dm[1]).split(',')[0];
    if (!eqs.length) throw new MError('No differential equations found.', '', 'dsolve');
    return mk(dsolveImpl(eqs, conds, indep));
  });
  R('__subsref', (a) => I.subsrefRaw(a[0], a.slice(1)));
  R('__subsasgn', (a) => I.subsasgnRaw(a[0], a.slice(2), a[1]));
  void Cell; void colVec; void zeros; void str; void cplx; void isChar; void toStringList;
}
