// Command-line check of the analysis core (no browser): runs the NEMA IQ analysis on a DICOM folder and prints the summary.
// Usage: node test_core.js <DICOM folder> [2012|2018] [results.json] [SeriesDescription of one PET series]
// Settings as in the program defaults: ratio 4.00, profile auto, one ROI slice per sphere, measured sphere types.
const fs = require('fs'), path = require('path');
require('./profiles.js');
const N = require('./core.js');
const root = process.argv[2], standard = process.argv[3] || '2018', out = process.argv[4] || null, only = process.argv[5] || null;

function walk(d) { let r = []; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) r = r.concat(walk(p)); else r.push(p); } return r; }
const toAB = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
function fileShim(p) {
  const size = fs.statSync(p).size;
  return { name: path.basename(p), size,
    slice: (a, b) => ({ arrayBuffer: async () => { const fd = fs.openSync(p, 'r'); const n = Math.min(b, size) - a; const buf = Buffer.alloc(n); fs.readSync(fd, buf, 0, n, a); fs.closeSync(fd); return toAB(buf); } }),
    arrayBuffer: async () => toAB(fs.readFileSync(p)) };
}
const F = (v, d = 2) => v == null || !isFinite(v) ? '-' : v.toFixed(d);
(async () => {
  const t0 = Date.now();
  const log = new N.Log((lvl, m) => console.log(`[${lvl}] ${m}`));
  const files = walk(root).map(fileShim);
  const groups = await N.scanFiles(files, log);
  const seriesKeys = only ? groups.filter(g => g.info.modality !== 'PT' || g.info.desc === only).map(g => g.key) : undefined;
  const res = await N.run(groups, { seriesKeys, standard, ratio: 4.0, profileId: 'auto', sliceMode: 'per-sphere', sphereTypes: 'detected', baseline: null }, log);
  const S = res.summary;
  console.log('---- SUMMARY', S.standardName, S.recon_label, S.spec_name);
  res.geom.spheres.forEach((q, j) => console.log(`${q.d} ${q.type} Q=${F(S.contrast_mean[j])}±${F(S.contrast_sd[j])} ${S.contrast_status[j]}  BV=${F(S.bv_mean[j], 3)} ${S.bv_status[j]} slice=${q.slice} z=${q.z.toFixed(2)} x=${q.x.toFixed(2)} y=${q.y.toFixed(2)}`));
  console.log(`lung ${F(S.lung_mean, 3)} ${S.lung_status}; overall ${S.overall}; margin ${S.bg_margin_mm}; bgCV ${S.bg_cv && S.bg_cv.toFixed(3)}; meas/exp ${S.meas_over_expected && S.meas_over_expected.toFixed(4)}`);
  console.log('C_B37 per rep', res.frames.map(f => f.C_B37.toFixed(1)).join(', '), 'lung slices', res.rois.lungSlices.length ? res.rois.lungSlices[0] + '-' + res.rois.lungSlices[res.rois.lungSlices.length - 1] : 'none');
  console.log('CT', JSON.stringify(res.ct));
  console.log('elapsed s', ((Date.now() - t0) / 1000).toFixed(1));
  if (out) fs.writeFileSync(out, JSON.stringify({ summary: S, spheres: res.geom.spheres, frames: res.frames.map(f => ({ contrast: f.contrast, BV: f.BV, lung_mean: f.lung_mean, C_B37: f.C_B37 })), bg: res.rois.bgCentres, bgInfo: res.rois.bgInfo, warnings: log.warnings }, null, 1));
})().catch(e => { console.error('ERROR', e.stack); process.exit(1); });
