// Renders engine figure models as MATLAB-like floating figure windows using Plotly.
/* global Plotly */

const PARULA = [[0, '#3E26A8'], [0.1, '#4545E3'], [0.2, '#3D66FA'], [0.3, '#2D86F0'], [0.4, '#1BA2D9'], [0.5, '#16BAA5'], [0.6, '#56C66B'], [0.7, '#A4C231'], [0.8, '#E6B729'], [0.9, '#FCD535'], [1, '#F9FB0E']];
const COLORMAPS = { parula: PARULA, jet: 'Jet', hot: 'Hot', gray: 'Greys', grey: 'Greys', cool: 'Bluered', hsv: 'Rainbow', turbo: 'Turbo', viridis: 'Viridis' };
const MARKERS = { o: 'circle', '+': 'cross-thin', '*': 'asterisk', '.': 'circle', x: 'x-thin', s: 'square', d: 'diamond', '^': 'triangle-up', v: 'triangle-down', '>': 'triangle-right', '<': 'triangle-left', p: 'star', h: 'hexagram' };
const DASH = { '-': 'solid', '--': 'dash', ':': 'dot', '-.': 'dashdot' };
const FONT = { family: 'Helvetica, Arial, sans-serif', size: 12, color: '#262626' };

const TEX = { '\\pi': 'π', '\\theta': 'θ', '\\Theta': 'Θ', '\\alpha': 'α', '\\beta': 'β', '\\gamma': 'γ', '\\delta': 'δ', '\\Delta': 'Δ', '\\epsilon': 'ε', '\\lambda': 'λ', '\\mu': 'μ', '\\sigma': 'σ', '\\Sigma': 'Σ', '\\omega': 'ω', '\\Omega': 'Ω', '\\phi': 'φ', '\\tau': 'τ', '\\rho': 'ρ', '\\eta': 'η', '\\leq': '≤', '\\geq': '≥', '\\neq': '≠', '\\infty': '∞', '\\leftarrow': '←', '\\rightarrow': '→', '\\uparrow': '↑', '\\downarrow': '↓', '\\pm': '±', '\\times': '×', '\\div': '÷', '\\circ': '°', '\\approx': '≈', '\\cdot': '·', '\\deg': '°' };
export function texToHtml(s) {
  if (!s) return '';
  let t = String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  t = t.replace(/\\[A-Za-z]+/g, (m) => { if (TEX[m]) return TEX[m]; for (let k = m.length - 1; k > 1; k--) if (TEX[m.slice(0, k)]) return TEX[m.slice(0, k)] + m.slice(k); return m.slice(1); });
  t = t.replace(/\^\{([^}]*)\}/g, '<sup>$1</sup>').replace(/_\{([^}]*)\}/g, '<sub>$1</sub>');
  t = t.replace(/\^(\S)/g, '<sup>$1</sup>').replace(/_(\S)/g, '<sub>$1</sub>');
  return t.replace(/\n/g, '<br>');
}

function niceStep(r) {
  const raw = r / 8; const p = Math.pow(10, Math.floor(Math.log10(raw))); const m = raw / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
}
function niceLimits(lo, hi) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  if (lo === hi) { const d = Math.abs(lo) || 1; return [lo - d * 0.1 - (lo === 0 ? 0.9 : 0), hi + d * 0.1 + (lo === 0 ? 0.9 : 0)]; }
  const st = niceStep(hi - lo);
  const a = Math.floor(lo / st + 1e-9) * st, b = Math.ceil(hi / st - 1e-9) * st;
  return [a, b];
}

let FIG_W = 620, FIG_H = 450;
function domainOf(pos) {
  // margins in pixels, converted to fractions of the plotting area (like MATLAB's subplot insets)
  const left = 62 / FIG_W, right = 22 / FIG_W, top = 34 / FIG_H, bottom = 50 / FIG_H;
  if (!pos) return { x: [left, 1 - right], y: [bottom, 1 - top] };
  const { m, n, p } = pos;
  const cells = p.map(q => ({ r: Math.floor((q - 1) / n), c: (q - 1) % n }));
  const r0 = Math.min(...cells.map(c => c.r)), r1 = Math.max(...cells.map(c => c.r));
  const c0 = Math.min(...cells.map(c => c.c)), c1 = Math.max(...cells.map(c => c.c));
  const cw = 1 / n, rh = 1 / m;
  let x0 = c0 * cw + left, x1 = (c1 + 1) * cw - right;
  let y1 = 1 - r0 * rh - top, y0 = 1 - (r1 + 1) * rh + bottom;
  if (x1 - x0 < 0.05) { const mid = (c0 + c1 + 1) * cw / 2; x0 = mid - 0.025; x1 = mid + 0.025; }
  if (y1 - y0 < 0.05) { const mid = 1 - (r0 + r1 + 1) * rh / 2; y0 = mid - 0.025; y1 = mid + 0.025; }
  return { x: [Math.max(0, x0), Math.min(1, x1)], y: [Math.max(0, y0), Math.min(1, y1)] };
}

function lineTrace(s, ax, xa, ya) {
  const marker = s.marker && s.marker !== 'none' ? MARKERS[s.marker] || 'circle' : null;
  const filled = s.mfc && s.mfc !== 'none';
  const lineOn = s.lineStyle !== 'none';
  const t = {
    type: s.z ? 'scatter3d' : 'scatter', x: s.x, y: s.y, z: s.z,
    mode: lineOn && marker ? 'lines+markers' : marker ? 'markers' : 'lines',
    line: { color: s.color, width: Math.max(1, (s.lineWidth || 0.5) * 1.6), dash: DASH[s.lineStyle] || 'solid' },
    hoverinfo: 'x+y' + (s.z ? '+z' : ''),
  };
  if (marker) {
    const m = { symbol: marker + (filled || s.marker === '.' || ['+', '*', 'x'].includes(s.marker) ? '' : '-open'), size: s.marker === '.' ? Math.max(4, (s.markerSize || 6) * 0.7) : (s.markerSize || 6) * 1.25, color: filled ? (s.mfc === 'auto' ? s.color : s.mfc) : (s.mec || s.color), line: { color: s.mec || s.color, width: Math.max(1, (s.lineWidth || 0.5) * 1.5) } };
    if (['+', '*', 'x'].includes(s.marker)) m.symbol = marker + '-open';
    t.marker = m;
  }
  if (s.kind === 'stairs') t.line.shape = 'hv';
  if (s.err) t.error_y = { type: 'data', array: s.err, visible: true, color: s.color, thickness: 1, width: 4 };
  if (!s.z) { t.xaxis = xa; t.yaxis = s.yaxis === 'right' ? ax.y2name : ya; }
  return t;
}

export function figureToPlotly(fig, opts = {}) {
  FIG_W = Math.max(200, opts.width || 620); FIG_H = Math.max(160, opts.height || 450);
  const traces = []; const layout = {
    paper_bgcolor: '#F0F0F0', plot_bgcolor: '#FFFFFF', font: FONT, showlegend: false,
    margin: { l: 0, r: 0, t: fig.sgtitle ? 30 : 0, b: 0 }, annotations: [], shapes: [], hovermode: 'closest',
  };
  if (fig.sgtitle) layout.annotations.push({ text: `<b>${texToHtml(fig.sgtitle)}</b>`, xref: 'paper', yref: 'paper', x: 0.5, y: 1.06, showarrow: false, font: { size: 14 } });
  let axisCount = 0, sceneCount = 0, polarCount = 0;
  const legendItems = [];
  fig.axes.forEach((ax, k) => {
    const dom = domainOf(ax.pos);
    const hasPie = ax.series.some(s => s.kind === 'pie');
    if (hasPie) {
      ax.series.filter(s => s.kind === 'pie').forEach(s => {
        const total = s.values.reduce((p, q) => p + q, 0);
        traces.push({ type: 'pie', values: s.values, labels: s.labels || s.values.map((v, i) => `${Math.round(v / total * 100)}%`), text: s.values.map(v => `${Math.round(v / total * 100)}%`), textinfo: s.labels ? 'label' : 'text', sort: false, direction: 'counterclockwise', rotation: 90, domain: dom, marker: { colors: s.values.map((_, i) => PARULA[Math.round(i / Math.max(1, s.values.length - 1) * 10)][1]), line: { color: '#000', width: 1 } }, showlegend: false });
      });
      if (ax.title) layout.annotations.push({ text: `<b>${texToHtml(ax.title)}</b>`, xref: 'paper', yref: 'paper', x: (dom.x[0] + dom.x[1]) / 2, y: dom.y[1] + 0.04, showarrow: false });
      return;
    }
    if (ax.polar) {
      polarCount++; const pn = polarCount === 1 ? 'polar' : `polar${polarCount}`;
      layout[pn] = { domain: dom, bgcolor: '#fff', angularaxis: { thetaunit: 'radians', direction: 'counterclockwise', gridcolor: '#ddd' }, radialaxis: { gridcolor: '#ddd' } };
      ax.series.filter(s => s.kind === 'polar').forEach(s => traces.push({ type: 'scatterpolar', r: s.r, theta: s.theta, thetaunit: 'radians', mode: s.marker !== 'none' ? 'lines+markers' : 'lines', line: { color: s.color, dash: DASH[s.lineStyle] || 'solid' }, subplot: pn }));
      if (ax.title) layout.annotations.push({ text: `<b>${texToHtml(ax.title)}</b>`, xref: 'paper', yref: 'paper', x: (dom.x[0] + dom.x[1]) / 2, y: dom.y[1] + 0.06, showarrow: false });
      return;
    }
    if (ax.is3d) {
      sceneCount++; const sn = sceneCount === 1 ? 'scene' : `scene${sceneCount}`;
      const view = ax.view || [-37.5, 30]; const az = view[0] * Math.PI / 180, el = view[1] * Math.PI / 180;
      const eye = { x: 2.0 * Math.sin(az) * Math.cos(el), y: -2.0 * Math.cos(az) * Math.cos(el), z: 2.0 * Math.sin(el) };
      const axisCfg = (label, lim) => ({ title: { text: texToHtml(label) }, showgrid: true, gridcolor: '#d0d0d0', zeroline: false, showbackground: true, backgroundcolor: '#fff', linecolor: '#262626', showline: true, range: lim || undefined, tickfont: { size: 10 } });
      layout[sn] = { domain: dom, camera: { eye, up: { x: 0, y: 0, z: 1 } }, xaxis: axisCfg(ax.xlabel, ax.xlim), yaxis: axisCfg(ax.ylabel, ax.ylim), zaxis: axisCfg(ax.zlabel, ax.zlim), aspectmode: ax.axisMode === 'equal' ? 'data' : 'cube' };
      for (const s of ax.series) {
        if (s.kind === 'line') { const t = lineTrace(s, ax); t.scene = sn; traces.push(t); legendItems.push({ ax, trace: t, s }); }
        else if (s.kind === 'surface') traces.push(...surfaceTraces(s, ax, sn));
      }
      if (ax.title) layout.annotations.push({ text: `<b>${texToHtml(ax.title)}</b>`, xref: 'paper', yref: 'paper', x: (dom.x[0] + dom.x[1]) / 2, y: Math.min(1.02, dom.y[1] + 0.03), showarrow: false, font: { size: 13 } });
      return;
    }
    axisCount++;
    const xa = axisCount === 1 ? 'x' : `x${axisCount}`, ya = axisCount === 1 ? 'y' : `y${axisCount}`;
    const xk = axisCount === 1 ? 'xaxis' : `xaxis${axisCount}`, yk = axisCount === 1 ? 'yaxis' : `yaxis${axisCount}`;
    const hasRight = ax.series.some(s => s.yaxis === 'right');
    let y2name = null, y2k = null;
    if (hasRight) { axisCount++; y2name = `y${axisCount}`; y2k = `yaxis${axisCount}`; }
    ax.y2name = y2name;
    // compute data limits
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity, y2min = Infinity, y2max = -Infinity;
    const upd = (xs, ys, right) => {
      for (const v of xs || []) if (v !== null && Number.isFinite(v) && (ax.xscale !== 'log' || v > 0)) { if (v < xmin) xmin = v; if (v > xmax) xmax = v; }
      for (const v of ys || []) if (v !== null && Number.isFinite(v) && (ax.yscale !== 'log' || v > 0)) { if (right) { if (v < y2min) y2min = v; if (v > y2max) y2max = v; } else { if (v < ymin) ymin = v; if (v > ymax) ymax = v; } }
    };
    let categorical = null;
    for (const s of ax.series) {
      if (s.kind === 'line' || s.kind === 'stairs') { const t = lineTrace(s, ax, xa, ya); traces.push(t); legendItems.push({ ax, trace: t, s }); upd(s.x, s.err ? s.y.map((v, i) => v + s.err[i]).concat(s.y.map((v, i) => v - s.err[i])) : s.y, s.yaxis === 'right'); }
      else if (s.kind === 'stem') {
        const xs = [], ys = [];
        s.x.forEach((x, i) => { xs.push(x, x, null); ys.push(0, s.y[i], null); });
        traces.push({ type: 'scatter', x: xs, y: ys, mode: 'lines', line: { color: s.color, width: Math.max(1, s.lineWidth * 1.6) }, xaxis: xa, yaxis: ya, hoverinfo: 'skip' });
        const t = lineTrace({ ...s, lineStyle: 'none' }, ax, xa, ya); traces.push(t); legendItems.push({ ax, trace: t, s }); upd(s.x, [...s.y, 0]);
      } else if (s.kind === 'area') {
        traces.push({ type: 'scatter', x: s.x, y: s.x.map(() => s.base), mode: 'lines', line: { width: 0 }, xaxis: xa, yaxis: ya, hoverinfo: 'skip' });
        const t = { type: 'scatter', x: s.x, y: s.y, fill: 'tonexty', fillcolor: s.color, mode: 'lines', line: { color: '#000', width: 1 }, xaxis: xa, yaxis: ya };
        traces.push(t); legendItems.push({ ax, trace: t, s }); upd(s.x, [...s.y, s.base]);
      } else if (s.kind === 'fill') {
        const t = { type: 'scatter', x: [...s.x, s.x[0]], y: [...s.y, s.y[0]], fill: 'toself', fillcolor: s.color, mode: 'lines', line: { color: '#000', width: 1 }, xaxis: xa, yaxis: ya };
        traces.push(t); legendItems.push({ ax, trace: t, s }); upd(s.x, s.y);
      } else if (s.kind === 'bar') {
        const t = s.hist
          ? { type: 'bar', x: s.x, y: s.y, width: s.edges.slice(1).map((e, i) => e - s.edges[i]), marker: { color: s.color, opacity: s.opacity ?? 1, line: { color: '#000', width: 0.8 } }, xaxis: xa, yaxis: ya }
          : { type: 'bar', x: s.horizontal ? s.y : s.x, y: s.horizontal ? s.x : s.y, orientation: s.horizontal ? 'h' : 'v', width: s.width, marker: { color: s.color, line: { color: '#000', width: 0.8 } }, xaxis: xa, yaxis: ya };
        traces.push(t); legendItems.push({ ax, trace: t, s });
        if (s.hist) upd(s.edges, [0, ...s.y]); else if (s.horizontal) upd([0, ...s.y], s.x.map(v => [v - 0.5, v + 0.5]).flat()); else upd(s.x.map(v => [v - 0.5, v + 0.5]).flat(), [0, ...s.y]);
        layout.barmode = 'group'; layout.bargap = s.hist ? 0 : 0.2;
      } else if (s.kind === 'box') {
        categorical = s.groups.map(g => g.name);
        s.groups.forEach((g, i) => { traces.push({ type: 'box', y: g.values, name: g.name, x: g.values.map(() => g.name), boxpoints: 'outliers', line: { color: '#0000FF', width: 1 }, fillcolor: 'rgba(0,0,0,0)', marker: { color: '#FF0000', symbol: 'cross-thin-open', size: 7 }, whiskerwidth: 0.5, xaxis: xa, yaxis: ya, hoverinfo: 'y' }); upd([], g.values); });
      } else if (s.kind === 'surface') {
        traces.push(...surfaceTraces(s, ax, null, xa, ya));
        if (s.x) upd(s.x, s.y);
        else if (s.z) upd([0.5, s.z[0].length + 0.5], [0.5, s.z.length + 0.5]);
      }
    }
    const isImg = ax.series.some(s => s.kind === 'surface' && (s.style === 'imagesc' || s.style === 'imshow'));
    let xr = ax.xlim, yr = ax.ylim;
    const tight = ax.axisMode === 'tight' || isImg;
    if (!xr && Number.isFinite(xmin)) xr = categorical ? null : (tight || ax.series.some(s => s.kind === 'line' && !s.marker) ? [xmin, xmax] : niceLimits(xmin, xmax));
    if (!xr && Number.isFinite(xmin) && !categorical) xr = niceLimits(xmin, xmax);
    if (xr && xr[0] === xr[1]) xr = niceLimits(xr[0], xr[1]);
    if (!yr && Number.isFinite(ymin)) yr = tight ? [ymin, ymax] : niceLimits(ymin, ymax);
    if (yr && yr[0] === yr[1]) yr = niceLimits(yr[0], yr[1]);
    // MATLAB keeps x tight for line plots when limits coincide with ticks; use nice limits otherwise
    if (!ax.xlim && xr && !tight && !categorical && Number.isFinite(xmin)) { const nl = niceLimits(xmin, xmax); xr = nl; }
    const logR = (r, scale) => (r && scale === 'log' ? r.map(v => Math.log10(Math.max(v, 1e-300))) : r);
    const axisBase = (label, range, scale, grid, dom2, anchor, extra = {}) => ({
      domain: dom2, anchor, title: { text: texToHtml(label), font: { size: 13 }, standoff: 4 }, automargin: false, range: logR(range, scale) || undefined, type: scale === 'log' ? 'log' : categorical && anchor.startsWith('y') ? 'category' : 'linear', autorange: range ? false : true,
      showline: !ax.axisOff, mirror: ax.box ? 'ticks' : false, linecolor: '#262626', linewidth: 1, ticks: ax.axisOff ? '' : 'inside', ticklen: 5, tickcolor: '#262626',
      showgrid: grid, gridcolor: '#DCDCDC', zeroline: false, visible: !ax.axisOff, tickfont: { size: 11 }, exponentformat: 'power', ...extra,
      minor: ax.minorGrid ? { showgrid: true, gridcolor: '#F0F0F0' } : undefined,
    });
    layout[xk] = axisBase(ax.xlabel, xr, ax.xscale, ax.grid, dom.x, ya, { tickvals: ax.xticks || undefined, ticktext: ax.xticklabels || undefined });
    if (categorical) { layout[xk].type = 'category'; layout[xk].range = undefined; layout[xk].autorange = true; }
    layout[yk] = axisBase(ax.ylabel, yr, ax.yscale, ax.grid, dom.y, xa, { tickvals: ax.yticks || undefined, ticktext: ax.yticklabels || undefined });
    if (hasRight) {
      const r2 = ax.ylimRight || (Number.isFinite(y2min) ? niceLimits(y2min, y2max) : null);
      layout[y2k] = { ...axisBase(ax.ylabelRight, r2, 'linear', false, dom.y, xa), overlaying: ya, side: 'right', mirror: false };
      layout[yk].mirror = false;
      if (ax.plotyy) { layout[yk].tickfont = { color: '#0072BD', size: 11 }; layout[y2k].tickfont = { color: '#D95319', size: 11 }; }
    }
    if (isImg) { layout[yk].autorange = 'reversed'; layout[yk].range = undefined; }
    if (ax.axisMode === 'equal' || ax.axisMode === 'image') { layout[yk].scaleanchor = xa; layout[yk].scaleratio = 1; layout[yk].constrain = 'domain'; layout[xk].constrain = 'domain'; }
    if (ax.axisMode === 'square' && xr && yr) { layout[yk].scaleanchor = xa; layout[yk].scaleratio = (xr[1] - xr[0]) / (yr[1] - yr[0]); layout[yk].constrain = 'domain'; }
    if (ax.title) layout.annotations.push({ text: `<b>${texToHtml(ax.title)}</b>`, xref: 'paper', yref: 'paper', x: (dom.x[0] + dom.x[1]) / 2, y: dom.y[1], yanchor: 'bottom', yshift: 6, showarrow: false, font: { size: 13 } });
    for (const t of ax.texts) {
      if (t.free) { layout.annotations.push({ text: texToHtml(t.text), xref: 'paper', yref: 'paper', x: (dom.x[0] + dom.x[1]) / 2, y: (dom.y[0] + dom.y[1]) / 2, showarrow: false }); continue; }
      layout.annotations.push({ text: texToHtml(t.text), x: ax.xscale === 'log' ? Math.log10(t.x) : t.x, y: ax.yscale === 'log' ? Math.log10(t.y) : t.y, xref: xa, yref: ya, showarrow: false, xanchor: t.align === 'right' ? 'right' : t.align === 'center' ? 'center' : 'left', font: { color: t.color || '#000', size: t.size ? t.size * 1.25 : 12 } });
    }
    if (ax.colorbar) { const last = traces[traces.length - 1]; if (last) { last.showscale = true; last.colorbar = { x: dom.x[1] + 0.01, len: dom.y[1] - dom.y[0], y: (dom.y[0] + dom.y[1]) / 2, thickness: 12 }; } }
  });
  // legends (one per axes, drawn as annotation-like box via Plotly legend only for first axes)
  const axesWithLegend = fig.axes.filter(a => a.legend);
  if (axesWithLegend.length) {
    const ax = axesWithLegend[0];
    const items = legendItems.filter(li => li.ax === ax);
    const labels = ax.legend.labels;
    items.forEach((li, i) => {
      const name = labels ? labels[i] : li.s.name || `data${i + 1}`;
      if (name === undefined) return;
      li.trace.name = texToHtml(name); li.trace.showlegend = true;
    });
    layout.showlegend = true;
    const k = fig.axes.indexOf(ax); const dom = domainOf(ax.pos);
    const loc = ax.legend.location || 'northeast';
    const pos = {
      northeast: [dom.x[1] - 0.01, dom.y[1] - 0.01, 'right', 'top'], northwest: [dom.x[0] + 0.01, dom.y[1] - 0.01, 'left', 'top'],
      southeast: [dom.x[1] - 0.01, dom.y[0] + 0.01, 'right', 'bottom'], southwest: [dom.x[0] + 0.01, dom.y[0] + 0.01, 'left', 'bottom'],
      north: [(dom.x[0] + dom.x[1]) / 2, dom.y[1] - 0.01, 'center', 'top'], south: [(dom.x[0] + dom.x[1]) / 2, dom.y[0] + 0.01, 'center', 'bottom'],
      east: [dom.x[1] - 0.01, (dom.y[0] + dom.y[1]) / 2, 'right', 'middle'], west: [dom.x[0] + 0.01, (dom.y[0] + dom.y[1]) / 2, 'left', 'middle'],
      northeastoutside: [dom.x[1] + 0.01, dom.y[1], 'left', 'top'], eastoutside: [dom.x[1] + 0.01, (dom.y[0] + dom.y[1]) / 2, 'left', 'middle'],
      best: [dom.x[1] - 0.01, dom.y[1] - 0.01, 'right', 'top'],
    }[loc] || [dom.x[1] - 0.01, dom.y[1] - 0.01, 'right', 'top'];
    layout.legend = { x: pos[0], y: pos[1], xanchor: pos[2], yanchor: pos[3], bgcolor: '#FFFFFF', bordercolor: '#262626', borderwidth: 1, font: { size: 11 } };
  }
  traces.forEach(t => { if (t.showlegend === undefined) t.showlegend = false; });
  return { data: traces, layout };
}

function surfaceTraces(s, ax, scene, xa, ya) {
  const cs = COLORMAPS[ax.colormap] || PARULA;
  const out = [];
  const z = s.z;
  if (s.style === 'imagesc' || s.style === 'imshow' || s.style === 'pcolor') {
    const t = { type: 'heatmap', z, x: s.x || undefined, y: s.y || undefined, colorscale: s.style === 'imshow' ? 'Greys' : cs, reversescale: s.style === 'imshow', showscale: false, xaxis: xa, yaxis: ya };
    if (s.style === 'imshow') { const mx = s.cls === 'uint8' ? 255 : 1; t.zmin = 0; t.zmax = mx; t.colorscale = [[0, '#000'], [1, '#fff']]; t.reversescale = false; }
    out.push(t); return out;
  }
  if (s.style === 'contour' || s.style === 'contourf') {
    const t = { type: 'contour', z, x: s.x, y: s.y, colorscale: cs, showscale: false, contours: { coloring: s.style === 'contourf' ? 'fill' : 'lines' }, line: { width: 1.2 }, xaxis: xa, yaxis: ya };
    if (typeof s.levels === 'number') t.ncontours = s.levels; else if (Array.isArray(s.levels)) { t.contours.start = Math.min(...s.levels); t.contours.end = Math.max(...s.levels); t.contours.size = (t.contours.end - t.contours.start) / Math.max(1, s.levels.length - 1) || 1; t.autocontour = false; }
    out.push(t); return out;
  }
  const dx = s.x.length > 1 ? (s.x[s.x.length - 1] - s.x[0]) / (s.x.length - 1) : 1;
  const dy = s.y.length > 1 ? (s.y[s.y.length - 1] - s.y[0]) / (s.y.length - 1) : 1;
  const flat = (z || []).flat().filter(v => v !== null);
  const zmin = Math.min(...flat), zmax = Math.max(...flat);
  const isMesh = s.style.startsWith('mesh') || s.style === 'waterfall';
  const edges = ax.shading === 'faceted' || isMesh;
  const lines = (dim, start, end, size) => ({ show: edges, start, end, size: Math.abs(size) || 1, color: isMesh ? undefined : '#000', usecolormap: isMesh, width: 1, highlight: false });
  const t = {
    type: 'surface', x: s.x, y: s.y, z, colorscale: cs, showscale: false, hidesurface: isMesh,
    contours: { x: lines('x', Math.min(...s.x), Math.max(...s.x), dx), y: lines('y', Math.min(...s.y), Math.max(...s.y), dy), z: { show: s.style === 'meshc' || s.style === 'surfc', project: { z: true }, usecolormap: true, start: zmin, end: zmax, size: (zmax - zmin) / 10 || 1, highlight: false } },
    lighting: { ambient: 0.9, diffuse: 0.4, specular: 0.05 }, scene,
  };
  if (s.style === 'surfc' || s.style === 'meshc') { t.contours.z.show = true; t.contours.z.project = { z: true }; }
  if (isMesh) t.opacity = 1;
  out.push(t);
  if (s.style === 'meshz') {
    // curtain around the edges down to the minimum z
    const xs = [], ys = [], zs = [];
    const R = z.length, C = z[0].length;
    const ring = [];
    for (let j = 0; j < C; j++) ring.push([0, j]); for (let i = 1; i < R; i++) ring.push([i, C - 1]); for (let j = C - 2; j >= 0; j--) ring.push([R - 1, j]); for (let i = R - 2; i >= 0; i--) ring.push([i, 0]);
    for (const [i, j] of ring) { xs.push(s.x[j], s.x[j], null); ys.push(s.y[i], s.y[i], null); zs.push(z[i][j], zmin, null); }
    out.push({ type: 'scatter3d', x: xs, y: ys, z: zs, mode: 'lines', line: { color: '#555', width: 2 }, scene, hoverinfo: 'skip' });
  }
  return out;
}

// ---------------- window manager ----------------
let plotlyPromise = null;
export function ensurePlotly() {
  if (window.Plotly) return Promise.resolve();
  if (!plotlyPromise) plotlyPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = new URL('../vendor/plotly.min.js', import.meta.url).href;
    s.onload = () => resolve(); s.onerror = () => { plotlyPromise = null; reject(new Error('Could not load the plotting library. Check your connection.')); };
    document.head.appendChild(s);
  });
  return plotlyPromise;
}
export class FigureManager {
  constructor(container, { onClose } = {}) {
    this.container = container; this.windows = new Map(); this.z = 100; this.onClose = onClose;
    this.models = new Map();
  }
  async update(payload) {
    for (const id of payload.closed || []) this.close(id, true);
    for (const fig of payload.figures) this.models.set(fig.id, fig);
    if (!payload.figures.length) return;
    await ensurePlotly();
    for (const fig of payload.figures) if (this.models.get(fig.id) === fig) this.render(fig);
  }
  ensureWindow(fig) {
    let w = this.windows.get(fig.id);
    if (w) return w;
    const el = document.createElement('div');
    el.className = 'figwin';
    const n = this.windows.size;
    const narrow = window.innerWidth < 760;
    const fw = Math.min(620, window.innerWidth - 20);
    el.style.width = `${fw}px`;
    el.style.left = narrow ? '8px' : `${Math.max(10, window.innerWidth - fw - 20 - 30 * n)}px`;
    el.style.top = narrow ? `${60 + 20 * n}px` : `${70 + 30 * n}px`;
    el.style.zIndex = ++this.z;
    el.innerHTML = `
      <div class="figwin-title"><span class="figwin-icon"></span><span class="figwin-name"></span>
        <span class="figwin-btns"><button class="fw-min" title="Minimize">&#8212;</button><button class="fw-max" title="Maximize">&#9744;</button><button class="fw-close" title="Close">&#10005;</button></span></div>
      <div class="figwin-menu"><span>File</span><span>Edit</span><span>View</span><span>Insert</span><span>Tools</span><span>Desktop</span><span>Window</span><span>Help</span></div>
      <div class="figwin-tools"><button class="fw-png" title="Save as PNG">&#128190; Save PNG</button></div>
      <div class="figwin-plot"></div>`;
    this.container.appendChild(el);
    const plot = el.querySelector('.figwin-plot');
    el.addEventListener('mousedown', () => { el.style.zIndex = ++this.z; });
    el.querySelector('.fw-close').onclick = () => this.close(fig.id);
    el.querySelector('.fw-min').onclick = () => el.classList.toggle('minimized');
    el.querySelector('.fw-max').onclick = () => { el.classList.toggle('maximized'); Plotly.Plots.resize(plot); };
    el.querySelector('.fw-png').onclick = () => this.downloadPng(fig.id);
    dragBy(el.querySelector('.figwin-title'), el);
    let rt = null;
    new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => { const f = this.models.get(fig.id); if (f && plot._fullLayout) this.render(f, true); }, 120); }).observe(plot);
    w = { el, plot }; this.windows.set(fig.id, w);
    return w;
  }
  render(fig, resizeOnly = false) {
    const w = this.ensureWindow(fig);
    w.el.querySelector('.figwin-name').textContent = `Figure ${fig.id}${fig.name ? ': ' + fig.name : ''}`;
    const { data, layout } = figureToPlotly(fig, { width: w.plot.clientWidth, height: w.plot.clientHeight });
    Plotly.react(w.plot, data, layout, { displaylogo: false, responsive: true, modeBarButtonsToRemove: ['sendDataToCloud', 'lasso2d', 'select2d'] });
    if (resizeOnly) return;
    w.el.classList.remove('minimized');
    w.el.style.zIndex = ++this.z;
  }
  close(id, fromEngine = false) {
    const w = this.windows.get(id); if (!w) return;
    Plotly.purge(w.plot); w.el.remove(); this.windows.delete(id); this.models.delete(id);
    if (!fromEngine && this.onClose) this.onClose(id);
  }
  closeAll() { for (const id of [...this.windows.keys()]) this.close(id, true); }
  async toPngBytes(id) {
    await ensurePlotly();
    let w = this.windows.get(id);
    const fig = this.models.get(id);
    if (!w && fig) { this.render(fig); w = this.windows.get(id); }
    if (!w) throw new Error('figure not found');
    const url = await Plotly.toImage(w.plot, { format: 'png', width: 840, height: 630 });
    const b64 = url.split(',')[1]; const bin = atob(b64); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  async downloadPng(id) {
    const bytes = await this.toPngBytes(id);
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: 'image/png' })); a.download = `figure${id}.png`; a.click();
  }
}

function dragBy(handle, el) {
  let sx, sy, ox, oy, dragging = false;
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    dragging = true; sx = e.clientX; sy = e.clientY; ox = el.offsetLeft; oy = el.offsetTop; handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    el.style.left = `${Math.max(-el.offsetWidth + 80, Math.min(window.innerWidth - 80, ox + e.clientX - sx))}px`;
    el.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, oy + e.clientY - sy))}px`;
  });
  handle.addEventListener('pointerup', () => { dragging = false; });
}
