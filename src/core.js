/* =====================================================================================
 * NEMA IQ Analyzer - analysis core (DICOM reader + NEMA NU 2 image-quality analysis).
 * Pure JavaScript, no DOM, no external libraries. Runs in any modern browser (offline)
 * and in Node.js (for testing).
 * ===================================================================================== */
(function (G) {
'use strict';
const N = {};
N.VERSION = '2.0.0';

// ------------------------------------------------------------------ constants
const SPHERE_D = [10, 13, 17, 22, 28, 37];          // inner diameters [mm]
const RING_R = 57.2;                                // sphere ring radius [mm]
const LUNG_INSERT_D = 51.0, LUNG_ROI_D = 30.0, BG_ROI_D = 37.0;
const EDGE_MARGIN = 15.0, N_BG = 12, SS = 10;
const BG_Z_OFFSETS = [-20, -10, 0, 10, 20];
N.SPHERE_D = SPHERE_D;
N.CONST = { RING_R, LUNG_INSERT_D, LUNG_ROI_D, BG_ROI_D, EDGE_MARGIN, N_BG, BG_Z_OFFSETS };

N.STANDARDS = {
  '2018': { id: '2018', name: 'NEMA NU 2-2018', types: ['hot', 'hot', 'hot', 'hot', 'hot', 'hot'], lungExcl: 30,
    fill: 'All six spheres hot (4:1)',
    note: 'All six spheres (10-37 mm) hot at the sphere:background ratio; lung-residual slices within 30 mm of the lung-insert ends are excluded.' },
  '2012': { id: '2012', name: 'NEMA NU 2-2012', types: ['hot', 'hot', 'hot', 'hot', 'cold', 'cold'], lungExcl: 10,
    fill: '10-22 mm hot, 28/37 mm cold',
    note: 'Spheres 10-22 mm hot, 28 and 37 mm cold (non-radioactive water); lung-residual slices within 10 mm of the lung-insert ends are excluded.' }
};

// =====================================================================================
// Scanner profiles, acceptance limits, reference values (vendor-neutral)
// =====================================================================================
// No acceptance limits are built in: limits differ between vendors, systems and acceptance protocols and are defined in
// the manufacturer's documentation. Users enter them (or load a JSON file). Optional scanner profiles (profiles.js) only
// identify the system and carry PUBLISHED reference values (peer-reviewed / public vendor documents, with citation),
// which are shown next to the results for comparison - never used for PASS/FAIL.
N.PROFILES = (G.NEMA_PROFILES && G.NEMA_PROFILES.profiles) || [];
N.PROFILE_DB = (G.NEMA_PROFILES && G.NEMA_PROFILES.meta) || null;
N.addProfiles = function (obj) {
  const list = Array.isArray(obj) ? obj : (obj && obj.profiles) || [];
  for (const p of list) { if (!p.id) throw new Error('profile without id'); N.PROFILES = N.PROFILES.filter(q => q.id !== p.id).concat([p]); }
  return list.length;
};
const rx = s => { try { return new RegExp(s, 'i'); } catch (e) { return null; } };
// candidate profiles for a DICOM header (manufacturer + model regex, then nearest axial FOV)
N.matchProfiles = function (meta) {
  const man = meta.Manufacturer || '', mdl = meta.Model || '', axf = meta.AxialFOV_mm || null;
  const hits = N.PROFILES.filter(p => {
    const mm = p.match || {}, a = mm.manufacturer ? rx(mm.manufacturer) : null, b = mm.model ? rx(mm.model) : null;
    return (!a || a.test(man)) && (!b || b.test(mdl)) && (a || b);
  });
  return hits.map(p => ({ p, d: axf && p.afov_cm ? Math.abs(p.afov_cm * 10 - axf) : 999 })).sort((x, y) => x.d - y.d).map(x => x.p);
};
N.parseLimitList = function (s, n) {
  if (s == null || String(s).trim() === '') return null;
  const v = String(s).split(/[\s,;]+/).filter(Boolean).map(t => /^(-|na|n\/a|null|none)$/i.test(t) ? null : Number(t));
  if (v.length !== n || v.some(x => x !== null && !isFinite(x))) throw new Error(`limits: expected ${n} value(s) (number, or '-' for no limit), got '${s}'`);
  return n === 1 ? v[0] : (v.every(x => x === null) ? null : v);
};
// limits object: {name, source, contrast[6] (hot spheres, >=), bv[6] (<=), lung (<=), standard}
N.normLimits = function (L) {
  if (!L) return null;
  const arr6 = v => { if (v == null) return null;
    const a = Array.isArray(v) ? v.map(x => x == null || x === '' ? null : Number(x)) : N.parseLimitList(v, 6);
    if (a && a.length !== 6) throw new Error('limits: six values (10-37 mm) required');
    return a && a.some(x => x !== null) ? a : null; };
  // sphere types the contrast limits refer to: explicit in the file, else those of the NEMA edition the limits are declared for (else hot)
  const edk = (String(L.standard || '').match(/20(12|18)/) || [])[0];
  const st = L.sphere_types ? (Array.isArray(L.sphere_types) ? L.sphere_types : SPHERE_D.map(d => L.sphere_types[String(d)]))
                            : (edk && N.STANDARDS[edk] ? N.STANDARDS[edk].types.slice() : null);
  const out = { name: L.name || 'User-entered limits', source: L.source || '', standard: L.standard || '', contrast: arr6(L.contrast), bv: arr6(L.bv),
                sphere_types: st && st.length === 6 ? st.map(t => t ? String(t).toLowerCase() : null) : null, notes: L.notes || '',
                lung: L.lung == null || L.lung === '' ? null : (typeof L.lung === 'string' ? N.parseLimitList(L.lung, 1) : Number(L.lung)) };
  if (!out.contrast && !out.bv && out.lung == null) return null;
  return out;
};
N.NO_LIMITS = { name: 'No acceptance limits', source: '', contrast: null, bv: null, lung: null };
// NEMA NU 2 recommended activity concentration at the start of the test
N.NEMA_BG_KBQML = 5.3;


// ------------------------------------------------------------------ logging
class Log {
  constructor(cb) { this.lines = []; this.warnings = []; this.cb = cb || null; }
  info(m) { this.lines.push('[info] ' + m); if (this.cb) this.cb('info', m); }
  warn(m) { this.lines.push('[WARN] ' + m); this.warnings.push(m); if (this.cb) this.cb('warn', m); }
}
N.Log = Log;

// =====================================================================================
// DICOM reader (Explicit/Implicit VR Little Endian, Explicit VR Big Endian; uncompressed)
// =====================================================================================
const TS_IMPLICIT = '1.2.840.10008.1.2', TS_EXPLICIT_LE = '1.2.840.10008.1.2.1', TS_EXPLICIT_BE = '1.2.840.10008.1.2.2';
const LONG_VR = new Set(['OB', 'OW', 'OF', 'SQ', 'UT', 'UN', 'OD', 'OL', 'OV', 'UC', 'UR', 'SV', 'UV']);
const T = (g, e) => (((g << 16) | e) >>> 0);
const TAG = {
  TransferSyntax: T(0x0002, 0x0010), ImageType: T(0x0008, 0x0008), StudyDate: T(0x0008, 0x0020), SeriesDate: T(0x0008, 0x0021),
  AcquisitionDate: T(0x0008, 0x0022), SeriesTime: T(0x0008, 0x0031), AcquisitionTime: T(0x0008, 0x0032), Modality: T(0x0008, 0x0060),
  Manufacturer: T(0x0008, 0x0070), StationName: T(0x0008, 0x1010), SeriesDescription: T(0x0008, 0x103E), Model: T(0x0008, 0x1090),
  PatientID: T(0x0010, 0x0020), PatientWeight: T(0x0010, 0x1030), Radiopharmaceutical: T(0x0018, 0x0031),
  SliceThickness: T(0x0018, 0x0050), KVP: T(0x0018, 0x0060), DeviceSerial: T(0x0018, 0x1000), Software: T(0x0018, 0x1020),
  RpVolume: T(0x0018, 0x1071), RpStartTime: T(0x0018, 0x1072), TotalDose: T(0x0018, 0x1074), HalfLife: T(0x0018, 0x1075),
  PositronFraction: T(0x0018, 0x1076), RpStartDateTime: T(0x0018, 0x1078), ReconDiameter: T(0x0018, 0x1100),
  ConvKernel: T(0x0018, 0x1210), FrameDuration: T(0x0018, 0x1242),
  SeriesUID: T(0x0020, 0x000E), SeriesNumber: T(0x0020, 0x0011), InstanceNumber: T(0x0020, 0x0013), IPP: T(0x0020, 0x0032),
  IOP: T(0x0020, 0x0037), FoR: T(0x0020, 0x0052),
  Samples: T(0x0028, 0x0002), Rows: T(0x0028, 0x0010), Columns: T(0x0028, 0x0011), PixelSpacing: T(0x0028, 0x0030),
  CorrectedImage: T(0x0028, 0x0051), BitsAllocated: T(0x0028, 0x0100), PixelRep: T(0x0028, 0x0103),
  RescaleIntercept: T(0x0028, 0x1052), RescaleSlope: T(0x0028, 0x1053),
  RpSeq: T(0x0054, 0x0016), NumberOfSlices: T(0x0054, 0x0081), NumberOfTimeSlices: T(0x0054, 0x0101),
  Units: T(0x0054, 0x1001), RandomsCorr: T(0x0054, 0x1100), AttenCorr: T(0x0054, 0x1101), DecayCorr: T(0x0054, 0x1102),
  ReconMethod: T(0x0054, 0x1103), ScatterCorr: T(0x0054, 0x1105), FrameRefTime: T(0x0054, 0x1300), DecayFactor: T(0x0054, 0x1321),
  PixelData: T(0x7FE0, 0x0010)
};
N.TAG = TAG;
// VRs needed for Implicit VR files (standard + GE PET private block 0x10 in group 0009)
const DICT = new Map([
  [T(0x0028, 0x0008), 'IS'],   // Number of Frames (multi-frame objects are refused)
  [T(0x7053, 0x0010), 'LO'], [T(0x7053, 0x1000), 'DS'], [T(0x7053, 0x1009), 'DS'],   // Philips PET Private Group (SUV / activity-concentration scale factors)
  [TAG.ImageType, 'CS'], [TAG.StudyDate, 'DA'], [TAG.SeriesDate, 'DA'], [TAG.AcquisitionDate, 'DA'], [TAG.SeriesTime, 'TM'],
  [TAG.AcquisitionTime, 'TM'], [TAG.Modality, 'CS'], [TAG.Manufacturer, 'LO'], [TAG.StationName, 'SH'], [TAG.SeriesDescription, 'LO'],
  [TAG.Model, 'LO'], [TAG.PatientID, 'LO'], [TAG.PatientWeight, 'DS'], [TAG.Radiopharmaceutical, 'LO'], [TAG.SliceThickness, 'DS'],
  [TAG.KVP, 'DS'], [TAG.DeviceSerial, 'LO'], [TAG.Software, 'LO'], [TAG.RpVolume, 'DS'], [TAG.RpStartTime, 'TM'],
  [TAG.TotalDose, 'DS'], [TAG.HalfLife, 'DS'], [TAG.PositronFraction, 'DS'], [TAG.RpStartDateTime, 'DT'], [TAG.ReconDiameter, 'DS'],
  [TAG.ConvKernel, 'SH'], [TAG.FrameDuration, 'IS'], [TAG.SeriesUID, 'UI'], [TAG.SeriesNumber, 'IS'], [TAG.InstanceNumber, 'IS'],
  [TAG.IPP, 'DS'], [TAG.IOP, 'DS'], [TAG.FoR, 'UI'], [TAG.Samples, 'US'], [TAG.Rows, 'US'], [TAG.Columns, 'US'],
  [TAG.PixelSpacing, 'DS'], [TAG.CorrectedImage, 'CS'], [TAG.BitsAllocated, 'US'], [TAG.PixelRep, 'US'],
  [TAG.RescaleIntercept, 'DS'], [TAG.RescaleSlope, 'DS'], [TAG.RpSeq, 'SQ'], [T(0x0054, 0x0300), 'SQ'],
  [TAG.NumberOfSlices, 'US'], [TAG.NumberOfTimeSlices, 'US'], [TAG.Units, 'CS'], [TAG.RandomsCorr, 'CS'], [TAG.AttenCorr, 'LO'],
  [TAG.DecayCorr, 'CS'], [TAG.ReconMethod, 'LO'], [TAG.ScatterCorr, 'LO'], [TAG.FrameRefTime, 'DS'], [TAG.DecayFactor, 'DS'],
  [TAG.PixelData, 'OW'], [T(0x0009, 0x0010), 'LO'],
  [T(0x0009, 0x102C), 'SL'], [T(0x0009, 0x10E4), 'ST'], [T(0x0009, 0x10B2), 'SS'], [T(0x0009, 0x10B3), 'SS'], [T(0x0009, 0x10B4), 'FL'],
  [T(0x0009, 0x10BA), 'SS'], [T(0x0009, 0x10BB), 'FL'], [T(0x0009, 0x10BC), 'SS'], [T(0x0009, 0x10BD), 'FL'], [T(0x0009, 0x10DB), 'SL'],
  [T(0x0009, 0x10DC), 'FL'], [T(0x0009, 0x1038), 'FL'], [T(0x0009, 0x1039), 'DT'], [T(0x0009, 0x103C), 'FL'], [T(0x0009, 0x103D), 'DT'],
  [T(0x0009, 0x1071), 'FD'], [T(0x0009, 0x1072), 'FD'], [T(0x0009, 0x1066), 'FL']
]);

class DicomTruncated extends Error {}
N.DicomTruncated = DicomTruncated;

function parseDicom(buffer, stopAtPixel) {
  const dv = new DataView(buffer), u8 = new Uint8Array(buffer), L = buffer.byteLength;
  let pos = 0, ts = TS_IMPLICIT;
  if (L > 132 && u8[128] === 0x44 && u8[129] === 0x49 && u8[130] === 0x43 && u8[131] === 0x4D) {
    pos = 132;
    while (pos + 8 <= L && dv.getUint16(pos, true) === 0x0002) {
      const el = readEl(dv, u8, pos, true, true, L);
      if (el.tag === TAG.TransferSyntax) ts = latin1(u8, el.off, el.len).replace(/[\0\s]+$/g, '').trim();
      pos = el.next;
    }
  } else if (L > 8 && /^[A-Z]{2}$/.test(String.fromCharCode(u8[4], u8[5]))) ts = TS_EXPLICIT_LE;
  if (ts !== TS_IMPLICIT && ts !== TS_EXPLICIT_LE && ts !== TS_EXPLICIT_BE)
    throw new Error('Unsupported (compressed) transfer syntax ' + ts);
  const explicit = ts !== TS_IMPLICIT, little = ts !== TS_EXPLICIT_BE;
  const ds = { ts, explicit, little, dv, u8, el: new Map(), pixel: null };
  parseDataset(ds, ds.el, pos, L, stopAtPixel);
  return ds;
}
N.parseDicom = parseDicom;

function readEl(dv, u8, pos, explicit, little, L) {
  if (pos + 8 > L) throw new DicomTruncated('truncated');
  const g = dv.getUint16(pos, little), e = dv.getUint16(pos + 2, little);
  const tag = ((g << 16) | e) >>> 0;
  let vr = null, len, off;
  if (g === 0xFFFE) { len = dv.getUint32(pos + 4, little); off = pos + 8; }
  else if (explicit) {
    vr = String.fromCharCode(u8[pos + 4], u8[pos + 5]);
    if (LONG_VR.has(vr)) { if (pos + 12 > L) throw new DicomTruncated('truncated'); len = dv.getUint32(pos + 8, little); off = pos + 12; }
    else if (/^[A-Z]{2}$/.test(vr)) { len = dv.getUint16(pos + 6, little); off = pos + 8; }
    else { vr = DICT.get(tag) || 'UN'; len = dv.getUint32(pos + 4, little); off = pos + 8; }
  } else { vr = DICT.get(tag) || 'UN'; len = dv.getUint32(pos + 4, little); off = pos + 8; }
  const undef = len === 0xFFFFFFFF;
  return { tag, vr, off, len: undef ? -1 : len, next: undef ? off : off + len };
}

function parseDataset(ds, map, pos, end, stopAtPixel) {
  const { dv, u8, explicit, little } = ds;
  const L = dv.byteLength;
  while (pos < end) {
    if (pos + 8 > L) { if (end === L) break; throw new DicomTruncated('truncated'); }
    const el = readEl(dv, u8, pos, explicit, little, L);
    if (el.tag === 0xFFFEE00D || el.tag === 0xFFFEE0DD) return el.next;   // item / sequence delimitation
    if (el.tag === TAG.PixelData) {
      if (el.len < 0) throw new Error('Encapsulated (compressed) pixel data is not supported');
      ds.pixel = { off: el.off, len: el.len, vr: el.vr };
      if (stopAtPixel) return pos;
      if (el.off + el.len > L) throw new DicomTruncated('truncated');
      pos = el.next; continue;
    }
    if (el.vr === 'SQ' || el.len < 0) {
      const items = [];
      pos = parseSequence(ds, items, el.off, el.len);
      map.set(el.tag, { vr: 'SQ', items });
      continue;
    }
    if (el.off + el.len > L) throw new DicomTruncated('truncated');
    map.set(el.tag, { vr: el.vr, off: el.off, len: el.len });
    pos = el.next;
  }
  return pos;
}

function parseSequence(ds, items, off, len) {
  const { dv, little } = ds; const L = dv.byteLength;
  const end = len < 0 ? L : off + len;
  let pos = off;
  while (pos < end) {
    if (pos + 8 > L) throw new DicomTruncated('truncated');
    const g = dv.getUint16(pos, little), e = dv.getUint16(pos + 2, little);
    const tag = ((g << 16) | e) >>> 0, ilen = dv.getUint32(pos + 4, little);
    pos += 8;
    if (tag === 0xFFFEE0DD) return pos;
    if (tag !== 0xFFFEE000) throw new Error('Malformed sequence');
    const m = new Map();
    if (ilen === 0xFFFFFFFF) pos = parseDataset(ds, m, pos, L, false);
    else { parseDataset(ds, m, pos, pos + ilen, false); pos += ilen; }
    items.push(m);
  }
  return pos;
}

function latin1(u8, off, len) { let s = ''; for (let i = 0; i < len; i++) s += String.fromCharCode(u8[off + i]); return s; }

function nums(n, f) { n = Math.floor(n); if (n <= 0) return undefined; if (n === 1) return f(0); const a = []; for (let i = 0; i < n; i++) a.push(f(i)); return a; }
function dget(ds, tag, map) {
  const m = map || ds.el; const el = m.get(tag);
  if (!el) return undefined;
  if (el.vr === 'SQ') return el.items;
  const { dv, u8, little } = ds, { vr, off, len } = el;
  switch (vr) {
    case 'US': return nums(len / 2, i => dv.getUint16(off + 2 * i, little));
    case 'SS': return nums(len / 2, i => dv.getInt16(off + 2 * i, little));
    case 'UL': return nums(len / 4, i => dv.getUint32(off + 4 * i, little));
    case 'SL': return nums(len / 4, i => dv.getInt32(off + 4 * i, little));
    case 'FL': return nums(len / 4, i => dv.getFloat32(off + 4 * i, little));
    case 'FD': return nums(len / 8, i => dv.getFloat64(off + 8 * i, little));
    case 'OB': case 'OW': case 'UN': case 'OF': case 'OD': case 'OL': return null;
    default: {
      const s = latin1(u8, off, len).replace(/\0+$/g, '');
      if (vr === 'DS' || vr === 'IS') {
        const parts = s.split('\\').map(v => parseFloat(v)).filter(v => !isNaN(v));
        return parts.length === 0 ? undefined : parts.length === 1 ? parts[0] : parts;
      }
      const parts = s.split('\\').map(v => v.trim());
      return parts.length === 1 ? parts[0] : parts;
    }
  }
}
function dstr(ds, tag, map) { const v = dget(ds, tag, map); if (v === undefined || v === null) return ''; return Array.isArray(v) ? v.join('\\') : String(v); }
function dnum(ds, tag, map, def) { const v = dget(ds, tag, map); if (v === undefined || v === null || v === '') return def; const x = Array.isArray(v) ? +v[0] : (typeof v === 'number' ? v : parseFloat(v)); return isNaN(x) ? def : x; }
function darr(ds, tag, map) { const v = dget(ds, tag, map); if (v === undefined || v === null) return []; return Array.isArray(v) ? v : [v]; }
function privateTag(ds, group, creator, elemByte) {
  for (let b = 0x10; b <= 0xFF; b++) {
    const t = T(group, b);
    if (ds.el.has(t) && dstr(ds, t).trim() === creator) return T(group, (b << 8) | elemByte);
  }
  return null;
}
function gePriv(ds, elemByte) {
  const t = privateTag(ds, 0x0009, 'GEMS_PETD_01', elemByte);
  if (t === null) return null;
  const v = dget(ds, t);
  if (v === undefined || v === null) return null;
  return Array.isArray(v) ? v[0] : v;
}
N.dget = dget; N.dstr = dstr; N.dnum = dnum; N.darr = darr; N.gePriv = gePriv;

function parseDT(da, tm) {
  const s = ((da || '') + (tm || '')).replace(/[:\-\s]/g, '');
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?(?:\.(\d+))?/);
  if (!m) return null;
  const ms = m[7] ? Math.round(parseFloat('0.' + m[7]) * 1000) : 0;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), ms);
}
N.parseDT = parseDT;
const pad2 = x => String(x).padStart(2, '0');
N.fmtDT = function (t, withDate) {
  if (t === null || t === undefined || isNaN(t)) return '?';
  const d = new Date(t), hms = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
  return withDate === false ? hms : `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${hms}`;
};
N.fmtDate = function (t) { if (t == null) return '?'; const d = new Date(t); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; };

function headerInfo(ds) {
  return {
    modality: dstr(ds, TAG.Modality), seriesUID: dstr(ds, TAG.SeriesUID), desc: dstr(ds, TAG.SeriesDescription),
    seriesNumber: dnum(ds, TAG.SeriesNumber, null, 0), for: dstr(ds, TAG.FoR),
    rows: dnum(ds, TAG.Rows, null, 0), cols: dnum(ds, TAG.Columns, null, 0),
    ipp: darr(ds, TAG.IPP), iop: darr(ds, TAG.IOP), ps: darr(ds, TAG.PixelSpacing),
    slope: dnum(ds, TAG.RescaleSlope, null, 1), inter: dnum(ds, TAG.RescaleIntercept, null, 0),
    bits: dnum(ds, TAG.BitsAllocated, null, 16), pixrep: dnum(ds, TAG.PixelRep, null, 0), samples: dnum(ds, TAG.Samples, null, 1),
    units: dstr(ds, TAG.Units), corrected: darr(ds, TAG.CorrectedImage).map(String),
    nts: dnum(ds, TAG.NumberOfTimeSlices, null, 1), frt: dnum(ds, TAG.FrameRefTime, null, 0),
    acq: parseDT(dstr(ds, TAG.AcquisitionDate) || dstr(ds, TAG.SeriesDate), dstr(ds, TAG.AcquisitionTime) || dstr(ds, TAG.SeriesTime)),
    recon: dstr(ds, TAG.ReconMethod), dur: dnum(ds, TAG.FrameDuration, null, 0),
    // reconstruction signature: series with the same signature but different acquisitions are replicates
    reconSig: [dstr(ds, TAG.ReconMethod), dnum(ds, TAG.Rows, null, 0), dnum(ds, TAG.Columns, null, 0), (darr(ds, TAG.PixelSpacing)[0] || ''),
               gePriv(ds, 0xB2), gePriv(ds, 0xB3), gePriv(ds, 0xBB), gePriv(ds, 0xDB), gePriv(ds, 0xBD) || gePriv(ds, 0xF8), dstr(ds, TAG.ConvKernel)].join('|'),
    beta: gePriv(ds, 0xBD) || gePriv(ds, 0xF8) || null,
    manufacturer: dstr(ds, TAG.Manufacturer), model: dstr(ds, TAG.Model), axialFov: gePriv(ds, 0x2C) || null,
    // Philips: Units CNTS -> Bq/mL = (SV*slope + intercept) * Activity Concentration Scale Factor (7053,xx09) (Vereos DICOM conformance statement)
    acsf: (() => { const t = privateTag(ds, 0x7053, 'Philips PET Private Group', 0x09); const v = t === null ? null : dnum(ds, t, null, null); return v == null || !isFinite(v) ? null : +v; })()
  };
}
N.headerInfo = headerInfo;

// Scan File-like objects ({name, size, slice(a,b).arrayBuffer(), arrayBuffer()}) and group by series
N.scanFiles = async function (files, log, progress) {
  const groups = new Map();
  let nimg = 0, nskip = 0, nMulti = 0; const tsBad = new Map();
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (progress && i % 25 === 0) await progress(i / files.length, `Reading DICOM headers ${i}/${files.length}`);
    let ds = null;
    try {
      const head = await f.slice(0, Math.min(f.size, 262144)).arrayBuffer();
      try { ds = parseDicom(head, true); }
      catch (e) { if (e instanceof DicomTruncated) ds = parseDicom(await f.arrayBuffer(), true); else throw e; }
    } catch (e) { const m = /transfer syntax (\S+)/.exec(e.message || ''); if (m) tsBad.set(m[1], (tsBad.get(m[1]) || 0) + 1); nskip++; continue; }
    if (!ds.el.has(TAG.Rows) || !ds.el.has(TAG.SeriesUID) || !ds.pixel) { nskip++; continue; }
    if ((dnum(ds, T(0x0028, 0x0008), null, 1) || 1) > 1) { nMulti++; nskip++; continue; }   // Enhanced / multi-frame objects: not supported
    const h = headerInfo(ds);
    let key = h.seriesUID;
    if (h.nts > 1) key += '|t' + h.frt;
    if (!groups.has(key)) groups.set(key, { key, files: [], hdrs: [], info: h });
    const g = groups.get(key);
    g.files.push(f); g.hdrs.push(h); nimg++;
  }
  log.info(`${nimg} DICOM image files in ${groups.size} series (${nskip} other files skipped)`);
  const TSN = { '1.2.840.10008.1.2.4.50': 'JPEG Baseline', '1.2.840.10008.1.2.4.51': 'JPEG Extended', '1.2.840.10008.1.2.4.57': 'JPEG Lossless',
                '1.2.840.10008.1.2.4.70': 'JPEG Lossless SV1', '1.2.840.10008.1.2.4.80': 'JPEG-LS Lossless', '1.2.840.10008.1.2.4.81': 'JPEG-LS Near-Lossless',
                '1.2.840.10008.1.2.4.90': 'JPEG 2000 Lossless', '1.2.840.10008.1.2.4.91': 'JPEG 2000', '1.2.840.10008.1.2.5': 'RLE Lossless',
                '1.2.840.10008.1.2.1.99': 'Deflated Explicit VR LE', '1.3.46.670589.33.1.4.1': 'Philips private (CT-private-ELE)' };
  for (const [ts, n] of tsBad) log.warn(`${n} file(s) use the transfer syntax ${ts} (${TSN[ts] || 'compressed/private'}), which this program cannot decode: export the images uncompressed (Explicit or Implicit VR Little Endian)`);
  if (nMulti) log.warn(`${nMulti} multi-frame image object(s) (e.g. Enhanced PET) skipped: only single-frame images (one file per slice) are supported - export the series as classic PET/CT images`);
  if (!nimg && nMulti) throw new Error('No readable images: the study contains only multi-frame objects. Export the series as classic single-frame PET images and try again.');
  if (!nimg && tsBad.size) throw new Error('No readable images: all DICOM files use a compressed or private transfer syntax. Export the study uncompressed (Explicit or Implicit VR Little Endian) and try again.');
  return [...groups.values()];
};

// Group attenuation-corrected PET series by reconstruction. Replicates = different acquisitions, same reconstruction.
const RECON_PREF = [];   // no vendor preference: most replicates first, then earliest acquisition
N.reconGroups = function (groups) {
  const map = new Map();
  for (const g of groups) {
    const h = g.info;
    if (h.modality !== 'PT' || !h.corrected.includes('ATTN')) continue;
    if (!map.has(h.reconSig)) map.set(h.reconSig, []);
    map.get(h.reconSig).push(g);
  }
  const out = [...map.entries()].map(([sig, list]) => {
    list.sort((a, b) => (a.info.acq || 0) - (b.info.acq || 0));
    const h = list[0].info, m = (h.recon || '?').toUpperCase();
    const label = (/^QC(HD|FX)S?$/.test(m) || m.includes('CLEAR')) && h.beta ? `${h.recon} (Q.Clear beta ${Math.round(h.beta)})` : (h.recon || 'unknown recon');
    return { sig, label: `${label}, ${h.rows}x${h.cols}`, method: m, keys: list.map(g => g.key), series: list,
             descs: [...new Set(list.map(g => g.info.desc))], n: list.length };
  });
  const pref = r => { const i = RECON_PREF.indexOf(r.method); return i < 0 ? 99 : i; };
  out.sort((a, b) => (b.n - a.n) || (pref(a) - pref(b)) || ((a.series[0].info.acq || 0) - (b.series[0].info.acq || 0)));
  return out;
};
// two series are the same acquisition if they start within 1 s with the same frame duration
const sameAcq = (a, b) => a.acq != null && b.acq != null && Math.abs(a.acq - b.acq) < 1000 && Math.abs((a.dur || 0) - (b.dur || 0)) < 1000;

N.classifySeries = function (groups, log, filterText, explicit) {
  const cts = groups.filter(g => g.info.modality === 'CT');
  let pets = [];
  for (const g of groups) {
    const h = g.info;
    if (h.modality !== 'PT') continue;
    if (filterText && !h.desc.toLowerCase().includes(filterText.toLowerCase())) continue;
    if (!h.corrected.includes('ATTN')) { log.info(`skip non-attenuation-corrected PET series '${h.desc}'`); continue; }
    pets.push(g);
  }
  if (!pets.length) return { pets: [], ct: null, excluded: [], reconGroups: [] };
  const rg = N.reconGroups(pets);
  if (rg.length > 1) {
    if (explicit) {
      // user selection: reject reconstructions of the same acquisition being averaged as replicates
      for (let i = 0; i < pets.length; i++) for (let j = i + 1; j < pets.length; j++)
        if (sameAcq(pets[i].info, pets[j].info)) throw new Error(`'${pets[i].info.desc}' and '${pets[j].info.desc}' are two reconstructions of the same acquisition. ` +
          'Replicates must be separate acquisitions: select the series of one reconstruction only.');
      log.warn(`the selected replicates have different reconstruction parameters (${rg.map(r => r.label).join('; ')})`);
    } else {
      pets = rg[0].series.slice();
      log.info(`${rg.length} reconstructions found; analysing ${rg[0].label} [${rg[0].descs.join(', ')}]. Other: ` +
               rg.slice(1).map(r => `${r.label} [${r.descs.join(', ')}]`).join('; '));
    }
  }
  pets.sort((a, b) => (a.info.acq || 0) - (b.info.acq || 0));
  const ref = pets[0];
  const same = pets.filter(g => g.files.length === ref.files.length && g.info.for === ref.info.for &&
                                g.info.rows === ref.info.rows && g.info.cols === ref.info.cols);
  return { pets: same, ct: cts.find(g => g.info.for === ref.info.for) || null, excluded: pets.filter(g => !same.includes(g)), reconGroups: rg };
};

// ------------------------------------------------------------------ volumes
function decodePixels(ds, h) {
  const { off } = ds.pixel, n = h.rows * h.cols, dv = ds.dv, little = ds.little;
  if (h.samples !== 1) throw new Error('Only grey-scale (1 sample per pixel) images are supported');
  if (h.bits === 16) {
    const out = h.pixrep === 1 ? new Int16Array(n) : new Uint16Array(n);
    if (little && off % 2 === 0) out.set(h.pixrep === 1 ? new Int16Array(dv.buffer, off, n) : new Uint16Array(dv.buffer, off, n));
    else for (let i = 0; i < n; i++) out[i] = h.pixrep === 1 ? dv.getInt16(off + 2 * i, little) : dv.getUint16(off + 2 * i, little);
    return out;
  }
  if (h.bits === 32) {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = h.pixrep === 1 ? dv.getInt32(off + 4 * i, little) : dv.getUint32(off + 4 * i, little);
    return out;
  }
  if (h.bits === 8) { const out = new Uint8Array(n); out.set(new Uint8Array(dv.buffer, off, n)); return out; }
  throw new Error('Unsupported BitsAllocated ' + h.bits);
}

N.loadVolume = async function (g, progress, label) {
  const order = g.hdrs.map((h, i) => [parseFloat(h.ipp[2]), i]).sort((a, b) => a[0] - b[0]).map(v => v[1]);
  const h0 = g.hdrs[order[0]], iop = h0.iop.map(Number), ax = [1, 0, 0, 0, 1, 0];
  if (iop.length !== 6 || iop.some((v, i) => Math.abs(v - ax[i]) > 1e-3)) throw new Error(`Series '${h0.desc}': only axial (non-oblique) images are supported`);
  const nz = order.length, ny = h0.rows, nx = h0.cols, npx = ny * nx;
  const img = new Float32Array(nz * npx), z = new Float64Array(nz);
  let firstDs = null;
  for (let k = 0; k < nz; k++) {
    if (progress && k % 10 === 0) await progress(k / nz, `Loading ${label || h0.desc}: slice ${k + 1}/${nz}`);
    const ds = parseDicom(await g.files[order[k]].arrayBuffer(), false), h = headerInfo(ds);
    if (h.rows !== ny || h.cols !== nx) throw new Error('Inconsistent image size in series');
    const f = /^CNTS$/i.test((h.units || '').trim()) && h.acsf > 0 ? h.acsf : 1;
    const p = decodePixels(ds, h), o = k * npx, s = h.slope * f, b = h.inter * f;
    for (let j = 0; j < npx; j++) img[o + j] = p[j] * s + b;
    z[k] = parseFloat(h.ipp[2]);
    if (k === 0) firstDs = ds;
  }
  const dzs = []; for (let k = 1; k < nz; k++) dzs.push(z[k] - z[k - 1]);
  if (dzs.length && Math.max(...dzs) - Math.min(...dzs) > 0.01) throw new Error('Non-uniform slice spacing');
  const dz = dzs.length ? dzs.reduce((a, b) => a + b, 0) / dzs.length : dnum(firstDs, TAG.SliceThickness, null, 1);
  const ps = h0.ps.map(Number);
  return { img, nz, ny, nx, z, dz, px: ps[1], py: ps[0], x0: parseFloat(h0.ipp[0]), y0: parseFloat(h0.ipp[1]), hdr: firstDs, desc: h0.desc };
};

N.loadCTSlice = async function (g, zTarget) {
  let best = -1, bd = Infinity;
  g.hdrs.forEach((h, i) => { const d = Math.abs(parseFloat(h.ipp[2]) - zTarget); if (d < bd) { bd = d; best = i; } });
  const ds = parseDicom(await g.files[best].arrayBuffer(), false), h = headerInfo(ds), p = decodePixels(ds, h);
  const img = new Float32Array(p.length);
  for (let j = 0; j < p.length; j++) img[j] = p[j] * h.slope + h.inter;
  const ps = h.ps.map(Number);
  return { img, ny: h.rows, nx: h.cols, z: parseFloat(h.ipp[2]), dzMatch: bd, px: ps[1], py: ps[0],
           x0: parseFloat(h.ipp[0]), y0: parseFloat(h.ipp[1]), kvp: dnum(ds, TAG.KVP, null, 0), desc: h.desc };
};

N.petMeta = function (ds) {
  const m = {};
  m.SeriesDescription = dstr(ds, TAG.SeriesDescription); m.SeriesNumber = dnum(ds, TAG.SeriesNumber, null, null);
  m.Manufacturer = dstr(ds, TAG.Manufacturer); m.Model = dstr(ds, TAG.Model); m.Software = dstr(ds, TAG.Software);
  m.Station = dstr(ds, TAG.StationName); m.DeviceSerial = dstr(ds, TAG.DeviceSerial); m.PatientID = dstr(ds, TAG.PatientID);
  m.AcquisitionStart = parseDT(dstr(ds, TAG.AcquisitionDate) || dstr(ds, TAG.SeriesDate), dstr(ds, TAG.AcquisitionTime) || dstr(ds, TAG.SeriesTime));
  m.FrameDuration_s = dnum(ds, TAG.FrameDuration, null, 0) / 1000;
  m.Units = dstr(ds, TAG.Units); m.DecayCorrection = dstr(ds, TAG.DecayCorr); m.CorrectedImage = darr(ds, TAG.CorrectedImage).map(String);
  m.ReconMethod = dstr(ds, TAG.ReconMethod); m.ReconDiameter_mm = dnum(ds, TAG.ReconDiameter, null, 0);
  m.Matrix = `${dnum(ds, TAG.Rows, null, 0)}x${dnum(ds, TAG.Columns, null, 0)}`;
  m.PixelSpacing_mm = darr(ds, TAG.PixelSpacing).map(Number)[0];
  m.SliceThickness_mm = dnum(ds, TAG.SliceThickness, null, 0);
  m.ScatterCorrection = dstr(ds, TAG.ScatterCorr); m.AttenuationCorrection = dstr(ds, TAG.AttenCorr); m.RandomsCorrection = dstr(ds, TAG.RandomsCorr);
  m.PatientWeight_kg = dnum(ds, TAG.PatientWeight, null, 0);
  const seq = dget(ds, TAG.RpSeq);
  if (Array.isArray(seq) && seq.length) {
    const it = seq[0];
    m.Radiopharmaceutical = dstr(ds, TAG.Radiopharmaceutical, it);
    m.Dose_Bq = dnum(ds, TAG.TotalDose, it, 0);
    m.HalfLife_s = dnum(ds, TAG.HalfLife, it, 6586.2);
    m.TracerVolume_ml = dnum(ds, TAG.RpVolume, it, 0);
    const sdt = dstr(ds, TAG.RpStartDateTime, it);
    m.DoseDateTime = sdt ? parseDT(sdt) : parseDT(dstr(ds, TAG.SeriesDate), dstr(ds, TAG.RpStartTime, it));
  }
  const ge = {};
  ge.axial_fov_mm = gePriv(ds, 0x2C); ge.recon_protocol = gePriv(ds, 0xE4);
  ge.iterations = gePriv(ds, 0xB2); ge.subsets = gePriv(ds, 0xB3); ge.ir_recon_fov_cm = gePriv(ds, 0xB4);
  ge.post_filter = gePriv(ds, 0xBA); ge.post_filter_mm = gePriv(ds, 0xBB); ge.regularize_flag = gePriv(ds, 0xBC); ge.beta = gePriv(ds, 0xBD);
  ge.z_filter_flag = gePriv(ds, 0xDB); ge.z_filter_mm = gePriv(ds, 0xDC);
  if (!ge.beta) { const b2 = gePriv(ds, 0xF8); if (b2) ge.beta = b2; } ge.pre_inj_activity_MBq = gePriv(ds, 0x38); ge.post_inj_activity_MBq = gePriv(ds, 0x3C);
  ge.total_prompts = gePriv(ds, 0x71); ge.total_delays = gePriv(ds, 0x72);
  m.GE = ge;
  m.ConvolutionKernel = dstr(ds, TAG.ConvKernel);
  m.AxialFOV_mm = ge.axial_fov_mm || null;
  m.Recon = N.reconInfo(m);
  const acsfTag = privateTag(ds, 0x7053, 'Philips PET Private Group', 0x09), acsf = acsfTag === null ? null : dnum(ds, acsfTag, null, null);
  m.UnitsBqml = /^BQML$/i.test((m.Units || '').trim()) || (/^CNTS$/i.test((m.Units || '').trim()) && acsf > 0);
  m.UnitScaleNote = /^CNTS$/i.test((m.Units || '').trim()) ? (acsf > 0 ? 'converted to Bq/mL with the Philips activity-concentration scale factor (7053,1009)' : 'no Philips scale factor: not Bq/mL') : '';
  return m;
};

// Vendor-neutral reconstruction description: GE private tags where present, otherwise parsed from the standard
// ReconstructionMethod (0054,1103; e.g. 'PSF+TOF 4i5s', 'OSEM3D 3i24s') and ConvolutionKernel (0018,1210; e.g. 'XYZGAUSS5.00').
N.reconInfo = function (m) {
  const ge = m.GE || {}, s = m.ReconMethod || '', k = m.ConvolutionKernel || '';
  const R = { method: s, iterations: null, subsets: null, filter_mm: null, beta: null, zfilter: null, source: [] };
  if (ge.iterations != null || ge.subsets != null || ge.post_filter_mm != null || ge.beta) {
    R.iterations = ge.iterations ?? null; R.subsets = ge.subsets ?? null; R.filter_mm = ge.post_filter_mm ?? null; R.beta = ge.beta || null;
    R.zfilter = ge.z_filter_flag == null ? null : ge.z_filter_flag === 0 ? 'none' : (ge.z_filter_mm ? `${(+ge.z_filter_mm).toFixed(1)} mm` : 'on');
    R.source.push('GE private tags');
  }
  const mm = s.match(/(\d+)\s*i\s*(\d+)\s*s\b/i) || s.match(/(\d+)\s*iter\w*\D{0,12}?(\d+)\s*sub/i);
  if (mm && R.iterations == null) { R.iterations = +mm[1]; R.subsets = +mm[2]; R.source.push('ReconstructionMethod'); }
  const km = k.match(/gauss\D{0,3}([\d.]+)/i);
  if (R.filter_mm == null && km) { R.filter_mm = +km[1]; R.source.push('ConvolutionKernel'); }
  else if (R.filter_mm == null && /all-?pass/i.test(k)) { R.filter_mm = 0; R.source.push('ConvolutionKernel'); }
  return R;
};

N.reconLabel = function (m) {
  const rm = (m.ReconMethod || '').toUpperCase(), ge = m.GE || {};
  // GE method codes: VPHD / VPFX (+S = SharpIR), QCHD / QCFX (Q.Clear, +S = SharpIR)
  const isQC = ['Q.CLEAR', 'QCLEAR', 'BSREM'].some(k => rm.includes(k)) || /^QC(HD|FX)S?$/.test(rm) || (ge.regularize_flag && ge.beta);
  if (isQC) return ge.beta ? `QClear beta ${Math.round(ge.beta)}` : 'QClear';
  return (m.ReconMethod || 'unknown').trim();
};

// =====================================================================================
// Image-processing utilities
// =====================================================================================
function gaussKernel(sigma) {
  const r = Math.floor(4.0 * sigma + 0.5), k = new Float64Array(2 * r + 1); let s = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-0.5 * i * i / (sigma * sigma)); s += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= s;
  return k;
}
const reflect = (i, n) => { while (i < 0 || i >= n) { if (i < 0) i = -i - 1; if (i >= n) i = 2 * n - i - 1; } return i; };
// separable Gaussian (as scipy.ndimage.gaussian_filter, mode='reflect', truncate=4)
function gaussian3d(src, nz, ny, nx, sz, sy, sx) {
  const out = new Float32Array(src);
  const mk = (n, k) => {
    const r = (k.length - 1) / 2, buf = new Float64Array(n), res = new Float64Array(n);
    return (base, stride) => {
      for (let i = 0; i < n; i++) buf[i] = out[base + i * stride];
      for (let i = 0; i < n; i++) { let s = 0; for (let j = -r; j <= r; j++) s += k[j + r] * buf[reflect(i + j, n)]; res[i] = s; }
      for (let i = 0; i < n; i++) out[base + i * stride] = res[i];
    };
  };
  const fx = mk(nx, gaussKernel(sx)), fy = mk(ny, gaussKernel(sy)), fz = mk(nz, gaussKernel(sz));
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) fx((z * ny + y) * nx, 1);
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) fy(z * ny * nx + x, nx);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) fz(y * nx + x, ny * nx);
  return out;
}
N.gaussian3d = gaussian3d;

// exact quantile (numpy 'linear') of values v with lo < v < hi, via histogram + local sort
function quantile(arr, q, lo = -Infinity, hi = Infinity) {
  let n = 0, mn = Infinity, mx = -Infinity;
  for (let i = 0; i < arr.length; i++) { const v = arr[i]; if (v > lo && v < hi) { n++; if (v < mn) mn = v; if (v > mx) mx = v; } }
  if (n === 0) return NaN;
  if (mx === mn) return mn;
  const pos = q * (n - 1), r0 = Math.floor(pos), r1 = Math.min(r0 + 1, n - 1), frac = pos - r0;
  const NB = 65536, w = (mx - mn) / NB, hist = new Uint32Array(NB + 1), bin = v => Math.min(NB, Math.floor((v - mn) / w));
  for (let i = 0; i < arr.length; i++) { const v = arr[i]; if (v > lo && v < hi) hist[bin(v)]++; }
  let c = 0, b0 = -1, c0 = 0, b1 = -1;
  for (let b = 0; b <= NB; b++) {
    if (b0 < 0 && c + hist[b] > r0) { b0 = b; c0 = c; }
    if (b1 < 0 && c + hist[b] > r1) { b1 = b; break; }
    c += hist[b];
  }
  const vals = [];
  for (let i = 0; i < arr.length; i++) { const v = arr[i]; if (v > lo && v < hi) { const b = bin(v); if (b >= b0 && b <= b1) vals.push(v); } }
  vals.sort((a, b) => a - b);
  const v0 = vals[r0 - c0], v1 = vals[r1 - c0];
  return v0 + frac * (v1 - v0);
}
N.quantile = quantile;
function smallQuantile(vals, q) {
  const a = Array.from(vals).sort((x, y) => x - y); if (!a.length) return NaN;
  const pos = q * (a.length - 1), i = Math.floor(pos), f = pos - i;
  return i + 1 < a.length ? a[i] + f * (a[i + 1] - a[i]) : a[i];
}
const median = a => smallQuantile(a, 0.5);
const mean = a => { let s = 0; for (const v of a) s += v; return s / a.length; };
const std1 = a => { const m = mean(a); let s = 0; for (const v of a) s += (v - m) * (v - m); return Math.sqrt(s / (a.length - 1)); };
N.mean = mean; N.std1 = std1; N.median = median;

function label3d(mask, nz, ny, nx) {             // 6-connectivity
  const Np = mask.length, lab = new Int32Array(Np), q = new Int32Array(Np), sxy = ny * nx, comps = [];
  let n = 0;
  for (let i = 0; i < Np; i++) {
    if (!mask[i] || lab[i]) continue;
    n++; let head = 0, tail = 0; q[tail++] = i; lab[i] = n;
    let cnt = 0, zmin = 1e9, zmax = -1;
    while (head < tail) {
      const p = q[head++]; cnt++;
      const z = (p / sxy) | 0, r = p - z * sxy, y = (r / nx) | 0, x = r - y * nx;
      if (z < zmin) zmin = z; if (z > zmax) zmax = z;
      let j;
      if (x > 0) { j = p - 1; if (mask[j] && !lab[j]) { lab[j] = n; q[tail++] = j; } }
      if (x < nx - 1) { j = p + 1; if (mask[j] && !lab[j]) { lab[j] = n; q[tail++] = j; } }
      if (y > 0) { j = p - nx; if (mask[j] && !lab[j]) { lab[j] = n; q[tail++] = j; } }
      if (y < ny - 1) { j = p + nx; if (mask[j] && !lab[j]) { lab[j] = n; q[tail++] = j; } }
      if (z > 0) { j = p - sxy; if (mask[j] && !lab[j]) { lab[j] = n; q[tail++] = j; } }
      if (z < nz - 1) { j = p + sxy; if (mask[j] && !lab[j]) { lab[j] = n; q[tail++] = j; } }
    }
    comps.push({ label: n, count: cnt, zmin, zmax });
  }
  return { lab, comps };
}
function component2d(mask, ny, nx, y, x) {       // 4-connectivity component containing (y, x)
  const out = new Uint8Array(ny * nx), s = y * nx + x;
  if (y < 0 || x < 0 || y >= ny || x >= nx || !mask[s]) return out;
  const q = [s]; out[s] = 1;
  while (q.length) {
    const p = q.pop(), py = (p / nx) | 0, pxx = p - py * nx;
    if (pxx > 0 && mask[p - 1] && !out[p - 1]) { out[p - 1] = 1; q.push(p - 1); }
    if (pxx < nx - 1 && mask[p + 1] && !out[p + 1]) { out[p + 1] = 1; q.push(p + 1); }
    if (py > 0 && mask[p - nx] && !out[p - nx]) { out[p - nx] = 1; q.push(p - nx); }
    if (py < ny - 1 && mask[p + nx] && !out[p + nx]) { out[p + nx] = 1; q.push(p + nx); }
  }
  return out;
}
function fillHoles2d(m, ny, nx, off) {
  const seen = new Uint8Array(ny * nx), q = new Int32Array(ny * nx); let head = 0, tail = 0;
  const push = p => { if (!m[off + p] && !seen[p]) { seen[p] = 1; q[tail++] = p; } };
  for (let x = 0; x < nx; x++) { push(x); push((ny - 1) * nx + x); }
  for (let y = 0; y < ny; y++) { push(y * nx); push(y * nx + nx - 1); }
  while (head < tail) {
    const p = q[head++], y = (p / nx) | 0, x = p - y * nx;
    if (x > 0) push(p - 1); if (x < nx - 1) push(p + 1); if (y > 0) push(p - nx); if (y < ny - 1) push(p + nx);
  }
  for (let p = 0; p < ny * nx; p++) if (!m[off + p] && !seen[p]) m[off + p] = 1;
}
// exact Euclidean distance transform: distance [pixels] of foreground pixels to the nearest background pixel
function edt2d(mask, ny, nx, off = 0) {
  const INF = 1e20, M = Math.max(ny, nx), f = new Float64Array(M), d = new Float64Array(M), v = new Int32Array(M), z = new Float64Array(M + 1);
  const g = new Float64Array(ny * nx);
  const dt1 = n => {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
  };
  for (let x = 0; x < nx; x++) { for (let y = 0; y < ny; y++) f[y] = mask[off + y * nx + x] ? INF : 0; dt1(ny); for (let y = 0; y < ny; y++) g[y * nx + x] = d[y]; }
  const out = new Float32Array(ny * nx);
  for (let y = 0; y < ny; y++) { for (let x = 0; x < nx; x++) f[x] = g[y * nx + x]; dt1(nx); for (let x = 0; x < nx; x++) out[y * nx + x] = Math.sqrt(d[x]); }
  return out;
}
N.edt2d = edt2d;
function bilinear(img, ny, nx, y, x) {
  if (!(x >= 0 && y >= 0 && x <= nx - 1 && y <= ny - 1)) return 0;
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(x0 + 1, nx - 1), y1 = Math.min(y0 + 1, ny - 1), fx = x - x0, fy = y - y0;
  return (1 - fy) * ((1 - fx) * img[y0 * nx + x0] + fx * img[y0 * nx + x1]) + fy * ((1 - fx) * img[y1 * nx + x0] + fx * img[y1 * nx + x1]);
}
function uniform2d(img, ny, nx, size) {
  const h = Math.floor(size / 2), tmp = new Float64Array(ny * nx), out = new Float32Array(ny * nx);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) { let s = 0; for (let j = 0; j < size; j++) s += img[y * nx + reflect(x - h + j, nx)]; tmp[y * nx + x] = s / size; }
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) { let s = 0; for (let j = 0; j < size; j++) s += tmp[reflect(y - h + j, ny) * nx + x]; out[y * nx + x] = s / size; }
  return out;
}
function edgeCrossings(p, frac) {
  let mx = -Infinity; for (const v of p) if (v > mx) mx = v;
  const thr = frac * mx; let i0 = -1, i1 = -1;
  for (let i = 0; i < p.length; i++) if (p[i] >= thr) { if (i0 < 0) i0 = i; i1 = i; }
  const z0 = i0 === 0 ? 0 : (i0 - 1) + (thr - p[i0 - 1]) / (p[i0] - p[i0 - 1]);
  const z1 = i1 === p.length - 1 ? i1 : i1 + (p[i1] - thr) / (p[i1] - p[i1 + 1]);
  return [z0, z1];
}
function polyfit1(x, y) {
  const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0;
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) * (x[i] - mx); }
  const a = sxx > 0 ? sxy / sxx : 0; return [a, my - a * mx];
}
function ranks(a) {
  const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]), r = new Array(a.length);
  for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const rk = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = rk; i = j + 1; }
  return r;
}
function spearman(a, b) {
  const ra = ranks(a), rb = ranks(b), ma = mean(ra), mb = mean(rb); let s = 0, sa = 0, sb = 0;
  for (let i = 0; i < a.length; i++) { s += (ra[i] - ma) * (rb[i] - mb); sa += (ra[i] - ma) ** 2; sb += (rb[i] - mb) ** 2; }
  return sa > 0 && sb > 0 ? s / Math.sqrt(sa * sb) : NaN;
}

// fractional pixel coverage of a circle (SS x SS supersampling)
function diskWeights(cx, cy, rpx, ny, nx) {
  const y0 = Math.max(Math.floor(cy - rpx - 1), 0), y1 = Math.min(Math.ceil(cy + rpx + 1) + 1, ny);
  const x0 = Math.max(Math.floor(cx - rpx - 1), 0), x1 = Math.min(Math.ceil(cx + rpx + 1) + 1, nx);
  const h = y1 - y0, w = x1 - x0, wt = new Float32Array(h * w), off = [], r2 = rpx * rpx;
  for (let i = 0; i < SS; i++) off.push((i + 0.5) / SS - 0.5);
  let ws = 0;
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    let c = 0;
    for (const oy of off) { const dy = (y0 + yy + oy - cy) ** 2; for (const ox of off) if (dy + (x0 + xx + ox - cx) ** 2 <= r2) c++; }
    wt[yy * w + xx] = c / (SS * SS); ws += wt[yy * w + xx];
  }
  return { y0, x0, h, w, wt, ws };
}
N.diskWeights = diskWeights;
class ROI {
  constructor(iz, cx, cy, d, px, ny, nx, label) {
    this.iz = iz; this.cx = cx; this.cy = cy; this.d = d; this.label = label || '';
    Object.assign(this, diskWeights(cx, cy, 0.5 * d / px, ny, nx)); this.nx = nx; this.npx = ny * nx;
  }
  mean(img) {
    let s = 0; const o = this.iz * this.npx;
    for (let yy = 0; yy < this.h; yy++) {
      const r = o + (this.y0 + yy) * this.nx + this.x0, rw = yy * this.w;
      for (let xx = 0; xx < this.w; xx++) { const wv = this.wt[rw + xx]; if (wv) s += wv * img[r + xx]; }
    }
    return s / this.ws;
  }
}
N.ROI = ROI;

// =====================================================================================
// Phantom localisation
// =====================================================================================
function backgroundLevel(s) {
  const p = quantile(s, 0.99);
  let bg = quantile(s, 0.5, 0.2 * p, Infinity);
  for (let i = 0; i < 3; i++) bg = quantile(s, 0.5, 0.5 * bg, 1.5 * bg);
  return bg;
}
function diskOffsets(rpx) {
  const r = Math.ceil(rpx), o = [];
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= rpx * rpx) o.push([y, x]);
  return o;
}

function refineSphere(s, dims, bg, sign, z, y, x, rwmm, px, dz, iters = 5) {
  const { nz, ny, nx } = dims, npx = ny * nx;
  for (let it = 0; it < iters; it++) {
    const iz = Math.min(Math.max(Math.round(z), 0), nz - 1), r = Math.ceil(rwmm / px) + 1;
    const y0 = Math.max(Math.round(y) - r, 0), y1 = Math.min(Math.round(y) + r + 1, ny);
    const x0 = Math.max(Math.round(x) - r, 0), x1 = Math.min(Math.round(x) + r + 1, nx);
    const devs = [], pts = [];
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++)
      if (((yy - y) ** 2 + (xx - x) ** 2) * px * px <= rwmm * rwmm) { const d = sign * (s[iz * npx + yy * nx + xx] - bg); devs.push(d); pts.push([yy, xx, d]); }
    const peak = smallQuantile(devs, 0.99);
    if (!(peak > 0)) break;
    let ws = 0, wy = 0, wx = 0;
    for (const [yy, xx, d] of pts) if (d > 0.3 * peak) { ws += d; wy += d * yy; wx += d * xx; }
    if (ws <= 0) break;
    y = wy / ws; x = wx / ws;
    const rz = Math.ceil(rwmm / dz) + 1, zs = [];
    for (let k = Math.max(iz - rz, 0); k < Math.min(iz + rz + 1, nz); k++) zs.push(k);
    const rin = Math.max(0.35 * rwmm, 2.0 * px), m2 = [];
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) if (((yy - y) ** 2 + (xx - x) ** 2) * px * px <= rin * rin) m2.push(yy * nx + xx);
    if (!m2.length) break;
    const prof = zs.map(k => { let a = 0; for (const p of m2) a += s[k * npx + p]; return sign * (a / m2.length - bg); });
    let ip = 0; for (let i = 1; i < prof.length; i++) if (prof[i] > prof[ip]) ip = i;
    const pk = prof[ip];
    if (!(pk > 0)) break;
    const thr = 0.5 * pk;
    let il = ip; while (il > 0 && prof[il - 1] >= thr) il--;
    let ir = ip; while (ir < prof.length - 1 && prof[ir + 1] >= thr) ir++;
    const zl = zs[il] - (il > 0 ? (prof[il] - thr) / (prof[il] - prof[il - 1]) : 0);
    const zr = zs[ir] + (ir < prof.length - 1 ? (prof[ir] - thr) / (prof[ir] - prof[ir + 1]) : 0);
    z = 0.5 * (zl + zr);
  }
  return [z, y, x];
}

function apparentDiameter(s, dims, bg, sign, z, y, x, px, rwmm = 25.0) {
  const { ny, nx } = dims, npx = ny * nx, iz = Math.round(z), r = Math.ceil(rwmm / px);
  const y0 = Math.max(Math.round(y) - r, 0), y1 = Math.min(Math.round(y) + r + 1, ny);
  const x0 = Math.max(Math.round(x) - r, 0), x1 = Math.min(Math.round(x) + r + 1, nx);
  const h = y1 - y0, w = x1 - x0, dev = new Float32Array(h * w);
  let peak = -Infinity;
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const d = sign * (s[iz * npx + (y0 + yy) * nx + x0 + xx] - bg); dev[yy * w + xx] = d;
    if (((y0 + yy - y) ** 2 + (x0 + xx - x) ** 2) * px * px <= 6.25 && d > peak) peak = d;
  }
  if (!(peak > 0)) return [0, peak];
  const m = new Uint8Array(h * w); for (let i = 0; i < h * w; i++) m[i] = dev[i] > 0.5 * peak ? 1 : 0;
  const comp = component2d(m, h, w, Math.round(y) - y0, Math.round(x) - x0);
  let cnt = 0; for (const v of comp) cnt += v;
  return cnt ? [2 * Math.sqrt(cnt * px * px / Math.PI), peak] : [0, peak];
}

function solve4(A, b) {
  const n = 4, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / M[i][i]);
}
function ringFit(obs, ks, init) {       // Gauss-Newton: centre, phase, radius (pixels)
  let p = init.slice();
  const res = q => { const r = []; ks.forEach((k, i) => { const a = q[2] + k * Math.PI / 3; r.push(q[0] + q[3] * Math.cos(a) - obs[i][0], q[1] + q[3] * Math.sin(a) - obs[i][1]); }); return r; };
  for (let it = 0; it < 50; it++) {
    const r0 = res(p), J = [];
    for (let j = 0; j < 4; j++) { const q = p.slice(), h = 1e-5 * (Math.abs(q[j]) + 1); q[j] += h; const r1 = res(q); J.push(r1.map((v, i) => (v - r0[i]) / h)); }
    const A = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], b = [0, 0, 0, 0];
    for (let a = 0; a < 4; a++) { for (let c = 0; c < 4; c++) for (let i = 0; i < r0.length; i++) A[a][c] += J[a][i] * J[c][i];
      for (let i = 0; i < r0.length; i++) b[a] -= J[a][i] * r0[i]; }
    const dx = solve4(A, b); if (!dx) break;
    for (let j = 0; j < 4; j++) p[j] += dx[j];
    if (Math.hypot(...dx) < 1e-9) break;
  }
  return { p, resid: res(p) };
}

N.localize = function (img, dims, px, dz, opts, log) {
  const { nz, ny, nx } = dims, npx = ny * nx;
  const s = gaussian3d(img, nz, ny, nx, 0.5 * 2.0 / dz, 1.0 / px, 1.0 / px);
  const bg = backgroundLevel(s);
  log.info(`background level (smoothed, localisation only): ${bg.toFixed(1)}`);

  // body = filled region above 50 % of background, largest 3D component
  const body = new Uint8Array(nz * npx);
  for (let i = 0; i < body.length; i++) body[i] = s[i] > 0.5 * bg ? 1 : 0;
  for (let k = 0; k < nz; k++) fillHoles2d(body, ny, nx, k * npx);
  let L = label3d(body, nz, ny, nx);
  if (!L.comps.length) throw new Error('Phantom not found');
  const big = L.comps.reduce((a, c) => c.count > a.count ? c : a);
  for (let i = 0; i < body.length; i++) body[i] = L.lab[i] === big.label ? 1 : 0;
  L = null;
  const area = new Float64Array(nz);
  for (let k = 0; k < nz; k++) { let c = 0; for (let j = 0; j < npx; j++) c += body[k * npx + j]; area[k] = c; }
  const [zb0, zb1] = edgeCrossings(area, 0.5);
  log.info(`phantom axial extent (50% area): slices ${zb0.toFixed(1)}-${zb1.toFixed(1)} (${((zb1 - zb0) * dz).toFixed(1)} mm)`);

  // lung insert = longest cold component inside the body eroded by 5 mm
  const rE = 5.0 / px, cold = new Uint8Array(nz * npx), inner = new Uint8Array(nz * npx);
  for (let k = 0; k < nz; k++) {
    if (area[k] === 0) continue;
    const d = edt2d(body, ny, nx, k * npx);
    for (let j = 0; j < npx; j++) { inner[k * npx + j] = d[j] > rE ? 1 : 0; cold[k * npx + j] = (d[j] > rE && s[k * npx + j] < 0.4 * bg) ? 1 : 0; }
  }
  L = label3d(cold, nz, ny, nx);
  let lungOK = false, lc = null, med = 0, zl0 = null, zl1 = null, la = null, cmx = null, cmy = null;
  if (L.comps.length) {
    lc = L.comps[0];
    for (const c of L.comps) { const e = c.zmax - c.zmin + 1, eb = lc.zmax - lc.zmin + 1; if (e > eb || (e === eb && c.count > lc.count)) lc = c; }
    la = new Float64Array(nz); cmx = new Float64Array(nz); cmy = new Float64Array(nz);
    for (let k = 0; k < nz; k++) {
      let c = 0, sx = 0, sy = 0;
      for (let j = 0; j < npx; j++) if (L.lab[k * npx + j] === lc.label) { c++; sx += j % nx; sy += (j / nx) | 0; }
      la[k] = c; if (c) { cmx[k] = sx / c; cmy[k] = sy / c; }
    }
    med = median(Array.from(la).filter(v => v > 0));
    [zl0, zl1] = edgeCrossings(Array.from(la).map(v => Math.min(v, med)), 0.5);
    // a lung insert runs (almost) the full phantom length with a ~51 mm diameter; cold spheres are short
    const len = (zl1 - zl0) * dz, deq = 2 * Math.sqrt(med * px * px / Math.PI), plen = (zb1 - zb0) * dz;
    lungOK = len >= Math.max(80, 0.45 * plen) && deq >= 35 && deq <= 75;
    if (!lungOK) log.warn(`no lung insert detected (longest cold structure ${len.toFixed(0)} mm long, diameter ${deq.toFixed(0)} mm): ` +
                          'phantom axis taken from the sphere ring; lung residual not measured');
  } else log.warn('no lung insert detected: phantom axis taken from the sphere ring; lung residual not measured');
  L = null;

  let lungXY, tilt, lungDeq = null, fx, fy, zp, izp;
  if (lungOK) {
    const good = []; for (let k = 0; k < nz; k++) if (la[k] >= 0.5 * med && k >= zl0 + 5 / dz && k <= zl1 - 5 / dz) good.push(k);
    if (good.length < 3) throw new Error('Lung insert axis could not be determined');
    fx = polyfit1(good, good.map(k => cmx[k])); fy = polyfit1(good, good.map(k => cmy[k]));
    lungXY = zz => [fx[0] * zz + fx[1], fy[0] * zz + fy[1]];
    tilt = Math.atan(Math.hypot(fx[0], fy[0]) * px / dz) * 180 / Math.PI;
    lungDeq = 2 * Math.sqrt(med * px * px / Math.PI);
    log.info(`lung insert: slices ${zl0.toFixed(1)}-${zl1.toFixed(1)}, axis tilt ${tilt.toFixed(2)} deg, apparent diameter ${lungDeq.toFixed(1)} mm`);

    // sphere plane = maximum of |s - bg| in the annulus around the lung axis
    const P = new Float64Array(nz), zr = [];
    for (let k = Math.ceil(zb0 + 10 / dz); k <= Math.floor(zb1 - 10 / dz); k++) zr.push(k);
    for (const k of zr) {
      const [cx, cy] = lungXY(k); let a = 0, c = 0;
      for (let yy = 0; yy < ny; yy++) for (let xx = 0; xx < nx; xx++) {
        const rr = Math.hypot(xx - cx, yy - cy) * px;
        if (rr > RING_R - 22 && rr < RING_R + 22) { a += Math.abs(s[k * npx + yy * nx + xx] - bg); c++; }
      }
      P[k] = a / c;
    }
    const base = median(zr.map(k => P[k]));
    let kp = zr[0]; for (const k of zr) if (P[k] > P[kp]) kp = k;
    let ws = 0, wz = 0; for (let k = Math.max(kp - 4, 0); k < Math.min(kp + 5, nz); k++) { const w = Math.max(P[k] - base, 0); ws += w; wz += w * k; }
    zp = wz / ws; izp = Math.round(zp);
  } else {
    zl0 = null; zl1 = null;
    // phantom axis direction from the body centroid line (central 60 % of the phantom)
    const ks = [], bx = [], by = [];
    for (let k = Math.ceil(zb0 + 0.2 * (zb1 - zb0)); k <= Math.floor(zb1 - 0.2 * (zb1 - zb0)); k++) {
      let c = 0, sx = 0, sy = 0; for (let j = 0; j < npx; j++) if (body[k * npx + j]) { c++; sx += j % nx; sy += (j / nx) | 0; }
      if (c) { ks.push(k); bx.push(sx / c); by.push(sy / c); }
    }
    if (ks.length < 3) throw new Error('Phantom axis could not be determined');
    const bfx = polyfit1(ks, bx), bfy = polyfit1(ks, by);
    tilt = Math.atan(Math.hypot(bfx[0], bfy[0]) * px / dz) * 180 / Math.PI;
    // sphere plane = maximum of the local |s - bg| inside the eroded body (no lung insert: the spheres are the only structure)
    const rw = Math.max(1, Math.round(4 / px)), P = new Float64Array(nz), zr = [];
    for (let k = Math.ceil(zb0 + 10 / dz); k <= Math.floor(zb1 - 10 / dz); k++) zr.push(k);
    for (const k of zr) {
      const ad = new Float32Array(npx); for (let j = 0; j < npx; j++) ad[j] = inner[k * npx + j] ? Math.abs(s[k * npx + j] - bg) : 0;
      const u = uniform2d(ad, ny, nx, rw), v = []; for (let j = 0; j < npx; j++) if (inner[k * npx + j]) v.push(u[j]);
      v.sort((a, b) => b - a); const nTop = Math.max(6, Math.round(1500 / (px * px)));   // ~ area of the six sphere cross-sections
      let a = 0; for (let i = 0; i < Math.min(nTop, v.length); i++) a += v[i]; P[k] = a / Math.min(nTop, v.length);
    }
    const base = median(zr.map(k => P[k]));
    let kp = zr[0]; for (const k of zr) if (P[k] > P[kp]) kp = k;
    let ws = 0, wz = 0; for (let k = Math.max(kp - 4, 0); k < Math.min(kp + 5, nz); k++) { const w = Math.max(P[k] - base, 0); ws += w; wz += w * k; }
    zp = ws > 0 ? wz / ws : kp; izp = Math.round(zp);
    // ring centre = position maximising the six-fold ring response of the local |s - bg| in the sphere plane
    const ad = new Float32Array(npx); for (let j = 0; j < npx; j++) ad[j] = Math.abs(s[izp * npx + j] - bg);
    const dv = uniform2d(ad, ny, nx, Math.max(2, Math.round(6 / px))), Rp = RING_R / px, NA = 360;
    const cs = [], sn = []; for (let i = 0; i < NA; i++) { cs.push(Math.cos(i * 2 * Math.PI / NA)); sn.push(Math.sin(i * 2 * Math.PI / NA)); }
    const score = (cx, cy) => {
      const A = new Float64Array(NA); for (let i = 0; i < NA; i++) A[i] = bilinear(dv, ny, nx, cy + Rp * sn[i], cx + Rp * cs[i]);
      let b = -Infinity; for (let i = 0; i < NA / 6; i++) { let t = 0; for (let k = 0; k < 6; k++) t += A[i + k * NA / 6]; if (t > b) b = t; }
      return b;
    };
    const x0c = bfx[0] * izp + bfx[1], y0c = bfy[0] * izp + bfy[1], W = Math.round(45 / px), st = Math.max(1, Math.round(1.5 / px));
    let bc = [x0c, y0c], bsc = -Infinity;
    for (let yy = Math.round(y0c) - W; yy <= Math.round(y0c) + W; yy += st) for (let xx = Math.round(x0c) - W; xx <= Math.round(x0c) + W; xx += st) {
      if (yy < 0 || xx < 0 || yy >= ny || xx >= nx || !inner[izp * npx + yy * nx + xx]) continue;
      const v = score(xx, yy); if (v > bsc) { bsc = v; bc = [xx, yy]; }
    }
    for (let h = st / 2; h >= 0.124; h /= 2) {                   // local refinement to ~0.1 px
      let moved = true;
      while (moved) { moved = false;
        for (const [ox, oy] of [[h, 0], [-h, 0], [0, h], [0, -h]]) { const v = score(bc[0] + ox, bc[1] + oy); if (v > bsc) { bsc = v; bc = [bc[0] + ox, bc[1] + oy]; moved = true; } } }
    }
    fx = [bfx[0], bc[0] - bfx[0] * zp]; fy = [bfy[0], bc[1] - bfy[0] * zp];
    lungXY = zz => [fx[0] * zz + fx[1], fy[0] * zz + fy[1]];
    log.info(`sphere-ring centre (no lung insert): x ${bc[0].toFixed(1)}, y ${bc[1].toFixed(1)} px; body-axis tilt ${tilt.toFixed(2)} deg`);
  }
  log.info(`initial sphere plane: slice ${zp.toFixed(2)}`);

  // angular phase of the six ring positions
  const [cx, cy] = lungXY(zp);
  const absdev = new Float32Array(npx); for (let j = 0; j < npx; j++) absdev[j] = Math.abs(s[izp * npx + j] - bg);
  const dev2 = uniform2d(absdev, ny, nx, Math.max(3, Math.round(6 / px)));
  const A = []; for (let i = 0; i < 720; i++) { const ph = i * 0.5 * Math.PI / 180; A.push(bilinear(dev2, ny, nx, cy + RING_R / px * Math.sin(ph), cx + RING_R / px * Math.cos(ph))); }
  let bi = 0, bs = -Infinity;
  for (let i = 0; i < 120; i++) { let sc = 0; for (let k = 0; k < 6; k++) sc += A[(i + 120 * k) % 720]; if (sc > bs) { bs = sc; bi = i; } }
  const th0 = bi * 0.5 * Math.PI / 180, r4 = diskOffsets(4.0 / px), pos = [];
  for (let k = 0; k < 6; k++) {
    const ph = th0 + k * Math.PI / 3, x = cx + RING_R / px * Math.cos(ph), y = cy + RING_R / px * Math.sin(ph);
    let a = 0; for (const [oy, ox] of r4) a += s[izp * npx + (Math.round(y) + oy) * nx + Math.round(x) + ox];
    const sign = a / r4.length >= bg ? 1 : -1;
    const [z1, y1, x1] = refineSphere(s, dims, bg, sign, zp, y, x, 20.0, px, dz);
    const [dapp] = apparentDiameter(s, dims, bg, sign, z1, y1, x1, px);
    pos.push({ k, z: z1, y: y1, x: x1, sign0: sign, d_app: dapp });
  }
  // sphere diameters from the ring order (sizes increase monotonically around the ring)
  const meas = pos.map(p => p.d_app); let best = null;
  for (let st = 0; st < 6; st++) for (const dir of [1, -1]) {
    const hyp = [0, 1, 2, 3, 4, 5].map(k => SPHERE_D[(((dir * (k - st)) % 6) + 6) % 6]);
    const rho = spearman(meas, hyp);
    if (!isNaN(rho) && (!best || rho > best.rho)) best = { rho, hyp };
  }
  if (!best) throw new Error('Spheres could not be identified');
  if (best.rho < 0.8) log.warn(`sphere identification uncertain (rank correlation ${best.rho.toFixed(2)}); check the ROI overlay`);
  log.info('apparent diameters [mm]: ' + meas.map((d, i) => `${d.toFixed(1)}->${best.hyp[i]}`).join(', '));

  const spheres = pos.map((p, i) => {
    const D = best.hyp[i];
    const [z1, y1, x1] = refineSphere(s, dims, bg, p.sign0, p.z, p.y, p.x, D / 2 + 5.0, px, dz);
    const iz = Math.round(z1), dw = diskWeights(x1, y1, 0.25 * D / px, ny, nx);
    let a = 0; for (let yy = 0; yy < dw.h; yy++) for (let xx = 0; xx < dw.w; xx++) a += dw.wt[yy * dw.w + xx] * s[iz * npx + (dw.y0 + yy) * nx + dw.x0 + xx];
    const ratio = a / dw.ws / bg;
    return { d: D, z: z1, y: y1, x: x1, k: p.k, measured_ratio_smoothed: ratio, detected: ratio >= 1.0 ? 'hot' : 'cold' };
  }).sort((a, b) => a.d - b.d);

  const fit = ringFit(spheres.map(q => [q.x, q.y]), spheres.map(q => q.k), [cx, cy, th0, RING_R / px]);
  spheres.forEach((q, i) => {
    q.ring_residual_mm = Math.hypot(fit.resid[2 * i], fit.resid[2 * i + 1]) * px;
    if (q.ring_residual_mm > 3.0) log.warn(`${q.d} mm sphere centre deviates ${q.ring_residual_mm.toFixed(1)} mm from the ring model`);
  });
  const ring = { xc: fit.p[0], yc: fit.p[1], theta_deg: ((fit.p[2] * 180 / Math.PI) % 360 + 360) % 360, radius_mm: fit.p[3] * px,
                 rms_residual_mm: Math.sqrt(mean(spheres.map(q => q.ring_residual_mm ** 2))) };
  log.info(`sphere ring radius ${ring.radius_mm.toFixed(1)} mm (nominal ${RING_R}), rms residual ${ring.rms_residual_mm.toFixed(2)} mm`);
  // plausibility: six spheres on the 57.2 mm ring, clearly different from the background
  const nVisible = spheres.filter(q => Math.abs(q.measured_ratio_smoothed - 1) > 0.3).length;
  if (ring.rms_residual_mm > 6 || Math.abs(ring.radius_mm - RING_R) > 8 || nVisible < 4)
    throw new Error(`No NEMA IEC body-phantom sphere pattern found in this series (ring radius ${ring.radius_mm.toFixed(1)} mm, ` +
      `rms residual ${ring.rms_residual_mm.toFixed(1)} mm, ${nVisible} of 6 spheres distinguishable from the background). ` +
      'Check that the selected series is an image-quality phantom scan.');

  const zc = spheres.map(q => q.z), z0 = median(zc), iz0 = Math.round(z0);
  spheres.forEach(q => { q.slice_own = Math.round(q.z); q.slice = opts.sliceMode === 'common' ? iz0 : q.slice_own; });
  const zspread = (Math.max(...zc) - Math.min(...zc)) * dz;
  if (zspread > 2.0) log.warn(`sphere centres span ${zspread.toFixed(1)} mm axially (phantom tilt ${tilt.toFixed(1)} deg); ` +
    (opts.sliceMode === 'common' ? 'a common slice is used for all sphere ROIs' : 'each sphere ROI is placed on its own central slice'));
  log.info('sphere axial centres (slice): ' + spheres.map(q => `${q.d}:${q.z.toFixed(2)}`).join(', '));
  log.info(`common central slice ${iz0} (median sphere z ${z0.toFixed(2)}, offset ${((z0 - iz0) * dz).toFixed(2)} mm)`);

  return { bg_smooth: bg, body2d: body.slice(iz0 * npx, (iz0 + 1) * npx), zb: [zb0, zb1], lung_present: lungOK, lung_z: lungOK ? [zl0, zl1] : null, lung_fit: [fx, fy], lungXY,
           lung_tilt_deg: tilt, lung_d_eq: lungDeq, spheres, ring, z0, iz0, sphere_z_spread_mm: zspread, id_rank_corr: best.rho };
};

// =====================================================================================
// Background ROIs (adaptive margin) and ROI construction
// =====================================================================================
function offsetContour(dist, ny, nx, cx, cy, level, px) {
  const pts = [], ds = new Float64Array(1000);
  for (let a = 0; a < 720; a++) {
    const ph = a * 0.5 * Math.PI / 180, c = Math.cos(ph), sn = Math.sin(ph);
    let last = -1;
    for (let i = 0; i < 1000; i++) { const r = i * 0.25; ds[i] = bilinear(dist, ny, nx, cy + r / px * sn, cx + r / px * c); if (ds[i] >= level) last = i; }
    if (last < 0) continue;
    let r = last * 0.25;
    if (last + 1 < 1000 && ds[last] !== ds[last + 1]) r += (ds[last] - level) / (ds[last] - ds[last + 1]) * 0.25;
    pts.push([cx + r / px * c, cy + r / px * sn]);
  }
  return pts;
}
function maxMinSpacing(cand, px, nroi, slo, shi = 90) {
  const n = cand.length; if (n < nroi) return [0, null];
  const D = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) D[i * n + j] = Math.hypot(cand[i][0] - cand[j][0], cand[i][1] - cand[j][1]) * px;
  const step = Math.max(1, Math.floor(n / 120)), mind = new Float64Array(n);
  const greedy = sp => {
    for (let st = 0; st < n; st += step) {
      const ch = [st]; for (let j = 0; j < n; j++) mind[j] = D[st * n + j];
      for (let t = 1; t < n; t++) {
        const j = (st + t) % n;
        if (mind[j] >= sp) { ch.push(j); for (let q = 0; q < n; q++) { const v = D[j * n + q]; if (v < mind[q]) mind[q] = v; } if (ch.length === nroi) return ch; }
      }
    }
    return null;
  };
  let best = greedy(slo); if (!best) return [0, null];
  let lo = slo, hi = shi;
  for (let i = 0; i < 14; i++) { const mid = 0.5 * (lo + hi), ch = greedy(mid); if (ch) { lo = mid; best = ch; } else hi = mid; }
  return [lo, best];
}
/* NEMA: 12 x 37 mm background ROIs 15 mm from the phantom edge and >= 15 mm from any sphere.
   Both margins cannot always be met by 12 NON-overlapping ROIs; the common margin (wall / sphere /
   lung insert) is reduced in 0.5 mm steps until 12 ROIs fit, and they are spread to maximise spacing. */
N.placeBackgroundROIs = function (geom, ny, nx, px, log) {
  const dist = edt2d(geom.body2d, ny, nx); for (let i = 0; i < dist.length; i++) dist[i] *= px;
  const [cx, cy] = geom.lungXY(geom.iz0), rroi = BG_ROI_D / 2, minSep = BG_ROI_D + 1.0;
  let m = EDGE_MARGIN, sel = null, spacing = 0, cand = [];
  while (m >= 5.0 - 1e-9) {
    const pts = offsetContour(dist, ny, nx, cx, cy, m + rroi, px);
    cand = pts.filter(p => geom.spheres.every(q => Math.hypot(p[0] - q.x, p[1] - q.y) * px >= q.d / 2 + m + rroi) &&
                           Math.hypot(p[0] - cx, p[1] - cy) * px >= LUNG_INSERT_D / 2 + m + rroi);
    [spacing, sel] = maxMinSpacing(cand, px, N_BG, minSep);
    if (sel) break;
    m -= 0.5;
  }
  if (!sel) throw new Error('Could not place 12 background ROIs');
  const key = c => (((Math.atan2(c[1] - cy, c[0] - cx) + Math.PI / 2) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const centres = sel.map(i => cand[i]).sort((a, b) => key(a) - key(b));
  const wall = centres.map(c => bilinear(dist, ny, nx, c[1], c[0]) - rroi);
  const sgap = centres.map(c => Math.min(...geom.spheres.map(q => Math.hypot(c[0] - q.x, c[1] - q.y) * px - rroi - q.d / 2)));
  const info = { margin_mm: m, min_spacing_mm: spacing, wall_gap_mm: wall, sphere_gap_mm: sgap };
  if (m < EDGE_MARGIN) log.warn(`NEMA 15 mm wall/sphere margins cannot be met by 12 non-overlapping 37 mm background ROIs in this phantom configuration; margin reduced to ${m.toFixed(1)} mm (min ROI spacing ${spacing.toFixed(1)} mm)`);
  log.info(`background ROIs: margin ${m.toFixed(1)} mm, wall gap ${Math.min(...wall).toFixed(1)}-${Math.max(...wall).toFixed(1)} mm, sphere gap >= ${Math.min(...sgap).toFixed(1)} mm, min spacing ${spacing.toFixed(1)} mm`);
  return { centres, info };
};

N.buildROIs = function (geom, dims, px, dz, std, log) {
  const { nz, ny, nx } = dims, iz0 = geom.iz0;
  const sphere = geom.spheres.map(q => new ROI(q.slice, q.x, q.y, q.d, px, ny, nx, 'S' + q.d));
  const { centres, info } = N.placeBackgroundROIs(geom, ny, nx, px, log);
  const bgSlices = BG_Z_OFFSETS.map(off => {
    const k = iz0 + Math.round(off / dz);
    if (k < geom.zb[0] + 10 / dz || k > geom.zb[1] - 10 / dz) log.warn(`background slice at ${off >= 0 ? '+' : ''}${off} mm is within 10 mm of the phantom end`);
    return k;
  });
  const bg = {};
  for (const d of SPHERE_D) bg[d] = bgSlices.map(k => centres.map(c => new ROI(k, c[0], c[1], d, px, ny, nx, 'B' + d)));
  const excl = std.lungExcl, lungSlices = [];
  let lung = [];
  if (geom.lung_present) {
    const [zl0, zl1] = geom.lung_z;
    for (let k = 0; k < nz; k++) if ((k - zl0) * dz >= excl && (zl1 - k) * dz >= excl) lungSlices.push(k);
    if (!lungSlices.length) throw new Error('No slices left for the lung residual');
    lung = lungSlices.map(k => { const [x, y] = geom.lungXY(k); return new ROI(k, x, y, LUNG_ROI_D, px, ny, nx, 'L'); });
    log.info(`lung residual on ${lungSlices.length} slices (${lungSlices[0]}-${lungSlices[lungSlices.length - 1]}), excluding ${excl} mm at the insert ends (${std.name})`);
  }
  return { sphere, bg, bgCentres: centres, bgSlices, lung, lungSlices, bgInfo: info };
};

// =====================================================================================
// Measurements
// =====================================================================================
N.analyzeFrame = function (img, rois, geom, ratio) {
  const r = { C_sphere: [], C_B: [], SD_B: [], BV: [], contrast: [] };
  geom.spheres.forEach((q, j) => {
    const vals = []; rois.bg[q.d].forEach(row => row.forEach(roi => vals.push(roi.mean(img))));
    const cb = mean(vals), sd = std1(vals), ch = rois.sphere[j].mean(img);
    const qq = q.type === 'hot' ? (ch / cb - 1) / (ratio - 1) * 100 : (1 - ch / cb) * 100;
    r.C_sphere.push(ch); r.C_B.push(cb); r.SD_B.push(sd); r.BV.push(sd / cb * 100); r.contrast.push(qq);
  });
  r.C_B37 = r.C_B[SPHERE_D.indexOf(37)];
  r.lung_C = rois.lung.map(roi => roi.mean(img));
  r.lung_residual = r.lung_C.map(v => v / r.C_B37 * 100);
  r.lung_mean = r.lung_residual.length ? mean(r.lung_residual) : null;
  r.lung_max = r.lung_residual.length ? Math.max(...r.lung_residual) : null;
  r.ratio_sphere_bg = r.C_sphere.map((c, j) => c / r.C_B[j]);
  return r;
};

N.expectedConcentration = function (meta, tref, volMl, spheres, ratio) {
  if (!meta.Dose_Bq || meta.DoseDateTime == null || tref == null || !volMl) return null;
  const A = meta.Dose_Bq * Math.pow(2, -((tref - meta.DoseDateTime) / 1000) / (meta.HalfLife_s || 6586.2));
  const vhot = spheres.filter(q => q.type === 'hot').reduce((a, q) => a + 4 / 3 * Math.PI * Math.pow(q.d / 20, 3), 0);
  return A / (volMl + (ratio - 1) * vhot);
};

N.ctChecks = function (ct, pet, geom, rois, log) {
  if (!ct) return null;
  if (ct.dzMatch > 1.0) log.warn(`CT slice nearest to the PET central slice is ${ct.dzMatch.toFixed(1)} mm away`);
  const toCT = (xp, yp) => [((pet.x0 + xp * pet.px) - ct.x0) / ct.px, ((pet.y0 + yp * pet.py) - ct.y0) / ct.py];
  const hu = (xp, yp, d) => {
    const [xc, yc] = toCT(xp, yp), w = diskWeights(xc, yc, 0.5 * d / ct.px, ct.ny, ct.nx);
    let a = 0; for (let yy = 0; yy < w.h; yy++) for (let xx = 0; xx < w.w; xx++) a += w.wt[yy * w.w + xx] * ct.img[(w.y0 + yy) * ct.nx + w.x0 + xx];
    const m = a / w.ws; let v = 0;
    for (let yy = 0; yy < w.h; yy++) for (let xx = 0; xx < w.w; xx++) v += w.wt[yy * w.w + xx] * (ct.img[(w.y0 + yy) * ct.nx + w.x0 + xx] - m) ** 2;
    return [m, Math.sqrt(Math.max(v / w.ws, 0))];
  };
  const water = rois.bgCentres.map(c => hu(c[0], c[1], BG_ROI_D));
  const [lx, ly] = geom.lungXY(geom.iz0);
  const out = { ct_slice_z_mm: ct.z, kVp: ct.kvp, desc: ct.desc, water_HU_mean: mean(water.map(w => w[0])),
    water_HU_range: [Math.min(...water.map(w => w[0])), Math.max(...water.map(w => w[0]))],
    water_HU_pixel_sd: mean(water.map(w => w[1])), lung_HU_mean: hu(lx, ly, LUNG_ROI_D)[0], sphere_HU: {} };
  geom.spheres.forEach(q => { out.sphere_HU[q.d] = hu(q.x, q.y, 0.6 * q.d)[0]; });
  if (Math.abs(out.water_HU_mean) > 10) log.warn(`CTAC water CT number ${out.water_HU_mean.toFixed(1)} HU (|HU| > 10)`);
  for (const [d, v] of Object.entries(out.sphere_HU)) if (v < -150) log.warn(`${d} mm sphere CT number ${v.toFixed(0)} HU: air bubble or unfilled sphere?`);
  return out;
};

// Protocol checks. Expected values come from the selected profile's publicly documented protocol when available; otherwise
// the acquisition/reconstruction items are listed for information only.
N.protocolChecks = function (metas, profile, log) {
  const rows = [], m0 = metas[0], R = m0.Recon || {}, label = N.reconLabel(m0), P = profile && profile.protocol ? profile.protocol : null;
  const add = (item, exp, found, ok) => rows.push({ item, expected: exp, found, status: ok === null ? 'INFO' : ok ? 'OK' : 'DIFF' });
  const ft = P && P.scan_time_s ? [].concat(P.scan_time_s) : null;
  metas.forEach((m, i) => { const e = ft ? (ft[Math.min(i, ft.length - 1)]) : null;
    const tol = ft && ft.length === 1 ? 0.05 : 0.02;
    add(`Scan time replicate ${i + 1} [s]`, e == null ? '-' : (ft.length === 1 ? `≈${e}` : e), +m.FrameDuration_s.toFixed(1), e == null ? null : Math.abs(m.FrameDuration_s - e) <= Math.max(1, tol * e)); });
  add('Number of replicates', P && P.replicates ? P.replicates : '-', metas.length, P && P.replicates ? metas.length === P.replicates : null);
  const step = m0.FrameDuration_s ? m0.FrameDuration_s / 1800 * 100 : null, afv = m0.AxialFOV_mm ? m0.AxialFOV_mm / 10 : (profile && profile.afov_cm) || null;
  if (step) add(`Implied bed step${metas.length > 1 ? ' (replicate 1)' : ''}, NEMA 100 cm / 30 min [cm]`, '-', `${step.toFixed(1)}${afv ? ` (= ${Math.round((1 - step / afv) * 100)} % bed overlap for ${(+afv).toFixed(1)} cm axial FOV)` : ''}`, null);
  const ex = k => (P && P.recon && P.recon[k] != null) ? P.recon[k] : null;
  const methodFound = label + (m0.ReconMethod && label !== m0.ReconMethod.trim() ? ` (${m0.ReconMethod})` : '');
  const methodOK = ex('method') == null ? null : (m0.ReconMethod || '').trim().toUpperCase() === String(ex('method')).toUpperCase();
  const cmp = (item, k, found, eq, algo) => { const e = ex(k);
    const st = e == null || found == null || found === '' ? null : (algo && methodOK === false) ? null : eq(found, e);   // algorithm parameters: informational when the method differs
    add(item, e == null ? '-' : e, found == null || found === '' ? '?' : found, st); };
  cmp('Recon method', 'method', methodFound, () => methodOK);
  cmp('Image size', 'matrix', m0.Matrix, (f, e) => f === e);
  cmp('Pixel size [mm]', 'pixel_mm', m0.PixelSpacing_mm ? +m0.PixelSpacing_mm.toFixed(3) : null, (f, e) => Math.abs(f - e) < 0.05);
  const rf = m0.GE && m0.GE.ir_recon_fov_cm != null ? +m0.GE.ir_recon_fov_cm : (m0.ReconDiameter_mm ? m0.ReconDiameter_mm / 10 : null);
  cmp('Recon FOV [cm]', 'fov_cm', rf == null ? null : +rf.toFixed(1), (f, e) => Math.abs(f - e) < 0.5);
  if (R.beta) cmp('Q.Clear / penalty beta', 'beta', R.beta, (f, e) => Math.abs(f - e) < 0.5, true);
  cmp('Iterations', 'iterations', R.iterations, (f, e) => f === e, true);
  cmp('Subsets', 'subsets', R.subsets, (f, e) => f === e, true);
  cmp('Post-filter FWHM [mm]', 'filter_mm', R.filter_mm == null ? null : +(+R.filter_mm).toFixed(2), (f, e) => Math.abs(f - e) < 0.05, true);
  if (R.zfilter != null) cmp('z-filter', 'zfilter', R.zfilter, (f, e) => String(f).toLowerCase() === String(e).toLowerCase());
  add('Attenuation corrected', 'ATTN', m0.CorrectedImage.includes('ATTN') ? 'yes' : 'no', m0.CorrectedImage.includes('ATTN'));
  add('Scatter corrected', 'SCAT', m0.CorrectedImage.includes('SCAT') ? 'yes' : 'no', m0.CorrectedImage.includes('SCAT'));
  add('Units', 'BQML', m0.Units + (m0.UnitScaleNote ? ` (${m0.UnitScaleNote})` : ''), m0.UnitsBqml === true);
  add('Decay correction', 'START / ADMIN', m0.DecayCorrection, /^(START|ADMIN)$/i.test((m0.DecayCorrection || '').trim()) ? true : m0.DecayCorrection ? null : false);
  rows.filter(r => r.status === 'DIFF').forEach(r => log.warn(`protocol deviation: ${r.item}: expected ${r.expected}, found ${r.found}`));
  rows.doc = P ? (P.source || 'scanner profile') : 'no published protocol selected';
  return rows;
};

function specStatus(v, lim, kind) {
  if (lim == null || v == null || !isFinite(v)) return 'N/A';
  return kind === 'min' ? (v >= lim ? 'PASS' : 'FAIL') : (v <= lim ? 'PASS' : 'FAIL');
}

// =====================================================================================
// Full pipeline
// =====================================================================================
/* opts: {standard:'2018'|'2012', ratio (actual sphere:background ratio), profileId:'auto'|<profile id>|'none', referenceId,
          limits (see N.normLimits; null = no PASS/FAIL), baseline (baseline JSON), volumeMl, seriesKeys, reconLabel, seriesFilter,
          sliceMode:'per-sphere'|'common', sphereTypes:'detected'|'standard'} */
N.run = async function (groups, opts, log, progress) {
  progress = progress || (async () => {});
  const std = N.STANDARDS[opts.standard || '2018'];
  const allRecons = N.reconGroups(groups);
  if (opts.seriesKeys) groups = groups.filter(g => g.info.modality !== 'PT' || opts.seriesKeys.includes(g.key));
  const cls = N.classifySeries(groups, log, opts.seriesFilter, !!opts.seriesKeys);
  if (!cls.pets.length) throw new Error('No attenuation-corrected PET series found in the selected folder');
  if (cls.excluded.length) log.warn(`${cls.excluded.length} PET series excluded (different geometry / frame of reference)`);
  log.info(`PET replicates: ${cls.pets.map(g => g.info.desc).join(', ')}; CT: ${cls.ct ? cls.ct.info.desc : 'none'}`);
  log.info(`analysis standard: ${std.name}`);

  const pets = [];
  for (let i = 0; i < cls.pets.length; i++)
    pets.push(await N.loadVolume(cls.pets[i], async (f, msg) => progress((i + f) / cls.pets.length * 0.45, msg), `replicate ${i + 1}`));
  const p0 = pets[0], dims = { nz: p0.nz, ny: p0.ny, nx: p0.nx }, px = p0.px, dz = p0.dz;
  if (Math.abs(p0.px - p0.py) > 1e-3) log.warn('non-square pixels: x spacing used for ROI sizes');
  const metas = pets.map(p => N.petMeta(p.hdr));

  const model0 = metas[0].Model || '', man0 = metas[0].Manufacturer || '';
  // optional scanner profile (identification + published reference values; never limits)
  let profile = null;
  const pid = opts.profileId || 'auto';
  if (pid !== 'none') {
    if (pid === 'auto') {
      const cand = N.matchProfiles(metas[0]); profile = cand[0] || null;
      log.info(profile ? `scanner profile: ${profile.name} (auto-detected from '${man0} ${model0}'${metas[0].AxialFOV_mm ? `, axial FOV ${Math.round(metas[0].AxialFOV_mm)} mm` : ''})`
                       : `no built-in scanner profile matches '${man0} ${model0}'`);
      if (cand.length > 1) log.info(`other matching profiles: ${cand.slice(1).map(p => p.name).join('; ')} (select one explicitly if the variant differs)`);
    } else {
      profile = N.PROFILES.find(p => p.id === pid) || null;
      if (!profile) throw new Error(`unknown scanner profile '${pid}'`);
      log.info(`scanner profile: ${profile.name} (selected)`);
    }
  }
  // acceptance limits: only user-entered / user-loaded
  const L0 = N.normLimits(opts.limits);
  const spec = L0 ? Object.assign({ custom: true }, L0) : Object.assign({ custom: false }, N.NO_LIMITS);
  if (L0) log.info(`acceptance limits: ${spec.name}${spec.source ? ` (${spec.source})` : ''}: contrast ${spec.contrast ? spec.contrast.join('/') : '-'}, BV ${spec.bv ? spec.bv.join('/') : '-'}, lung ${spec.lung ?? '-'}`);
  else log.info('no acceptance limits entered: results are reported without PASS/FAIL');
  if (L0 && spec.standard && String(spec.standard) !== std.id) log.warn(`the acceptance limits are defined for NU 2-${spec.standard}, the analysis uses ${std.name}`);
  const specKey = profile ? profile.id : 'none';

  if (!metas[0].UnitsBqml) log.warn(`pixel values are in '${metas[0].Units || 'unknown units'}', not Bq/mL: contrast, BV and lung residual (ratios) are valid, the absolute activity-concentration check is skipped`);
  await progress(0.47, 'Averaging replicates');
  const vm = new Float32Array(p0.img.length);
  for (const p of pets) { const im = p.img; for (let i = 0; i < vm.length; i++) vm[i] += im[i] / pets.length; }
  await progress(0.5, 'Localising the phantom (body, lung insert, spheres)');
  const geom = N.localize(vm, dims, px, dz, { sliceMode: opts.sliceMode || 'per-sphere' }, log);
  geom.z_mm = Array.from(p0.z);

  // sphere types: measured fill checked against the selected standard
  const mism = [];
  geom.spheres.forEach((q, j) => {
    q.expected = std.types[j];
    q.type = opts.sphereTypes === 'standard' ? q.expected : q.detected;
    if (q.detected !== q.expected) mism.push(q);
  });
  geom.fillMatchesStandard = mism.length === 0; geom.fillMatchesOther = null;
  if (mism.length) {
    const other = std.id === '2018' ? N.STANDARDS['2012'] : N.STANDARDS['2018'];
    const matchesOther = geom.spheres.every((q, j) => q.detected === other.types[j]);
    geom.fillMatchesOther = matchesOther ? other.id : null;
    log.warn(`Sphere fill does not match ${std.name} (${std.fill}): ` +
      mism.map(q => `${q.d} mm expected ${q.expected}, measured ${q.detected} (sphere/bg ${q.measured_ratio_smoothed.toFixed(2)})`).join('; ') +
      (matchesOther ? `. The fill corresponds to ${other.name}.` : '.') +
      (opts.sphereTypes === 'standard' ? ' Spheres analysed with the types required by the standard.' : ' Spheres analysed with their measured type; vendor limits for these spheres are not evaluable.'));
  }

  await progress(0.7, 'Placing ROIs');
  const rois = N.buildROIs(geom, dims, px, dz, std, log);

  await progress(0.78, 'Measuring replicates');
  const volumeMl = opts.volumeMl || metas[0].TracerVolume_ml || null, ratio = opts.ratio || 4.0;
  if (!(ratio > 1)) throw new Error('sphere : background ratio must be greater than 1');
  const edKey = String(opts.standard || '2018');
  if (edKey === '2018' && Math.abs(ratio - 4) > 0.5) log.warn(`NEMA NU 2-2018 specifies a 4:1 sphere-to-background ratio only (the optional 8:1 of NU 2-2012 was removed); the entered ratio is ${ratio.toFixed(2)}:1`);
  else if (edKey === '2012' && Math.abs(ratio - 4) > 0.5 && Math.abs(ratio - 8) > 1) log.info(`entered ratio ${ratio.toFixed(2)}:1 - NEMA NU 2-2012 specifies 4:1 (optionally 8:1); contrast is computed with the entered ratio`);
  const frames = pets.map((p, i) => {
    const r = N.analyzeFrame(p.img, rois, geom, ratio);
    const dref = /^ADMIN$/i.test((metas[i].DecayCorrection || '').trim()) ? metas[i].DoseDateTime : metas[i].AcquisitionStart;   // DICOM: START = acquisition start, ADMIN = injection time
    r.expected_bg = metas[i].UnitsBqml ? N.expectedConcentration(metas[i], dref, volumeMl, geom.spheres, ratio) : null;
    return r;
  });
  const T12 = metas[0].HalfLife_s || 6586.2, t0 = metas[0].AcquisitionStart; let bgCV = null;
  const dcAdmin = metas.every(m => /^ADMIN$/i.test((m.DecayCorrection || '').trim()));
  if (dcAdmin || (metas.every(m => m.AcquisitionStart != null) && metas[0].DecayCorrection.toUpperCase() === 'START')) {
    frames.forEach((r, i) => { r.C_B37_at_ref = dcAdmin ? r.C_B37 : r.C_B37 * Math.pow(2, (metas[i].AcquisitionStart - t0) / 1000 / T12); });
    if (frames.length > 1) { const a = frames.map(r => r.C_B37_at_ref); bgCV = std1(a) / mean(a) * 100; }
    if (bgCV != null && bgCV > 2) log.warn(`background concentration differs between replicates by CV ${bgCV.toFixed(1)} % after decay correction`);
  }
  const ratios = frames.filter(r => r.expected_bg).map(r => r.C_B37 / r.expected_bg);
  if (ratios.length && Math.abs(mean(ratios) - 1) > 0.10) log.warn(`measured/expected background concentration = ${mean(ratios).toFixed(3)} (> 10 % deviation). Check the dose and volume entered at the console (volume used: ${volumeMl} mL) and the dose-calibrator / well-counter cross-calibration.`);

  let ctres = null;
  if (cls.ct) {
    try { await progress(0.85, 'CTAC check'); ctres = N.ctChecks(await N.loadCTSlice(cls.ct, p0.z[geom.iz0]), p0, geom, rois, log); }
    catch (e) { log.warn('CT check failed: ' + e.message); }
  }
  const prot = N.protocolChecks(metas, profile, log);
  const label = opts.reconLabel || N.reconLabel(metas[0]);

  let base = null;
  const B = opts.baseline;
  if (B && B.recons) {
    const bm = String(B.model || B.scanner || '').toLowerCase().replace(/\s+/g, ' ').trim(), dm = model0.toLowerCase().replace(/\s+/g, ' ').trim();
    if (bm && dm && !(bm.includes(dm) || dm.includes(bm)))
      log.warn(`baseline is for '${B.model || B.scanner}', not for this scanner (${model0}); no baseline comparison`);
    else {
      const key = Object.keys(B.recons).find(k => k.replace(/\s/g, '').toLowerCase() === label.replace(/\s/g, '').toLowerCase());
      if (key) base = Object.assign({ label: key, date: B.acquisition_date || '', source: B.source || '', standard: B.standard || '' }, B.recons[key]);
      else log.warn(`baseline has no entry for reconstruction '${label}' (available: ${Object.keys(B.recons).join(', ')})`);
    }
  }
  // published reference values from the scanner profile (comparison only)
  let ref = null;
  if (profile && Array.isArray(profile.references) && profile.references.length && opts.referenceId !== 'none') {
    const refs = profile.references;
    ref = (opts.referenceId && opts.referenceId !== 'auto') ? refs.find(r => r.id === opts.referenceId) || null
        : (refs.find(r => String(r.standard || '').includes(std.id) && r.default) || refs.find(r => String(r.standard || '').includes(std.id)) || refs.find(r => r.default) || refs[0]);
    if (ref) log.info(`published reference: ${ref.label || ref.recon || ''} - ${ref.citation || ''}`);
  }

  const nrep = frames.length, col = (k, j) => frames.map(f => f[k][j]);
  const S = { standard: std.id, standardName: std.name, ratio, recon_label: label, spec_key: specKey, spec_name: spec.name,
             profile_id: profile ? profile.id : null, profile_name: profile ? profile.name : null };
  S.contrast_mean = SPHERE_D.map((d, j) => mean(col('contrast', j)));
  S.contrast_sd = SPHERE_D.map((d, j) => nrep > 1 ? std1(col('contrast', j)) : null);
  S.bv_mean = SPHERE_D.map((d, j) => mean(col('BV', j)));
  S.bv_sd = SPHERE_D.map((d, j) => nrep > 1 ? std1(col('BV', j)) : null);
  S.lung_present = geom.lung_present;
  S.lung_mean = geom.lung_present ? mean(frames.map(f => f.lung_mean)) : null;
  S.lung_sd = geom.lung_present && nrep > 1 ? std1(frames.map(f => f.lung_mean)) : null;
  const limType = j => (spec.sphere_types && spec.sphere_types[j]) || 'hot';
  S.contrast_limit = geom.spheres.map((q, j) => (spec.contrast && spec.contrast[j] != null && q.type === limType(j)) ? spec.contrast[j] : null);
  // N/A = no limit applies (e.g. a cold sphere under NU 2-2012); N/E = limit applies but not evaluable (sphere not hot)
  S.contrast_status = geom.spheres.map((q, j) => {
    const L = spec.contrast ? spec.contrast[j] : null;
    if (L == null) return 'N/A';
    // limit defined for a sphere type that this sphere does not have: N/A if the analysis standard also expects the
    // measured type (e.g. cold sphere, hot-sphere limit, NU 2-2012), otherwise not evaluable (fill differs from the standard)
    if (q.type !== limType(j)) return std.types[j] === q.type ? 'N/A' : 'N/E';
    return specStatus(S.contrast_mean[j], L, 'min');
  });
  S.bv_status = S.bv_mean.map((v, j) => specStatus(v, spec.bv ? spec.bv[j] : null, 'max'));
  S.lung_status = geom.lung_present ? specStatus(S.lung_mean, spec.lung, 'max') : (spec.lung != null ? 'N/E' : 'N/A');
  const all = [...S.contrast_status, ...S.bv_status, S.lung_status], nNE = all.filter(s => s === 'N/E').length;
  const anyLim = !!(spec.contrast || spec.bv || spec.lung != null);
  S.overall = !anyLim ? 'NO LIMITS' : all.includes('FAIL') ? 'FAIL' : nNE ? `PASS* (${nNE} item(s) not evaluable)` : 'PASS';
  S.bg_cv = bgCV; S.meas_over_expected = ratios.length ? mean(ratios) : null; S.volume_ml = volumeMl;
  S.bg_margin_mm = rois.bgInfo.margin_mm; S.n_replicates = nrep; S.custom_limits = !!spec.custom;
  S.other_recons = allRecons.filter(g => !g.keys.some(k => cls.pets.some(p => p.key === k))).map(g => `${g.label} [${g.descs.join(', ')}]`);
  if (base) {
    S.baseline = base;
    const bt = Array.isArray(base.sphere_types) ? base.sphere_types : null;   // compare only spheres of the same type (hot vs hot, cold vs cold)
    S.delta_contrast = S.contrast_mean.map((m, j) => (bt ? bt[j] === geom.spheres[j].type : geom.spheres[j].type === 'hot') && m != null && base.contrast_mean[j] != null ? m - base.contrast_mean[j] : null);
    const tmis = bt ? geom.spheres.filter((q, j) => bt[j] !== q.type).map(q => q.d) : [];
    if (tmis.length) log.warn(`baseline sphere type differs for ${tmis.join(', ')} mm (hot vs cold fill): no contrast difference reported for these spheres`);
    S.delta_bv = S.bv_mean.map((m, j) => m - base.bv_mean[j]);
    S.delta_lung = S.lung_mean != null && base.lung_mean != null ? S.lung_mean - base.lung_mean : null;
  }
  if (ref) {
    const pick = k => SPHERE_D.map(d => { const o = ref[k]; if (o == null) return null; const v = Array.isArray(o) ? o[SPHERE_D.indexOf(d)] : o[String(d)]; return v == null || v === '' ? null : +v; });
    const rtype = SPHERE_D.map(d => { const o = ref.sphere_types; return o ? (Array.isArray(o) ? o[SPHERE_D.indexOf(d)] : o[String(d)]) : null; });
    S.reference = { id: ref.id || null, label: ref.label || ref.recon || 'published reference', citation: ref.citation || '', doi: ref.doi || ref.url || '',
                    standard: ref.standard || '', recon: ref.recon || '', acquisition: ref.acquisition || '', variant: ref.variant || '',
                    contrast: pick('contrast_pct'), bv: pick('bv_pct'), lung: ref.lung_residual_pct == null ? null : +ref.lung_residual_pct, sphere_types: rtype,
                    ratio: ref.ratio == null ? null : +ref.ratio, provisional: !!ref.provisional, table: ref.table || '', notes: ref.notes || '' };
    if (S.reference.ratio && Math.abs(S.reference.ratio - ratio) > 0.25) log.warn(`published reference was measured at ${S.reference.ratio}:1, this fill is ${ratio.toFixed(2)}:1 - hot-sphere contrast is not directly comparable`);
    if (S.reference.provisional) log.warn('published reference is marked provisional (secondary source); see the profile notes');
    const mismatch = SPHERE_D.filter((d, j) => rtype[j] && rtype[j] !== geom.spheres[j].type);
    if (mismatch.length) log.info(`published reference has different sphere types for ${mismatch.join(', ')} mm: no comparison for these spheres`);
    S.delta_ref_contrast = S.contrast_mean.map((m, j) => S.reference.contrast[j] == null || (rtype[j] && rtype[j] !== geom.spheres[j].type) ? null : m - S.reference.contrast[j]);
    S.delta_ref_bv = S.bv_mean.map((m, j) => S.reference.bv[j] == null ? null : m - S.reference.bv[j]);
    S.delta_ref_lung = S.lung_mean != null && S.reference.lung != null ? S.lung_mean - S.reference.lung : null;
  }
  log.info(`${nrep} replicate(s) analysed`);
  await progress(0.95, 'Building the report');
  return { version: N.VERSION, std, spec, specKey, profile, opts, pets, metas, geom, rois, frames, summary: S, ct: ctres, protocol: prot,
           vm, log, dims, px, dz, date: metas[0].AcquisitionStart };
};

if (typeof module !== 'undefined' && module.exports) module.exports = N; else G.NEMA = N;
})(typeof globalThis !== 'undefined' ? globalThis : this);
