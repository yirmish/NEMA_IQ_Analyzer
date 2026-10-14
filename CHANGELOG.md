# Changelog

## 2.0.4 — 2026-10-14

Packaging release: the program and the analysis are unchanged (results identical to 2.0.2 and 2.0.3).

### Release
- The demo dataset `NEMA_IQ_demo_digital_phantom.zip` is attached to the release, next to `NEMA_IQ_Analyzer.html` and
  `SHA256SUMS.txt`. Releases of this repository are immutable (files cannot be added after publication), so 2.0.3
  could not receive it.
- The release workflow attaches the demo ZIP and starts the release notes with the links to the online demo. Run again
  for an existing version, it adds missing files only to a release that is still mutable and otherwise stops with a
  message.

## 2.0.3 — 2026-10-14

The analysis is unchanged; results are identical to 2.0.2.

### Demo dataset
- New `demo/NEMA_IQ_demo_digital_phantom.zip` (4.4 MB): a digital IEC body phantom written as PET DICOM by
  `tests/digital_phantom.py` (NU 2-2012 fill, lung insert, 3 replicates, 2.5 mm voxels; no patient, site or scanner
  data). `python demo/make_demo.py` regenerates it byte for byte.
- Button *Load demo dataset* (section 1) and the address `NEMA_IQ_Analyzer.html?demo=1` on the project website download
  the ZIP, select NU 2-2012 and run the analysis. This is the only network access of the program and happens only on
  request. In a local copy (`file://`) the button explains how to load the ZIP by drag and drop instead.

### Input
- ZIP files can be dragged onto the page or chosen with *Select files…*; their DICOM entries are read in memory (stored or
  deflated entries; ZIP64 and encrypted ZIPs are refused with a message). `tests/analyse.js` accepts a ZIP as well.

### Repository
- `docs/social_preview.png` (1280 × 640, repository card for GitHub and link previews; `docs/make_social_preview.py`)
  and Open Graph / Twitter meta tags in the HTML head.
- `index.html` redirects the project website to the program and keeps `?demo=1`; it is now covered by `SHA256SUMS.txt`.
- Test case `demo_dataset` analyses the demo ZIP (14 cases).

## 2.0.2 — 2026-10-14

Defaults changed after a comparison with results of the GE NEMA software (Discovery MI 20 cm and Discovery MI DR 15 cm,
NU 2-2012 fill, 3 scans each). Contrast and background variability are otherwise computed exactly as in 2.0.1.

### Analysis
- Sphere ROIs: **one common slice through the sphere plane is now the default** (as in NEMA NU 2, where the sphere ROIs
  are drawn on the transverse slice centred on the spheres; this also reproduces the GE NEMA software). 2.0.0/2.0.1 placed each sphere
  ROI on its own central slice by default; this remains available (*Central slice of each sphere*, `sliceMode:
  'per-sphere'`). Where the sphere centres span 2.7 mm axially, per-sphere slices put three spheres on the next slice and
  single-scan contrast differed from GE by up to 11.9 points; with one common slice by at most 3.7 points (hot) and
  0.4 points (cold), comparable to GE's own scan-to-scan SD (3.3 points). Results change only where the sphere
  centres round to different slices (e.g. GE Omni Legend, 2026 test: 28/37 mm cold contrast +0.4/−1.7 points, hot
  spheres unchanged).
- Lung residual: new option *Lung-residual slices* (`lungRange`). **Default `'insert-ends'`**: the 10 / 30 mm exclusion
  applies at the ends of the lung insert only; where the insert continues beyond the first or last image slice (axial
  FOV shorter than the phantom), slices up to the FOV edge are used. 2.0.0/2.0.1 applied the exclusion at the FOV edge as
  well (`'fov-edge'`, still selectable). With the new default the lung residual agrees with GE within 0.16 points per
  scan (2.0.1: bias −0.7, up to 2.0 points) and shows the same scan-to-scan variation. No change when the whole insert is
  inside the FOV (e.g. 32 cm Omni Legend).
- Optional lung exclusion distance (`lungExclMm`); a value other than the standard's gives a warning.
- Report: the lung-slices row states the exclusion rule that was applied; the JSON export lists the new options.

### Tests
- The rule check follows the sphere-slice mode and the lung-slice rule. New cases: `tilt3_offset_common`,
  `short_fov_2012`, `short_fov_2012_fov_edge` (15.7 cm FOV, insert leaving the FOV) and `long_fov_full_insert` (13 cases).
  With the 2.0.1 core, `short_fov_2012` fails (lung slices excluded at the FOV edge).
- `tests/analyse.js` takes optional sphere-slice mode, lung-slice rule and exclusion arguments (default: program
  defaults). `run_tests.py --jobs 1` runs serially without worker processes.

### Documentation
- README: new settings, calculation conventions and the comparison with the GE NEMA software.
- Example report in `docs/` regenerated with 2.0.2 (one common sphere slice; lung slices up to the FOV edge).

## 2.0.1 — 2026-10-14

### Analysis
- Background ROIs: the distance from the phantom wall is measured to the wall located with sub-pixel precision (50 % of
  the background in the smoothed image, 5x finer grid). Version 2.0.0 measured it to the centres of the first pixels
  outside the phantom mask, which placed the ROIs up to one pixel (on average 0.1-0.3 pixel) closer to the wall than the
  reported margin. On digital phantoms the true wall gap of the closest ROI is now 15.2 mm without noise and
  14.7-15.2 mm with noise (2.0.0: 14.5 mm and 13.7-14.4 mm). The ROIs move inwards by up to about one pixel, so C_B and
  BV differ slightly from 2.0.0 (digital phantoms: C_B,37 by up to 0.1 %, BV by up to about 0.3 percentage points).

### Tests
- Digital IEC body phantoms with known ground truth (`tests/`): measurement, truth and rule checks on 9 cases (NU 2-2012
  and 2018 fills, 8:1, no lung insert, tilt, 1.65-4 mm voxels, noise, replicates, START/ADMIN, CNTS, Implicit VR).
- GitHub Actions: digital-phantom tests, rebuild check of the HTML, `profiles.js` and `SOURCES.md`, checksum check.

### Documentation and release
- Example report (`docs/`) regenerated with 2.0.1 from a digital IEC body phantom (NU 2-2012 fill, lung insert,
  3 replicates); `docs/make_example.py` reproduces it by running the program in headless Chromium. The 2.0.0 example
  (anonymised clinical phantom study) remains in the git history (commit ec56eac).
- Release workflow (`.github/workflows/release.yml`): tests, version/date consistency check, tag and GitHub release
  with `NEMA_IQ_Analyzer.html` and `SHA256SUMS.txt`.

## 2.0.0 — 2026-09-26 (first public release)

First vendor-neutral release, derived from an in-house tool (1.x) used for the annual PET QA of GE systems.

### Analysis
- NEMA NU 2-2012 and NU 2-2018 image-quality analysis: sphere contrast, background variability, lung residual;
  mean ± SD over replicate acquisitions; one ROI slice per sphere or one common slice.
- Automatic localisation with or without the lung insert; fill check (hot/cold spheres) against the selected edition.
- Protocol, correction, units, decay-correction, activity (measured vs expected) and CT-number checks.
- Informational bed step implied by the NEMA scan-time rule (100 cm in 30 min); warning for an 8:1 ratio under NU 2-2018.

### Limits, references and baselines
- No built-in acceptance limits. Limits are entered by hand or loaded from JSON; contrast limits refer to the sphere
  types of the NEMA edition chosen for the limits (or to explicit `sphere_types`).
- 11 optional scanner profiles (Siemens Biograph mCT, mCT Flow, Horizon, Vision 450/600; GE Discovery IQ,
  Discovery MI 3/4/5/6 rings, Discovery MI DR) with published protocols and reference values for comparison only.
  Sources in `SOURCES.md`; secondary sources are marked provisional.
- Baseline files (JSON) created by the program; comparison only for the same scanner model and the same sphere types.

### DICOM input
- Units BQML; Philips CNTS converted with the Activity Concentration Scale Factor (7053,1009).
- Rescale slope applied per slice; decay correction START and ADMIN.
- Clear messages for compressed or private transfer syntaxes and for multi-frame (Enhanced) objects, which are not
  supported.

### Validation
- Results identical to the 1.x tool on GE Omni Legend (3 replicates, NU 2-2012 and 2018) and GE Discovery MI
  (2 reconstructions). Siemens and Philips conventions tested on modified copies of GE images only.
