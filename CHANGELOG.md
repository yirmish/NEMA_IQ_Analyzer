# Changelog

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
