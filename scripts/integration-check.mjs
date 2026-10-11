import { chromium } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
const page = await browser.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => {
  localStorage.setItem('lens-consent', '1');
  localStorage.setItem('lens-settings', JSON.stringify({ schemaVersion: 2, model: 'base', language: 'auto', device: 'wasm', ocr: false }));
});
await page.goto('http://127.0.0.1:5175/');
const started = Date.now();
const chooserPromise = page.waitForEvent('filechooser');
await page.getByRole('button', { name: /파일 가져오기/ }).click();
await (await chooserPromise).setFiles('tests/fixtures/mixed.wav');
await page.getByRole('button', { name: '전체 ZIP 다운로드' }).waitFor({ timeout: 120000 });
await page.waitForFunction(() => !document.querySelector('.engine-banner') && !document.querySelector('.capture-panel'), null, { timeout: 300000 });
await page.waitForFunction(() => document.querySelector('.transcript-panel')?.textContent.toLowerCase().includes('demand'), null, { timeout: 300000 }).catch(async e => {
  console.log('PIPELINE DEBUG', await page.evaluate(async () => {
    const database = await new Promise(resolve => { const r = indexedDB.open('lecturelens-v1'); r.onsuccess = () => resolve(r.result); });
    const read = name => new Promise(resolve => { const r = database.transaction(name).objectStore(name).getAll(); r.onsuccess = () => resolve(r.result.map(v => ({ ...v, samples: v.samples ? { length: v.samples.length, peak: Math.max(...v.samples.slice(0, 16000).map(Math.abs)) } : undefined }))); });
    return { sessions: await read('sessions'), chunks: await read('chunks'), transcripts: await read('transcripts'), text: document.body.innerText };
  }), errors); await browser.close(); throw e;
});
const transcript = await page.locator('.transcript-panel').innerText();
if (!transcript.toLowerCase().includes('demand') || !transcript.includes('시장')) throw new Error('Mixed import pipeline did not preserve both languages: ' + transcript);
const imported = { elapsedMs: Date.now() - started, transcript };
await mkdir('qa-results', { recursive: true });
await writeFile('qa-results/import-pipeline.json', JSON.stringify({ imported, errors }, null, 2));
console.log(JSON.stringify({ imported, errors }, null, 2));
if (errors.length) throw new Error('UI errors');
} finally { await browser.close(); }
