// Figure/axes model. The engine records plotting commands into plain JSON
// figures; the browser side renders them (Plotly) in MATLAB-like windows.
import { Tensor, MError, num, str, zeros, rowVec, toStr, toNumber, isChar, className } from '../value.js';
import { isStr, toStringList } from './util.js';
import { charRows } from '../value.js';

export const COLOR_ORDER = ['#0072BD', '#D95319', '#EDB120', '#7E2F8E', '#77AC30', '#4DBEEE', '#A2142F'];
const COLOR_CHARS = { y: '#FFFF00', m: '#FF00FF', c: '#00FFFF', r: '#FF0000', g: '#00FF00', b: '#0000FF', w: '#FFFFFF', k: '#000000' };
const COLOR_NAMES = { yellow: 'y', magenta: 'm', cyan: 'c', red: 'r', green: 'g', blue: 'b', white: 'w', black: 'k' };

export function parseLineSpec(s) {
  const spec = { };
  let t = s;
  const ls = t.match(/--|-\.|-|:/); if (ls) { spec.lineStyle = ls[0]; t = t.replace(ls[0], ''); }
  const mk = t.match(/square|diamond|pentagram|hexagram|[.ox+*sdv^<>ph]/); if (mk) { spec.marker = { square: 's', diamond: 'd', pentagram: 'p', hexagram: 'h' }[mk[0]] || mk[0]; t = t.replace(mk[0], ''); }
  const cl = t.match(/[ymcrgbwk]/); if (cl) { spec.color = COLOR_CHARS[cl[0]]; t = t.replace(cl[0], ''); }
  if (t.trim()) return null;
  if (spec.marker && !spec.lineStyle) spec.lineStyle = 'none';
  return spec;
}
function colorOf(v) {
  if (isStr(v)) { const s = toStr(v).toLowerCase(); if (s === 'none') return 'none'; const c = COLOR_CHARS[s] || COLOR_CHARS[COLOR_NAMES[s]]; if (c) return c; if (/^#[0-9a-f]{6}$/i.test(s)) return s; throw new MError(`Invalid color name or hexadecimal color code.`); }
  if (v.type === 'num' && v.numel === 3) { const [r, g, b] = Array.from(v.re); if ([r, g, b].some(x => x < 0 || x > 1)) throw new MError('Color value must be a 3 element vector with values in the range [0,1].'); return '#' + [r, g, b].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join(''); }
  throw new MError('Invalid color specification.');
}
const arr = (v) => Array.from(v.re, x => (Number.isFinite(x) ? x : null));

export function installPlot(I) {
  const R = (name, fn, opts) => I.register(name, fn, opts);
  const S = { figs: new Map(), cur: null, dirty: new Set(), nextHandle: 1000, handles: new Map(), closed: [] };
  I.plotState = S;

  const newAxes = (pos = null) => ({ pos, hold: false, series: [], title: '', xlabel: '', ylabel: '', zlabel: '', ylabelRight: '', legend: null, grid: false, minorGrid: false, box: true, xlim: null, ylim: null, zlim: null, ylimRight: null, xscale: 'linear', yscale: 'linear', axisMode: null, axisOff: false, is3d: false, view: null, colorIdx: 0, texts: [], yside: 'left', colormap: 'parula', colorbar: false, shading: 'faceted', xticks: null, yticks: null });
  const fig = (create = true) => {
    if (S.cur === null || !S.figs.has(S.cur)) {
      if (!create) return null;
      let id = 1; while (S.figs.has(id)) id++;
      S.figs.set(id, { id, name: '', axes: [], curAx: null, sgtitle: '' }); S.cur = id;
    }
    const f = S.figs.get(S.cur); S.dirty.add(f.id); return f;
  };
  const ax = () => {
    const f = fig();
    if (!f.curAx) { const a = newAxes(); f.axes.push(a); f.curAx = a; }
    return f.curAx;
  };
  const prepareAxes = () => {
    const a = ax();
    if (!a.hold) {
      // NextPlot = 'replace': reset everything except the position
      const fresh = newAxes(a.pos);
      for (const k of Object.keys(fresh)) a[k] = fresh[k];
    }
    return a;
  };
  const nextColor = (a) => { const c = COLOR_ORDER[a.colorIdx % COLOR_ORDER.length]; a.colorIdx++; return c; };
  const addHandle = (obj) => { const h = S.nextHandle++ + 0.0001 * 0; S.handles.set(h, obj); return h; };

  // flush: send dirty figures to host
  I.plot = {
    flush() {
      if (!S.dirty.size && !S.closed.length) return;
      const figs = [...S.dirty].filter(id => S.figs.has(id)).map(id => S.figs.get(id));
      I.host.plot({ figures: JSON.parse(JSON.stringify(figs, (k, v) => (k === 'curAx' ? undefined : v))), closed: S.closed.slice(), current: S.cur });
      S.dirty.clear(); S.closed = [];
    },
    clf() { const f = fig(); f.axes = []; f.curAx = null; },
    command(name, args) { return I.builtins.get(name).fn(args, 0, {}); },
  };

  // parse plot(...) arguments into series
  function parsePlotArgs(args, fname, dims = 2) {
    const series = []; const props = {};
    // trailing name/value pairs
    let end = args.length;
    const propNames = ['linewidth', 'markersize', 'markeredgecolor', 'markerfacecolor', 'color', 'displayname', 'linestyle', 'marker'];
    for (let k = 0; k < args.length; k++) {
      if (isStr(args[k]) && propNames.includes(toStr(args[k]).toLowerCase()) && k + 1 < args.length) { end = Math.min(end, k); }
    }
    for (let k = end; k + 1 < args.length; k += 2) props[toStr(args[k]).toLowerCase()] = args[k + 1];
    const a = args.slice(0, end);
    let k = 0;
    while (k < a.length) {
      let x, y, z, spec = null;
      if (dims === 3) {
        x = a[k]; y = a[k + 1]; z = a[k + 2]; k += 3;
        if (!x || !y || !z) throw new MError('Not enough input arguments.', '', fname);
      } else {
        x = a[k];
        if (k + 1 < a.length && !isStr(a[k + 1])) { y = a[k + 1]; k += 2; }
        else { y = null; k += 1; }
      }
      if (k < a.length && isStr(a[k])) { spec = parseLineSpec(toStr(a[k])); if (!spec) throw new MError(`Error in color/linetype argument.`, '', fname); k++; }
      if (isStr(x) || (y && isStr(y))) throw new MError('Invalid data argument.', '', fname);
      for (const v of [x, y, z]) if (v && v.type !== 'num') throw new MError(`Invalid data argument.`, '', fname);
      if (dims === 2 && y === null) {
        if (x.im) { y = new Tensor(x.rows, x.cols, x.im); x = new Tensor(x.rows, x.cols, x.re); }
        else { y = x; x = null; }
      }
      // matrix handling
      const ys = [], xs = [], zs = [];
      const colsOf = (m) => { const out = []; for (let j = 0; j < m.cols; j++) out.push(Array.from(m.re.slice(j * m.rows, (j + 1) * m.rows))); return out; };
      const rowsOf = (m) => { const out = []; for (let i = 0; i < m.rows; i++) { const r = []; for (let j = 0; j < m.cols; j++) r.push(m.re[j * m.rows + i]); out.push(r); } return out; };
      const vecOf = (m) => Array.from(m.re);
      const isVec = (m) => m.rows === 1 || m.cols === 1;
      if (dims === 3) {
        if (isVec(x)) { xs.push(vecOf(x)); ys.push(vecOf(y)); zs.push(vecOf(z)); }
        else { colsOf(x).forEach((c, j) => { xs.push(c); ys.push(colsOf(y)[j]); zs.push(colsOf(z)[j]); }); }
        if (xs[0].length !== ys[0].length || xs[0].length !== zs[0].length) throw new MError('Vectors must be the same length.', '', fname);
      } else if (x === null) {
        if (isVec(y)) { ys.push(vecOf(y)); xs.push(ys[0].map((_, i) => i + 1)); }
        else colsOf(y).forEach(c => { ys.push(c); xs.push(c.map((_, i) => i + 1)); });
      } else if (isVec(x) && isVec(y)) {
        if (x.numel !== y.numel) throw new MError('Vectors must be the same length.', '', fname);
        xs.push(vecOf(x)); ys.push(vecOf(y));
      } else if (isVec(x)) {
        const n = x.numel;
        if (y.rows === n) colsOf(y).forEach(c => { xs.push(vecOf(x)); ys.push(c); });
        else if (y.cols === n) rowsOf(y).forEach(r => { xs.push(vecOf(x)); ys.push(r); });
        else throw new MError('Vectors must be the same length.', '', fname);
      } else if (isVec(y)) {
        const n = y.numel;
        if (x.rows === n) colsOf(x).forEach(c => { xs.push(c); ys.push(vecOf(y)); });
        else throw new MError('Vectors must be the same length.', '', fname);
      } else {
        if (x.rows !== y.rows || x.cols !== y.cols) throw new MError('Vectors must be the same length.', '', fname);
        colsOf(x).forEach((c, j) => { xs.push(c); ys.push(colsOf(y)[j]); });
      }
      for (let q = 0; q < ys.length; q++) {
        series.push({ kind: 'line', x: xs[q].map(v => (Number.isFinite(v) ? v : null)), y: ys[q].map(v => (Number.isFinite(v) ? v : null)), z: zs[q] ? zs[q].map(v => (Number.isFinite(v) ? v : null)) : undefined, spec: spec ? { ...spec } : {} });
      }
    }
    return { series, props };
  }
  function applyProps(s, props, a) {
    const sp = s.spec || {};
    s.color = sp.color || (props.color ? colorOf(props.color) : null) || nextColor(a);
    s.lineStyle = props.linestyle ? toStr(props.linestyle) : sp.lineStyle || '-';
    s.marker = props.marker ? (parseLineSpec(toStr(props.marker)) || {}).marker || toStr(props.marker) : sp.marker || 'none';
    s.lineWidth = props.linewidth ? toNumber(props.linewidth) : 0.5;
    s.markerSize = props.markersize ? toNumber(props.markersize) : 6;
    if (props.markeredgecolor) s.mec = colorOf(props.markeredgecolor);
    if (props.markerfacecolor) s.mfc = colorOf(props.markerfacecolor);
    if (props.displayname) s.name = toStr(props.displayname);
    delete s.spec;
    return s;
  }
  const doPlot = (fname, opts = {}) => (args, nout) => {
    if (!args.length) throw new MError('Not enough input arguments.', '', fname);
    const { series, props } = parsePlotArgs(args, fname, opts.dims || 2);
    const a = prepareAxes();
    if (opts.dims === 3) a.is3d = true;
    if (opts.xscale) a.xscale = opts.xscale;
    if (opts.yscale) a.yscale = opts.yscale;
    const hs = [];
    for (const s of series) { applyProps(s, props, a); if (a.yside === 'right') s.yaxis = 'right'; a.series.push(s); hs.push(addHandle(s)); }
    if (nout) return rowVec(hs);
  };
  R('plot', doPlot('plot'));
  R('line', doPlot('line'));
  R('plot3', doPlot('plot3', { dims: 3 }));
  R('semilogx', doPlot('semilogx', { xscale: 'log' }));
  R('semilogy', doPlot('semilogy', { yscale: 'log' }));
  R('loglog', doPlot('loglog', { xscale: 'log', yscale: 'log' }));
  R('plotyy', (args) => {
    const a = prepareAxes();
    const [x1, y1, x2, y2] = args;
    const s1 = parsePlotArgs([x1, y1], 'plotyy').series, s2 = parsePlotArgs([x2, y2], 'plotyy').series;
    s1.forEach(s => { applyProps(s, {}, a); s.color = COLOR_ORDER[0]; a.series.push(s); });
    s2.forEach(s => { applyProps(s, {}, a); s.color = COLOR_ORDER[1]; s.yaxis = 'right'; a.series.push(s); });
    a.plotyy = true;
  });
  R('yyaxis', (args) => { const a = ax(); a.yside = toStr(args[0]).toLowerCase() === 'right' ? 'right' : 'left'; a.plotyy = true; a.hold = true; });
  R('stem', (args) => { const r = doPlot('stem')(args); const a = ax(); const s = a.series[a.series.length - 1]; s.kind = 'stem'; if (s.marker === 'none') s.marker = 'o'; return r; });
  R('stairs', (args) => { doPlot('stairs')(args); const a = ax(); a.series[a.series.length - 1].kind = 'stairs'; });
  R('scatter', (args) => {
    const a = prepareAxes();
    const x = arr(args[0]), y = arr(args[1]);
    let size = 36, color = null, filled = false, marker = 'o';
    for (const v of args.slice(2)) {
      if (isStr(v)) { const s = toStr(v); if (s === 'filled') filled = true; else { const p = parseLineSpec(s); if (p) { if (p.color) color = p.color; if (p.marker) marker = p.marker; } } }
      else if (v.type === 'num' && v.numel === 1 && size === 36) size = v.re[0];
      else if (v.type === 'num' && v.numel === 3) color = colorOf(v);
    }
    a.series.push({ kind: 'line', x, y, color: color || nextColor(a), lineStyle: 'none', marker, markerSize: Math.sqrt(size), lineWidth: 0.5, mfc: filled ? 'auto' : undefined });
  });
  R('scatter3', (args) => { const a = prepareAxes(); a.is3d = true; a.series.push({ kind: 'line', x: arr(args[0]), y: arr(args[1]), z: arr(args[2]), color: nextColor(a), lineStyle: 'none', marker: 'o', markerSize: 6, lineWidth: 0.5 }); });
  R('area', (args) => {
    const a = prepareAxes();
    let x, y, base = 0;
    if (args.length === 1) { y = arr(args[0]); x = y.map((_, i) => i + 1); }
    else if (args.length === 2 && args[1].numel === 1 && args[0].numel > 1) { y = arr(args[0]); x = y.map((_, i) => i + 1); base = toNumber(args[1]); }
    else { x = arr(args[0]); y = arr(args[1]); if (args.length > 2 && !isStr(args[2])) base = toNumber(args[2]); }
    a.series.push({ kind: 'area', x, y, base, color: nextColor(a) });
  });
  R('fill', (args) => { const a = prepareAxes(); const c = args[2] ? colorOf(args[2]) : nextColor(a); a.series.push({ kind: 'fill', x: arr(args[0]), y: arr(args[1]), color: c }); });
  R('patch', (args) => I.builtins.get('fill').fn(args));
  const barFn = (horizontal) => (args) => {
    const a = prepareAxes();
    let x, y, color = null, width = 0.8;
    const nums = args.filter(v => !isStr(v));
    for (const v of args) if (isStr(v)) { const p = parseLineSpec(toStr(v)); if (p && p.color) color = p.color; }
    if (nums.length === 1) { y = nums[0]; x = null; } else { x = nums[0]; y = nums[1]; if (nums[2]) width = toNumber(nums[2]); }
    const cols = y.rows === 1 || y.cols === 1 ? [arr(y)] : Array.from({ length: y.cols }, (_, j) => Array.from(y.re.slice(j * y.rows, (j + 1) * y.rows)));
    const xv = x ? arr(x) : cols[0].map((_, i) => i + 1);
    for (const c of cols) a.series.push({ kind: 'bar', x: xv, y: c, color: color || nextColor(a), width, horizontal });
  };
  R('bar', barFn(false)); R('barh', barFn(true));
  const histImpl = (args, nout, fname) => {
    const x = Array.from(args[0].re).filter(Number.isFinite);
    let edges;
    if (args.length > 1 && args[1].numel > 1 && fname === 'histogram') edges = arr(args[1]);
    let nb = args.length > 1 && args[1].numel === 1 ? toNumber(args[1]) : fname === 'hist' ? 10 : null;
    const lo = Math.min(...x), hi = Math.max(...x);
    let centers = null;
    if (fname === 'hist' && args.length > 1 && args[1].numel > 1) {
      centers = arr(args[1]); edges = [-Infinity]; for (let k = 0; k < centers.length - 1; k++) edges.push((centers[k] + centers[k + 1]) / 2); edges.push(Infinity);
    }
    if (!edges) {
      if (!nb) {
        // Scott-like automatic binning similar to MATLAB histogram
        const n = x.length; const sd = Math.sqrt(x.reduce((s, v) => s + (v - x.reduce((p, q) => p + q, 0) / n) ** 2, 0) / Math.max(1, n - 1));
        let bw = 3.5 * sd / Math.cbrt(n) || 1; const pw = Math.pow(10, Math.floor(Math.log10(bw))); bw = [1, 2, 2.5, 5, 10].map(m => m * pw).find(c => c >= bw) || bw;
        const e0 = Math.floor(lo / bw) * bw; nb = Math.max(1, Math.ceil((hi - e0) / bw)); edges = Array.from({ length: nb + 1 }, (_, k) => e0 + k * bw);
      } else edges = Array.from({ length: nb + 1 }, (_, k) => lo + (hi - lo) * k / nb);
    }
    const counts = new Array(edges.length - 1).fill(0);
    for (const v of x) for (let k = edges.length - 2; k >= 0; k--) if (v >= edges[k] && (v < edges[k + 1] || (k === edges.length - 2 && v <= edges[k + 1]))) { counts[k]++; break; }
    if (!centers) centers = counts.map((_, k) => (edges[k] + edges[k + 1]) / 2);
    if (fname === 'hist' && nout) return [rowVec(counts), rowVec(centers)];
    const a = prepareAxes();
    const fin = edges.map((e, k) => (Number.isFinite(e) ? e : k === 0 ? centers[0] - (centers[1] - centers[0]) / 2 : centers[centers.length - 1] + (centers[1] - centers[0]) / 2));
    a.series.push({ kind: 'bar', x: centers, y: counts, color: fname === 'hist' ? '#0072BD' : '#0072BD', opacity: fname === 'histogram' ? 0.6 : 1, width: 1, edges: fin, hist: true });
  };
  R('hist', (args, nout) => histImpl(args, nout, 'hist'));
  R('histogram', (args, nout) => histImpl(args, nout, 'histogram'));
  R('boxplot', (args) => {
    const a = prepareAxes();
    const x = args[0];
    let groups = [];
    let labels = null;
    for (let k = 1; k + 1 < args.length; k++) if (isStr(args[k]) && toStr(args[k]).toLowerCase() === 'labels') labels = toStringList(args[k + 1]);
    if (args.length > 1 && !(isStr(args[1]) && toStr(args[1]).toLowerCase() === 'labels')) {
      const g = args[1]; const keys = g.type === 'cell' || isChar(g) ? toStringList(g) : Array.from(g.re, String);
      const map = new Map(); keys.forEach((k, i) => { if (!map.has(k)) map.set(k, []); if (Number.isFinite(x.re[i])) map.get(k).push(x.re[i]); });
      groups = [...map.entries()].map(([name, values]) => ({ name, values }));
    } else if (x.rows === 1 || x.cols === 1) groups = [{ name: '1', values: arr(x).filter(v => v !== null) }];
    else for (let j = 0; j < x.cols; j++) groups.push({ name: String(j + 1), values: Array.from(x.re.slice(j * x.rows, (j + 1) * x.rows)).filter(Number.isFinite) });
    if (labels) groups.forEach((g, k) => (g.name = labels[k] ?? g.name));
    a.series.push({ kind: 'box', groups });
  });
  R('pie', (args) => {
    const a = prepareAxes(); const v = arr(args[0]);
    const labels = args.length > 1 && args[args.length - 1].type === 'cell' ? toStringList(args[args.length - 1]) : null;
    a.series.push({ kind: 'pie', values: v, labels }); a.axisOff = true;
  });
  R('errorbar', (args) => {
    const a = prepareAxes(); let x, y, e;
    if (args.length === 2) { y = arr(args[0]); x = y.map((_, i) => i + 1); e = arr(args[1]); } else { x = arr(args[0]); y = arr(args[1]); e = arr(args[2]); }
    a.series.push({ kind: 'line', x, y, err: e, color: nextColor(a), lineStyle: '-', marker: 'none', lineWidth: 0.5, markerSize: 6 });
  });
  R('polarplot', (args) => {
    const a = prepareAxes(); const th = arr(args[0]), r = arr(args[1]);
    const sp = args[2] && isStr(args[2]) ? parseLineSpec(toStr(args[2])) || {} : {};
    a.series.push({ kind: 'polar', theta: th, r, color: sp.color || nextColor(a), lineStyle: sp.lineStyle || '-', marker: sp.marker || 'none' });
    a.polar = true;
  });
  R('polar', (args) => I.builtins.get('polarplot').fn(args));
  // surfaces
  const surfFn = (style) => (args) => {
    const a = prepareAxes(); a.is3d = !['contour', 'contourf', 'imagesc', 'pcolor'].includes(style);
    let X, Y, Z, levels = null;
    const nums = args.filter(v => !isStr(v));
    if (nums.length === 1 || (nums.length === 2 && style.startsWith('contour'))) { Z = nums[0]; if (nums[1]) levels = nums[1]; X = null; Y = null; }
    else { [X, Y, Z] = nums; if (nums[3]) levels = nums[3]; }
    const mat = (m) => { const out = []; for (let i = 0; i < m.rows; i++) { const r = []; for (let j = 0; j < m.cols; j++) { const v = m.re[j * m.rows + i]; r.push(Number.isFinite(v) ? v : null); } out.push(r); } return out; };
    let xs, ys;
    if (!X) { xs = Array.from({ length: Z.cols }, (_, j) => j + 1); ys = Array.from({ length: Z.rows }, (_, i) => i + 1); }
    else if (X.rows === 1 || X.cols === 1) { xs = arr(X); ys = arr(Y); }
    else { xs = Array.from({ length: X.cols }, (_, j) => X.re[j * X.rows]); ys = Array.from({ length: Y.rows }, (_, i) => Y.re[i]); }
    a.series.push({ kind: 'surface', style, x: xs, y: ys, z: mat(Z), levels: levels ? (levels.numel === 1 ? levels.re[0] : arr(levels)) : null });
  };
  for (const s of ['mesh', 'surf', 'meshc', 'meshz', 'surfc', 'contour', 'contourf', 'contour3', 'waterfall', 'pcolor', 'surfl']) R(s, surfFn(s));
  R('imagesc', surfFn('imagesc')); R('image', surfFn('imagesc'));
  R('imshow', (args) => { const a = prepareAxes(); const Z = args[0]; const out = []; for (let i = 0; i < Z.rows; i++) { const r = []; for (let j = 0; j < Z.cols; j++) r.push(Z.re[j * Z.rows + i]); out.push(r); } a.series.push({ kind: 'surface', style: 'imshow', z: out, x: null, y: null, cls: Z.cls }); a.axisOff = true; a.axisMode = 'equal'; });
  const fplotImpl = (fname) => (args) => {
    const f = args[0];
    let lims = [-5, 5];
    if (fname === 'ezplot') lims = [-2 * Math.PI, 2 * Math.PI];
    let spec = null;
    for (const v of args.slice(1)) { if (isStr(v)) spec = toStr(v); else if (v.numel >= 2) lims = arr(v); }
    let fn;
    if (f.type === 'fh') fn = (x) => { const r = I.callHandle(f, [num(x)], 1)[0]; return r.re[0]; };
    else if (f.type === 'sym') { const g = I.symToFunc(f, 1); fn = (x) => g(num(x)).re[0]; }
    else if (isStr(f)) { const h = I.evalString(`@(x) ${toStr(f)}`); fn = (x) => I.callHandle(h, [num(x)], 1)[0].re[0]; }
    else throw new MError('Input must be a function or functions of a single variable.', '', fname);
    // adaptive sampling: start uniform, refine where curvature is high
    let xs = Array.from({ length: 200 }, (_, k) => lims[0] + (lims[1] - lims[0]) * k / 199);
    for (let pass = 0; pass < 4; pass++) {
      const ys = xs.map(fn); const nx = [xs[0]];
      for (let k = 1; k < xs.length; k++) {
        if (k < xs.length - 1) {
          const d2 = Math.abs(ys[k + 1] - 2 * ys[k] + ys[k - 1]); const span = Math.abs(Math.max(...ys.filter(Number.isFinite)) - Math.min(...ys.filter(Number.isFinite))) || 1;
          if (d2 > 0.02 * span && nx.length < 5000) nx.push((xs[k - 1] + xs[k]) / 2);
        }
        nx.push(xs[k]);
      }
      xs = nx;
    }
    const ys = xs.map(v => { const y = fn(v); return Number.isFinite(y) ? y : null; });
    const a = prepareAxes(); const sp = spec ? parseLineSpec(spec) || {} : {};
    a.series.push({ kind: 'line', x: xs, y: ys, color: sp.color || nextColor(a), lineStyle: sp.lineStyle || '-', marker: sp.marker || 'none', lineWidth: 0.5, markerSize: 6 });
    if (fname === 'ezplot' && !a.title) a.title = f.type === 'sym' ? I.symToStr(f.exprs[0]) : isStr(f) ? toStr(f) : '';
    a.xlim = lims.slice(0, 2);
  };
  R('fplot', fplotImpl('fplot')); R('ezplot', fplotImpl('ezplot'));
  R('fsurf', (args) => {
    const f = args[0]; const lims = args[1] ? arr(args[1]) : [-5, 5, -5, 5];
    const [x0, x1, y0, y1] = lims.length === 2 ? [lims[0], lims[1], lims[0], lims[1]] : lims; const n = 35;
    const xs = Array.from({ length: n }, (_, k) => x0 + (x1 - x0) * k / (n - 1)), ys = Array.from({ length: n }, (_, k) => y0 + (y1 - y0) * k / (n - 1));
    const g = f.type === 'sym' ? I.symToFunc(f, 2) : (x, y) => I.callHandle(f, [x, y], 1)[0];
    const z = ys.map(y => xs.map(x => g(num(x), num(y)).re[0]));
    const a = prepareAxes(); a.is3d = true; a.series.push({ kind: 'surface', style: 'surf', x: xs, y: ys, z });
  });

  // ---------- annotations & axes ----------
  const labelFn = (key) => (args, nout) => {
    const a = ax();
    if (!args.length) throw new MError('Not enough input arguments.', '', key);
    let v = args[0];
    let text = v.type === 'cell' ? toStringList(v).join('\n') : isChar(v) ? charRows(v).join('\n') : v.type === 'string' ? v.data.join('\n') : v.type === 'num' ? String(v.re[0]) : toStr(v);
    if (key === 'ylabel' && a.yside === 'right') a.ylabelRight = text; else a[key] = text;
    for (let k = 1; k + 1 < args.length; k += 2) { const p = toStr(args[k]).toLowerCase(); if (p === 'fontsize') a[key + 'Size'] = toNumber(args[k + 1]); if (p === 'color') a[key + 'Color'] = colorOf(args[k + 1]); }
  };
  R('title', labelFn('title')); R('xlabel', labelFn('xlabel')); R('ylabel', labelFn('ylabel')); R('zlabel', labelFn('zlabel'));
  R('sgtitle', (args) => { fig().sgtitle = toStr(args[0]); });
  R('suptitle', (args) => { fig().sgtitle = toStr(args[0]); });
  R('legend', (args) => {
    const a = ax();
    if (!args.length || (args.length === 1 && isStr(args[0]) && ['show', 'boxon', 'boxoff'].includes(toStr(args[0]).toLowerCase()))) { a.legend = a.legend || { labels: null, location: 'northeast' }; return; }
    if (args.length === 1 && isStr(args[0]) && ['off', 'hide'].includes(toStr(args[0]).toLowerCase())) { a.legend = null; return; }
    let labels = [], location = 'northeast';
    for (let k = 0; k < args.length; k++) {
      const v = args[k];
      if (isStr(v) && ['location', 'orientation', 'fontsize', 'box', 'textcolor', 'autoupdate', 'numcolumns'].includes(toStr(v).toLowerCase()) && k + 1 < args.length) { if (toStr(v).toLowerCase() === 'location') location = toStr(args[k + 1]).toLowerCase(); k++; continue; }
      if (v.type === 'cell') labels.push(...toStringList(v));
      else if (isChar(v) && v.rows > 1) labels.push(...charRows(v).map(s => s.trim()));
      else if (isStr(v)) labels.push(toStr(v));
    }
    a.legend = { labels, location };
  });
  R('grid', (args) => {
    const a = ax(); const w = args.length ? toStr(args[0]).toLowerCase() : 'toggle';
    if (w === 'on') a.grid = true; else if (w === 'off') { a.grid = false; a.minorGrid = false; } else if (w === 'minor') { a.minorGrid = !a.minorGrid; } else a.grid = !a.grid;
  });
  R('box', (args) => { const a = ax(); a.box = !args.length || toStr(args[0]) === 'on'; });
  R('hold', (args) => {
    const w = args.length ? toStr(args[0]).toLowerCase() : 'toggle';
    const a = ax(); a.hold = w === 'on' || w === 'all' ? true : w === 'off' ? false : !a.hold;
  });
  R('ishold', () => num(ax().hold ? 1 : 0));
  R('axis', (args, nout) => {
    const a = ax();
    if (!args.length) { return rowVec([...(a.xlim || [0, 1]), ...(a.ylim || [0, 1])]); }
    for (const v of args) {
      if (isStr(v)) {
        const w = toStr(v).toLowerCase();
        if (['equal', 'square', 'tight', 'normal', 'image'].includes(w)) { a.axisMode = w === 'normal' ? null : w; if (w === 'normal') { a.xlim = a.ylim = null; } }
        else if (w === 'off') a.axisOff = true; else if (w === 'on') a.axisOff = false;
        else if (w === 'auto') { a.xlim = a.ylim = a.zlim = null; }
        else if (w === 'ij' || w === 'xy' || w === 'vis3d' || w === 'manual' || w === 'fill') { }
        else throw new MError(`Unknown command option.`, '', 'axis');
      } else {
        const l = arr(v);
        if (l.length < 4) throw new MError('Vector must have 4, 6, or 8 elements.', '', 'axis');
        a.xlim = [l[0], l[1]]; a.ylim = [l[2], l[3]]; if (l.length >= 6) a.zlim = [l[4], l[5]];
      }
    }
  });
  const limFn = (key) => (args) => { const a = ax(); if (!args.length) return rowVec(a[key] || [0, 1]); if (isStr(args[0])) { a[key] = null; return; } const l = arr(args[0]); if (l[0] >= l[1]) throw new MError('Limits must be a 2-element vector of increasing numeric values.', '', key); if (key === 'ylim' && a.yside === 'right') a.ylimRight = l; else a[key] = l; };
  R('xlim', limFn('xlim')); R('ylim', limFn('ylim')); R('zlim', limFn('zlim'));
  R('xticks', (args) => { ax().xticks = arr(args[0]); }); R('yticks', (args) => { ax().yticks = arr(args[0]); });
  R('xticklabels', (args) => { ax().xticklabels = toStringList(args[0]); }); R('yticklabels', (args) => { ax().yticklabels = toStringList(args[0]); });
  R('text', (args) => {
    const a = ax(); const x = toNumber(args[0]), y = toNumber(args[1]);
    const hasZ = args.length > 3 && !isStr(args[2]);
    const s = hasZ ? args[3] : args[2];
    const t = { x, y, z: hasZ ? toNumber(args[2]) : undefined, text: s.type === 'cell' ? toStringList(s).join('\n') : toStr(s), align: 'left' };
    for (let k = hasZ ? 4 : 3; k + 1 < args.length; k += 2) { const p = toStr(args[k]).toLowerCase(); if (p === 'horizontalalignment') t.align = toStr(args[k + 1]).toLowerCase(); if (p === 'color') t.color = colorOf(args[k + 1]); if (p === 'fontsize') t.size = toNumber(args[k + 1]); }
    a.texts.push(t);
  });
  R('gtext', (args) => { const a = ax(); a.texts.push({ x: null, y: null, text: toStr(args[0]), align: 'center', free: true }); I.warn('gtext: interactive placement is not available; the text was placed at the center of the axes.'); });
  R('annotation', () => {});
  R('colorbar', (args) => { const a = ax(); a.colorbar = !(args.length && toStr(args[0]) === 'off'); });
  R('colormap', (args) => { const a = ax(); if (args.length && isStr(args[0])) a.colormap = toStr(args[0]).toLowerCase(); });
  R('shading', (args) => { ax().shading = toStr(args[0]).toLowerCase(); });
  R('view', (args) => { const a = ax(); if (args.length === 1 && args[0].numel === 1) a.view = args[0].re[0] === 2 ? [0, 90] : [-37.5, 30]; else if (args.length >= 2) a.view = [toNumber(args[0]), toNumber(args[1])]; else if (args.length) a.view = arr(args[0]); a.is3d = !(a.view && a.view[1] === 90); });
  R('rotate3d', () => {}); R('zoom', () => {}); R('pan', () => {}); R('datacursormode', () => {});
  R('subplot', (args) => {
    const f = fig();
    let m, n, p;
    if (args.length === 1) { const v = Math.round(toNumber(args[0])); m = Math.floor(v / 100); n = Math.floor((v % 100) / 10); p = v % 10; }
    else { m = toNumber(args[0]); n = toNumber(args[1]); p = args[2].numel > 1 ? arr(args[2]) : toNumber(args[2]); }
    const pv = Array.isArray(p) ? p : [p];
    for (const q of pv) if (q < 1 || q > m * n) throw new MError('Index exceeds number of subplots.', '', 'subplot');
    if (f.axes.length === 1 && !f.axes[0].pos && f.axes[0].series.length === 0) f.axes = [];
    if (f.axes.length && !f.axes[0].pos) f.axes = [];
    // remove axes overlapping differently-shaped grids
    const key = `${m},${n},${pv.join('-')}`;
    let a = f.axes.find(x => x.pos && x.pos.key === key);
    if (!a) {
      f.axes = f.axes.filter(x => !(x.pos && (x.pos.m !== m || x.pos.n !== n) && x.pos.p.some(q => pv.includes(q))));
      a = newAxes({ m, n, p: pv, key }); f.axes.push(a);
    }
    f.curAx = a;
  });
  R('figure', (args, nout) => {
    let id = null; let name = '';
    for (let k = 0; k < args.length; k++) { if (isStr(args[k])) { const p = toStr(args[k]).toLowerCase(); if (p === 'name') name = toStr(args[k + 1]); k++; } else id = toNumber(args[k]); }
    if (id === null) { id = 1; while (S.figs.has(id)) id++; }
    if (!S.figs.has(id)) S.figs.set(id, { id, name, axes: [], curAx: null, sgtitle: '' });
    else if (name) S.figs.get(id).name = name;
    S.cur = id; S.dirty.add(id);
    if (nout) return num(id);
  });
  R('gcf', () => { const f = fig(); return num(f.id); });
  R('gca', () => { ax(); return num(-1); });
  R('cla', () => { const a = ax(); a.series = []; a.texts = []; a.colorIdx = 0; });
  R('close', (args) => {
    if (args.length && isStr(args[0]) && toStr(args[0]) === 'all') { for (const id of S.figs.keys()) S.closed.push(id); S.figs.clear(); S.cur = null; return; }
    const id = args.length ? toNumber(args[0]) : S.cur;
    if (id !== null && S.figs.has(id)) { S.figs.delete(id); S.closed.push(id); S.dirty.delete(id); S.cur = S.figs.size ? [...S.figs.keys()].pop() : null; }
  });
  R('set', (args) => {
    const h = args[0];
    for (let k = 1; k + 1 < args.length; k += 2) {
      const p = toStr(args[k]).toLowerCase(); const v = args[k + 1];
      const hv = h.type === 'num' ? Array.from(h.re) : [];
      for (const hid of hv) {
        const s = S.handles.get(hid);
        if (s) {
          if (p === 'linewidth') s.lineWidth = toNumber(v); else if (p === 'color') s.color = colorOf(v); else if (p === 'marker') s.marker = (parseLineSpec(toStr(v)) || {}).marker || 'none'; else if (p === 'markersize') s.markerSize = toNumber(v); else if (p === 'linestyle') s.lineStyle = toStr(v); else if (p === 'markerfacecolor') s.mfc = colorOf(v); else if (p === 'markeredgecolor') s.mec = colorOf(v); else if (p === 'displayname') s.name = toStr(v);
          S.dirty.add(S.cur);
        } else if (hid === -1) {
          const a = ax();
          if (p === 'xscale') a.xscale = toStr(v); else if (p === 'yscale') a.yscale = toStr(v); else if (p === 'xlim') a.xlim = arr(v); else if (p === 'ylim') a.ylim = arr(v); else if (p === 'xtick') a.xticks = arr(v); else if (p === 'ytick') a.yticks = arr(v); else if (p === 'xticklabel') a.xticklabels = toStringList(v); else if (p === 'fontsize') a.fontSize = toNumber(v); else if (p === 'xgrid') a.grid = toStr(v) === 'on'; else if (p === 'ygrid') a.grid = toStr(v) === 'on';
        }
      }
    }
  });
  R('get', () => num(0));
  R('saveas', (args) => {
    let id = S.cur; let name, fmt = null;
    if (args.length >= 2) { id = toNumber(args[0]) || S.cur; name = toStr(args[1]); if (args[2]) fmt = toStr(args[2]); }
    else name = toStr(args[0]);
    if (!S.figs.has(id)) throw new MError('Invalid figure handle.', '', 'saveas');
    if (!/\.\w+$/.test(name)) name += '.' + (fmt || 'fig').replace(/^png$/, 'png');
    I.plot.flush();
    I.host.saveFigure(id, name);
  });
  R('print', (args) => {
    let name = 'figure1.png', id = S.cur;
    for (const v of args) { if (isStr(v)) { const s = toStr(v); if (s.startsWith('-f')) id = +s.slice(2) || id; else if (!s.startsWith('-')) name = s; } else id = toNumber(v); }
    if (!/\.\w+$/.test(name)) name += '.png';
    I.plot.flush(); I.host.saveFigure(id, name);
  });
  R('exportgraphics', (args) => { const name = toStr(args[1]); I.plot.flush(); I.host.saveFigure(S.cur, name); });
  R('ginput', () => { throw new MError('ginput is not supported in this environment.'); });
  R('drawnow', () => I.plot.flush());
  R('refresh', () => I.plot.flush());
  R('shg', () => I.plot.flush());
  R('clf', () => { const f = fig(); f.axes = []; f.curAx = null; });
  void className; void zeros; void str; void Tensor;
}
