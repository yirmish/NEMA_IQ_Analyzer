// Analyses a DICOM folder with the program's analysis core and writes the full result as JSON: summary, sphere centres,
// ROI positions, per-replicate measurements and warnings, or {ok: false, error} if the analysis stops. Used by run_tests.py.
// Usage: node analyse.js <DICOM folder or .zip> <out.json> [2012|2018] [sphere:background ratio] [common|per-sphere] [insert-ends|fov-edge]
//        [lung exclusion mm]   (omitted options: the program defaults)
'use strict';
const fs = require('fs'), path = require('path');
require('../src/profiles.js');
const N = require('../src/core.js');
const [root, out, standard = '2018', ratio = '4', sliceMode = 'common', lungRange = 'insert-ends', lungExcl = ''] = process.argv.slice(2);

function walk(d) { let r = []; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); r = e.isDirectory() ? r.concat(walk(p)) : r.concat([p]); } return r; }
const toAB = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
function fileShim(p) {
  const size = fs.statSync(p).size;
  return { name: path.basename(p), size, arrayBuffer: async () => toAB(fs.readFileSync(p)),
    slice: (a, b) => ({ arrayBuffer: async () => { const fd = fs.openSync(p, 'r'), n = Math.min(b, size) - a, buf = Buffer.alloc(n); fs.readSync(fd, buf, 0, n, a); fs.closeSync(fd); return toAB(buf); } }) };
}
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o[k] === undefined ? null : o[k]]));

(async () => {
  const log = new N.Log();
  let res;
  try {
    const files = /\.zip$/i.test(root) ? await N.expandZips([N.memFile(path.basename(root), new Uint8Array(fs.readFileSync(root)))], log)   // the program's ZIP reader
                                        : walk(root).filter(p => p.endsWith('.dcm')).map(fileShim);
    const groups = await N.scanFiles(files, log);
    res = await N.run(groups, { standard, ratio: +ratio, profileId: 'auto', sliceMode, lungRange, lungExclMm: lungExcl === '' ? null : +lungExcl, sphereTypes: 'detected', baseline: null }, log);
  } catch (e) {
    fs.writeFileSync(out, JSON.stringify({ ok: false, error: e.message, warnings: log.warnings }));
    return;
  }
  const g = res.geom;
  fs.writeFileSync(out, JSON.stringify({
    ok: true, summary: res.summary, warnings: log.warnings, px: res.px, dz: res.dz,
    geom: pick(g, ['lung_present', 'lung_tilt_deg', 'lung_d_eq', 'lung_z', 'zb', 'ring', 'z0', 'iz0', 'sphere_z_spread_mm', 'id_rank_corr']),
    spheres: g.spheres.map(q => pick(q, ['d', 'type', 'detected', 'x', 'y', 'z', 'slice', 'ring_residual_mm'])),
    rois: { bgCentres: res.rois.bgCentres, bgSlices: res.rois.bgSlices, bgInfo: res.rois.bgInfo, lungInfo: res.rois.lungInfo, lung: res.rois.lung.map(r => [r.iz, r.cx, r.cy]) },
    frames: res.frames.map(f => pick(f, ['contrast', 'BV', 'C_sphere', 'C_B', 'SD_B', 'C_B37', 'lung_C', 'lung_mean', 'expected_bg', 'C_B37_at_ref']))
  }));
})().catch(e => { console.error(e.stack); process.exit(1); });
