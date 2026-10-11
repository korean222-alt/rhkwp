import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage(); await page.goto('http://127.0.0.1:5173/');
const started = Date.now();
const storage = await page.evaluate(async () => {
  const db = await import('/src/lib/db.ts');
  const { DEFAULT_SETTINGS } = await import('/src/types.ts');
  const id = 'one-hour-storage-test';
  await db.putSession({ id, name: '1시간 합성 무음 · 저장/복구 테스트', createdAt: Date.now(), updatedAt: Date.now(), status: 'recording', source: 'screen', duration: 0, bytes: 0, settings: { ...DEFAULT_SETTINGS, ocr: false } });
  const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 540;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f3f6ed'; ctx.fillRect(0, 0, 960, 540);
  ctx.fillStyle = '#254c30'; ctx.font = '32px sans-serif'; ctx.fillText('장시간 저장 검증 · SYNTHETIC FIXTURE', 60, 140);
  const image = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .7));
  for (let i = 0; i < 720; i++) {
    const sec = i * 5;
    await db.saveChunk({ id: `${id}:${sec.toFixed(5).padStart(16, '0')}`, sessionId: id, start: sec, duration: 5, samples: new Float32Array(80000), status: 'pending' });
    if (i % 2 === 0) await db.saveFrame({ id: `${id}:frame${i}`, sessionId: id, sec, sceneId: 'synthetic', type: 'periodic', image, ocr: '', ocrStatus: 'off' });
  }
  return { imageSize: image.size, peakPcmBytes: 720 * 80000 * 4, session: await db.getSession(id), chunks: await db.chunkStats(id) };
});
await page.reload();
await page.waitForTimeout(1200);
const recovered = await page.evaluate(async () => {
  const db = await import('/src/lib/db.ts'); return db.getSession('one-hour-storage-test');
});
const processing = await page.evaluate(async () => {
  const db = await import('/src/lib/db.ts');
  const { Engine } = await import('/src/lib/engine.ts');
  const states = []; const engine = new Engine(s => { if (s.error) states.push(s.error); });
  await engine.start('one-hour-storage-test');
  return { session: await db.getSession('one-hour-storage-test'), chunks: await db.chunkStats('one-hour-storage-test'), frames: (await db.frameMeta('one-hour-storage-test')).length, errors: states };
});
const result = { elapsedMs: Date.now() - started, storage, statusAfterRefresh: recovered.status, processing };
console.log(JSON.stringify(result, null, 2));
await mkdir('qa-results', { recursive: true }); await writeFile('qa-results/one-hour-storage.json', JSON.stringify(result, null, 2));
if (processing.chunks.done !== 720 || processing.errors.length || processing.session.duration !== 3600 || processing.session.status !== 'complete' || recovered.status !== 'interrupted') throw new Error('Storage/resume validation failed');
await browser.close();
