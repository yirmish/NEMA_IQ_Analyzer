/* =====================================================================================
 * NEMA IQ Analyzer - user interface
 * ===================================================================================== */
(function () {
'use strict';
const N = window.NEMA, R = window.NEMA_REPORT;
const $ = id => document.getElementById(id);
let files = [], groups = [], result = null, baselineObj = null, limitsObj = null, detectedProfile = null, folderName = '';

function logLine(lvl, m) { const el = $('log'); el.textContent += (lvl === 'warn' ? '[WARN] ' : '[info] ') + m + '\n'; el.scrollTop = el.scrollHeight; }
async function progress(fr, msg) {
  $('barIn').style.width = Math.round(Math.min(Math.max(fr, 0), 1) * 100) + '%';
  if (msg) $('progMsg').textContent = msg;
  await new Promise(r => setTimeout(r, 0));
}
function showError(e) {
  const box = $('err'); box.hidden = false; box.textContent = 'Error: ' + (e && e.message ? e.message : e);
  console.error(e);
}

// ---------------------------------------------------------------- file selection
async function entriesToFiles(entry, out) {
  if (entry.isFile) { await new Promise(res => entry.file(fl => { out.push(fl); res(); }, () => res())); return; }
  if (entry.isDirectory) {
    const rd = entry.createReader();
    let batch;
    do { batch = await new Promise(res => rd.readEntries(res, () => res([]))); for (const e of batch) await entriesToFiles(e, out); } while (batch.length);
  }
}
async function setFiles(list, name) {
  files = list; folderName = name || '';
  $('err').hidden = true; $('p-report').hidden = true; $('log').textContent = '';
  if (!files.length) return;
  const log = new N.Log(logLine);
  $('runBtn').disabled = true;
  try {
    groups = await N.scanFiles(files, log, progress);
    await progress(1, `${files.length} files read`);
    renderSeries();
  } catch (e) { showError(e); }
}
function renderSeries() {
  const box = $('seriesBox');
  if (!groups.length) { box.innerHTML = '<p class="bad">No DICOM images found.</p>'; return; }
  const pets = groups.filter(g => g.info.modality === 'PT');
  const rg = N.reconGroups(groups), recOf = {};
  rg.forEach((r, i) => r.keys.forEach(k => { recOf[k] = i; }));
  const sel = rg.length ? rg[0] : null;
  const refFoR = sel ? sel.series[0].info.for : (pets.length ? pets[0].info.for : null);
  let h = `<p>${folderName ? `<b>${R.esc(folderName)}</b> — ` : ''}${files.length} files, ${groups.length} series. Tick the PET series to use as replicates (separate acquisitions of one reconstruction):</p>`;
  if (rg.length > 1) h += `<div class="reconpick"><b>Reconstruction:</b><select id="reconSel">${rg.map((r, i) =>
      `<option value="${i}">${R.esc(r.label)} — ${r.n} series (${R.esc(r.descs.join(', '))})</option>`).join('')}</select>
      <span class="hint">${rg.length} reconstructions found; each is analysed separately (run again with another choice for the next report).</span></div>`;
  h += `<table class="t series"><thead><tr><th>use</th><th>modality</th><th>series description</th><th>images</th><th>acquisition</th><th>reconstruction</th><th>corrections / units</th><th>role</th></tr></thead><tbody>`;
  groups.slice().sort((a, b) => (a.info.acq || 0) - (b.info.acq || 0)).forEach(g => {
    const i = g.info, ac = i.corrected.includes('ATTN'), isPet = i.modality === 'PT', inSel = sel && sel.keys.includes(g.key);
    const role = isPet ? (!ac ? 'ignored (not attenuation-corrected)' : inSel ? 'PET replicate' : 'other reconstruction')
                       : i.modality === 'CT' ? (i.for === refFoR ? 'CTAC (CT-number check)' : 'CT (other frame of reference)') : 'ignored';
    h += `<tr><td>${isPet ? `<input type="checkbox" class="selser" value="${R.esc(g.key)}" ${ac && inSel ? 'checked' : ''}>` : ''}</td><td>${i.modality}</td><td>${R.esc(i.desc)}</td><td>${g.files.length}</td>
      <td>${N.fmtDT(i.acq)}</td><td>${isPet ? R.esc(recOf[g.key] != null ? rg[recOf[g.key]].label : (i.recon || '')) : ''}</td><td>${R.esc(i.corrected.join(', '))}${i.units ? ' / ' + R.esc(i.units) : ''}</td><td class="role">${role}</td></tr>`;
  });
  box.innerHTML = h + '</tbody></table>';
  if (rg.length > 1) $('reconSel').addEventListener('change', e => {
    const r = rg[+e.target.value];
    document.querySelectorAll('.selser').forEach(cb => { cb.checked = r.keys.includes(cb.value);
      const td = cb.closest('tr').querySelector('td.role'); const g = groups.find(x => x.key === cb.value);
      if (g && g.info.corrected.includes('ATTN')) td.textContent = cb.checked ? 'PET replicate' : 'other reconstruction'; });
  });
  $('runBtn').disabled = !pets.length;
  detectProfile();
}
$('dirInput').addEventListener('change', e => {
  const l = Array.from(e.target.files); const rp = l.length && l[0].webkitRelativePath ? l[0].webkitRelativePath.split('/')[0] : '';
  setFiles(l, rp);
});
$('fileInput').addEventListener('change', e => setFiles(Array.from(e.target.files), ''));
const drop = $('drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', async e => {
  const items = Array.from(e.dataTransfer.items || []), out = []; let name = '';
  for (const it of items) { const en = it.webkitGetAsEntry && it.webkitGetAsEntry(); if (en) { if (!name) name = en.name; await entriesToFiles(en, out); } }
  if (!out.length && e.dataTransfer.files) out.push(...e.dataTransfer.files);
  setFiles(out, name);
});

// ---------------------------------------------------------------- settings
function fillProfiles() {
  const sel = $('profSel'), keep = sel.value, byMan = {};
  N.PROFILES.forEach(p => { (byMan[p.manufacturer || 'Other'] = byMan[p.manufacturer || 'Other'] || []).push(p); });
  sel.innerHTML = '<option value="auto">Auto-detect from the DICOM header</option><option value="none">None</option>' +
    Object.keys(byMan).sort().map(m => `<optgroup label="${R.esc(m)}">${byMan[m].map(p => `<option value="${R.esc(p.id)}">${R.esc(p.name)}</option>`).join('')}</optgroup>`).join('');
  if ([...sel.options].some(o => o.value === keep)) sel.value = keep;
  updateProfileInfo();
}
function currentProfile() { const v = $('profSel').value; return v === 'auto' ? detectedProfile : v === 'none' ? null : N.PROFILES.find(p => p.id === v) || null; }
function updateProfileInfo() {
  const p = currentProfile(), v = $('profSel').value;
  $('profInfo').textContent = !N.PROFILES.length ? 'No built-in profiles. Load a profile JSON to add one.'
    : v === 'auto' ? (groups.length ? (p ? `Detected: ${p.name}` : 'No profile matches this scanner (analysis works without one).') : `${N.PROFILES.length} built-in profiles; detection after the DICOM folder is read.`)
    : p ? `${p.name}${p.afov_cm ? `, ${p.afov_cm} cm axial FOV` : ''}` : 'No profile.';
  const rs = $('refSel'), keep = rs.value, refs = p && p.references ? p.references : [];
  rs.innerHTML = '<option value="auto">Automatic (profile entry for the selected standard)</option><option value="none">None</option>' +
    refs.map(r => `<option value="${R.esc(r.id)}">${R.esc(r.label || r.recon || r.id)}${r.standard ? ' — ' + R.esc(r.standard) : ''}</option>`).join('');
  if ([...rs.options].some(o => o.value === keep)) rs.value = keep;
  // published limit sets of the profile: offered as an explicit, opt-in choice
  const ls = $('limSel'), keepL = ls.value, pls = p && p.published_limits ? p.published_limits : [];
  ls.innerHTML = '<option value="none">None (report results without PASS/FAIL)</option><option value="custom">Enter limits…</option><option value="file">Load limits JSON…</option>' +
    pls.map(l => `<option value="profile:${R.esc(l.id)}">Published: ${R.esc(l.name)}</option>`).join('');
  ls.value = [...ls.options].some(o => o.value === keepL) ? keepL : 'none';
  if (ls.value !== keepL) ls.dispatchEvent(new Event('change'));
  const r = rs.value === 'auto' ? null : refs.find(x => x.id === rs.value);
  $('refInfo').textContent = !refs.length ? (p ? 'This profile has no published reference values.' : '') : r ? `${r.citation || ''}` : `${refs.length} published value set(s) available.`;
}
$('profSel').addEventListener('change', updateProfileInfo);
$('refSel').addEventListener('change', updateProfileInfo);
$('profFile').addEventListener('change', async e => {
  try { const n = N.addProfiles(JSON.parse(await e.target.files[0].text())); fillProfiles(); if (groups.length) detectProfile(); logLine('info', `${n} profile(s) loaded from file`); }
  catch (err) { showError('profile file: ' + err.message); }
});
function detectProfile() {
  const pet = groups.find(g => g.info.modality === 'PT');
  detectedProfile = pet ? (N.matchProfiles({ Manufacturer: pet.info.manufacturer, Model: pet.info.model, AxialFOV_mm: pet.info.axialFov })[0] || null) : null;
  updateProfileInfo();
}
$('limSel').addEventListener('change', () => { const v = $('limSel').value; $('customBox').hidden = v !== 'custom'; $('limFileLbl').hidden = v !== 'file';
  const p = currentProfile(), pl = v.startsWith('profile:') && p ? (p.published_limits || []).find(x => x.id === v.slice(8)) : null;
  $('limInfo').textContent = v === 'file' && limitsObj ? `${limitsObj.name}${limitsObj.source ? ' (' + limitsObj.source + ')' : ''}`
    : pl ? `${pl.source}. ${pl.notes || ''} Check that they apply to your system, software and reconstruction.` : ''; });
$('limFile').addEventListener('change', async e => {
  try { const j = JSON.parse(await e.target.files[0].text()); limitsObj = N.normLimits(j.limits || j); if (!limitsObj) throw new Error('no limit values found');
        $('limInfo').textContent = `${limitsObj.name}${limitsObj.source ? ' (' + limitsObj.source + ')' : ''}: contrast ${limitsObj.contrast ? limitsObj.contrast.join('/') : '-'}, BV ${limitsObj.bv ? limitsObj.bv.join('/') : '-'}, lung ${limitsObj.lung ?? '-'}`; }
  catch (err) { showError('limits file: ' + err.message); }
});
function customLimits() {
  return N.normLimits({ name: $('limName').value.trim() || 'User-entered limits', source: $('limSrc').value.trim(), standard: $('limStd').value,
                        contrast: $('limQ').value, bv: $('limBV').value, lung: $('limLung').value });
}
$('limSave').addEventListener('click', () => {
  try { const L = customLimits(); if (!L) throw new Error('enter at least one limit');
        download(`NEMA_IQ_limits_${(L.name || 'custom').replace(/[^\w.-]+/g, '_').slice(0, 40)}.json`, JSON.stringify(Object.assign({ format: 'nema-iq-limits', version: 1 }, L), null, 1), 'application/json'); }
  catch (err) { showError(err); }
});
$('baseSel').addEventListener('change', () => { const v = $('baseSel').value; $('baseFileLbl').hidden = v !== 'file'; });
$('baseFile').addEventListener('change', async e => {
  try { const b = JSON.parse(await e.target.files[0].text()); if (!b.recons) throw new Error('JSON has no "recons" entry');
        baselineObj = b; $('baseInfo').textContent = `${b.scanner || b.model || ''} ${b.acquisition_date || ''} (${Object.keys(b.recons).join(', ')})`; }
  catch (err) { showError('baseline file: ' + err.message); }
});
fillProfiles();
document.querySelectorAll('input[name=std]').forEach(r => r.addEventListener('change', () => {
  $('stdNote').textContent = N.STANDARDS[document.querySelector('input[name=std]:checked').value].note;
}));

function readOpts() {
  const num = id => { const v = parseFloat($(id).value); return isFinite(v) ? v : null; };
  return {
    standard: document.querySelector('input[name=std]:checked').value,
    ratio: num('ratio') || 4.0, volumeMl: num('volMl'),
    profileId: $('profSel').value === 'auto' ? (detectedProfile ? detectedProfile.id : 'none') : $('profSel').value, referenceId: $('refSel').value,
    limits: $('limSel').value === 'custom' ? (() => { const L = customLimits(); if (!L) throw new Error('Acceptance limits: enter at least one value, or select None'); return L; })()
          : $('limSel').value === 'file' ? (limitsObj || (() => { throw new Error('Acceptance limits: choose a limits JSON file'); })())
          : $('limSel').value.startsWith('profile:') ? (() => { const p = currentProfile(), id = $('limSel').value.slice(8);
              const l = p && (p.published_limits || []).find(x => x.id === id); if (!l) throw new Error('published limits not available for this profile');
              return N.normLimits(Object.assign({}, l, { name: l.name, source: l.source })); })() : null,
    sliceMode: $('sliceSel').value, sphereTypes: $('typeSel').value,
    baseline: $('baseSel').value === 'file' ? baselineObj : null,
    site: $('site').value.trim(), operator: $('operator').value.trim(),
    seriesKeys: Array.from(document.querySelectorAll('.selser:checked')).map(c => c.value)
  };
}

// ---------------------------------------------------------------- run
async function run() {
  $('err').hidden = true; $('p-report').hidden = true; $('runBtn').disabled = true; $('log').textContent = '';
  let opts;
  try { opts = readOpts(); } catch (e) { showError(e); $('runBtn').disabled = false; return; }
  if (!opts.seriesKeys.length) { showError('select at least one PET series'); $('runBtn').disabled = false; return; }
  if (opts.ratio <= 1) { showError('the sphere:background ratio must be > 1'); $('runBtn').disabled = false; return; }
  const log = new N.Log(logLine);
  const t0 = performance.now();
  try {
    result = await N.run(groups, opts, log, progress);
    await progress(0.97, 'Rendering the report');
    $('report').innerHTML = R.buildReport(result);
    $('p-report').hidden = false;
    await progress(1, `Done in ${((performance.now() - t0) / 1000).toFixed(1)} s — ${result.summary.overall}`);
    $('p-report').scrollIntoView({ behavior: 'smooth' });
    document.body.dataset.done = '1';
  } catch (e) { showError(e); document.body.dataset.done = 'error'; }
  $('runBtn').disabled = false;
}
$('runBtn').addEventListener('click', run);

// ---------------------------------------------------------------- exports
function download(name, text, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/plain' }));
  a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const tag = () => `${N.fmtDate(result.date)}_${result.summary.recon_label.replace(/\s+/g, '')}_NU2-${result.summary.standard}`;
$('printBtn').addEventListener('click', () => window.print());
$('baseBtn').addEventListener('click', () => {
  const S = result.summary, m = result.metas[0];
  const b = { format: 'nema-iq-baseline', version: 1, manufacturer: m.Manufacturer, model: m.Model, scanner: `${m.Manufacturer} ${m.Model}`.trim(),
              acquisition_date: N.fmtDate(result.date), standard: S.standard, source: `NEMA IQ Analyzer v${N.VERSION}, study ${N.fmtDate(result.date)}${$('site').value.trim() ? ', ' + $('site').value.trim() : ''}`,
              recons: { [S.recon_label]: { contrast_mean: S.contrast_mean, contrast_sd: S.contrast_sd, bv_mean: S.bv_mean, bv_sd: S.bv_sd,
                                           lung_mean: S.lung_mean, lung_sd: S.lung_sd, n_replicates: S.n_replicates, sphere_types: result.geom.spheres.map(q => q.type) } } };
  download(`NEMA_IQ_baseline_${tag()}.json`, JSON.stringify(b, null, 1), 'application/json');
});
$('csvBtn').addEventListener('click', () => download(`NEMA_IQ_results_${tag()}.csv`, R.resultsCSV(result), 'text/csv'));
$('lungBtn').addEventListener('click', () => download(`NEMA_IQ_lung_${tag()}.csv`, R.lungCSV(result), 'text/csv'));
$('jsonBtn').addEventListener('click', () => download(`NEMA_IQ_results_${tag()}.json`, R.resultsJSON(result), 'application/json'));
$('htmlBtn').addEventListener('click', () => {
  const css = document.getElementById('reportCss').textContent;
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>NEMA IQ report ${tag()}</title><style>${css}</style></head><body class="standalone">${$('report').innerHTML}</body></html>`;
  download(`NEMA_IQ_report_${tag()}.html`, html, 'text/html');
});

// ---------------------------------------------------------------- automated test hook (?autotest=manifest.json&std=2018)
(async function autotest() {
  const q = new URLSearchParams(location.search), man = q.get('autotest');
  if (!man) return;
  try {
    const xhr = (u, type) => new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open('GET', u); x.responseType = type;
      x.onload = () => res(x.response); x.onerror = () => rej(new Error('cannot read ' + u)); x.send(); });
    const list = await xhr(man, 'json'), fl = [];
    for (const u of list) { const b = await xhr(u, 'blob'); fl.push(new File([b], decodeURIComponent(u.split('/').pop()))); }
    await setFiles(fl, 'autotest');
    if (q.get('std')) document.querySelector(`input[name=std][value="${q.get('std')}"]`).checked = true;
    if (q.get('site')) $('site').value = q.get('site');
    if (q.get('recon') && $('reconSel')) { $('reconSel').value = q.get('recon'); $('reconSel').dispatchEvent(new Event('change')); }
    if (q.get('prof')) { $('profSel').value = q.get('prof'); $('profSel').dispatchEvent(new Event('change')); }
    if (q.get('ref')) { $('refSel').value = q.get('ref'); $('refSel').dispatchEvent(new Event('change')); }
    if (q.get('lim')) { $('limSel').value = q.get('lim'); $('limSel').dispatchEvent(new Event('change')); }
    for (const id of ['limQ', 'limBV', 'limLung', 'limSrc', 'limName', 'limStd']) if (q.get(id) != null) $(id).value = q.get(id);
    if (q.get('mix')) document.querySelectorAll('.selser').forEach(cb => { cb.checked = true; });   // test: tick every PET series
    if (q.get('base')) { baselineObj = await xhr(q.get('base'), 'json'); $('baseSel').value = 'file'; $('baseSel').dispatchEvent(new Event('change')); }
    await run();
    if (q.get('print')) window.print();
  } catch (e) { showError(e); document.body.dataset.done = 'error'; }
})();
})();
