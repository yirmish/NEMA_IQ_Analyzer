"""Build the demo dataset demo/NEMA_IQ_demo_digital_phantom.zip.

The demo is a digital IEC/NEMA body phantom written as PET DICOM by tests/digital_phantom.py (no patient, site or
scanner data): NU 2-2012 fill (10-22 mm spheres hot at 4:1, 28 and 37 mm cold), lung insert, three replicate
acquisitions 400 s apart (F-18 decay), 160 x 160 matrix with 2.5 mm pixels, 80 slices of 2.5 mm, 6.5 mm PSF and
correlated noise, phantom axis tilted 0.5 degrees and 4/-6 mm off centre. truth.json holds the true geometry.

Parameters, random seed, UIDs and ZIP time stamps are fixed, so the ZIP is reproduced byte for byte.
Usage: python demo/make_demo.py [out.zip]      Requires: numpy, scipy (tests/requirements.txt).
"""
import hashlib, os, random, sys, tempfile, uuid, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'tests'))
import digital_phantom as dp  # noqa: E402

PHANTOM = dict(n=160, px=2.5, dz=2.5, nz=80, ss=3, fwhm=6.5, noise=0.13, nrep=3, fill='2012', ratio=4.0,
               lung_act=0.09, tilt_deg=0.5, rot_deg=8.0, dx=4.0, dy=-6.0, seed=2012)
TOP = 'NEMA_IQ_demo_digital_phantom'
README = f"""NEMA IQ Analyzer - demo dataset (digital phantom, no patient or site data)

Synthetic NEMA NU 2 image-quality test written by tests/digital_phantom.py: NU 2-2012 fill (10-22 mm spheres hot at
4:1, 28/37 mm cold), lung insert, 3 replicate acquisitions, 160 x 160 x 80 voxels of 2.5 mm, 6.5 mm PSF, noise.
Parameters: {PHANTOM}
truth.json: true sphere centres (column/row/slice), phantom tilt and background concentration per replicate.

Use: open NEMA_IQ_Analyzer.html, drag this ZIP file (or the unpacked folder) onto the page, choose NEMA NU 2-2012
and click Analyse - or open https://yirmish.github.io/NEMA_IQ_Analyzer/NEMA_IQ_Analyzer.html?demo=1
"""


def main(out):
    rnd = random.Random(PHANTOM['seed'])
    dp._uid = lambda: '2.25.' + str(uuid.UUID(int=rnd.getrandbits(128), version=4).int)   # reproducible UIDs
    with tempfile.TemporaryDirectory(prefix='nema_demo_') as tmp:
        dp.make_phantom(tmp, **PHANTOM)
        names = sorted(os.path.relpath(os.path.join(r, f), tmp).replace(os.sep, '/') for r, _, fs in os.walk(tmp) for f in fs)
        names = [n for n in names if n.endswith('.dcm') or n == 'truth.json']
        with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
            def put(name, data):
                zi = zipfile.ZipInfo(f'{TOP}/{name}', date_time=(2026, 1, 1, 0, 0, 0)); zi.compress_type = zipfile.ZIP_DEFLATED
                zi.external_attr = 0o644 << 16; z.writestr(zi, data, compresslevel=9)
            put('README.txt', README.encode())
            for n in names: put(n, open(os.path.join(tmp, n), 'rb').read())
    print(out, len([n for n in names if n.endswith('.dcm')]), 'images,', os.path.getsize(out) // 1024, 'kB, sha256',
          hashlib.sha256(open(out, 'rb').read()).hexdigest()[:16])


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'NEMA_IQ_demo_digital_phantom.zip'))
