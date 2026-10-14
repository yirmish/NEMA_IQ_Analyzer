"""Regenerate the example report in docs/ from a digital IEC body phantom (no patient or site data).

The phantom (tests/digital_phantom.py, fixed parameters and seed) is analysed with NEMA_IQ_Analyzer.html in headless
Chromium, exactly as a user would do it; the printed report is saved as docs/example_report.pdf and its first two pages
as docs/example_summary.png and docs/example_qa.png (108 dpi).

Requires: Python 3 with numpy and scipy, Node.js with Playwright and its Chromium, and pdftoppm (poppler-utils).
Usage: python docs/make_example.py
"""
import os, subprocess, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'tests'))
from digital_phantom import make_phantom  # noqa: E402

# NU 2-2012 fill (10-22 mm hot at 4:1, 28/37 mm cold), lung insert, 3 replicate acquisitions; 384 x 384 matrix with
# 1.04 mm pixels and 2.07 mm slices; resolution and noise chosen to resemble a clinical PMT-era OSEM reconstruction
PHANTOM = dict(n=384, px=1.04, dz=2.07, nz=96, ss=3, fwhm=6.5, noise=0.13, nrep=3, fill='2012', ratio=4.0,
               lung_act=0.09, tilt_deg=0.5, rot_deg=8.0, dx=4.0, dy=-6.0, seed=2012)

with tempfile.TemporaryDirectory(prefix='nema_example_') as tmp:
    make_phantom(tmp, **PHANTOM)
    pdf = os.path.join(HERE, 'example_report.pdf')
    env = dict(os.environ)
    env.setdefault('NODE_PATH', subprocess.run(['npm', 'root', '-g'], capture_output=True, text=True).stdout.strip())
    subprocess.run(['node', os.path.join(HERE, 'render_example.js'), tmp, pdf, '2012', 'Digital IEC phantom (tests/digital_phantom.py)'],
                   check=True, env=env)
for page, name in ((1, 'example_summary'), (2, 'example_qa')):
    subprocess.run(['pdftoppm', '-png', '-r', '108', '-f', str(page), '-l', str(page), '-singlefile', pdf, os.path.join(HERE, name)], check=True)
print('written: docs/example_report.pdf, docs/example_summary.png, docs/example_qa.png')
