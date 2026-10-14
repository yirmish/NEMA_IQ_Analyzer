# Changelog

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
