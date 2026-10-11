import { chromium } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => {
  localStorage.setItem('lens-consent', '1');
  localStorage.setItem('lens-settings', JSON.stringify({ model: 'base', language: 'auto', device: 'wasm', ocr: false }));
});
await page.goto('http://127.0.0.1:5175/');
const started = Date.now();
const chooserPromise = page.waitForEvent('filechooser');
await page.getByRole('button', { name: '파일 가져오기' }).click();
await (await chooserPromise).setFiles('tests/fixtures/mixed.wav');
await page.getByRole('button', { name: '전체 ZIP 다운로드' }).waitFor({ timeout: 120000 });
await page.waitForFunction(() => !document.querySelector('.engine-banner') && !document.querySelector('.capture-panel'), null, { timeout: 120000 });
await page.waitForFunction(() => document.querySelector('.transcript-panel')?.textContent.includes('Demand'), null, { timeout: 120000 }).catch(async e => {
  console.log('PIPELINE DEBUG', await page.evaluate(async () => {
    const database = await new Promise(resolve => { const r = indexedDB.open('lecturelens-v1'); r.onsuccess = () => resolve(r.result); });
    const read = name => new Promise(resolve => { const r = database.transaction(name).objectStore(name).getAll(); r.onsuccess = () => resolve(r.result.map(v => ({ ...v, samples: v.samples ? { length: v.samples.length, peak: Math.max(...v.samples.slice(0, 16000).map(Math.abs)) } : undefined }))); });
    return { sessions: await read('sessions'), chunks: await read('chunks'), transcripts: await read('transcripts'), text: document.body.innerText };
  }), errors); await browser.close(); throw e;
});
const transcript = await page.locator('.transcript-panel').innerText();
if (!transcript.includes('Demand') || !transcript.includes('시장')) throw new Error('Mixed import pipeline did not preserve both languages: ' + transcript);
const imported = { elapsedMs: Date.now() - started, transcript };
const seed = await page.evaluate(async () => {
  const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1080;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1920, 1080);
  ctx.fillStyle = 'black'; ctx.font = '48px sans-serif'; ctx.fillText('수요와 공급', 60, 120); ctx.font = '32px sans-serif'; ctx.fillText('시장 균형', 60, 200); ctx.fillText('Demand and Supply', 60, 280);
  const ocrImage = await new Promise(r => canvas.toBlob(r, 'image/png'));
  const small = document.createElement('canvas'); small.width = 960; small.height = 540; small.getContext('2d').drawImage(canvas, 0, 0, 960, 540);
  const image = await new Promise(r => small.toBlob(r, 'image/jpeg', .7));
  const settings = { model: 'tiny', device: 'wasm', language: 'auto', interval: 10, sceneThreshold: 14, quality: .7, width: 960, saveImages: true, ocr: true, ocrWidth: 1920, keywords: ['보시면'] };
  const database = await new Promise(resolve => { const req = indexedDB.open('lecturelens-v1'); req.onsuccess = () => resolve(req.result); });
  const tx = database.transaction(['sessions', 'frames'], 'readwrite');
  tx.objectStore('sessions').put({ id: 'ocr-release', name: 'OCR 임시 이미지 검증', createdAt: Date.now(), updatedAt: Date.now(), status: 'interrupted', source: 'file', duration: 10, bytes: image.size + ocrImage.size, settings });
  tx.objectStore('frames').put({ id: 'ocr-release-frame', sessionId: 'ocr-release', sec: 0, sceneId: 'ocr-s1', type: 'scene', image, ocrImage, ocr: '', ocrStatus: 'pending' });
  await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = reject; }); database.close();
  dispatchEvent(new Event('lens:changed'));
  return { storedBytes: image.size + ocrImage.size, jpegBytes: image.size, pngBytes: ocrImage.size };
});
await page.getByRole('button', { name: '내 강의', exact: false }).first().click();
await page.getByRole('button', { name: /OCR 임시 이미지 검증/ }).click();
await page.getByRole('button', { name: '저장된 구간 다시 처리' }).click();
await page.waitForFunction(() => !document.querySelector('.engine-banner'), null, { timeout: 120000 });
const after = await page.evaluate(async () => {
  const database = await new Promise(resolve => { const r = indexedDB.open('lecturelens-v1'); r.onsuccess = () => resolve(r.result); });
  const read = (name, id) => new Promise(resolve => { const r = database.transaction(name).objectStore(name).get(id); r.onsuccess = () => resolve(r.result); });
  const frame = await read('frames', 'ocr-release-frame'), session = await read('sessions', 'ocr-release'); database.close();
  return { text: frame.ocr, tempImageRemoved: !frame.ocrImage, retainedBytes: session.bytes, status: session.status };
});
if (!after.tempImageRemoved || after.retainedBytes !== seed.jpegBytes || after.status !== 'complete') throw new Error('OCR cleanup failed: ' + JSON.stringify(after));
if (!after.text.replace(/\s/g, '').includes('수요')) throw new Error('OCR pipeline failed to read Korean');
const result = { imported, ocr: { ...seed, ...after }, errors };
console.log(JSON.stringify(result, null, 2));
await mkdir('qa-results', { recursive: true }); await writeFile('qa-results/full-pipeline.json', JSON.stringify(result, null, 2));
await browser.close();
