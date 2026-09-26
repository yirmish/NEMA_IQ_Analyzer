"""Generate SOURCES.md from scanner_profiles.json (per-profile sources) plus the documents behind the program logic.

Usage: python make_sources.py            (looks for scanner_profiles.json next to this file or one level up)
"""
import json, os

here = os.path.dirname(os.path.abspath(__file__))
prof_path = next(p for p in (os.path.join(here, "scanner_profiles.json"), os.path.join(os.path.dirname(here), "scanner_profiles.json"))
                 if os.path.exists(p))
root = os.path.dirname(prof_path)
db = json.load(open(prof_path, encoding="utf-8"))

# Documents used for the analysis rules and the DICOM reader (not specific to one profile).
LOGIC_SOURCES = [
    ("NEMA NU 2-2018, Performance Measurements of Positron Emission Tomographs, Foreword (free preview)",
     "changes from NU 2-2012: all six spheres hot, 8:1 ratio removed, lung-slice exclusion 10 -> 30 mm, phantom positioning"),
    ("IAEA Human Health Series No. 1, Quality Assurance for PET and PET/CT Systems (2009), reproducing the NU 2-2007 IQ procedure",
     "ROI sizes and positions, contrast / background-variability / lung-residual formulas"),
    ("Open-access PET performance evaluations (e.g. Rausch 2015, Vandendriessche 2019, Chen 2020, Zeimpekis 2022)",
     "NU 2-2012/2018 scan-time rule (100 cm axial in 30 min), fill and positioning as applied in practice"),
    ("DICOM PS3.3 C.8.9 (PET Series / PET Image modules), PS3.6 (data dictionary)",
     "Units, Corrected Image, Decay Correction (START / ADMIN), Rescale Slope per image, Radiopharmaceutical Information"),
    ("Philips Vereos PET/CT 2.0 DICOM Conformance Statement",
     "Units CNTS; Activity Concentration Scale Factor (7053,1009) and SUV Scale Factor (7053,1000) of 'Philips PET Private Group'; private transfer syntax"),
    ("Siemens Biograph Vision VG86A DICOM Conformance Statement, Print No. 10753734-EKL-861",
     "Manufacturer's Model Name strings 'Biograph<n>_Vision 3R/4R[ Edge]'; Units BQML; decay correction START"),
    ("Canon Cartesion Prime DICOM Conformance Statement", "general PET attributes (no private scale factor documented)"),
    ("GDCM private dictionary (GEMS_PETD_01) and public TCIA DICOM headers",
     "names of GE private reconstruction tags; Manufacturer / Model strings of GE and Siemens systems"),
]

NOT_FOUND = [
    "Siemens: Biograph Horizon per-sphere NEMA IQ values; Horizon 4R geometry and TOF; primary IQ tables of Jakoby 2011 (mCT) "
    "and van Sluis 2019 (Vision 600); any public Siemens IQ acceptance limits. Vision model-name strings were taken from the "
    "conformance statement and have not been checked on images from a Vision system.",
    "GE: primary IQ tables of Reynes-Llompart 2017 (Discovery IQ) and Hsu 2017 (Discovery MI 4-ring); per-sphere values of "
    "Chicheportiche 2020 (figures only); public IQ limits for Discovery MI / MI DR; GE DICOM conformance-statement definitions "
    "of the private PET tags (names taken from the GDCM dictionary).",
    "NEMA: the full texts of NU 2-2012 and NU 2-2018 (not freely available); the program follows the published summaries above. "
    "Where the text allows two readings (lung-residual denominator; one common slice vs one slice per sphere) the choice is "
    "stated in README.md.",
    "Other vendors: no public United Imaging DICOM conformance statement; Philips and Canon are supported by the generic "
    "DICOM reader but have no built-in profile.",
]


def rx(s):
    return f"`/{s}/i`"


def fmt_list(v):
    return "[" + ", ".join(str(x) for x in v) + "]" if isinstance(v, list) else str(v)


def profile_md(p):
    L = [f"## {p['name']}", ""]
    m = p.get("match") or {}
    parts = []
    if m.get("manufacturer"): parts.append(f"Manufacturer {rx(m['manufacturer'])}")
    if m.get("model"): parts.append(f"Model {rx(m['model'])}")
    ver = ""
    if p.get("match_verified") is False:
        ver = (" (pattern checked against the model names of the conformance statement, not on images)"
               if p.get("dicom_model_names_source") else " (pattern not verified against DICOM headers)")
    L.append(f"- Profile id: `{p['id']}`; DICOM match: {', '.join(parts)}{ver}")
    geo = [f"Axial FOV: {p['afov_cm']} cm" if p.get("afov_cm") else None, f"variant: {p['variant']}" if p.get("variant") else None,
           f"TOF {p['tof_ps']} ps" if p.get("tof_ps") else None]
    L.append("- " + "; ".join(g for g in geo if g))
    if p.get("dicom_model_names"):
        src = p.get("dicom_model_names_source")
        where = f"listed in the {src}" if src else "seen in public DICOM (TCIA)"
        L.append(f"- ManufacturerModelName values {where}: " + ", ".join(f"`{n}`" for n in p["dicom_model_names"]))
    pr = p.get("protocol")
    if pr:
        items = []
        if pr.get("scan_time_s") is not None: items.append(f"scan time {fmt_list(pr['scan_time_s'])} s")
        if pr.get("replicates"): items.append(f"replicates {pr['replicates']}")
        for k, v in (pr.get("recon") or {}).items():
            items.append(f"recon method {v}" if k == "method" else f"{k} {v}")
        L.append(f"- Published NEMA IQ protocol: {', '.join(items)} — {pr.get('source', '')}")
    for lim in p.get("published_limits") or []:
        types = "/".join(lim.get("sphere_types") or [])
        L.append(f"- Published limits (opt-in): {lim['name']}: contrast {fmt_list(lim.get('contrast'))}"
                 f"{f' ({types})' if types else ''}, BV {fmt_list(lim.get('bv'))}, lung {lim.get('lung')} — {lim.get('source', '')}")
        if lim.get("notes"): L.append(f"  - {lim['notes']}")
    if p.get("notes"): L.append(f"- Notes: {p['notes']}")
    refs = p.get("references") or []
    if refs:
        L += ["", "| Reference set | Standard | Ratio | Recon | Source (table) |", "|---|---|---|---|---|"]
        for r in refs:
            lab = r["label"] + (" (provisional)" if r.get("provisional") and "provisional" not in r["label"].lower() else "")
            rs = f"{float(r['ratio']):.2f}".rstrip("0") if r.get("ratio") else None
            ratio = (rs + "0" if rs.endswith(".") else rs) + ":1" if rs else "-"
            src = " ".join(x for x in (r.get("citation"), r.get("doi")) if x)
            if r.get("table"): src += f" ({r['table']})"
            cell = lambda s: str(s or "-").replace("|", "/").replace("\n", " ")
            L.append(f"| {cell(lab)} | {cell(r.get('standard'))} | {ratio} | {cell(r.get('recon'))} | {cell(src)} |")
    else:
        L.append("- No published per-sphere NEMA IQ values found.")
    return "\n".join(L) + "\n"


out = ["# Sources", "",
       "## Documents behind the analysis rules and the DICOM reader", "",
       "| Document | Used for |", "|---|---|"]
out += [f"| {d} | {u} |" for d, u in LOGIC_SOURCES]
out += ["", "# Sources of the built-in scanner profiles", "",
        "Generated from `scanner_profiles.json` by `make_sources.py`. Published values are shown in the report for "
        "**comparison only**; they are not acceptance limits. Values were copied from the cited table or text of each "
        "source; entries marked *provisional* come from a secondary source.", ""]
out += [profile_md(p) for p in db["profiles"]]
out += ["## Not found in public sources (at compilation)", ""] + [f"- {s}" for s in NOT_FOUND] + [""]
dst = os.path.join(root, "SOURCES.md")
open(dst, "w", encoding="utf-8", newline="\n").write("\n".join(out))
print(dst, sum(len(s) for s in out), "chars,", len(db["profiles"]), "profiles")
