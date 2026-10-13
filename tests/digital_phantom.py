"""Digital IEC/NEMA NU 2 body phantom written as classic single-frame PET DICOM, with known ground truth.

Used by run_tests.py to verify the analysis end to end (DICOM reader, localisation, ROIs, formulas, decay correction and
units) against values that are known exactly.

Geometry (interior): upper half a circle of radius 147 mm, lower half 294 x 77 mm with 77 mm corner radii (294 x 224 mm
cross-section), 180 mm long; lung insert of 51 mm diameter along the whole length, coaxial with the sphere ring
(radius 57.2 mm); sphere centres 70 mm from one end. Sphere walls are not modelled: the activity steps directly from
sphere to background. Voxel values are partial-volume averages (supersampling factor ss in x, y and z). Optional: a
Gaussian point-spread function and correlated, signal-dependent Gaussian noise. The phantom tests the software, not the
physics of a scanner.

Command line: python digital_phantom.py <outdir> [key=value ...]   (keys and defaults: DEFAULTS)
Output: <outdir>/rep<k>/*.dcm, <outdir>/rep<k>.npy (the image in Bq/mL as the program should read it) and
<outdir>/truth.json (sphere centres in column/row/slice index coordinates, background concentration per replicate).
"""
import json, os, struct, sys, uuid
import numpy as np
from scipy.ndimage import gaussian_filter

DEFAULTS = dict(
    px=2.0, dz=2.0, n=256, nz=100,      # pixel size, slice spacing [mm], matrix, slices (centred on the scanner axis)
    ss=4,                               # supersampling factor for the partial-volume averages
    fwhm=0.0,                           # Gaussian PSF [mm] (0 = none)
    noise=0.0, noise_fwhm=4.0, seed=1,  # noise SD relative to sqrt(signal x background); correlation FWHM [mm]
    fill='2018',                        # '2018': all six spheres hot; '2012': 28 and 37 mm cold
    ratio=4.0, bg=5300.0,               # sphere:background ratio; background [Bq/mL] at the start of the first acquisition
    lung=True, lung_act=0.0,            # lung insert present; its activity on the axis as a fraction of the background
    lung_grad=0.0,                      # relative increase of the lung-insert activity from the axis to the insert wall
    tilt_deg=0.0,                       # phantom axis tilted about the scanner x axis
    rot_deg=0.0, mirror=False,          # rotation of the sphere ring about the phantom axis; reversed size order
    dx=0.0, dy=0.0, zoff=0.0,           # position of the ring centre / sphere plane relative to the scanner centre [mm]
    nrep=1,                             # replicate acquisitions (start 400 s apart, F-18 decay)
    decay='START',                      # DICOM Decay Correction: START (acquisition start) or ADMIN (injection time)
    units='BQML', acsf=0.5,             # BQML, or CNTS with the Philips activity-concentration scale factor acsf
    ts='explicit',                      # transfer syntax: explicit or implicit VR little endian
    manufacturer='Synthetic', model='Digital IEC phantom')

SPHERE_D = [10, 13, 17, 22, 28, 37]
RING_R, LUNG_D, LENGTH, SPHERE_FROM_END = 57.2, 51.0, 180.0, 70.0
T_HALF = 6586.2                         # F-18 [s]
T_INJ, T_ACQ, REP_STEP, FRAME_S = 9 * 3600, 10 * 3600, 400, 240


def _rot(P):
    t, r = np.deg2rad(P['tilt_deg']), np.deg2rad(P['rot_deg'])
    tilt = np.array([[1, 0, 0], [0, np.cos(t), -np.sin(t)], [0, np.sin(t), np.cos(t)]])
    spin = np.array([[np.cos(r), -np.sin(r), 0], [np.sin(r), np.cos(r), 0], [0, 0, 1]])
    return tilt, spin


def _spheres(P):
    _, spin = _rot(P)
    cold = [28, 37] if P['fill'] == '2012' else []
    out = []
    for k, d in enumerate(SPHERE_D):
        a = np.deg2rad(30 + (-60 if P['mirror'] else 60) * k)
        out.append(dict(d=d, hot=d not in cold, c=spin @ np.array([RING_R * np.cos(a), RING_R * np.sin(a), 0.0])))
    return out


def _activity(X, Y, z, P, M, off, sph):
    """Truth activity (relative to the background) at scanner coordinates X, Y (2-D arrays) and z (scalar), in mm."""
    u, v, w = X - off[0], Y - off[1], z - off[2]
    x = u * M[0, 0] + v * M[1, 0] + w * M[2, 0]           # phantom frame = M^T (scanner - offset)
    y = u * M[0, 1] + v * M[1, 1] + w * M[2, 1]
    zz = u * M[0, 2] + v * M[1, 2] + w * M[2, 2]
    top = (y <= 0) & (x * x + y * y <= 147.0 ** 2)
    bottom = (y > 0) & (y <= 77.0) & ((np.abs(x) <= 70.0) | ((np.abs(x) - 70.0) ** 2 + y * y <= 77.0 ** 2))
    body = (top | bottom) & (zz >= SPHERE_FROM_END - LENGTH) & (zz <= SPHERE_FROM_END)
    a = body.astype(np.float64)
    if P['lung']:
        r2 = x * x + y * y
        m = body & (r2 <= (LUNG_D / 2) ** 2)
        a[m] = P['lung_act'] * (1 + P['lung_grad'] * np.sqrt(r2[m]) / (LUNG_D / 2))
    for s in sph:
        r = s['d'] / 2
        dzs = zz - s['c'][2]
        if np.abs(dzs).min() > r:
            continue
        inside = (x - s['c'][0]) ** 2 + (y - s['c'][1]) ** 2 + dzs * dzs <= r * r
        a[inside] = P['ratio'] if s['hot'] else 0.0
    return a


def phantom_volume(P):
    """Noise-free activity concentration relative to the background (nz, n, n), and the truth dictionary."""
    n, nz, px, dz, ss = P['n'], P['nz'], P['px'], P['dz'], P['ss']
    x0, z0 = -(n - 1) / 2 * px, -(nz - 1) / 2 * dz          # pixel-centre coordinates of index 0 [mm]
    tilt, _ = _rot(P)
    M, off, sph = tilt, np.array([P['dx'], P['dy'], P['zoff']]), _spheres(P)
    # bounding box of the body in scanner coordinates (only this part is computed)
    corners = np.array([[x, y, z] for x in (-147, 147) for y in (-147, 77) for z in (SPHERE_FROM_END - LENGTH, SPHERE_FROM_END)])
    cs = corners @ M.T + off
    lo = np.floor((cs.min(0) - [x0, x0, z0]) / [px, px, dz]).astype(int) - 2
    hi = np.ceil((cs.max(0) - [x0, x0, z0]) / [px, px, dz]).astype(int) + 3
    i0, j0, k0 = np.maximum(lo, 0); i1, j1, k1 = np.minimum(hi, [n, n, nz])
    o = (np.arange(ss) + 0.5) / ss - 0.5
    xs = x0 + np.add.outer(np.arange(i0, i1), o).ravel() * px
    ys = x0 + np.add.outer(np.arange(j0, j1), o).ravel() * px
    Y, X = np.meshgrid(ys, xs, indexing='ij')
    vol = np.zeros((nz, n, n), np.float32)
    for k in range(k0, k1):
        acc = sum(_activity(X, Y, z0 + (k + oz) * dz, P, M, off, sph) for oz in o)
        vol[k, j0:j1, i0:i1] = acc.reshape(j1 - j0, ss, i1 - i0, ss).mean(axis=(1, 3)) / ss
    if P['fwhm'] > 0:
        f = P['fwhm'] / 2.3548
        vol = gaussian_filter(vol, (f / dz, f / px, f / px), mode='constant').astype(np.float32)
    # phantom frame -> scanner coordinates [mm]: M @ p + off; index coordinates: (x - x0) / px, (y - x0) / px, (z - z0) / dz
    truth = dict(params=P, spheres=[], tilt_deg=P['tilt_deg'], lung_present=bool(P['lung']), x0=x0, z0=z0,
                 M=M.tolist(), off=off.tolist(), ends_mm=[SPHERE_FROM_END - LENGTH, SPHERE_FROM_END])
    for s in sph:
        c = M @ s['c'] + off
        truth['spheres'].append(dict(d=s['d'], hot=s['hot'], x=(c[0] - x0) / px, y=(c[1] - x0) / px, z=(c[2] - z0) / dz))
    return vol, truth


# ------------------------------------------------------------------------------------------------ DICOM writer
def _value(vr, v):
    if isinstance(v, (bytes, bytearray)):
        b = bytes(v)
    elif vr == 'US':
        b = struct.pack('<H', v)
    elif vr == 'UL':
        b = struct.pack('<I', v)
    else:
        b = str(v).encode('ascii')
    if len(b) % 2:
        b += b'\0' if vr in ('UI', 'OB', 'OW', 'SQ') else b' '
    return b


def _encode(elements, explicit):
    """elements: list of (group, element, VR, value); a value of an SQ is a list of item element lists."""
    out = b''
    for g, e, vr, v in sorted(elements, key=lambda t: (t[0], t[1])):
        if vr == 'SQ':
            v = b''.join(struct.pack('<HHI', 0xFFFE, 0xE000, len(it)) + it for it in (_encode(i, explicit) for i in v))
        b = _value(vr, v)
        if not explicit:
            out += struct.pack('<HHI', g, e, len(b)) + b
        elif vr in ('OB', 'OW', 'SQ', 'UN', 'UT'):
            out += struct.pack('<HH2sHI', g, e, vr.encode(), 0, len(b)) + b
        else:
            out += struct.pack('<HH2sH', g, e, vr.encode(), len(b)) + b
    return out


def _uid():
    return '2.25.' + str(uuid.uuid4().int)


def _tm(sec):
    return f'{sec // 3600:02d}{sec // 60 % 60:02d}{sec % 60:02d}'


def make_phantom(outdir, **kw):
    P = dict(DEFAULTS)
    for k, v in kw.items():
        if k not in P:
            raise KeyError(f'unknown phantom parameter {k}')
        P[k] = type(P[k])(v) if not isinstance(P[k], bool) else (v if isinstance(v, bool) else str(v).lower() in ('1', 'true', 'yes'))
    rel, truth = phantom_volume(P)
    n, nz, px, dz = P['n'], P['nz'], P['px'], P['dz']
    x0, z0 = -(n - 1) / 2 * px, -(nz - 1) / 2 * dz
    rng = np.random.default_rng(P['seed'])
    # injected activity such that the measured/expected check of the program gives 1: background compartment volume
    # (body minus lung insert) plus the excess activity of the hot spheres, decayed from injection to the acquisition
    area = np.pi * 147.0 ** 2 / 2 + 140.0 * 77.0 + np.pi * 77.0 ** 2 / 2 - np.pi * (LUNG_D / 2) ** 2   # mm^2
    vol_ml = area * LENGTH / 1000.0
    vhot = sum(4 / 3 * np.pi * (s['d'] / 20) ** 3 for s in truth['spheres'] if s['hot'])
    dose = P['bg'] * (vol_ml + (P['ratio'] - 1) * vhot) * 2 ** ((T_ACQ - T_INJ) / T_HALF)
    study, frame = _uid(), _uid()
    truth['bg_by_rep'], truth['volume_ml'], truth['dose_bq'] = [], vol_ml, dose
    os.makedirs(outdir, exist_ok=True)
    for rep in range(P['nrep']):
        t_start = T_ACQ + rep * REP_STEP
        ref = 2 ** ((T_ACQ - T_INJ) / T_HALF) if P['decay'] == 'ADMIN' else 2 ** (-(t_start - T_ACQ) / T_HALF)
        bg = P['bg'] * ref                                   # background in this replicate's image [Bq/mL]
        img = rel.astype(np.float64) * bg
        if P['noise'] > 0:
            f = P['noise_fwhm'] / 2.3548
            nn = gaussian_filter(rng.standard_normal(img.shape), (f / dz, f / px, f / px))
            img += P['noise'] * np.sqrt(np.maximum(img, 0) * bg) * nn / nn.std()
        truth['bg_by_rep'].append(bg)
        np.save(os.path.join(outdir, f'rep{rep + 1}.npy'), img.astype(np.float32))
        stored = img / P['acsf'] if P['units'] == 'CNTS' else img
        d = os.path.join(outdir, f'rep{rep + 1}')
        os.makedirs(d, exist_ok=True)
        series = _uid()
        for k in range(nz):
            slope = max(float(np.abs(stored[k]).max()), 1e-3) / 32000.0     # per-slice rescale slope
            sop = _uid()
            ts = '1.2.840.10008.1.2.1' if P['ts'] == 'explicit' else '1.2.840.10008.1.2'
            meta = _encode([(2, 1, 'OB', b'\0\1'), (2, 2, 'UI', '1.2.840.10008.5.1.4.1.1.128'), (2, 3, 'UI', sop), (2, 0x10, 'UI', ts)], True)
            meta = _encode([(2, 0, 'UL', len(meta))], True) + meta
            els = [
                (8, 8, 'CS', 'ORIGINAL\\PRIMARY'), (8, 0x16, 'UI', '1.2.840.10008.5.1.4.1.1.128'), (8, 0x18, 'UI', sop),
                (8, 0x20, 'DA', '20260101'), (8, 0x21, 'DA', '20260101'), (8, 0x22, 'DA', '20260101'),
                (8, 0x31, 'TM', _tm(t_start)), (8, 0x32, 'TM', _tm(t_start)), (8, 0x60, 'CS', 'PT'),
                (8, 0x70, 'LO', P['manufacturer']), (8, 0x103E, 'LO', f'IEC digital rep{rep + 1}'), (8, 0x1090, 'LO', P['model']),
                (0x10, 0x20, 'LO', 'DIGITAL PHANTOM'), (0x18, 0x50, 'DS', f'{dz:g}'), (0x18, 0x1242, 'IS', str(FRAME_S * 1000)),
                (0x20, 0xD, 'UI', study), (0x20, 0xE, 'UI', series), (0x20, 0x11, 'IS', str(rep + 1)), (0x20, 0x13, 'IS', str(k + 1)),
                (0x20, 0x32, 'DS', f'{x0:.4f}\\{x0:.4f}\\{z0 + k * dz:.4f}'), (0x20, 0x37, 'DS', '1\\0\\0\\0\\1\\0'), (0x20, 0x52, 'UI', frame),
                (0x28, 2, 'US', 1), (0x28, 4, 'CS', 'MONOCHROME2'), (0x28, 0x10, 'US', n), (0x28, 0x11, 'US', n),
                (0x28, 0x30, 'DS', f'{px:g}\\{px:g}'), (0x28, 0x51, 'CS', 'ATTN\\SCAT\\DECY'), (0x28, 0x100, 'US', 16),
                (0x28, 0x101, 'US', 16), (0x28, 0x102, 'US', 15), (0x28, 0x103, 'US', 1),
                (0x28, 0x1052, 'DS', '0'), (0x28, 0x1053, 'DS', f'{slope:.10g}'),
                (0x54, 0x16, 'SQ', [[(0x18, 0x1071, 'DS', f'{vol_ml:.1f}'), (0x18, 0x1072, 'TM', _tm(T_INJ)),
                                     (0x18, 0x1074, 'DS', f'{dose:.6g}'), (0x18, 0x1075, 'DS', f'{T_HALF:g}')]]),
                (0x54, 0x1001, 'CS', P['units']), (0x54, 0x1102, 'CS', P['decay']), (0x54, 0x1103, 'LO', 'OSEM 3i21s'),
                (0x7FE0, 0x10, 'OW', np.round(stored[k] / slope).astype('<i2').tobytes())]
            if P['units'] == 'CNTS':
                els += [(0x7053, 0x10, 'LO', 'Philips PET Private Group'), (0x7053, 0x1009, 'DS', f'{P["acsf"]:g}')]
            with open(os.path.join(d, f'{k + 1:04d}.dcm'), 'wb') as fh:
                fh.write(b'\0' * 128 + b'DICM' + meta + _encode(els, P['ts'] == 'explicit'))
    with open(os.path.join(outdir, 'truth.json'), 'w') as fh:
        json.dump(truth, fh, indent=1)
    return truth


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    t = make_phantom(sys.argv[1], **dict(a.split('=', 1) for a in sys.argv[2:]))
    print(sys.argv[1], [(s['d'], round(s['x'], 2), round(s['y'], 2), round(s['z'], 2)) for s in t['spheres']])
