// Runs NEMA_IQ_Analyzer.html in headless Chromium (Playwright) on a DICOM folder, as a user would, and saves the
// printed report as PDF (A4 landscape, background graphics). Used by make_example.py.
// Usage: node render_example.js <DICOM folder> <out.pdf> [2012|2018] [site]
'use strict';
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const [dir, out, standard = '2012', site = ''] = process.argv.slice(2);
const html = path.join(__dirname, '..', 'NEMA_IQ_Analyzer.html');
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);

(async () => {
  const browser = await chromium.launch(), page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('file://' + html);
  await page.check(`input[name=std][value="${standard}"]`);
  if (site) await page.fill('#site', site);
  await page.setInputFiles('#fileInput', walk(dir).filter(p => p.endsWith('.dcm')).sort());
  await page.waitForFunction(() => !document.getElementById('runBtn').disabled, null, { timeout: 120000 });
  await page.click('#runBtn');
  await page.waitForFunction(() => document.body.dataset.done, null, { timeout: 300000 });
  if (await page.evaluate(() => document.body.dataset.done) !== '1') throw new Error('analysis failed: ' + await page.textContent('#err'));
  if (errors.length) throw new Error('page errors: ' + errors.join('; '));
  await page.emulateMedia({ media: 'print' });
  await page.pdf({ path: out, preferCSSPageSize: true, printBackground: true });
  console.log(out, (await page.textContent('#log')).split('\n').filter(l => l.startsWith('[WARN]')).join('\n') || 'no warnings');
  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
