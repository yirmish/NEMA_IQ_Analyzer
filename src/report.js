/* =====================================================================================
 * NEMA IQ Analyzer - report rendering (SVG charts, canvas images, printable A4 pages)
 * ===================================================================================== */
(function (G) {
'use strict';
const N = G.NEMA;
const R = {};
const C = { hot: '#d62728', cold: '#1f77b4', bg: '#2ca02c', lung: '#ff7f0e', base: '#555555', grey: '#9a9a9a', ref: '#7b3fa0' };
R.COLORS = C;
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f = (v, d = 1) => (v == null || !isFinite(v)) ? '-' : (+v).toFixed(d);
const pm = (m, s, d = 1) => s == null || !isFinite(s) ? f(m, d) : `${f(m, d)} ± ${f(s, d)}`;
const x3 = v => v == null || !isFinite(v) ? '' : (+v).toFixed(3);
const sgn = (v, d = 1) => (v == null || !isFinite(v)) ? '-' : (v >= 0 ? '+' : '') + (+v).toFixed(d);
R.esc = esc; R.f = f;

// ------------------------------------------------------------------ SVG charts
function niceTicks(lo, hi, n = 6) {
  const span = hi - lo, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= n) || raw;
  const t = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) t.push(+v.toFixed(10));
  return t;
}
function marker(shape, x, y, sz, col, fill) {
  const fl = fill === false ? 'white' : col;
  if (shape === 't') return `<path d="M${x} ${y - sz * 1.3}L${x + sz * 1.15} ${y + sz * 0.8}L${x - sz * 1.15} ${y + sz * 0.8}Z" fill="${fl}" stroke="${col}" stroke-width="1.2"/>`;
  if (shape === 's') return `<rect x="${x - sz}" y="${y - sz}" width="${2 * sz}" height="${2 * sz}" fill="${fl}" stroke="${col}" stroke-width="1.2"/>`;
  if (shape === 'd') return `<path d="M${x} ${y - sz * 1.3}L${x + sz} ${y}L${x} ${y + sz * 1.3}L${x - sz} ${y}Z" fill="${fl}" stroke="${col}" stroke-width="1.2"/>`;
  return `<circle cx="${x}" cy="${y}" r="${sz}" fill="${fl}" stroke="${col}" stroke-width="1.2"/>`;
}
/* o: {w,h,title,xlabel,ylabel,xmin,xmax,ymin,ymax,xticks,series:[{kind:'line'|'points'|'limit', x,y,err,color,shape,label,fill,dash,labels}],
       hlines:[{y,color,dash,label}], vspan:[x0,x1,color], legend:'lr'|'ur'|'ul'|'ll'} */
R.chart = function (o) {
  const W = o.w || 460, H = o.h || 270, m = { l: 50, r: 12, t: o.title ? 24 : 10, b: 40 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const X = v => m.l + (v - o.xmin) / (o.xmax - o.xmin) * pw, Y = v => m.t + ph - (v - o.ymin) / (o.ymax - o.ymin) * ph;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" class="chart" font-family="Segoe UI, Arial, sans-serif">`;
  if (o.title) s += `<text x="${m.l + pw / 2}" y="15" text-anchor="middle" font-size="12" font-weight="600">${esc(o.title)}</text>`;
  const yt = niceTicks(o.ymin, o.ymax, 6);
  for (const t of yt) s += `<line x1="${m.l}" x2="${m.l + pw}" y1="${Y(t)}" y2="${Y(t)}" stroke="#e3e3e3"/><text x="${m.l - 5}" y="${Y(t) + 3.5}" text-anchor="end" font-size="10">${t}</text>`;
  const xt = o.xticks || niceTicks(o.xmin, o.xmax, 8);
  for (const t of xt) s += `<line x1="${X(t)}" x2="${X(t)}" y1="${m.t}" y2="${m.t + ph}" stroke="#f0f0f0"/><text x="${X(t)}" y="${m.t + ph + 14}" text-anchor="middle" font-size="10">${t}</text>`;
  if (o.vspan) s += `<rect x="${X(o.vspan[0])}" y="${m.t}" width="${X(o.vspan[1]) - X(o.vspan[0])}" height="${ph}" fill="${o.vspan[2]}" opacity="0.12"/>`;
  s += `<rect x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="none" stroke="#333"/>`;
  s += `<text x="${m.l + pw / 2}" y="${H - 6}" text-anchor="middle" font-size="11">${esc(o.xlabel || '')}</text>`;
  s += `<text transform="translate(13 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle" font-size="11">${esc(o.ylabel || '')}</text>`;
  s += `<defs><clipPath id="cp${o.id || 0}"><rect x="${m.l}" y="${m.t}" width="${pw}" height="${ph}"/></clipPath></defs><g clip-path="url(#cp${o.id || 0})">`;
  const leg = [];
  for (const h of (o.hlines || [])) {
    s += `<line x1="${m.l}" x2="${m.l + pw}" y1="${Y(h.y)}" y2="${Y(h.y)}" stroke="${h.color}" stroke-width="1.2" stroke-dasharray="${h.dash || ''}"/>`;
    if (h.label) leg.push({ kind: 'hline', color: h.color, dash: h.dash, label: h.label });
  }
  for (const se of (o.series || [])) {
    const pts = se.x.map((x, i) => [x, se.y[i], se.err ? se.err[i] : 0, se.labels ? se.labels[i] : null]).filter(p => p[1] != null && isFinite(p[1]));
    if (se.kind === 'limit') {
      for (const [x, y] of pts) s += `<line x1="${X(x) - 9}" x2="${X(x) + 9}" y1="${Y(y)}" y2="${Y(y)}" stroke="#000" stroke-width="2.2"/>`;
    } else {
      if (se.kind === 'line' && pts.length > 1) s += `<polyline points="${pts.map(p => `${X(p[0])},${Y(p[1])}`).join(' ')}" fill="none" stroke="${se.color}" stroke-width="${se.lw || 1.6}" stroke-dasharray="${se.dash || ''}"/>`;
      for (const [x, y, e] of pts) if (e) s += `<line x1="${X(x)}" x2="${X(x)}" y1="${Y(y - e)}" y2="${Y(y + e)}" stroke="${se.color}" stroke-width="1"/><line x1="${X(x) - 3}" x2="${X(x) + 3}" y1="${Y(y - e)}" y2="${Y(y - e)}" stroke="${se.color}"/><line x1="${X(x) - 3}" x2="${X(x) + 3}" y1="${Y(y + e)}" y2="${Y(y + e)}" stroke="${se.color}"/>`;
      if (se.shape !== 'none') for (const [x, y] of pts) s += marker(se.shape || 'o', X(x), Y(y), se.size || 3.6, se.color, se.fill);
    }
    for (const [x, y, , lab] of pts) if (lab != null) s += `<text x="${X(x) + (se.labelDx || 0)}" y="${Y(y) - 7}" text-anchor="middle" font-size="9.5" fill="#222">${esc(lab)}</text>`;
    if (se.label) leg.push(se);
  }
  s += '</g>';
  if (leg.length) {
    const lw = Math.max(...leg.map(l => l.label.length)) * 5.6 + 34, lh = leg.length * 14 + 6;
    const pos = o.legend || 'lr';
    const lx = pos.includes('l') && pos[1] === 'l' ? m.l + 6 : m.l + pw - lw - 6;
    const ly = pos[0] === 'u' ? m.t + 6 : m.t + ph - lh - 6;
    s += `<rect x="${lx}" y="${ly}" width="${lw}" height="${lh}" fill="white" fill-opacity="0.92" stroke="#bbb"/>`;
    leg.forEach((l, i) => {
      const yy = ly + 12 + i * 14, xx = lx + 8;
      if (l.kind === 'limit') s += `<line x1="${xx}" x2="${xx + 16}" y1="${yy - 3}" y2="${yy - 3}" stroke="#000" stroke-width="2.2"/>`;
      else if (l.kind === 'hline') s += `<line x1="${xx}" x2="${xx + 16}" y1="${yy - 3}" y2="${yy - 3}" stroke="${l.color}" stroke-width="1.4" stroke-dasharray="${l.dash || ''}"/>`;
      else { if (l.kind === 'line') s += `<line x1="${xx}" x2="${xx + 16}" y1="${yy - 3}" y2="${yy - 3}" stroke="${l.color}" stroke-width="1.6"/>`;
             if (l.shape !== 'none') s += marker(l.shape || 'o', xx + 8, yy - 3, 3.4, l.color, l.fill); }
      s += `<text x="${xx + 22}" y="${yy}" font-size="10">${esc(l.label)}</text>`;
    });
  }
  return s + '</svg>';
};

// ------------------------------------------------------------------ images (canvas -> PNG data URL)
R.hasCanvas = () => typeof document !== 'undefined' && !!document.createElement;
/* o: {img, ny, nx, rows:[y0,y1), cols:[x0,x1), vmin, vmax, scale, yscale, overlays:[{t:'circle',x,y,r,color,lw,dash,text}|{t:'hline',y,color,dash,lw}|{t:'hband',y0,y1,color,alpha}]} */
R.renderImage = function (o) {
  if (!R.hasCanvas()) return '';
  const [y0, y1] = o.rows, [x0, x1] = o.cols, h = y1 - y0, w = x1 - x0, sc = o.scale || 2, ys = o.yscale || 1;
  const base = document.createElement('canvas'); base.width = w; base.height = h;
  const bctx = base.getContext('2d'), id = bctx.createImageData(w, h), vmin = o.vmin || 0, vmax = o.vmax || 1;
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const v = o.img[(y0 + yy) * o.nx + x0 + xx]; let t = (v - vmin) / (vmax - vmin); t = t < 0 ? 0 : t > 1 ? 1 : t;
    const g = Math.round(255 * (1 - t)), p = (yy * w + xx) * 4; id.data[p] = id.data[p + 1] = id.data[p + 2] = g; id.data[p + 3] = 255;
  }
  bctx.putImageData(id, 0, 0);
  const cv = document.createElement('canvas'); cv.width = Math.round(w * sc); cv.height = Math.round(h * sc * ys);
  const ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.drawImage(base, 0, 0, cv.width, cv.height);
  const PX = x => (x - x0 + 0.5) * sc, PY = y => (y - y0 + 0.5) * sc * ys;
  for (const ov of (o.overlays || [])) {
    ctx.save(); ctx.strokeStyle = ov.color; ctx.lineWidth = ov.lw || 1.2; ctx.setLineDash(ov.dash || []); ctx.globalAlpha = ov.alpha == null ? 1 : ov.alpha;
    if (ov.t === 'circle') {
      ctx.beginPath(); ctx.ellipse(PX(ov.x), PY(ov.y), ov.r * sc, ov.r * sc * ys, 0, 0, 2 * Math.PI); ctx.stroke();
      if (ov.text) { ctx.globalAlpha = 1; ctx.fillStyle = ov.color; ctx.font = `${Math.round(10 * sc / 2)}px Segoe UI, Arial`; ctx.textAlign = 'center';
                     ctx.fillText(ov.text, PX(ov.x), PY(ov.y) - ov.r * sc * ys - 3); }
    } else if (ov.t === 'hline') { ctx.beginPath(); ctx.moveTo(0, PY(ov.y)); ctx.lineTo(cv.width, PY(ov.y)); ctx.stroke(); }
    else if (ov.t === 'hband') { ctx.fillStyle = ov.color; ctx.globalAlpha = ov.alpha || 0.15; ctx.fillRect(0, PY(ov.y0 - 0.5), cv.width, PY(ov.y1 + 0.5) - PY(ov.y0 - 0.5)); }
    ctx.restore();
  }
  return cv.toDataURL('image/png');
};

function sliceOf(vol, k, npx) { return vol.subarray(k * npx, (k + 1) * npx); }
function cropBox(res, margin = 12) {
  const { ny, nx } = res.dims, b = res.geom.body2d; let y0 = ny, y1 = 0, x0 = nx, x1 = 0;
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) if (b[y * nx + x]) { if (y < y0) y0 = y; if (y > y1) y1 = y; if (x < x0) x0 = x; if (x > x1) x1 = x; }
  return { rows: [Math.max(y0 - margin, 0), Math.min(y1 + margin + 1, ny)], cols: [Math.max(x0 - margin, 0), Math.min(x1 + margin + 1, nx)] };
}
function vmaxFor(res, frame) {
  const hot = res.geom.spheres.map((q, j) => q.type === 'hot' ? frame.C_sphere[j] : null).filter(v => v != null);
  return hot.length ? 1.1 * Math.max(...hot) : 2 * frame.C_B37;
}
function roiOverlays(res, showBg = true) {
  const px = res.px, ov = [];
  res.geom.spheres.forEach(q => ov.push({ t: 'circle', x: q.x, y: q.y, r: q.d / 2 / px, color: q.type === 'hot' ? C.hot : C.cold, lw: 1.3, text: String(q.d) }));
  if (showBg) for (const c of res.rois.bgCentres) for (const d of N.SPHERE_D)
    ov.push({ t: 'circle', x: c[0], y: c[1], r: d / 2 / px, color: C.bg, lw: d === 37 ? 1.1 : 0.5, alpha: d === 37 ? 0.95 : 0.55 });
  if (res.geom.lung_present) {
    const [lx, ly] = res.geom.lungXY(res.geom.iz0);
    ov.push({ t: 'circle', x: lx, y: ly, r: N.CONST.LUNG_ROI_D / 2 / px, color: C.lung, lw: 1.2, dash: [4, 3] });
  }
  return ov;
}
R.transaxial = function (res, vol, vmax, scale) {
  const npx = res.dims.ny * res.dims.nx, bx = cropBox(res);
  return R.renderImage({ img: sliceOf(vol, res.geom.iz0, npx), ny: res.dims.ny, nx: res.dims.nx, rows: bx.rows, cols: bx.cols,
                         vmin: 0, vmax, scale: scale || 2, overlays: roiOverlays(res) });
};
R.coronal = function (res, vol, vmax) {
  const { nz, ny, nx } = res.dims, [, ly] = res.geom.lungXY(res.geom.iz0), row = Math.round(ly);
  const img = new Float32Array(nz * nx);
  for (let k = 0; k < nz; k++) for (let x = 0; x < nx; x++) img[k * nx + x] = vol[k * ny * nx + row * nx + x];
  const bx = cropBox(res), z0 = Math.max(Math.floor(res.geom.zb[0]) - 6, 0), z1 = Math.min(Math.ceil(res.geom.zb[1]) + 7, nz);
  const ls = res.rois.lungSlices, ov = ls.length ? [{ t: 'hband', y0: ls[0], y1: ls[ls.length - 1], color: C.lung, alpha: 0.16 }] : [];
  res.rois.bgSlices.forEach(k => ov.push({ t: 'hline', y: k, color: C.bg, lw: 1 }));
  ov.push({ t: 'hline', y: res.geom.z0, color: C.hot, lw: 1, dash: [3, 3] });
  return R.renderImage({ img, ny: nz, nx, rows: [z0, z1], cols: bx.cols, vmin: 0, vmax, scale: 1.2, yscale: res.dz / res.px, overlays: ov });
};

// ------------------------------------------------------------------ charts used in the report
function contrastChart(res, frames, S, opts) {
  const D = N.SPHERE_D, sp = res.geom.spheres, spec = res.spec, base = S.baseline, series = [];
  const hot = sp.map(q => q.type === 'hot');
  if (frames.length > 1) frames.forEach((fr, i) => series.push({ kind: 'points', x: D, y: fr.contrast, color: C.grey, size: 2.4, label: i === 0 ? 'replicates' : null }));
  const mean = opts.single ? frames[0].contrast : S.contrast_mean, sd = opts.single ? null : S.contrast_sd;
  series.push({ kind: 'line', x: D.filter((d, j) => hot[j]), y: mean.filter((v, j) => hot[j]), err: sd ? sd.filter((v, j) => hot[j]) : null, color: C.hot,
                label: opts.single || frames.length < 2 ? 'hot sphere' : 'hot sphere, mean ± SD', labelDx: base && !opts.single ? -12 : 0, labels: mean.filter((v, j) => hot[j]).map(v => v.toFixed(1)) });
  if (hot.some(h => !h)) series.push({ kind: 'points', shape: 's', x: D.filter((d, j) => !hot[j]), y: mean.filter((v, j) => !hot[j]),
                err: sd ? sd.filter((v, j) => !hot[j]) : null, color: C.cold, label: opts.single || frames.length < 2 ? 'cold sphere' : 'cold sphere, mean ± SD', labelDx: base && !opts.single ? -12 : 0, labels: mean.filter((v, j) => !hot[j]).map(v => v.toFixed(1)) });
  if (base && !opts.single) series.push({ kind: 'points', shape: 'd', fill: false, x: D.map(d => d + 0.8), y: base.contrast_mean, err: base.contrast_sd, color: C.base, label: `baseline ${String(base.date).slice(0, 4)}` });
  if (S.reference && !opts.single) series.push({ kind: 'points', shape: 't', fill: false, x: D.map(d => d - 0.8), y: S.reference.contrast.map((v, j) => S.reference.sphere_types[j] && S.reference.sphere_types[j] !== sp[j].type ? null : v), color: C.ref, label: 'published reference' });
  // limit bars only where the limit is actually evaluated (hot sphere with a vendor limit); N/E and N/A spheres get none, as in the table
  if (spec.contrast) series.push({ kind: 'limit', x: D, y: (S.contrast_limit || spec.contrast.map((v, j) => sp[j].type === 'hot' ? v : null)), label: 'limit (≥)' });
  return R.chart({ id: opts.id, w: opts.w || 460, h: opts.h || 270, title: 'Sphere contrast', xlabel: 'Sphere diameter [mm]', ylabel: 'Contrast [%]',
                   xmin: 7, xmax: 40, ymin: 0, ymax: 110, xticks: D, series, legend: 'lr' });
}
function bvChart(res, frames, S, opts) {
  const D = N.SPHERE_D, spec = res.spec, base = S.baseline, series = [];
  if (frames.length > 1 && !opts.single) frames.forEach((fr, i) => series.push({ kind: 'points', x: D, y: fr.BV, color: C.grey, size: 2.4 }));
  const mean = opts.single ? frames[0].BV : S.bv_mean;
  series.push({ kind: 'line', x: D, y: mean, err: opts.single ? null : S.bv_sd, color: C.bg, label: opts.single || frames.length < 2 ? 'background variability' : 'mean ± SD', labelDx: base && !opts.single ? -12 : 0, labels: mean.map(v => v.toFixed(2)) });
  if (base && !opts.single) series.push({ kind: 'points', shape: 'd', fill: false, x: D.map(d => d + 0.8), y: base.bv_mean, err: base.bv_sd, color: C.base, label: `baseline ${String(base.date).slice(0, 4)}` });
  if (S.reference && !opts.single && Array.isArray(S.reference.bv) && S.reference.bv.some(v => v != null)) series.push({ kind: 'points', shape: 't', fill: false, x: D.map(d => d - 0.8), y: S.reference.bv, color: C.ref, label: 'published reference' });
  if (spec.bv) series.push({ kind: 'limit', x: D, y: spec.bv, label: 'limit (≤)' });
  const ymax = Math.max(...mean, ...(spec.bv || [0]), ...(base ? base.bv_mean : [0]), ...(S.reference ? S.reference.bv.filter(v => v != null) : [0])) * 1.3;
  return R.chart({ id: opts.id, w: opts.w || 460, h: opts.h || 250, title: 'Background variability', xlabel: 'Sphere diameter [mm]', ylabel: 'BV [%]',
                   xmin: 7, xmax: 40, ymin: 0, ymax, xticks: D, series, legend: 'ur' });
}
function noLungBox(opts) {
  const W = opts.w || 460, H = opts.h || 250;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" class="chart" font-family="Segoe UI, Arial, sans-serif">
    <text x="${W / 2}" y="15" text-anchor="middle" font-size="12" font-weight="600">Lung residual (accuracy of attenuation &amp; scatter correction)</text>
    <rect x="50" y="24" width="${W - 62}" height="${H - 64}" fill="#fafafa" stroke="#999" stroke-dasharray="4 3"/>
    <text x="${50 + (W - 62) / 2}" y="${24 + (H - 64) / 2 - 6}" text-anchor="middle" font-size="12" fill="#555">No lung insert detected in the phantom</text>
    <text x="${50 + (W - 62) / 2}" y="${24 + (H - 64) / 2 + 12}" text-anchor="middle" font-size="11" fill="#777">lung residual not measured</text></svg>`;
}
function lungChart(res, frames, S, opts) {
  if (!res.geom.lung_present || !res.rois.lungSlices.length) return noLungBox(opts);
  const ls = res.rois.lungSlices, cols = ['#1f77b4', '#ff7f0e', '#2ca02c', '#9467bd', '#8c564b'], series = [], hl = [];
  frames.forEach((fr, i) => series.push({ kind: 'line', shape: opts.single ? 'o' : 'none', size: 1.8, lw: 1, x: ls, y: fr.lung_residual, color: opts.single ? C.lung : cols[i % 5],
                                          label: `${opts.single ? 'mean' : 'rep ' + (i + 1)}: ${fr.lung_mean.toFixed(2)} %` }));
  if (res.spec.lung) hl.push({ y: res.spec.lung, color: '#d00', dash: '3 3', label: `limit ${res.spec.lung} %` });
  if (S.reference && !opts.single && S.reference.lung != null) hl.push({ y: S.reference.lung, color: C.ref, dash: '2 2', label: `published ref.: ${S.reference.lung.toFixed(1)} %` });
  if (S.baseline && !opts.single && S.baseline.lung_mean != null) hl.push({ y: S.baseline.lung_mean, color: C.base, dash: '6 3', label: `baseline: ${S.baseline.lung_mean.toFixed(2)} %` });
  const top = Math.max(res.spec.lung || 0, ...frames.map(f => f.lung_max)), nleg = frames.length + hl.length;
  const ymax = top * (nleg > 2 ? 1.75 : 1.35);   // headroom so the legend (upper right) sits above the data and the limit line
  return R.chart({ id: opts.id, w: opts.w || 460, h: opts.h || 250, title: 'Lung residual (accuracy of attenuation & scatter correction)', xlabel: 'Slice number',
                   ylabel: 'Lung residual [%]', xmin: ls[0] - 1, xmax: ls[ls.length - 1] + 1, ymin: 0, ymax, series, hlines: hl, legend: 'ur' });
}

// ------------------------------------------------------------------ tables / text helpers
const stCls = s => s === 'PASS' || s === 'OK' ? 'ok' : s === 'FAIL' || s === 'DIFF' ? 'bad' : s === 'N/E' ? 'warn' : 'na';
function headerBlock(res) {
  const m = res.metas[0], Rc = m.Recon || {}, S = res.summary, o = res.opts, afov = m.AxialFOV_mm ? (m.AxialFOV_mm / 10).toFixed(0) : (res.profile && res.profile.afov_cm);
  const rfov = m.GE && m.GE.ir_recon_fov_cm != null ? m.GE.ir_recon_fov_cm : (m.ReconDiameter_mm ? m.ReconDiameter_mm / 10 : null);
  const l1 = [o.site, `${m.Manufacturer} ${m.Model}`, afov ? `${afov} cm AFOV` : null, m.Software ? `SW ${m.Software}` : null, m.Station ? `station ${m.Station}` : null,
              `study ${N.fmtDate(res.date)}`, `ID ${m.PatientID}`].filter(Boolean).join(' | ');
  const l2 = [`Recon ${S.recon_label}${Rc.iterations != null ? ` (${Rc.iterations} it / ${Rc.subsets ?? '?'} ss)` : ''}`, m.Matrix, rfov ? `FOV ${+(+rfov).toFixed(1)} cm` : null,
              Rc.filter_mm != null ? `filter ${Rc.filter_mm} mm` : null, `pixel ${res.px.toFixed(3)} mm`, `slice ${res.dz.toFixed(2)} mm`,
              `dose ${m.Dose_Bq ? (m.Dose_Bq / 1e6).toFixed(2) + ' MBq @ ' + N.fmtDT(m.DoseDateTime, false) : '?'}`, `vol ${S.volume_ml ?? '?'} mL`,
              `aH/aB = ${S.ratio.toFixed(2)}`, o.operator ? `operator ${o.operator}` : null].filter(Boolean).join(' | ');
  return `<div class="hdr"><div>${esc(l1)}</div><div>${esc(l2)}</div><div>Analysis standard: <b>${esc(S.standardName)}</b> · limits: ${esc(res.spec.name)}${S.profile_name ? ` · profile: ${esc(S.profile_name)}` : ''} · report generated ${esc(new Date().toISOString().slice(0, 16).replace('T', ' '))} · NEMA IQ Analyzer v${N.VERSION}</div></div>`;
}
function verdictBadge(S) {
  const cls = S.overall.startsWith('FAIL') ? 'bad' : S.overall.startsWith('PASS*') ? 'warn' : S.overall.startsWith('PASS') ? 'ok' : 'na';
  return `<div class="verdict ${cls}">Overall: ${esc(S.overall)}</div>`;
}
function resultsTable(res) {
  const S = res.summary, sp = res.geom.spheres, spec = res.spec, rf = !S.baseline && S.reference;
  const b = S.baseline || (rf ? true : null), dQ = S.baseline ? S.delta_contrast : S.delta_ref_contrast, dB = S.baseline ? S.delta_bv : S.delta_ref_bv, dL = S.baseline ? S.delta_lung : S.delta_ref_lung;
  const dh = S.baseline ? 'Δ base' : 'Δ ref';
  let h = `<table class="t small res"><thead><tr><th>D [mm]</th><th>type</th><th>Contrast [%]</th><th>limit</th><th></th>${b ? `<th>${dh}</th>` : ''}<th>BV [%]</th><th>limit</th><th></th>${b ? `<th>${dh}</th>` : ''}</tr></thead><tbody>`;
  sp.forEach((q, j) => {
    h += `<tr><td>${q.d}</td><td class="${q.type}">${q.type}${q.type !== q.expected ? ' <span class="flag" title="differs from the selected standard">!</span>' : ''}</td>
      <td>${pm(S.contrast_mean[j], S.contrast_sd[j])}</td><td>${S.contrast_limit[j] != null ? '≥&nbsp;' + S.contrast_limit[j] : '-'}</td><td class="${stCls(S.contrast_status[j])}">${S.contrast_status[j]}</td>
      ${b ? `<td>${dQ[j] == null ? '-' : sgn(dQ[j])}</td>` : ''}
      <td>${pm(S.bv_mean[j], S.bv_sd[j], 2)}</td><td>${spec.bv && spec.bv[j] != null ? '≤&nbsp;' + spec.bv[j] : '-'}</td><td class="${stCls(S.bv_status[j])}">${S.bv_status[j]}</td>
      ${b ? `<td>${sgn(dB[j], 2)}</td>` : ''}</tr>`;
  });
  h += `<tr class="sep"><td colspan="2">Lung error</td><td>${S.lung_present ? pm(S.lung_mean, S.lung_sd, 2) : 'not measured'}</td><td>${spec.lung != null ? '≤&nbsp;' + spec.lung : '-'}</td><td class="${stCls(S.lung_status)}">${S.lung_status}</td>${b ? `<td>${sgn(dL, 2)}</td>` : ''}<td colspan="${b ? 4 : 3}"></td></tr>`;
  return h + '</tbody></table>';
}
function replicateTable(res) {
  const fr = res.frames, D = N.SPHERE_D;
  let h = `<table class="t small"><thead><tr><th>D [mm]</th>${fr.map((x, i) => `<th>Q rep ${i + 1}</th>`).join('')}${fr.map((x, i) => `<th>BV rep ${i + 1}</th>`).join('')}</tr></thead><tbody>`;
  D.forEach((d, j) => { h += `<tr><td>${d}</td>${fr.map(x => `<td>${f(x.contrast[j])}</td>`).join('')}${fr.map(x => `<td>${f(x.BV[j], 2)}</td>`).join('')}</tr>`; });
  h += `<tr class="sep"><td>lung</td>${fr.map(x => `<td>${f(x.lung_mean, 2)}</td>`).join('')}<td colspan="${fr.length}"></td></tr>`;
  h += `<tr><td>C<sub>B,37</sub></td>${fr.map(x => `<td>${f(x.C_B37 / 1000, 3)}</td>`).join('')}<td colspan="${fr.length}">kBq/mL</td></tr>`;
  return h + '</tbody></table>';
}
function fillNote(res) {
  const g = res.geom, std = res.std;
  if (g.fillMatchesStandard) return `<div class="note ok">Sphere fill matches ${esc(std.name)} (${esc(std.fill)}).</div>`;
  const other = g.fillMatchesOther ? N.STANDARDS[g.fillMatchesOther] : null;
  return `<div class="note bad"><b>Sphere fill does not match ${esc(std.name)}</b> (${esc(std.fill)}): ` +
    g.spheres.filter(q => q.detected !== q.expected).map(q => `${q.d} mm measured ${q.detected} (sphere/bg ${q.measured_ratio_smoothed.toFixed(2)})`).join(', ') +
    (other ? `. The fill corresponds to <b>${esc(other.name)}</b>.` : '.') + '</div>';
}

// ------------------------------------------------------------------ pages
function pageSummary(res) {
  const S = res.summary, vmax = vmaxFor(res, res.frames[0]), im = R.transaxial(res, res.vm, vmax, 2);
  return `<section class="page"><div class="ptitle"><h1>NEMA IQ – Summary <span>(${esc(S.recon_label)}, ${res.frames.length > 1 ? `mean of ${res.frames.length} replicates` : 'single acquisition'})</span></h1>${verdictBadge(S)}</div>
  ${headerBlock(res)}${fillNote(res)}
  <div class="grid3">
    <div class="cell"><div class="cap">Replicate mean, common central slice ${res.geom.iz0}<br><span class="leg"><i style="color:${C.hot}">■</i> hot <i style="color:${C.cold}">■</i> cold <i style="color:${C.bg}">■</i> background${res.geom.lung_present ? ` <i style="color:${C.lung}">■</i> lung` : ''}</span></div>${im ? `<img class="slice" src="${im}">` : ''}</div>
    <div class="cell">${contrastChart(res, res.frames, S, { id: 1 })}</div>
    <div class="cell">${resultsTable(res)}
      <div class="small mt">Contrast ≥ limit, BV ≤ limit, lung error ≤ limit; limits: ${esc(res.spec.name)}${res.spec.source ? ` (${esc(res.spec.source)})` : ''}; contrast limits apply to ${res.spec.sphere_types ? 'the sphere types given with the limits' : 'hot spheres'}.${res.spec.custom ? '' : ' <b>No acceptance limits entered: no PASS/FAIL.</b>'}${S.reference ? ` Published reference (comparison only): ${esc(S.reference.label)}.` : ''}${res.frames.length < 2 ? ' Single acquisition: no replicate SD.' : ''}
      N/E = limit applies but the sphere was not hot (not evaluable); N/A = no limit.${S.baseline ? ` Δ = difference from baseline ${esc(S.baseline.label)} ${esc(S.baseline.date)}.` : ''}</div></div>
    <div class="cell">${replicateTable(res)}</div>
    <div class="cell">${bvChart(res, res.frames, S, { id: 2 })}</div>
    <div class="cell">${lungChart(res, res.frames, S, { id: 3 })}</div>
  </div></section>`;
}
function refTable(res) {
  const S = res.summary, R_ = S.reference; if (!R_) return '';
  let t = `<h3>Published reference (comparison only)</h3><table class="t small"><thead><tr><th>D</th><th>ref. type</th><th>Q ref [%]</th><th>Q here</th><th>BV ref [%]</th><th>BV here</th></tr></thead><tbody>`;
  N.SPHERE_D.forEach((d, j) => t += `<tr><td>${d}</td><td>${esc(R_.sphere_types[j] || '-')}</td><td>${f(R_.contrast[j])}</td><td>${f(S.contrast_mean[j])}</td><td>${f(R_.bv[j], 2)}</td><td>${f(S.bv_mean[j], 2)}</td></tr>`);
  t += `<tr class="sep"><td colspan="2">lung</td><td colspan="2">${R_.lung == null ? '-' : f(R_.lung, 1) + ' %'}</td><td colspan="2">${S.lung_mean == null ? 'not measured' : f(S.lung_mean, 2) + ' %'}</td></tr></tbody></table>`;
  t += `<div class="small">${R_.provisional ? '<b>Provisional (secondary source).</b> ' : ''}${esc(R_.citation)}${R_.doi ? ` (${esc(R_.doi)})` : ''}${R_.table ? `, ${esc(R_.table)}` : ''}. ${R_.standard ? esc(R_.standard) + '; ' : ''}${R_.ratio ? `ratio ${R_.ratio}:1; ` : ''}${R_.variant ? esc(R_.variant) + '; ' : ''}recon: ${esc(R_.recon || '-')}; acquisition: ${esc(R_.acquisition || '-')}.
    Published values depend on acquisition, reconstruction and phantom preparation; they are not acceptance limits.</div>`;
  return t;
}
function kv(rows) { return `<table class="kv">${rows.map(r => `<tr><td>${esc(r[0])}</td><td>${r[1]}</td></tr>`).join('')}</table>`; }
function pageDetails(res) {
  const S = res.summary, m0 = res.metas[0], g = res.geom, bi = res.rois.bgInfo, ct = res.ct;
  let prot = `<table class="t small"><thead><tr><th>Protocol item (${esc(res.protocol.doc || '')})</th><th>expected</th><th>found</th><th>status</th></tr></thead><tbody>`;
  res.protocol.forEach(r => prot += `<tr><td>${esc(r.item)}</td><td>${esc(r.expected)}</td><td>${esc(r.found)}</td><td class="${stCls(r.status)}">${r.status}</td></tr>`);
  prot += '</tbody></table>';
  const acq = res.metas.map((m, i) => `rep ${i + 1}: ${esc(m.SeriesDescription)} — start ${N.fmtDT(m.AcquisitionStart, false)}, ${m.FrameDuration_s.toFixed(0)} s` +
    (m.GE.total_prompts ? `, prompts ${(m.GE.total_prompts / 1e6).toFixed(0)} M, delays ${(m.GE.total_delays / 1e6).toFixed(0)} M` : '')).join('<br>');
  let act = `<table class="t small"><thead><tr><th>rep</th><th>C<sub>B,37</sub> measured</th><th>expected</th><th>meas/exp</th></tr></thead><tbody>`;
  res.frames.forEach((fr, i) => act += `<tr><td>${i + 1}</td><td>${f(fr.C_B37 / 1000, 3)}</td><td>${fr.expected_bg ? f(fr.expected_bg / 1000, 3) : '-'}</td><td>${fr.expected_bg ? f(fr.C_B37 / fr.expected_bg, 3) : '-'}</td></tr>`);
  act += `</tbody></table><div class="small">kBq/mL, each replicate decay-corrected to its own start. Expected = net dose ${m0.Dose_Bq ? (m0.Dose_Bq / 1e6).toFixed(2) + ' MBq' : '?'} at ${N.fmtDT(m0.DoseDateTime)} / volume ${S.volume_ml ?? '?'} mL
${m0.GE.pre_inj_activity_MBq != null ? ` (pre ${(+m0.GE.pre_inj_activity_MBq).toFixed(2)} MBq, residual ${m0.GE.post_inj_activity_MBq != null ? (+m0.GE.post_inj_activity_MBq).toFixed(2) : '?'} MBq)` : ''}.
    NEMA NU 2 recommended background at the start of the test: ${N.NEMA_BG_KBQML} kBq/mL (spheres ${(N.NEMA_BG_KBQML * S.ratio).toFixed(1)} kBq/mL at a<sub>H</sub>/a<sub>B</sub> = ${S.ratio.toFixed(2)}).${res.metas[0].UnitsBqml ? '' : ' Pixel values are not in Bq/mL: expected concentration not evaluated.'}${S.bg_cv != null ? ` Replicate consistency after decay correction: CV ${S.bg_cv.toFixed(2)} %.` : ''}</div>`;
  let ratio = `<table class="t small"><thead><tr><th>D</th><th>type</th>${res.frames.map((x, i) => `<th>C<sub>S</sub>/C<sub>B</sub> rep ${i + 1}</th>`).join('')}</tr></thead><tbody>`;
  g.spheres.forEach((q, j) => ratio += `<tr><td>${q.d}</td><td class="${q.type}">${q.type}</td>${res.frames.map(x => `<td>${f(x.ratio_sphere_bg[j], 2)}</td>`).join('')}</tr>`);
  ratio += '</tbody></table>';
  const ctb = ct ? kv([['CT slice z', `${f(ct.ct_slice_z_mm, 1)} mm (${ct.kVp} kVp)`], ['Water (12 BG ROIs)', `${f(ct.water_HU_mean, 1)} HU [${f(ct.water_HU_range[0], 1)}, ${f(ct.water_HU_range[1], 1)}], pixel SD ${f(ct.water_HU_pixel_sd, 1)}`],
      [res.geom.lung_present ? 'Lung insert (30 mm)' : 'Phantom centre (30 mm; no lung insert)', `${f(ct.lung_HU_mean, 0)} HU`], ['Sphere contents', Object.entries(ct.sphere_HU).map(([d, v]) => `${d}: ${f(v, 0)}`).join(', ') + ' HU']]) : '<div class="small">No matching CT series.</div>';
  const geo = kv([['Common central slice', `${g.iz0} (z = ${f(g.z_mm[g.iz0], 1)} mm)`], ['Sphere centres (slice)', g.spheres.map(q => `${q.d}: ${q.z.toFixed(1)}`).join(', ')],
    ['Sphere ROI slices', g.spheres.map(q => `${q.d}: ${q.slice}`).join(', ') + ` (${res.opts.sliceMode === 'common' ? 'common' : 'per-sphere'} mode)`],
    ['Sphere ring', `radius ${f(g.ring.radius_mm, 1)} mm (57.2), rms residual ${f(g.ring.rms_residual_mm, 2)} mm`],
    ['Tilt / axial spread', `${g.lung_present ? 'lung axis' : 'body axis'} ${f(g.lung_tilt_deg, 2)}°, sphere centres ${f(g.sphere_z_spread_mm, 1)} mm`],
    ['Background ROIs', `margin ${f(bi.margin_mm, 1)} mm (NEMA 15), wall gap ${f(Math.min(...bi.wall_gap_mm), 1)}–${f(Math.max(...bi.wall_gap_mm), 1)} mm, sphere gap ≥ ${f(Math.min(...bi.sphere_gap_mm), 1)} mm, spacing ${f(bi.min_spacing_mm, 1)} mm`],
    ['Background slices', res.rois.bgSlices.join(', ') + ' (' + res.rois.bgSlices.map(k => sgn((k - g.iz0) * res.dz, 1)).join(', ') + ' mm)'],
    ['Lung slices', g.lung_present ? `${res.rois.lungSlices[0]}–${res.rois.lungSlices[res.rois.lungSlices.length - 1]} (n = ${res.rois.lungSlices.length}); insert ${f(g.lung_z[0], 1)}–${f(g.lung_z[1], 1)}; exclusion ${res.std.lungExcl} mm`
                                  : 'no lung insert detected: lung residual not measured; ring centre and body axis used for localisation']]);
  const warn = res.log.warnings.length ? '<ul class="warn">' + res.log.warnings.map(w => `<li>${esc(w)}</li>`).join('') + '</ul>' : '<div class="small">none</div>';
  const stdCmp = `<table class="t small"><thead><tr><th></th><th>NEMA NU 2-2012</th><th>NEMA NU 2-2018</th></tr></thead><tbody>
    <tr><td>Hot spheres</td><td>10, 13, 17, 22 mm</td><td>all six (10–37 mm)</td></tr><tr><td>Cold spheres</td><td>28, 37 mm (Q<sub>C</sub>)</td><td>none</td></tr>
    <tr><td>Lung slices excluded</td><td>10 mm from insert ends</td><td>30 mm from insert ends</td></tr>
    <tr><td>Used here</td><td>${res.std.id === '2012' ? '<b>✔</b>' : ''}</td><td>${res.std.id === '2018' ? '<b>✔</b>' : ''}</td></tr></tbody></table>`;
  return `<section class="page"><div class="ptitle"><h1>NEMA IQ – QA details</h1>${verdictBadge(S)}</div>${headerBlock(res)}
  <div class="grid3 details">
    <div class="cell">${prot}<h3>Acquisition</h3><div class="small">${acq}</div>${res.summary.other_recons && res.summary.other_recons.length ?
      `<div class="small mt"><b>Other reconstructions in the folder</b> (not analysed in this report): ${esc(res.summary.other_recons.join('; '))}</div>` : ''}</div>
    <div class="cell"><h3>Activity concentration (background, 37 mm ROIs)</h3>${act}<h3>Measured sphere/background ratio</h3>${ratio}<h3>CTAC check</h3>${ctb}${refTable(res)}</div>
    <div class="cell"><h3>Geometry (automatic localisation)</h3>${geo}<h3>Standard</h3>${stdCmp}<h3>Warnings / notes</h3>${warn}
      <h3>Definitions (NEMA NU 2, Sec. 7)</h3><div class="small">Q<sub>H</sub> = (C<sub>H</sub>/C<sub>B</sub> − 1)/(a<sub>H</sub>/a<sub>B</sub> − 1) × 100 %; Q<sub>C</sub> = (1 − C<sub>C</sub>/C<sub>B</sub>) × 100 %;
      BV = SD<sub>B</sub>/C<sub>B</sub> × 100 % over 60 background ROIs (12 ROIs × 5 slices, K−1); lung error = C<sub>lung,i</sub>/C<sub>B,37</sub> × 100 %, averaged over slices.
      ROI means use fractional (sub-pixel) weights. a<sub>H</sub>/a<sub>B</sub> = ${S.ratio.toFixed(3)}.</div></div>
  </div></section>`;
}
function pageReplicate(res, i) {
  const fr = res.frames[i], m = res.metas[i], vol = res.pets[i].img, vmax = vmaxFor(res, fr), S = res.summary;
  const im = R.transaxial(res, vol, vmax, 2), co = R.coronal(res, vol, vmax);
  let t = `<table class="t small"><thead><tr><th>D</th><th>type</th><th>slice</th><th>Q [%]</th><th>BV [%]</th><th>C<sub>S</sub> [kBq/mL]</th><th>C<sub>B</sub> [kBq/mL]</th></tr></thead><tbody>`;
  res.geom.spheres.forEach((q, j) => t += `<tr><td>${q.d}</td><td class="${q.type}">${q.type}</td><td>${q.slice}</td><td>${f(fr.contrast[j])}</td><td>${f(fr.BV[j], 2)}</td><td>${f(fr.C_sphere[j] / 1000, 3)}</td><td>${f(fr.C_B[j] / 1000, 3)}</td></tr>`);
  t += `<tr class="sep"><td colspan="3">Lung error</td><td colspan="4">${fr.lung_mean == null ? 'not measured (no lung insert)' : `${f(fr.lung_mean, 2)} % (max ${f(fr.lung_max, 2)} %)`}</td></tr>`;
  t += `<tr><td colspan="3">C<sub>B,37</sub></td><td colspan="4">${f(fr.C_B37 / 1000, 3)} kBq/mL${fr.expected_bg ? ` (expected ${f(fr.expected_bg / 1000, 3)}, ratio ${f(fr.C_B37 / fr.expected_bg, 3)})` : ''}</td></tr></tbody></table>`;
  return `<section class="page"><div class="ptitle"><h1>NEMA IQ – Replicate ${i + 1}/${res.frames.length}: <span>${esc(m.SeriesDescription)} (start ${N.fmtDT(m.AcquisitionStart, false)}, ${m.FrameDuration_s.toFixed(0)} s)</span></h1></div>${headerBlock(res)}
  <div class="grid3">
    <div class="cell"><div class="cap">Common central slice ${res.geom.iz0}; sphere ROI slices ${res.geom.spheres.map(q => q.d + ':' + q.slice).join(', ')}</div>${im ? `<img class="slice" src="${im}">` : ''}</div>
    <div class="cell">${contrastChart(res, [fr], S, { id: 10 + i * 3, single: true })}</div>
    <div class="cell">${bvChart(res, [fr], S, { id: 11 + i * 3, single: true })}</div>
    <div class="cell"><div class="cap">Coronal through ${res.geom.lung_present ? 'lung' : 'phantom'} axis — green: background slices${res.geom.lung_present ? ', orange: lung range' : ''}, red: sphere plane</div>${co ? `<img class="coronal" src="${co}">` : ''}</div>
    <div class="cell">${lungChart(res, [fr], S, { id: 12 + i * 3, single: true })}</div>
    <div class="cell">${t}</div>
  </div></section>`;
}
function pageAppendix(res) {
  const fr = res.frames, g = res.geom, bi = res.rois.bgInfo;
  let s1 = `<table class="t small"><thead><tr><th>D</th><th>type</th><th>slice</th><th>x, y [px]</th>${fr.map((x, i) => `<th>C<sub>S</sub> rep ${i + 1}</th>`).join('')}${fr.map((x, i) => `<th>C<sub>B</sub> rep ${i + 1}</th>`).join('')}</tr></thead><tbody>`;
  g.spheres.forEach((q, j) => s1 += `<tr><td>${q.d}</td><td class="${q.type}">${q.type}</td><td>${q.slice}</td><td>${f(q.x, 1)}, ${f(q.y, 1)}</td>${fr.map(x => `<td>${f(x.C_sphere[j] / 1000, 3)}</td>`).join('')}${fr.map(x => `<td>${f(x.C_B[j] / 1000, 3)}</td>`).join('')}</tr>`);
  s1 += '</tbody></table><div class="small">Concentrations in kBq/mL. C<sub>B</sub> = mean of the 60 background ROIs of the sphere\'s diameter.</div>';
  let s2 = `<table class="t small"><thead><tr><th>#</th><th>x, y [px]</th><th>wall gap [mm]</th><th>sphere gap [mm]</th></tr></thead><tbody>`;
  res.rois.bgCentres.forEach((c, k) => s2 += `<tr><td>${k + 1}</td><td>${f(c[0], 1)}, ${f(c[1], 1)}</td><td>${f(bi.wall_gap_mm[k], 1)}</td><td>${f(bi.sphere_gap_mm[k], 1)}</td></tr>`);
  s2 += `</tbody></table><div class="small">Background slices ${res.rois.bgSlices.join(', ')}.</div>`;
  const ls = res.rois.lungSlices, rows = ls.map((k, i) => `<tr><td>${k}</td><td>${f(g.z_mm[k], 1)}</td>${fr.map(x => `<td>${f(x.lung_residual[i], 2)}</td>`).join('')}</tr>`);
  const per = Math.ceil(rows.length / 2), head = `<thead><tr><th>slice</th><th>z [mm]</th>${fr.map((x, i) => `<th>rep ${i + 1}</th>`).join('')}</tr></thead>`;
  const lung = rows.length ? `<div class="twocol"><table class="t tiny">${head}<tbody>${rows.slice(0, per).join('')}</tbody></table><table class="t tiny">${head}<tbody>${rows.slice(per).join('')}</tbody></table></div>`
                           : '<div class="small">No lung insert detected in the phantom: lung residual not measured.</div>';
  return `<section class="page"><div class="ptitle"><h1>NEMA IQ – Appendix: ROI data and lung residual per slice</h1></div>${headerBlock(res)}
  <div class="grid2">
    <div class="cell"><h3>Sphere ROIs (ROI diameter = sphere inner diameter)</h3>${s1}<h3>Background ROI centres</h3>${s2}
</div>
    <div class="cell"><h3>Lung residual per slice [%] (30 mm ROI / C<sub>B,37</sub>)</h3>${lung}</div>
  </div></section>`;
}
R.buildReport = function (res) {
  return pageSummary(res) + pageDetails(res) + res.frames.map((x, i) => pageReplicate(res, i)).join('') + pageAppendix(res);
};

// ------------------------------------------------------------------ exports (CSV / JSON)
R.resultsCSV = function (res) {
  const S = res.summary, fr = res.frames, b = S.baseline, L = [];
  const hdr = ['diameter_mm', 'type', 'expected_type', ...fr.map((x, i) => `contrast_rep${i + 1}`), 'contrast_mean', 'contrast_sd', 'contrast_limit', 'contrast_status',
    ...fr.map((x, i) => `bv_rep${i + 1}`), 'bv_mean', 'bv_sd', 'bv_limit', 'bv_status', ...(b ? ['contrast_baseline', 'contrast_delta', 'bv_baseline', 'bv_delta'] : [])];
  L.push(hdr.join(','));
  res.geom.spheres.forEach((q, j) => L.push([q.d, q.type, q.expected, ...fr.map(x => x.contrast[j].toFixed(3)), S.contrast_mean[j].toFixed(3), x3(S.contrast_sd[j]),
    S.contrast_limit[j] ?? '', S.contrast_status[j], ...fr.map(x => x.BV[j].toFixed(3)), S.bv_mean[j].toFixed(3), x3(S.bv_sd[j]), res.spec.bv ? res.spec.bv[j] : '',
    S.bv_status[j], ...(b ? [b.contrast_mean[j], S.delta_contrast[j] == null ? '' : S.delta_contrast[j].toFixed(3), b.bv_mean[j], S.delta_bv[j].toFixed(3)] : [])].join(',')));
  L.push(''); L.push(['item', ...fr.map((x, i) => `rep${i + 1}`), 'mean', 'sd', 'limit', 'status', ...(b ? ['baseline', 'delta'] : [])].join(','));
  L.push(['lung_error_pct', ...fr.map(x => x3(x.lung_mean)), x3(S.lung_mean), x3(S.lung_sd), res.spec.lung ?? '', S.lung_status, ...(b ? [b.lung_mean ?? '', x3(S.delta_lung)] : [])].join(','));
  L.push(['C_B37_Bq_per_mL', ...fr.map(x => x.C_B37.toFixed(1))].join(','));
  L.push(''); L.push(`standard,${S.standardName}`); L.push(`recon,${S.recon_label}`); L.push(`limits,${res.spec.name}`); L.push(`overall,${S.overall}`); L.push(`ratio_aH_aB,${S.ratio}`); L.push(`replicates,${fr.length}`); L.push(`lung_insert,${S.lung_present ? 'yes' : 'not detected'}`);
  return L.join('\r\n');
};
R.lungCSV = function (res) {
  const L = [['slice', 'z_mm', ...res.frames.map((x, i) => `lung_residual_rep${i + 1}_pct`)].join(',')];
  if (!res.rois.lungSlices.length) L.push('# no lung insert detected: lung residual not measured');
  res.rois.lungSlices.forEach((k, i) => L.push([k, res.geom.z_mm[k].toFixed(2), ...res.frames.map(x => x.lung_residual[i].toFixed(3))].join(',')));
  return L.join('\r\n');
};
R.resultsJSON = function (res) {
  const g = res.geom;
  const out = { software: `NEMA IQ Analyzer v${N.VERSION}`, generated: new Date().toISOString(), options: Object.assign({}, res.opts, { baseline: res.opts.baseline ? '(loaded)' : null }),
    standard: res.std, limits: res.spec, summary: res.summary,
    replicates: res.frames.map((fr, i) => ({ series: res.metas[i].SeriesDescription, start: N.fmtDT(res.metas[i].AcquisitionStart), duration_s: res.metas[i].FrameDuration_s,
      contrast: fr.contrast, bv: fr.BV, C_sphere: fr.C_sphere, C_B: fr.C_B, C_B37: fr.C_B37, lung_mean: fr.lung_mean, lung_residual: fr.lung_residual, expected_bg: fr.expected_bg })),
    metadata: res.metas.map(m => Object.assign({}, m, { AcquisitionStart: N.fmtDT(m.AcquisitionStart), DoseDateTime: N.fmtDT(m.DoseDateTime) })),
    geometry: { spheres: g.spheres, ring: g.ring, iz0: g.iz0, z0: g.z0, lung_z: g.lung_z, zb: g.zb, tilt_deg: g.lung_tilt_deg, sphere_z_spread_mm: g.sphere_z_spread_mm,
      bg_centres_px: res.rois.bgCentres, bg_slices: res.rois.bgSlices, bg_info: res.rois.bgInfo, lung_slices: res.rois.lungSlices },
    protocol: res.protocol, ct: res.ct, warnings: res.log.warnings, log: res.log.lines };
  return JSON.stringify(out, null, 1);
};

G.NEMA_REPORT = R;
})(typeof globalThis !== 'undefined' ? globalThis : this);
