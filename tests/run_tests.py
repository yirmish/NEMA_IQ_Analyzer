"""Verification of the NEMA IQ analysis on digital IEC body phantoms with known ground truth.

For every case a phantom is written as PET DICOM (digital_phantom.py) and analysed with the program's analysis core
(analyse.js, Node.js). The results are checked in two ways:
  1. measurement check: an independent implementation of the NEMA ROI statistics (this file, with the same 10 x 10
     supersampling of the ROI edge pixels) is applied to the same images at the ROI positions chosen by the program.
     Contrast, background variability and lung residual must agree to rounding. This tests the ROI weights, the pooling
     of the 60 background ROIs and the formulas, independent of the localisation.
  2. truth check: sphere identification, hot/cold type, sphere centres, lung-insert tilt, background concentration,
     decay correction, units and measured/expected activity are compared with the ground truth, and the contrast with
     the contrast of a sphere ROI centred on the true sphere centre (40 x 40 supersampling; end-to-end error, including
     the localisation and the discretisation of the ROI edge).
  3. rule check: the ROI layout follows the NEMA rules against the true geometry: each sphere ROI on the slice nearest
     the sphere centre; 12 background ROIs at >= 15 mm (or the reported reduced margin) from the phantom wall, the
     spheres and the lung insert, on the central slice and at +-10 and +-20 mm; lung-residual slices outside the
     exclusion zone at the insert ends (10 mm NU 2-2012, 30 mm NU 2-2018).

Usage: python tests/run_tests.py [--jobs N] [--only name,name] [--keep DIR] [--summary FILE]
Requires Python 3 with numpy and scipy (tests/requirements.txt) and Node.js.
"""
import argparse, json, os, shutil, subprocess, sys, tempfile, time
from concurrent.futures import ProcessPoolExecutor
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from digital_phantom import make_phantom  # noqa: E402

SPHERE_D = [10, 13, 17, 22, 28, 37]

# Tolerances. q_meas: |contrast difference| of the measurement check [percentage points]; bv_meas, lung_meas likewise.
# loc_xy / loc_z: sphere-centre error [mm]; q_e2e: |contrast(program) - contrast(ROI at the true centre)| per sphere;
# cb: relative error of C_B,37 against the true background; ring: |ring radius - 57.2| [mm].
EXACT = dict(q_meas=0.01, bv_meas=0.005, lung_meas=0.005, loc_xy=0.25, loc_z=0.25, q_e2e=dict.fromkeys(SPHERE_D, 0.5),
             cb=0.001, ring=0.3, mexp=0.002, bv_max=0.05, lung_truth=0.1, tilt=0.3)
NOISY = dict(EXACT, loc_xy=1.0, loc_z=1.0, q_e2e={10: 2.0, 13: 2.0, 17: 1.0, 22: 1.0, 28: 0.5, 37: 0.5},
             cb=0.01, ring=1.0, mexp=0.01, bv_max=None, lung_truth=None, tilt=0.5)
COARSE = dict(NOISY, loc_xy=1.5, loc_z=1.5, q_e2e={10: 3.0, 13: 3.0, 17: 1.5, 22: 1.5, 28: 1.0, 37: 1.0})

CASES = [
    dict(name='ideal', desc='no PSF, no noise, NU 2-2018 fill, sphere plane on a slice centre',
         phantom=dict(zoff=1.0), tol=EXACT, warnings=[]),
    dict(name='psf6_lung', desc='6 mm PSF, no noise, lung insert 10-20 % of background (radial gradient), sphere plane between slices',
         phantom=dict(fwhm=6, lung_act=0.10, lung_grad=1.0), tol=EXACT, warnings=[]),
    dict(name='nu2012_3rep', desc='NU 2-2012 fill (28/37 mm cold), 6 mm PSF, noise, lung insert 10 %, 3 replicates, decay START',
         phantom=dict(fill='2012', fwhm=6, noise=0.12, nrep=3, zoff=1.0, lung_act=0.10, seed=11), standard='2012', tol=NOISY),
    dict(name='nu2012_ratio8', desc='NU 2-2012 fill at 8:1, 6 mm PSF, noise',
         phantom=dict(fill='2012', ratio=8.0, fwhm=6, noise=0.10, zoff=1.0, seed=12), standard='2012', ratio=8.0, tol=NOISY),
    dict(name='tilt3_offset', desc='axis tilted 3 deg, ring rotated 17 deg, 15/-20 mm off centre, noise',
         phantom=dict(tilt_deg=3, rot_deg=17, dx=15, dy=-20, fwhm=6, noise=0.10, lung_act=0.05, seed=13), tol=NOISY,
         warnings=['sphere centres span']),
    dict(name='no_lung_tilt4_mirrored', desc='no lung insert, tilt 4 deg, ring rotated -40 deg, reversed size order, noise',
         phantom=dict(lung=False, tilt_deg=4, rot_deg=-40, mirror=True, dx=-10, dy=10, fwhm=6, noise=0.10, seed=14), tol=NOISY,
         warnings=['no lung insert detected', 'sphere centres span']),
    dict(name='voxel4mm_admin_implicit', desc='4 mm voxels, 8 mm PSF, noise, 2 replicates, decay ADMIN, Implicit VR',
         phantom=dict(px=4.0, dz=4.0, n=128, nz=50, fwhm=8, noise=0.10, nrep=2, decay='ADMIN', ts='implicit', zoff=2.0, seed=15),
         tol=COARSE),
    dict(name='voxel1.65mm_cnts', desc='1.65 mm voxels, 4 mm PSF, noise, Philips-style CNTS units with scale factor',
         phantom=dict(px=1.65, dz=1.65, n=220, nz=122, ss=3, fwhm=4, noise=0.10, units='CNTS', zoff=0.825, lung_act=0.05, seed=16), tol=NOISY),
    dict(name='no_spheres', desc='spheres filled like the background: the program must refuse the series',
         phantom=dict(ratio=1.0, fwhm=6, noise=0.05, seed=17), error='No NEMA IEC body-phantom sphere pattern'),
]


# ------------------------------------------------------------------------------------------------ reference ROI statistics
class Disk:
    """Circular ROI with fractional pixel weights (ss x ss supersampling); written independently of core.js."""
    def __init__(self, cx, cy, d_mm, px, ss=10):
        r = d_mm / 2 / px
        self.y0, self.x0 = int(np.floor(cy - r)) - 1, int(np.floor(cx - r)) - 1
        ny = nx = int(np.ceil(2 * r)) + 3
        o = (np.arange(ss) + 0.5) / ss - 0.5
        yy = (np.arange(self.y0, self.y0 + ny)[:, None] + o[None, :]) - cy        # (ny, ss)
        xx = (np.arange(self.x0, self.x0 + nx)[:, None] + o[None, :]) - cx        # (nx, ss)
        inside = yy[:, None, :, None] ** 2 + xx[None, :, None, :] ** 2 <= r * r    # (ny, nx, ss, ss)
        self.w = inside.mean(axis=(2, 3))

    def mean(self, img2d):
        h, w = self.w.shape
        return float((self.w * img2d[self.y0:self.y0 + h, self.x0:self.x0 + w]).sum() / self.w.sum())


def contrast(c_s, c_b, ratio, hot):
    return (c_s / c_b - 1) / (ratio - 1) * 100 if hot else (1 - c_s / c_b) * 100


def reference_frame(img, R, ratio, px):
    """NEMA statistics of one replicate at the program's ROI positions."""
    sph = sorted(R['spheres'], key=lambda q: q['d'])
    out = dict(C_B=[], BV=[], contrast=[])
    for q in sph:
        disks = [Disk(c[0], c[1], q['d'], px) for c in R['rois']['bgCentres']]
        vals = np.array([dk.mean(img[k]) for k in R['rois']['bgSlices'] for dk in disks])
        cb = vals.mean()
        out['C_B'].append(cb)
        out['BV'].append(vals.std(ddof=1) / cb * 100)
        out['contrast'].append(contrast(Disk(q['x'], q['y'], q['d'], px).mean(img[q['slice']]), cb, ratio, q['type'] == 'hot'))
    cb37 = out['C_B'][-1]
    lung = [Disk(cx, cy, 30.0, px).mean(img[k]) / cb37 * 100 for k, cx, cy in R['rois']['lung']]
    out['lung'] = float(np.mean(lung)) if lung else None
    return out


def axis_index(truth, k):
    """(column, row) of the true phantom axis on slice k."""
    M, off, x0, z0, P = np.array(truth['M']), np.array(truth['off']), truth['x0'], truth['z0'], truth['params']
    w = (z0 + k * P['dz'] - off[2]) / M[2, 2]
    return (M[0, 2] * w + off[0] - x0) / P['px'], (M[1, 2] * w + off[1] - x0) / P['px']


def lung_end_slices(truth):
    """Slice positions of the lung-insert ends on the axis, clipped to the scanned slices."""
    M, off, z0, P = np.array(truth['M']), np.array(truth['off']), truth['z0'], truth['params']
    e = sorted((M[2, 2] * w + off[2] - z0) / P['dz'] for w in truth['ends_mm'])
    return max(e[0], -0.5), min(e[1], P['nz'] - 0.5)


def background_gaps(truth, R, px):
    """Smallest distance [mm] between the edge of a 37 mm background ROI and the true phantom wall, sphere edges and
    lung-insert wall, in the central background slice."""
    M, off, x0, z0, P = np.array(truth['M']), np.array(truth['off']), truth['x0'], truth['z0'], truth['params']
    k = R['rois']['bgSlices'][len(R['rois']['bgSlices']) // 2]
    zc = z0 + k * P['dz']
    th = np.linspace(0, 2 * np.pi, 7200, endpoint=False)
    wall = [(147 * np.cos(a), 147 * np.sin(a)) for a in th if np.sin(a) <= 0]
    wall += [(70 + 77 * np.cos(a), 77 * np.sin(a)) for a in th if 0 <= a <= np.pi / 2]
    wall += [(-70 + 77 * np.cos(a), 77 * np.sin(a)) for a in th if np.pi / 2 <= a <= np.pi]
    wall += [(x, 77.0) for x in np.linspace(-70, 70, 1401)]
    wall = np.array(wall)
    w = (zc - off[2] - M[2, 0] * wall[:, 0] - M[2, 1] * wall[:, 1]) / M[2, 2]          # wall points in the slice plane
    wx = M[0, 0] * wall[:, 0] + M[0, 1] * wall[:, 1] + M[0, 2] * w + off[0]
    wy = M[1, 0] * wall[:, 0] + M[1, 1] * wall[:, 1] + M[1, 2] * w + off[1]
    ax, ay = axis_index(truth, k)
    gaps = dict(wall=np.inf, sphere=np.inf, lung=np.inf)
    for cx, cy in R['rois']['bgCentres']:
        X, Y = x0 + cx * px, x0 + cy * px
        gaps['wall'] = min(gaps['wall'], np.hypot(wx - X, wy - Y).min() - 18.5)
        for t in truth['spheres']:
            gaps['sphere'] = min(gaps['sphere'], np.hypot(t['x'] - cx, t['y'] - cy) * px - t['d'] / 2 - 18.5)
        if truth['lung_present']:
            gaps['lung'] = min(gaps['lung'], np.hypot(ax - cx, ay - cy) * px - 25.5 - 18.5)
    return {k: v for k, v in gaps.items() if np.isfinite(v)}


# ------------------------------------------------------------------------------------------------ one case
def run_case(case, workdir):
    t0 = time.time()
    d = os.path.join(workdir, case['name'])
    truth = make_phantom(d, **case['phantom'])
    P = truth['params']
    std, ratio = case.get('standard', '2018'), case.get('ratio', 4.0)
    out = os.path.join(d, 'result.json')
    node = shutil.which('node') or 'node'
    p = subprocess.run([node, os.path.join(HERE, 'analyse.js'), d, out, std, str(ratio)], capture_output=True, text=True)
    fails, info = [], {}

    def check(ok, msg):
        if not ok:
            fails.append(msg)

    if p.returncode != 0 or not os.path.exists(out):
        return dict(name=case['name'], desc=case['desc'], fails=[f'analysis crashed: {p.stderr.strip()[-500:]}'], info={}, sec=time.time() - t0)
    R = json.load(open(out))
    if case.get('error'):
        check(not R['ok'] and case['error'] in R.get('error', ''), f"expected the error '{case['error']}', got {R.get('error') if not R['ok'] else 'a result'}")
        return dict(name=case['name'], desc=case['desc'], fails=fails, info=dict(error=R.get('error', '')[:60]), sec=time.time() - t0)
    if not R['ok']:
        return dict(name=case['name'], desc=case['desc'], fails=[f"analysis failed: {R['error']}"], info={}, sec=time.time() - t0)
    T, S, px, dz = case['tol'], R['summary'], P['px'], P['dz']
    sph = {q['d']: q for q in R['spheres']}

    # 1. measurement check (every replicate, at the program's ROI positions)
    dq = dbv = dl = 0.0
    for i, F in enumerate(R['frames']):
        img = np.load(os.path.join(d, f'rep{i + 1}.npy'))
        ref = reference_frame(img, R, ratio, px)
        dq = max(dq, max(abs(a - b) for a, b in zip(F['contrast'], ref['contrast'])))
        dbv = max(dbv, max(abs(a - b) for a, b in zip(F['BV'], ref['BV'])))
        if ref['lung'] is not None:
            dl = max(dl, abs(F['lung_mean'] - ref['lung']))
    check(dq <= T['q_meas'], f"contrast differs from the reference ROI statistics by {dq:.3f} pp (> {T['q_meas']})")
    check(dbv <= T['bv_meas'], f"BV differs from the reference by {dbv:.3f} (> {T['bv_meas']})")
    check(dl <= T['lung_meas'], f"lung residual differs from the reference by {dl:.3f} pp (> {T['lung_meas']})")

    # 2. truth check
    for t in truth['spheres']:
        q = sph.get(t['d'])
        if q is None:
            fails.append(f"{t['d']} mm sphere not reported"); continue
        check(q['detected'] == ('hot' if t['hot'] else 'cold'), f"{t['d']} mm sphere detected {q['detected']}, true {'hot' if t['hot'] else 'cold'}")
    exy = max(np.hypot(sph[t['d']]['x'] - t['x'], sph[t['d']]['y'] - t['y']) * px for t in truth['spheres'])
    ez = max(abs(sph[t['d']]['z'] - t['z']) * dz for t in truth['spheres'])
    check(exy <= T['loc_xy'], f'sphere centre error in plane {exy:.2f} mm (> {T["loc_xy"]})')
    check(ez <= T['loc_z'], f'sphere centre error along z {ez:.2f} mm (> {T["loc_z"]})')
    # end-to-end: program contrast vs contrast of a ROI centred on the true centre (same slice, same background)
    img = np.load(os.path.join(d, 'rep1.npy'))
    F = R['frames'][0]
    de2e = 0.0
    for j, t in enumerate(sorted(truth['spheres'], key=lambda s: s['d'])):
        q = sph[t['d']]
        qt = contrast(Disk(t['x'], t['y'], t['d'], px, ss=40).mean(img[q['slice']]), F['C_B'][j], ratio, q['type'] == 'hot')
        e = abs(F['contrast'][j] - qt); de2e = max(de2e, e)
        check(e <= T['q_e2e'][t['d']], f"{t['d']} mm: contrast {F['contrast'][j]:.2f} vs {qt:.2f} with the ROI on the true centre (> {T['q_e2e'][t['d']]} pp)")
    cb = max(abs(f['C_B37'] / b - 1) for f, b in zip(R['frames'], truth['bg_by_rep']))
    check(cb <= T['cb'], f'C_B,37 deviates {cb * 100:.2f} % from the true background (> {T["cb"] * 100:.2f} %)')
    ring = abs(R['geom']['ring']['radius_mm'] - 57.2)
    check(ring <= T['ring'], f'ring radius off by {ring:.2f} mm (> {T["ring"]})')
    check(R['geom']['lung_present'] == truth['lung_present'], f"lung insert detected: {R['geom']['lung_present']}, present: {truth['lung_present']}")
    tilt = abs(R['geom']['lung_tilt_deg'] - truth['tilt_deg'])
    check(tilt <= T['tilt'], f"phantom tilt {R['geom']['lung_tilt_deg']:.2f} deg, true {truth['tilt_deg']} deg")
    mexp = S['meas_over_expected']
    check(mexp is not None and abs(mexp - 1) <= T['mexp'], f'measured/expected background {mexp} (decay correction or units?)')
    if P['nrep'] > 1:
        check(S['bg_cv'] is not None and S['bg_cv'] < 1.0, f"replicate background CV {S['bg_cv']} % after decay correction")
    if T['bv_max'] is not None:
        check(max(S['bv_mean']) <= T['bv_max'], f"BV {max(S['bv_mean']):.3f} % in a noise-free image")
    if T['lung_truth'] is not None and truth['lung_present']:
        # lung ROI (30 mm) centred on the true insert axis, on the program's lung slices, over the true background
        tl = np.mean([Disk(*axis_index(truth, k), 30.0, px, ss=40).mean(img[k]) for k, _, _ in R['rois']['lung']]) / truth['bg_by_rep'][0] * 100
        check(abs(S['lung_mean'] - tl) <= T['lung_truth'], f"lung residual {S['lung_mean']:.3f} %, true {tl:.3f} %")

    # 3. rule check
    for t in truth['spheres']:
        q = sph[t['d']]
        check(abs(q['slice'] - t['z']) <= 0.5 + T['loc_z'] / dz, f"{t['d']} mm sphere ROI on slice {q['slice']}, sphere centre at slice {t['z']:.2f}")
    zc = np.median([t['z'] for t in truth['spheres']])
    offs = sorted((k - zc) * dz for k in R['rois']['bgSlices'])
    check(len(offs) == 5 and all(abs(o - e) <= dz / 2 + T['loc_z'] for o, e in zip(offs, [-20, -10, 0, 10, 20])),
          f'background slices at {[round(o, 1) for o in offs]} mm from the sphere plane (expected 0, +-10, +-20)')
    gaps = background_gaps(truth, R, px)
    m = S['bg_margin_mm']
    check(m == 15.0, f'background ROI margin reduced to {m} mm (12 ROIs fit at 15 mm in this phantom)')
    check(len(R['rois']['bgCentres']) == 12, f"{len(R['rois']['bgCentres'])} background ROI centres")
    # Known deviation (version 2.0.0): the program measures the wall distance to the centres of the first pixels outside
    # the phantom mask, i.e. up to half a pixel beyond the wall, so the background ROIs come 0.25-0.4 pixel closer to the
    # wall than the reported margin. Allowed here as 0.5 pixel; the margin to spheres and lung insert has no such offset.
    for what, g in gaps.items():
        allow = 0.5 * px + 0.3 if what == 'wall' else 0.6
        check(g >= m - allow, f'background ROI {what} gap {g:.2f} mm < margin {m} mm - {allow:.2f} mm')
    if truth['lung_present']:
        excl = 10.0 if std == '2012' else 30.0
        ks = [k for k, _, _ in R['rois']['lung']]
        lo, hi = lung_end_slices(truth)
        check(ks == list(range(ks[0], ks[-1] + 1)), 'lung-residual slices not contiguous')
        # no slice inside the exclusion zone (half a slice for the discrete end); at most 2 slices excluded in addition
        check(lo + excl / dz - 0.5 <= ks[0] <= lo + excl / dz + 2 and hi - excl / dz - 2 <= ks[-1] <= hi - excl / dz + 0.5,
              f'lung-residual slices {ks[0]}-{ks[-1]}; insert ends at slices {lo:.1f}/{hi:.1f}, exclusion {excl} mm')
    if 'warnings' in case:
        for w in case['warnings']:
            check(any(w in x for x in R['warnings']), f"missing warning '{w}'")
        extra = [x for x in R['warnings'] if not any(w in x for w in case['warnings'])]
        check(not extra, f'unexpected warning(s): {extra}')
    info = dict(loc_xy=exy, loc_z=ez, dq_meas=dq, dq_e2e=de2e, warnings=len(R['warnings']))
    return dict(name=case['name'], desc=case['desc'], fails=fails, info=info, sec=time.time() - t0)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--jobs', type=int, default=min(4, os.cpu_count() or 1))
    ap.add_argument('--only', default='', help='comma-separated case names')
    ap.add_argument('--keep', default='', help='keep the phantoms and results in this folder')
    ap.add_argument('--summary', default='', help='append a Markdown summary to this file (e.g. $GITHUB_STEP_SUMMARY)')
    a = ap.parse_args()
    cases = [c for c in CASES if not a.only or c['name'] in a.only.split(',')]
    if not cases:
        sys.exit(f'no case matches {a.only}; cases: {", ".join(c["name"] for c in CASES)}')
    work = os.path.abspath(a.keep) if a.keep else tempfile.mkdtemp(prefix='nema_phantoms_')
    os.makedirs(work, exist_ok=True)
    try:
        with ProcessPoolExecutor(max_workers=a.jobs) as ex:
            results = list(ex.map(run_case, cases, [work] * len(cases)))
    finally:
        if not a.keep:
            shutil.rmtree(work, ignore_errors=True)
    f = lambda v, n=2: '-' if v is None else f'{v:.{n}f}'
    lines = ['| case | result | centre error xy / z [mm] | max Δ contrast: measurement / end-to-end [pp] | time [s] |',
             '|---|---|---|---|---|']
    for r in results:
        i = r['info']
        lines.append(f"| `{r['name']}` | {'FAIL' if r['fails'] else 'pass'} | {f(i.get('loc_xy'))} / {f(i.get('loc_z'))} | "
                     f"{f(i.get('dq_meas'), 3)} / {f(i.get('dq_e2e'))} | {r['sec']:.0f} |")
    failed = [r for r in results if r['fails']]
    report = '\n'.join(['## Digital-phantom verification', ''] + lines + [''] +
                       [f"- **{r['name']}** ({r['desc']}): " + '; '.join(r['fails']) for r in failed])
    print(report)
    if a.summary:
        with open(a.summary, 'a', encoding='utf-8') as fh:
            fh.write(report + '\n')
    print(f"\n{len(results) - len(failed)} of {len(results)} cases passed")
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
