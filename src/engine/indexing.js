// Subscripted reference and assignment for arrays, cells, structs and strings.
import { Tensor, Cell, Struct, StrArr, MError, empty, className, saturate, isIntCls } from './value.js';

export const COLON = { colon: true };

function badIndex(pos, nargs) {
  if (nargs > 1) return new MError(`Index in position ${pos} is invalid. Array indices must be positive integers or logical values.`, 'MATLAB:badsubscript');
  return new MError('Array indices must be positive integers or logical values.', 'MATLAB:badsubscript');
}

// convert index value to 0-based positions; dimLen used for colon/logical
export function resolveIndex(ix, dimLen, pos, nargs, forSet = false) {
  if (ix === COLON || ix.colon) {
    const a = new Array(dimLen); for (let i = 0; i < dimLen; i++) a[i] = i; return { idx: a, shape: null, colon: true };
  }
  if (ix.type !== 'num') {
    if (ix.type === 'cell') throw new MError('Unable to use a value of type cell as an index.');
    if (ix.type === 'string') throw new MError('Unable to use a value of type string as an index.');
    throw new MError(`Unable to use a value of type ${className(ix)} as an index.`);
  }
  if (ix.cls === 'logical') {
    const out = [];
    for (let i = 0; i < ix.numel; i++) if (ix.re[i] !== 0) {
      if (i >= dimLen && !forSet) {
        throw new MError(nargs > 1
          ? `Index in position ${pos} exceeds array bounds. Index must not exceed ${dimLen}.`
          : `The logical indices contain a true value outside of the array bounds.`, 'MATLAB:badsubscript');
      }
      out.push(i);
    }
    return { idx: out, shape: ix.rows === 1 ? 'row' : 'col', logical: true, src: ix };
  }
  const n = ix.numel, out = new Array(n);
  for (let i = 0; i < n; i++) {
    const v = ix.re[i];
    if (!(v >= 1) || !Number.isInteger(v) || (ix.im && ix.im[i] !== 0)) throw badIndex(pos, nargs);
    out[i] = v - 1;
  }
  return { idx: out, shape: [ix.rows, ix.cols] };
}

function boundsErr(pos, nargs, max) {
  if (nargs === 1) return new MError(`Index exceeds the number of array elements. Index must not exceed ${max}.`, 'MATLAB:badsubscript');
  return new MError(`Index in position ${pos} exceeds array bounds. Index must not exceed ${max}.`, 'MATLAB:badsubscript');
}

// ---------- generic element access helpers ----------
function makeLike(base, rows, cols, picker) {
  // picker(k) -> source linear index (or -1 for fill)
  const n = rows * cols;
  switch (base.type) {
    case 'num': {
      const re = new Float64Array(n);
      const im = base.im ? new Float64Array(n) : null;
      for (let k = 0; k < n; k++) { const s = picker(k); re[k] = base.re[s]; if (im) im[k] = base.im[s]; }
      const t = new Tensor(rows, cols, re, im, base.cls);
      if (im) { let any = false; for (let k = 0; k < n; k++) if (im[k] !== 0) { any = true; break; } if (!any) t.im = null; }
      return t;
    }
    case 'cell': { const d = new Array(n); for (let k = 0; k < n; k++) d[k] = base.data[picker(k)]; return new Cell(rows, cols, d); }
    case 'struct': { const d = new Array(n); for (let k = 0; k < n; k++) d[k] = base.data[picker(k)]; return new Struct(rows, cols, base.fields, d); }
    case 'string': { const d = new Array(n); for (let k = 0; k < n; k++) d[k] = base.data[picker(k)]; return new StrArr(rows, cols, d); }
  }
  throw new MError(`Indexing is not supported for variables of type ${className(base)}.`);
}

export function subsref(base, args) {
  if (base.type === 'fh' || base.type === 'sym' && false) throw new MError('Array indices must be positive integers or logical values.');
  if (base.type === 'table') throw new MError('Use dot notation or brace indexing to access table variables.');
  const nargs = args.length;
  if (nargs === 0) return base;
  if (nargs === 1) {
    const n = base.numel;
    const r = resolveIndex(args[0], n, 1, 1);
    const idx = r.idx;
    for (const k of idx) if (k >= n) throw boundsErr(1, 1, n);
    let rows, cols;
    if (r.colon) { rows = idx.length; cols = 1; }
    else if (r.logical) {
      // mask: result is row if source is row vector (or mask is row and source is row)
      if (base.rows === 1 && (r.src.rows === 1 || true)) { rows = 1; cols = idx.length; }
      else { rows = idx.length; cols = 1; }
      if (base.rows !== 1 && r.src.rows === 1 && base.cols === 1) { rows = idx.length; cols = 1; }
      if (base.rows === 1 && base.cols === 1 && r.src.rows === 1) { rows = 1; cols = idx.length; }
    } else {
      const [ir, ic] = r.shape;
      const isVecIdx = ir === 1 || ic === 1;
      if (isVecIdx && (base.rows === 1 || base.cols === 1) && base.numel > 0 && !(base.rows === 1 && base.cols === 1)) {
        if (base.rows === 1) { rows = 1; cols = idx.length; } else { rows = idx.length; cols = 1; }
      } else { rows = ir; cols = ic; }
    }
    return makeLike(base, rows, cols, k => idx[k]);
  }
  // 2-D (extra trailing indices must be 1)
  for (let p = 2; p < nargs; p++) {
    const r = resolveIndex(args[p], 1, p + 1, nargs);
    for (const k of r.idx) if (k > 0) throw boundsErr(p + 1, nargs, 1);
  }
  const R = base.rows, C = base.cols;
  const ri = resolveIndex(args[0], R, 1, nargs).idx;
  const ci = resolveIndex(args[1], C, 2, nargs).idx;
  for (const k of ri) if (k >= R) throw boundsErr(1, nargs, R);
  for (const k of ci) if (k >= C) throw boundsErr(2, nargs, C);
  const nr = ri.length;
  return makeLike(base, nr, ci.length, k => ci[Math.floor(k / nr)] * R + ri[k % nr]);
}

// ---------- assignment ----------
function fillValue(base) {
  if (base.type === 'cell') return empty();
  if (base.type === 'struct') return null;
  if (base.type === 'string') return '';
  return 0;
}

function resize(base, nr, nc) {
  if (nr === base.rows && nc === base.cols) return copyContainer(base);
  const R = base.rows;
  const n = nr * nc;
  switch (base.type) {
    case 'num': {
      const re = new Float64Array(n); const im = base.im ? new Float64Array(n) : null;
      for (let j = 0; j < base.cols; j++) for (let i = 0; i < R; i++) { re[j * nr + i] = base.re[j * R + i]; if (im) im[j * nr + i] = base.im[j * R + i]; }
      return new Tensor(nr, nc, re, im, base.cls);
    }
    case 'cell': {
      const d = new Array(n).fill(null).map(() => empty());
      for (let j = 0; j < base.cols; j++) for (let i = 0; i < R; i++) d[j * nr + i] = base.data[j * R + i];
      return new Cell(nr, nc, d);
    }
    case 'struct': {
      const d = new Array(n).fill(null).map(() => new Map(base.fields.map(f => [f, empty()])));
      for (let j = 0; j < base.cols; j++) for (let i = 0; i < R; i++) d[j * nr + i] = base.data[j * R + i];
      return new Struct(nr, nc, base.fields, d);
    }
    case 'string': {
      const d = new Array(n).fill('');
      for (let j = 0; j < base.cols; j++) for (let i = 0; i < R; i++) d[j * nr + i] = base.data[j * R + i];
      return new StrArr(nr, nc, d);
    }
  }
}
function copyContainer(b) {
  switch (b.type) {
    case 'num': return new Tensor(b.rows, b.cols, Float64Array.from(b.re), b.im ? Float64Array.from(b.im) : null, b.cls);
    case 'cell': return new Cell(b.rows, b.cols, b.data.slice());
    case 'struct': return new Struct(b.rows, b.cols, b.fields, b.data.slice());
    case 'string': return new StrArr(b.rows, b.cols, b.data.slice());
  }
}

// coerce rhs to be storable into base (same container kind)
function prepareRhs(base, rhs) {
  if (base.type === 'num') {
    if (rhs.type !== 'num') {
      if (rhs.type === 'cell') throw new MError('Conversion to double from cell is not possible.');
      if (rhs.type === 'struct') throw new MError('Conversion to double from struct is not possible.');
      if (rhs.type === 'string') throw new MError('Conversion to double from string is not possible.');
      if (rhs.type === 'sym') throw new MError('Unable to convert symbolic expression to double. Use the "double" function, or assign into a sym array.');
      throw new MError(`Conversion to ${base.cls} from ${className(rhs)} is not possible.`);
    }
    return rhs;
  }
  if (base.type === 'cell') {
    if (rhs.type !== 'cell') throw new MError('Conversion to cell from ' + className(rhs) + ' is not possible.');
    return rhs;
  }
  if (base.type === 'struct') {
    if (rhs.type !== 'struct') throw new MError('Conversion to struct from ' + className(rhs) + ' is not possible.');
    return rhs;
  }
  if (base.type === 'string') {
    if (rhs.type === 'string') return rhs;
    if (rhs.type === 'num' && rhs.cls === 'char') return new StrArr(1, 1, [String.fromCharCode(...rhs.re)]);
    if (rhs.type === 'num') return new StrArr(rhs.rows, rhs.cols, Array.from(rhs.re, String));
    throw new MError('Conversion to string from ' + className(rhs) + ' is not possible.');
  }
  return rhs;
}

function resultClassForAssign(base, rhs, wasEmpty) {
  if (base.type !== 'num') return null;
  if (wasEmpty && base.cls === 'double') return rhs.cls;
  if (base.cls === 'logical' && rhs.cls !== 'logical') return rhs.cls === 'char' ? 'char' : 'double';
  if (base.cls === 'char' && rhs.cls !== 'char') return rhs.cls === 'logical' ? 'char' : rhs.cls;
  if (base.cls === 'double' && isIntCls(rhs.cls)) return rhs.cls;
  if (base.cls === 'double' && rhs.cls === 'single') return 'single';
  return base.cls;
}

function setElem(out, k, rhs, s) {
  switch (out.type) {
    case 'num':
      out.re[k] = saturate(rhs.re[s], out.cls);
      if (rhs.im) { if (!out.im) out.im = new Float64Array(out.numel); out.im[k] = rhs.im[s]; }
      else if (out.im) out.im[k] = 0;
      break;
    case 'cell': out.data[k] = rhs.data[s]; break;
    case 'struct': out.data[k] = rhs.data[s]; break;
    case 'string': out.data[k] = rhs.data[s]; break;
  }
}

function alignStructFields(base, rhs) {
  // when assigning a struct element into a struct array, fields must match (union like MATLAB requires same)
  const all = base.fields.slice();
  for (const f of rhs.fields) if (!all.includes(f)) all.push(f);
  const fix = (S) => {
    const data = S.data.map(m => { const nm = new Map(); for (const f of all) nm.set(f, m.has(f) ? m.get(f) : empty()); return nm; });
    return new Struct(S.rows, S.cols, all, data);
  };
  if (base.numel > 0 && rhs.fields.length && (all.length !== base.fields.length || all.length !== rhs.fields.length)) {
    throw new MError('Subscripted assignment between dissimilar structures.');
  }
  return [fix(base), fix(rhs)];
}

export function subsasgn(base, args, rhs) {
  const nargs = args.length;
  // deletion: x(idx) = []
  if (rhs.type === 'num' && rhs.numel === 0 && rhs.cls === 'double' && rhs.rows === 0 && rhs.cols === 0 && base.type !== 'cell_content') {
    if (!(base.type === 'num' && base.numel === 0 && args.every(a => a !== COLON && !a.colon && a.numel === 0))) return deleteElems(base, args);
  }
  const wasEmpty = base.numel === 0;
  if (base.type === 'num' && rhs.type !== 'num' && wasEmpty) {
    // x = []; x(2) = {..} -> becomes cell/struct/string
    if (rhs.type === 'cell') base = new Cell(0, 0, []);
    else if (rhs.type === 'struct') base = new Struct(0, 0, rhs.fields, []);
    else if (rhs.type === 'string') base = new StrArr(0, 0, []);
  }
  rhs = prepareRhs(base, rhs);
  if (base.type === 'struct' && rhs.type === 'struct') [base, rhs] = alignStructFields(base, rhs);
  const newCls = resultClassForAssign(base, rhs, wasEmpty);

  if (nargs === 1) {
    let n = base.numel;
    const r = resolveIndex(args[0], n, 1, 1, true);
    const idx = r.idx;
    let maxK = -1; for (const k of idx) if (k > maxK) maxK = k;
    let out;
    if (maxK >= n) {
      if (base.rows === 0 && base.cols === 0) out = resize(base, 1, maxK + 1);
      else if (base.rows === 1) out = resize(base, 1, maxK + 1);
      else if (base.cols === 1) out = resize(base, maxK + 1, 1);
      else throw new MError('Attempt to grow array along ambiguous dimension.', 'MATLAB:indexed_matrix_cannot_be_resized');
    } else out = copyContainer(base);
    if (newCls && out.cls !== newCls) { out.cls = newCls; if (isIntCls(newCls) || newCls === 'single') for (let k = 0; k < out.numel; k++) out.re[k] = saturate(out.re[k], newCls); }
    if (rhs.numel === 1) { for (const k of idx) setElem(out, k, rhs, 0); }
    else {
      if (rhs.numel !== idx.length) throw new MError('Unable to perform assignment because the left and right sides have a different number of elements.', 'MATLAB:subsassignnumelmismatch');
      for (let q = 0; q < idx.length; q++) setElem(out, idx[q], rhs, q);
    }
    return finalize(out);
  }
  // 2-D
  for (let p = 2; p < nargs; p++) {
    const r = resolveIndex(args[p], 1, p + 1, nargs, true);
    for (const k of r.idx) if (k > 0) throw new MError('Multidimensional arrays are not supported in this environment.');
  }
  let R = base.rows, C = base.cols;
  // colon on empty dimension takes rhs size
  let rArg = args[0], cArg = args[1];
  let ri, ci;
  if ((rArg === COLON || rArg.colon) && R === 0 && base.numel === 0) {
    ri = [...Array(rhs.numel === 1 && !(cArg === COLON || cArg.colon) ? 1 : rhs.rows).keys()];
  } else ri = resolveIndex(rArg, R, 1, nargs, true).idx;
  if ((cArg === COLON || cArg.colon) && C === 0 && base.numel === 0) {
    ci = [...Array(rhs.numel === 1 && !(rArg === COLON || rArg.colon) ? 1 : rhs.cols).keys()];
  } else ci = resolveIndex(cArg, C, 2, nargs, true).idx;
  const maxR = Math.max(R - 1, ...ri), maxC = Math.max(C - 1, ...ci);
  let out = resize(base, maxR + 1, maxC + 1);
  if (newCls && out.cls !== newCls) { out.cls = newCls; }
  const NR = out.rows;
  if (rhs.numel === 1) {
    for (const j of ci) for (const i of ri) setElem(out, j * NR + i, rhs, 0);
  } else {
    const cnt = ri.length * ci.length;
    if (rhs.numel !== cnt) {
      throw new MError(`Unable to perform assignment because the size of the left side is ${ri.length}-by-${ci.length} and the size of the right side is ${rhs.rows}-by-${rhs.cols}.`, 'MATLAB:subsassigndimmismatch');
    }
    // MATLAB allows assigning vectors of same numel across shapes when one dim matches
    let q = 0;
    for (let jj = 0; jj < ci.length; jj++) for (let ii = 0; ii < ri.length; ii++) setElem(out, ci[jj] * NR + ri[ii], rhs, q++);
  }
  return finalize(out);
}
function finalize(out) {
  if (out.type === 'num' && out.im) { let any = false; for (let k = 0; k < out.numel; k++) if (out.im[k] !== 0) { any = true; break; } if (!any) out.im = null; }
  return out;
}

export function deleteElems(base, args) {
  const nargs = args.length;
  if (nargs === 1) {
    const n = base.numel;
    const r = resolveIndex(args[0], n, 1, 1);
    const del = new Set(r.idx);
    for (const k of del) if (k >= n) throw new MError('Matrix index is out of range for deletion.', 'MATLAB:index_out_of_range_deletion');
    const keep = []; for (let k = 0; k < n; k++) if (!del.has(k)) keep.push(k);
    if (r.colon) return makeLike(base, 0, 0, k => 0);
    let rows, cols;
    if (base.cols === 1 && base.rows !== 1) { rows = keep.length; cols = 1; }
    else if (base.rows === 1) { rows = 1; cols = keep.length; }
    else {
      if (del.size === 0) return base;
      rows = 1; cols = keep.length;
    }
    return makeLike(base, rows, cols, k => keep[k]);
  }
  const R = base.rows, C = base.cols;
  const a0 = args[0], a1 = args[1];
  const isC0 = a0 === COLON || a0.colon, isC1 = a1 === COLON || a1.colon;
  const ri = resolveIndex(a0, R, 1, 2).idx, ci = resolveIndex(a1, C, 2, 2).idx;
  const fullRows = isC0 || new Set(ri).size === R && ri.every(k => k < R);
  const fullCols = isC1 || new Set(ci).size === C && ci.every(k => k < C);
  if (fullRows) {
    for (const k of ci) if (k >= C) throw new MError('Matrix index is out of range for deletion.');
    const del = new Set(ci); const keepC = []; for (let j = 0; j < C; j++) if (!del.has(j)) keepC.push(j);
    return makeLike(base, R, keepC.length, k => keepC[Math.floor(k / R)] * R + (k % R));
  }
  if (fullCols) {
    for (const k of ri) if (k >= R) throw new MError('Matrix index is out of range for deletion.');
    const del = new Set(ri); const keepR = []; for (let i = 0; i < R; i++) if (!del.has(i)) keepR.push(i);
    const nr = keepR.length;
    return makeLike(base, nr, C, k => Math.floor(k / nr) * R + keepR[k % nr]);
  }
  throw new MError('A null assignment can have only one non-colon index.', 'MATLAB:nullAssignmentOneNonColon');
}
