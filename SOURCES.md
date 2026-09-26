# Sources

## Documents behind the analysis rules and the DICOM reader

| Document | Used for |
|---|---|
| NEMA NU 2-2018, Performance Measurements of Positron Emission Tomographs, Foreword (free preview) | changes from NU 2-2012: all six spheres hot, 8:1 ratio removed, lung-slice exclusion 10 -> 30 mm, phantom positioning |
| IAEA Human Health Series No. 1, Quality Assurance for PET and PET/CT Systems (2009), reproducing the NU 2-2007 IQ procedure | ROI sizes and positions, contrast / background-variability / lung-residual formulas |
| Open-access PET performance evaluations (e.g. Rausch 2015, Vandendriessche 2019, Chen 2020, Zeimpekis 2022) | NU 2-2012/2018 scan-time rule (100 cm axial in 30 min), fill and positioning as applied in practice |
| DICOM PS3.3 C.8.9 (PET Series / PET Image modules), PS3.6 (data dictionary) | Units, Corrected Image, Decay Correction (START / ADMIN), Rescale Slope per image, Radiopharmaceutical Information |
| Philips Vereos PET/CT 2.0 DICOM Conformance Statement | Units CNTS; Activity Concentration Scale Factor (7053,1009) and SUV Scale Factor (7053,1000) of 'Philips PET Private Group'; private transfer syntax |
| Siemens Biograph Vision VG86A DICOM Conformance Statement, Print No. 10753734-EKL-861 | Manufacturer's Model Name strings 'Biograph<n>_Vision 3R/4R[ Edge]'; Units BQML; decay correction START |
| Canon Cartesion Prime DICOM Conformance Statement | general PET attributes (no private scale factor documented) |
| GDCM private dictionary (GEMS_PETD_01) and public TCIA DICOM headers | names of GE private reconstruction tags; Manufacturer / Model strings of GE and Siemens systems |

# Sources of the built-in scanner profiles

Generated from `scanner_profiles.json` by `make_sources.py`. Published values are shown in the report for **comparison only**; they are not acceptance limits. Values were copied from the cited table or text of each source; entries marked *provisional* come from a secondary source.

## Siemens Biograph mCT (TrueV, 4 rings, 22.1 cm)

- Profile id: `siemens-biograph-mct-4r`; DICOM match: Manufacturer `/siemens/i`, Model `/mCT(?!\s*Flow)/i`
- Axial FOV: 22.1 cm; variant: 4 rings (TrueV); TOF 540 ps
- ManufacturerModelName values seen in public DICOM (TCIA): `Biograph128_mCT`, `Biograph64_mCT`, `Biograph 64_mCT`, `Biograph40_mCT`, `Biograph20_mCT`, `Biograph64_mCT 4R`
- Notes: Geometry: Karlberg 2016 (22.1 cm; Carlier 2020 lists 21.6 cm). A 3-ring (non-TrueV) mCT exists; its axial FOV was not found in a public source. Reference values are NU 2-2007 (IQ procedure equivalent to NU 2-2012 except scan time), contrast only.

| Reference set | Standard | Ratio | Recon | Source (table) |
|---|---|---|---|---|
| PSF+TOF 3i21s, 4 mm, 4:1 (Karlberg 2016) | NEMA NU 2-2007 (IQ procedure equivalent to NU 2-2012 apart from emission scan time, per Rausch 2015 Discussion) | 4.0:1 | 3D OSEM + PSF + TOF; 3 it x 21 subsets; filter Gaussian 4 mm FWHM; matrix 400x400; voxel ~2 isotropic (paper states ~2 mm) mm | Karlberg AM, Sæther O, Eikenes L, Goa PE. Quantitative comparison of PET performance—Siemens Biograph mCT and mMR. EJNMMI Phys. 2016;3:5. https://doi.org/10.1186/s40658-016-0142-7 (Table 3 (contrast); lung residual from Results text/Fig. 5) |
| OSEM 3i24s, 4 mm, 4:1 (Karlberg 2016) | NEMA NU 2-2007 (IQ procedure equivalent to NU 2-2012 apart from emission scan time, per Rausch 2015 Discussion) | 4.0:1 | 3D OSEM (no PSF, no TOF); 3 it x 24 subsets; filter Gaussian 4 mm FWHM; matrix 400x400; voxel ~2 isotropic (paper states ~2 mm) mm | Karlberg AM, Sæther O, Eikenes L, Goa PE. Quantitative comparison of PET performance—Siemens Biograph mCT and mMR. EJNMMI Phys. 2016;3:5. https://doi.org/10.1186/s40658-016-0142-7 (Table 3 (contrast); lung residual from Results text/Fig. 5) |
| PSF 3i21s, 4 mm, 4:1 (Karlberg 2016) | NEMA NU 2-2007 (IQ procedure equivalent to NU 2-2012 apart from emission scan time, per Rausch 2015 Discussion) | 4.0:1 | 3D OSEM + PSF (TrueX); 3 it x 21 subsets; filter Gaussian 4 mm FWHM; matrix 400x400; voxel ~2 isotropic (paper states ~2 mm) mm | Karlberg AM, Sæther O, Eikenes L, Goa PE. Quantitative comparison of PET performance—Siemens Biograph mCT and mMR. EJNMMI Phys. 2016;3:5. https://doi.org/10.1186/s40658-016-0142-7 (Table 3 (contrast); lung residual from Results text/Fig. 5) |
| TOF 3i21s, 4 mm, 4:1 (Karlberg 2016) | NEMA NU 2-2007 (IQ procedure equivalent to NU 2-2012 apart from emission scan time, per Rausch 2015 Discussion) | 4.0:1 | 3D OSEM + TOF; 3 it x 21 subsets; filter Gaussian 4 mm FWHM; matrix 400x400; voxel ~2 isotropic (paper states ~2 mm) mm | Karlberg AM, Sæther O, Eikenes L, Goa PE. Quantitative comparison of PET performance—Siemens Biograph mCT and mMR. EJNMMI Phys. 2016;3:5. https://doi.org/10.1186/s40658-016-0142-7 (Table 3 (contrast); lung residual from Results text/Fig. 5) |
| PSF+TOF 3i21s, 4 mm, 8:1 (Karlberg 2016) | NEMA NU 2-2007 (IQ procedure equivalent to NU 2-2012 apart from emission scan time, per Rausch 2015 Discussion) | 8.0:1 | 3D OSEM + PSF + TOF; 3 it x 21 subsets; filter Gaussian 4 mm FWHM; matrix 400x400; voxel ~2 isotropic (paper states ~2 mm) mm | Karlberg AM, Sæther O, Eikenes L, Goa PE. Quantitative comparison of PET performance—Siemens Biograph mCT and mMR. EJNMMI Phys. 2016;3:5. https://doi.org/10.1186/s40658-016-0142-7 (Table 2 (contrast); lung residual from Results text/Fig. 5) |
| OSEM 3i24s, 4 mm, 8:1 (Karlberg 2016) | NEMA NU 2-2007 (IQ procedure equivalent to NU 2-2012 apart from emission scan time, per Rausch 2015 Discussion) | 8.0:1 | 3D OSEM (no PSF, no TOF); 3 it x 24 subsets; filter Gaussian 4 mm FWHM; matrix 400x400; voxel ~2 isotropic (paper states ~2 mm) mm | Karlberg AM, Sæther O, Eikenes L, Goa PE. Quantitative comparison of PET performance—Siemens Biograph mCT and mMR. EJNMMI Phys. 2016;3:5. https://doi.org/10.1186/s40658-016-0142-7 (Table 2 (contrast); lung residual from Results text/Fig. 5) |
| PSF 3i21s, 4 mm, 8:1 (Karlberg 2016) | NEMA NU 2-2007 (IQ procedure equivalent to NU 2-2012 apart from emission scan time, per Rausch 2015 Discussion) | 8.0:1 | 3D OSEM + PSF (TrueX); 3 it x 21 subsets; filter Gaussian 4 mm FWHM; matrix 400x400; voxel ~2 isotropic (paper states ~2 mm) mm | Karlberg AM, Sæther O, Eikenes L, Goa PE. Quantitative comparison of PET performance—Siemens Biograph mCT and mMR. EJNMMI Phys. 2016;3:5. https://doi.org/10.1186/s40658-016-0142-7 (Table 2 (contrast); lung residual from Results text/Fig. 5) |
| TOF 3i21s, 4 mm, 8:1 (Karlberg 2016) | NEMA NU 2-2007 (IQ procedure equivalent to NU 2-2012 apart from emission scan time, per Rausch 2015 Discussion) | 8.0:1 | 3D OSEM + TOF; 3 it x 21 subsets; filter Gaussian 4 mm FWHM; matrix 400x400; voxel ~2 isotropic (paper states ~2 mm) mm | Karlberg AM, Sæther O, Eikenes L, Goa PE. Quantitative comparison of PET performance—Siemens Biograph mCT and mMR. EJNMMI Phys. 2016;3:5. https://doi.org/10.1186/s40658-016-0142-7 (Table 2 (contrast); lung residual from Results text/Fig. 5) |

## Siemens Biograph mCT Flow (4 rings, 22.1 cm)

- Profile id: `siemens-biograph-mct-flow`; DICOM match: Manufacturer `/siemens/i`, Model `/mCT\s*Flow/i`
- Axial FOV: 22.1 cm; variant: 64-4R (TrueV); TOF 540 ps
- ManufacturerModelName values seen in public DICOM (TCIA): `Biograph mCT Flow 20`
- Notes: Geometry and values: Rausch 2015 (NU 2-2012, three 240 s single-bed acquisitions). Rausch report 2 iterations in Methods and 3 in Discussion for OSEM.

| Reference set | Standard | Ratio | Recon | Source (table) |
|---|---|---|---|---|
| PSF+TOF 2i21s, 3 mm, 4:1 (Rausch 2015) | NEMA NU 2-2012 | 4.0:1 | OSEM 3D + PSF + TOF; 2 it x 21 subsets; filter Gaussian 3 mm FWHM; matrix 200x200 | Rausch I, Cal-González J, Dapra D, Gallowitsch HJ, Lind P, Beyer T, Minear G. Performance evaluation of the Biograph mCT Flow PET/CT system according to the NEMA NU2-2012 standard. EJNMMI Phys. 2015;2:26. https://doi.org/10.1186/s40658-015-0132-1 (Table 3 (mean; max/min in paper), Methods 'Image quality') |
| OSEM 2i24s, 3 mm, 4:1 (Rausch 2015) | NEMA NU 2-2012 | 4.0:1 | OSEM 3D (no PSF, no TOF); 2 it x 24 subsets; filter Gaussian 3 mm FWHM; matrix 200x200 | Rausch I, Cal-González J, Dapra D, Gallowitsch HJ, Lind P, Beyer T, Minear G. Performance evaluation of the Biograph mCT Flow PET/CT system according to the NEMA NU2-2012 standard. EJNMMI Phys. 2015;2:26. https://doi.org/10.1186/s40658-015-0132-1 (Table 3 (mean; max/min in paper), Methods 'Image quality') |
| PSF+TOF 2i21s, 3 mm, 8:1 (Rausch 2015) | NEMA NU 2-2012 | 8.0:1 | OSEM 3D + PSF + TOF; 2 it x 21 subsets; filter Gaussian 3 mm FWHM; matrix 200x200 | Rausch I, Cal-González J, Dapra D, Gallowitsch HJ, Lind P, Beyer T, Minear G. Performance evaluation of the Biograph mCT Flow PET/CT system according to the NEMA NU2-2012 standard. EJNMMI Phys. 2015;2:26. https://doi.org/10.1186/s40658-015-0132-1 (Table 3 (mean; max/min in paper), Methods 'Image quality') |
| OSEM 2i24s, 3 mm, 8:1 (Rausch 2015) | NEMA NU 2-2012 | 8.0:1 | OSEM 3D (no PSF, no TOF); 2 it x 24 subsets; filter Gaussian 3 mm FWHM; matrix 200x200 | Rausch I, Cal-González J, Dapra D, Gallowitsch HJ, Lind P, Beyer T, Minear G. Performance evaluation of the Biograph mCT Flow PET/CT system according to the NEMA NU2-2012 standard. EJNMMI Phys. 2015;2:26. https://doi.org/10.1186/s40658-015-0132-1 (Table 3 (mean; max/min in paper), Methods 'Image quality') |

## Siemens Biograph Horizon (3 rings, 16.4 cm)

- Profile id: `siemens-biograph-horizon`; DICOM match: Manufacturer `/siemens/i`, Model `/Horizon/i`
- Axial FOV: 16.4 cm; variant: 3R (a 4R version exists; its axial FOV was not found)
- ManufacturerModelName values seen in public DICOM (TCIA): `Biograph Horizon`, `Biograph16_Horizon 3R`
- Notes: Identification only: no published per-sphere NEMA IQ values were found for the Biograph Horizon.
- No published per-sphere NEMA IQ values found.

## Siemens Biograph Vision 450 (6 rings, 19.7 cm)

- Profile id: `siemens-biograph-vision-450`; DICOM match: Manufacturer `/siemens/i`, Model `/Vision(\D*450|\s*3R)/i` (pattern checked against the model names of the conformance statement, not on images)
- Axial FOV: 19.7 cm; variant: 6 rings; TOF 213 ps
- ManufacturerModelName values listed in the Siemens Biograph Vision VG86A DICOM Conformance Statement, Print No. 10753734-EKL-861: `Biograph20_Vision 3R`, `Biograph40_Vision 3R`, `Biograph64_Vision 3R`, `Biograph128_Vision 3R`, `Biograph128_Vision 3R Edge`
- Notes: Model-name strings from the Siemens Biograph Vision VG86A DICOM Conformance Statement (Print No. 10753734-EKL-861): 'Biograph<20|40|64|128>_Vision 3R' or '... 4R' (optional suffix ' Edge'). The mapping 3R = Vision 450 (19.7 cm) and 4R = Vision 600 (26.1-26.3 cm) is inferred from the 3:4 ratio of the axial FOVs (6 vs 8 block rings); verify on your system. Reference values: Carlier 2020 (NU 2-2012-type fill, 28/37 mm cold).

| Reference set | Standard | Ratio | Recon | Source (table) |
|---|---|---|---|---|
| PSF+TOF 4i5s, no filter, 220x220 (Carlier 2020) | NEMA NU 2 (paper cites NU 2-2018 [ref 8]) but NU 2-2012-type fill: 10-22 mm hot at 4:1, 28/37 mm non-radioactive water | 4.0:1 | 3D OP-OSEM + PSF + TOF; 4 it x 5 subsets; filter none; matrix 220x220; voxel 3.2 x 3.2 x 1.65 mm | Carlier T, Ferrer L, Conti M, Bodet-Milin C, Rousseau C, Bercier Y, Bendriem B, Kraeber-Bodéré F. From a PMT-based to a SiPM-based PET system: a study to define matched acquisition/reconstruction parameters and NEMA performance of the Biograph Vision 450. EJNMMI Phys. 2020;7:55. https://doi.org/10.1186/s40658-020-00323-w (Table 3; Methods 'Image quality') |
| PSF+TOF 4i5s, no filter, 440x440 (Carlier 2020) | NEMA NU 2 (paper cites NU 2-2018 [ref 8]) but NU 2-2012-type fill: 10-22 mm hot at 4:1, 28/37 mm non-radioactive water | 4.0:1 | 3D OP-OSEM + PSF + TOF; 4 it x 5 subsets; filter none; matrix 440x440; voxel 1.65 x 1.65 x 1.65 mm | Carlier T, Ferrer L, Conti M, Bodet-Milin C, Rousseau C, Bercier Y, Bendriem B, Kraeber-Bodéré F. From a PMT-based to a SiPM-based PET system: a study to define matched acquisition/reconstruction parameters and NEMA performance of the Biograph Vision 450. EJNMMI Phys. 2020;7:55. https://doi.org/10.1186/s40658-020-00323-w (Table 3; Methods 'Image quality') |
| PSF+TOF 8i5s, no filter, 440x440 (Carlier 2020) | NEMA NU 2 (paper cites NU 2-2018 [ref 8]) but NU 2-2012-type fill: 10-22 mm hot at 4:1, 28/37 mm non-radioactive water | 4.0:1 | 3D OP-OSEM + PSF + TOF; 8 it x 5 subsets; filter none; matrix 440x440; voxel 1.65 x 1.65 x 1.65 mm | Carlier T, Ferrer L, Conti M, Bodet-Milin C, Rousseau C, Bercier Y, Bendriem B, Kraeber-Bodéré F. From a PMT-based to a SiPM-based PET system: a study to define matched acquisition/reconstruction parameters and NEMA performance of the Biograph Vision 450. EJNMMI Phys. 2020;7:55. https://doi.org/10.1186/s40658-020-00323-w (Table 3 (values in brackets, 8 iterations); Methods 'Image quality') |

## Siemens Biograph Vision 600 (8 rings, 26.1 cm)

- Profile id: `siemens-biograph-vision-600`; DICOM match: Manufacturer `/siemens/i`, Model `/Vision(\D*600|\s*4R)/i` (pattern checked against the model names of the conformance statement, not on images)
- Axial FOV: 26.1 cm; variant: 8 rings; TOF 210 ps
- ManufacturerModelName values listed in the Siemens Biograph Vision VG86A DICOM Conformance Statement, Print No. 10753734-EKL-861: `Biograph20_Vision 4R`, `Biograph40_Vision 4R`, `Biograph64_Vision 4R`, `Biograph128_Vision 4R`, `Biograph128_Vision 4R Edge`
- Notes: Model-name strings from the Siemens Biograph Vision VG86A DICOM Conformance Statement (Print No. 10753734-EKL-861): 'Biograph<20|40|64|128>_Vision 3R' or '... 4R' (optional suffix ' Edge'). The mapping 3R = Vision 450 (19.7 cm) and 4R = Vision 600 (26.1-26.3 cm) is inferred from the 3:4 ratio of the axial FOVs (6 vs 8 block rings); verify on your system. The reference is a secondary transcription of van Sluis 2019 (primary tables not retrieved): provisional.

| Reference set | Standard | Ratio | Recon | Source (table) |
|---|---|---|---|---|
| PSF+TOF 8i5s, 440x440, 4:1 (van Sluis 2019, via Pena-Acosta 2025) - provisional | NEMA NU 2-2012 (van Sluis 2019; NU 2-2018 used only for TOF and co-registration) | 4.0:1 | 3D OP-OSEM + PSF + TOF; 8 it x 5 subsets; filter none (per Carlier 2020 description of the van Sluis parameters; not confirmed from the primary text); matrix 440x440; voxel 1.6 x 1.6 x 1.6 mm | van Sluis J, de Jong J, Schaar J, Noordzij W, van Snick P, Dierckx R, Borra R, Willemsen A, Boellaard R. Performance characteristics of the digital Biograph Vision PET/CT system. J Nucl Med. 2019;60:1031-1036.; values as reproduced in Peña-Acosta MM, Gallardo S, Lorduy-Alós M, Verdú G. Application of NEMA protocols to verify GATE models based on the Digital Biograph Vision and the Biograph Vision Quadra scanners. Z Med Phys. 2025;35:318-330. https://doi.org/10.2967/jnumed.118.215418; https://doi.org/10.1016/j.zemedi.2024.01.005 (Primary: van Sluis 2019 Table (4:1) — not retrieved; values copied from Peña-Acosta 2025 Table 5 'Experiment' column (ref [26] = van Sluis 2019); recon parameters from JNM article page text) |

## GE Discovery IQ (5 rings, 26 cm)

- Profile id: `ge-discovery-iq-5r`; DICOM match: Manufacturer `/^GE\b|GE MEDICAL|GE HEALTH/i`, Model `/Discovery\s*IQ/i`
- Axial FOV: 26 cm; variant: 5 rings (2- to 4-ring configurations exist: axial FOV 10.4-26 cm)
- ManufacturerModelName values seen in public DICOM (TCIA): `Discovery IQ`
- Published NEMA IQ protocol: scan time [352, 366, 381] s, replicates 3, recon method VPHD, matrix 256x256, fov_cm 40, iterations 8, subsets 12, filter_mm 2.0, zfilter none — GE manufacturer NEMA IQ protocol as published by Vallot et al. EJNMMI Phys 2020;7:30, Table 1 (ring configuration not stated)
- Published limits (opt-in): GE prescribed limits, Discovery IQ 5-ring, NU 2-2012 (as reproduced by Jha et al. 2019): contrast [30, 40, 50, 60, 60, 60] (hot/hot/hot/hot/cold/cold), BV [12, 10, 9, 7, 6, 5], lung 19 — Jha 2019 WJNM (doi 10.4103/wjnm.WJNM_72_18) Table 3 'Prescribed limits'
  - Reconstruction to which the limits apply is not stated. The same numeric pattern (30/40/50/60/60/60; 12/10/9/7/6/5; lung 19) is reported as the GE specification for the Omni Legend (NU 2-2018, all hot) in Smith et al. arXiv:2308.06255 Table 5 - a different scanner, noted only as a cross-check. Source uses strict inequalities; the program applies >= / <=.
- Notes: BGO, non-TOF. The model name does not encode the ring number; the GE axial-FOV header tag is used to select between profiles when several match. Gen 2: no peer-reviewed NEMA data found.

| Reference set | Standard | Ratio | Recon | Source (table) |
|---|---|---|---|---|
| VPHD, 4:1 (Jha 2019) | NEMA NU 2-2012 | 4.0:1 | VPHD ('VUE Point HD Sharp IR'); iterations, subsets, filter and matrix for the IQ test not reported | Jha AK, Mithun S, Puranik AD, Purandare NC, Shah S, Agrawal A, Rangarajan V. Performance characteristic evaluation of a bismuth germanate-based high-sensitivity 5-ring Discovery image quality PET/CT system as per NEMA NU 2-2012. World J Nucl Med. 2019;18(4):351-360 https://doi.org/10.4103/wjnm.WJNM_72_18 (Table 3 (VPHD rows); Methods 'Image quality') |
| Q.Clear beta 350, 4:1 (Jha 2019) | NEMA NU 2-2012 | 4.0:1 | Q.Clear beta 350 ('prescribed by vendor'); matrix not reported | Jha AK, Mithun S, Puranik AD, Purandare NC, Shah S, Agrawal A, Rangarajan V. Performance characteristic evaluation of a bismuth germanate-based high-sensitivity 5-ring Discovery image quality PET/CT system as per NEMA NU 2-2012. World J Nucl Med. 2019;18(4):351-360 https://doi.org/10.4103/wjnm.WJNM_72_18 (Table 3 (Q.Clear rows); Discussion (beta 350)) |
| VPHD 8i12s, 2 mm, 256x256 (Vallot 2020, 68Ge phantom) | NEMA NU 2-2012 (68Ge solid phantom variant) | 3.96:1 | VPHD (OSEM, no PSF), 8 iterations, 12 subsets, 2 mm post-filter, no z-filter, 256 x 256, 40 cm DFOV (manufacturer NEMA recon, test 1) | Vallot D, De Ponti E, Morzenti S, Gramek A, Pieczonka A, Reynes-Llompart G, Siennicki J, Deak P, Dutta C, Uribe J, Caselles O. Evaluation of PET quantitation accuracy among multiple Discovery IQ PET/CT systems via NEMA image quality test. EJNMMI Phys. 2020;7:30 https://doi.org/10.1186/s40658-020-00294-y (Table 4, column 'NEMA ACQ and RECON OSEM (test 1)'; Tables 1-3) |
| Q.Clear beta 25, 256x256 (Vallot 2020, 68Ge phantom) | NEMA NU 2-2012 (68Ge solid phantom variant) | 3.96:1 | Q.Clear (BSREM + PSF) beta 25, 25 iterations, 256 x 256, 40 cm DFOV (test 2) | Vallot D, De Ponti E, Morzenti S, Gramek A, Pieczonka A, Reynes-Llompart G, Siennicki J, Deak P, Dutta C, Uribe J, Caselles O. Evaluation of PET quantitation accuracy among multiple Discovery IQ PET/CT systems via NEMA image quality test. EJNMMI Phys. 2020;7:30 https://doi.org/10.1186/s40658-020-00294-y (Table 4, column 'NEMA ACQ and RECON BSREM (test 2)') |
| VPHD (Reynes-Llompart 2017, via Smith 2023) - provisional | NEMA NU 2-2012 | 4.0:1 | VPHD (iterations/subsets not given in secondary source) | Smith RL, Bartley L, O'Callaghan C, Bradley KM, Marshall C. NEMA NU 2-2018 performance evaluation of a new generation digital 32-cm axial field-of-view Omni Legend PET-CT. arXiv:2308.06255 https://arxiv.org/abs/2308.06255 (Table 7, column 'Discovery IQ, Reynes-Llompart et al (9), NEMA NU2-2012') |

## GE Discovery MI (3 rings, 15 cm)

- Profile id: `ge-discovery-mi-3r`; DICOM match: Manufacturer `/^GE\b|GE MEDICAL|GE HEALTH/i`, Model `/Discovery\s*MI(?!\s*-?\s*DR)/i`
- Axial FOV: 15 cm; variant: Gen 1, 3 rings; TOF 375.6 ps
- ManufacturerModelName values seen in public DICOM (TCIA): `Discovery MI`
- Published NEMA IQ protocol: scan time 200 s, replicates 3, recon method VPFX, matrix 384x384, iterations 4, subsets 34 — Vandendriessche et al. EJNMMI Phys 2019;6:8 (GE NEMA test procedure: 3 min 20 s per frame, VPFX 4 it / 34 subsets, 384x384; filter not stated)
- Notes: All Discovery MI configurations share the model name 'Discovery MI'; the GE axial-FOV header tag selects the ring configuration.

| Reference set | Standard | Ratio | Recon | Source (table) |
|---|---|---|---|---|
| VPFX 4i34s, 4:1 (Vandendriessche 2019) | NEMA NU 2-2012 | 4.0:1 | VPFX (TOF-OSEM, no PSF), 384 x 384, 4 iterations, 34 subsets, CTAC; post-filter not stated | Vandendriessche D, Uribe J, Bertin H, De Geeter F. Performance characteristics of silicon photomultiplier based 15-cm AFOV TOF PET/CT. EJNMMI Phys. 2019;6:8 https://doi.org/10.1186/s40658-019-0244-0 (Abstract (CR, BV, LE); Table 3 (CR); Methods p4-5; LE 8.5 +/- 0.3% p9) |

## GE Discovery MI (4 rings, 20 cm)

- Profile id: `ge-discovery-mi-4r`; DICOM match: Manufacturer `/^GE\b|GE MEDICAL|GE HEALTH/i`, Model `/Discovery\s*MI(?!\s*-?\s*DR)/i`
- Axial FOV: 20 cm; variant: Gen 1, 4 rings; TOF 375.4 ps
- ManufacturerModelName values seen in public DICOM (TCIA): `Discovery MI`
- Published NEMA IQ protocol: scan time [271, 279, 282] s, replicates 3, recon method VPFX, matrix 384x384, iterations 4, subsets 34, filter_mm 2.0 — Chicheportiche et al. EJNMMI Phys 2020;7:4, p4-5 (citing the GE Discovery MI NEMA test procedure)
- Notes: Reference contrast from the Hsu 2017 abstract only (BV, lung residual and recon details not retrievable).

| Reference set | Standard | Ratio | Recon | Source (table) |
|---|---|---|---|---|
| Averaged CRC (Hsu 2017 abstract) - contrast only | NEMA NU 2-2012 | 4.0:1 | not retrieved | Hsu DFC, Ilan E, Peterson WT, Uribe J, Lubberink M, Levin CS. Studies of a next-generation silicon-photomultiplier-based time-of-flight PET/CT system. J Nucl Med. 2017;58(9):1511-1518 https://doi.org/10.2967/jnumed.117.189514 (Abstract (averaged contrast recovery coefficients); same values tabulated in Vandendriessche 2019 Table 3 (DMI 4 column)) |

## GE Discovery MI (5 rings, 25 cm)

- Profile id: `ge-discovery-mi-5r`; DICOM match: Manufacturer `/^GE\b|GE MEDICAL|GE HEALTH/i`, Model `/Discovery\s*MI(?!\s*-?\s*DR)/i`
- Axial FOV: 25 cm; variant: Gen 1 and Gen 2, 5 rings; TOF 381.7 ps
- ManufacturerModelName values seen in public DICOM (TCIA): `Discovery MI`
- Published NEMA IQ protocol: scan time [323, 334, 346] s, replicates 3, recon method VPFX, matrix 384x384, iterations 4, subsets 34, filter_mm 2.0 — Zeimpekis et al. EJNMMI 2022;49:3023, p3 (Gen 2, NU 2-2018 scan times; VPFX 4 it / 34 subsets, 2 mm, 384x384)
- Notes: Gen 1 (Pan 2019, NU 2-2012) and Gen 2 (Zeimpekis 2022, NU 2-2018) share the 25 cm axial FOV; choose the reference that matches the system generation.

| Reference set | Standard | Ratio | Recon | Source (table) |
|---|---|---|---|---|
| VPFX, 4:1, Gen 1, mean of 3 sites (Pan 2019) | NEMA NU 2-2012 | 4.0:1 | iterative reconstruction with TOF (VPFX); iterations/subsets/filter for the IQ test not stated (4 it / 34 subsets / 2 mm 'per vendor recommendations' stated for the spatial-resolution IR); matrix not stated for IQ | Pan T, Einstein SA, Kappadath SC, Grogg KS, Lois Gomez C, Alessio AM, Hunter WC, El Fakhri G, Kinahan PE, Mawlawi OR. Performance evaluation of the 5-Ring GE Discovery MI PET/CT system using the NEMA NU 2-2012 Standard. Med Phys. 2019;46(7):3025-3033 https://doi.org/10.1002/mp.13576 (Table 1 ('Image Quality, IR'); Methods 2.B.5) |
| VPFX 4i34s 2 mm, all hot, Gen 2 (Zeimpekis 2022) | NEMA NU 2-2018 | 4.0:1 | VPFX (TOF-OSEM) 4 iterations / 34 subsets, 2 mm Gaussian, 384 x 384 | Zeimpekis KG, Kotasidis FA, Huellner M, Nemirovsky A, Kaufmann PA, Treyer V. NEMA NU 2-2018 performance evaluation of a new generation 30-cm axial field-of-view Discovery MI PET/CT. Eur J Nucl Med Mol Imaging. 2022;49:3023-3032 https://doi.org/10.1007/s00259-022-05751-7 (Table 1, column 'DMI Gen2 5R', 'Image quality (VPFX)'; Methods p3) |
| Q.Clear beta 50, all hot, Gen 2 (Zeimpekis 2022) | NEMA NU 2-2018 | 4.0:1 | Q.Clear (BSREM with resolution modelling, TOF) beta 50, no filtering, 384 x 384 | Zeimpekis KG, Kotasidis FA, Huellner M, Nemirovsky A, Kaufmann PA, Treyer V. NEMA NU 2-2018 performance evaluation of a new generation 30-cm axial field-of-view Discovery MI PET/CT. Eur J Nucl Med Mol Imaging. 2022;49:3023-3032 https://doi.org/10.1007/s00259-022-05751-7 (Table 1, column 'DMI Gen2 5R', 'Image quality (QClear)') |

## GE Discovery MI (6 rings, 30 cm)

- Profile id: `ge-discovery-mi-6r`; DICOM match: Manufacturer `/^GE\b|GE MEDICAL|GE HEALTH/i`, Model `/Discovery\s*MI(?!\s*-?\s*DR)/i`
- Axial FOV: 30 cm; variant: Gen 2, 6 rings; TOF 389.6 ps
- ManufacturerModelName values seen in public DICOM (TCIA): `Discovery MI`
- Published NEMA IQ protocol: scan time [383, 399, 414] s, replicates 3, recon method VPFX, matrix 384x384, iterations 4, subsets 34, filter_mm 2.0 — Zeimpekis et al. EJNMMI 2022;49:3023, p3 (NU 2-2018 scan times 6:23, 6:39, 6:54; VPFX 4 it / 34 subsets, 2 mm, 384x384)

| Reference set | Standard | Ratio | Recon | Source (table) |
|---|---|---|---|---|
| VPFX 4i34s 2 mm, all hot (Zeimpekis 2022) | NEMA NU 2-2018 | 4.0:1 | VPFX 4 iterations / 34 subsets, 2 mm Gaussian, 384 x 384 | Zeimpekis KG, Kotasidis FA, Huellner M, Nemirovsky A, Kaufmann PA, Treyer V. NEMA NU 2-2018 performance evaluation of a new generation 30-cm axial field-of-view Discovery MI PET/CT. Eur J Nucl Med Mol Imaging. 2022;49:3023-3032 https://doi.org/10.1007/s00259-022-05751-7 (Table 1, column 'DMI Gen2 6R', 'Image quality (VPFX)') |
| Q.Clear beta 50, all hot (Zeimpekis 2022) | NEMA NU 2-2018 | 4.0:1 | Q.Clear beta 50, no filtering, 384 x 384 | Zeimpekis KG, Kotasidis FA, Huellner M, Nemirovsky A, Kaufmann PA, Treyer V. NEMA NU 2-2018 performance evaluation of a new generation 30-cm axial field-of-view Discovery MI PET/CT. Eur J Nucl Med Mol Imaging. 2022;49:3023-3032 https://doi.org/10.1007/s00259-022-05751-7 (Table 1, column 'DMI Gen2 6R', 'Image quality (QClear)') |

## GE Discovery MI DR (15.6 cm)

- Profile id: `ge-discovery-mi-dr`; DICOM match: Manufacturer `/^GE\b|GE MEDICAL|GE HEALTH/i`, Model `/Discovery\s*MI\s*-?\s*DR/i`
- Axial FOV: 15.6 cm; variant: PMT-based 'Digital Ready'; TOF 552.71 ps
- ManufacturerModelName values seen in public DICOM (TCIA): `Discovery MI DR`
- Published NEMA IQ protocol: scan time [212, 217, 222] s, replicates 3, recon method VPFX, matrix 384x384, iterations 4, subsets 24, filter_mm 2.0 — Chicheportiche et al. EJNMMI Phys 2020;7:4, p4-5 (citing the GE Discovery MI DR NEMA test procedure)
- Notes: Identification and protocol only: published per-sphere values are shown in figures only (Chicheportiche 2020) or paywalled (Michopoulou 2019).
- No published per-sphere NEMA IQ values found.

## Not found in public sources (at compilation)

- Siemens: Biograph Horizon per-sphere NEMA IQ values; Horizon 4R geometry and TOF; primary IQ tables of Jakoby 2011 (mCT) and van Sluis 2019 (Vision 600); any public Siemens IQ acceptance limits. Vision model-name strings were taken from the conformance statement and have not been checked on images from a Vision system.
- GE: primary IQ tables of Reynes-Llompart 2017 (Discovery IQ) and Hsu 2017 (Discovery MI 4-ring); per-sphere values of Chicheportiche 2020 (figures only); public IQ limits for Discovery MI / MI DR; GE DICOM conformance-statement definitions of the private PET tags (names taken from the GDCM dictionary).
- NEMA: the full texts of NU 2-2012 and NU 2-2018 (not freely available); the program follows the published summaries above. Where the text allows two readings (lung-residual denominator; one common slice vs one slice per sphere) the choice is stated in README.md.
- Other vendors: no public United Imaging DICOM conformance statement; Philips and Canon are supported by the generic DICOM reader but have no built-in profile.
