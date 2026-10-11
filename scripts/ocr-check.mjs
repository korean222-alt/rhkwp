import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage(); await page.goto('http://127.0.0.1:5173/');
const started = Date.now();
const result = await page.evaluate(async () => {
  const { recognize, stopOcr } = await import('/src/lib/ocr.ts');
  const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1080;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1920, 1080);
  ctx.fillStyle = 'black'; ctx.font = 'bold 48px sans-serif'; ctx.fillText('수요와 공급', 60, 120);
  ctx.font = '32px sans-serif'; ctx.fillText('시장 균형은 두 곡선이 만나는 지점입니다.', 60, 200);
  ctx.fillText('Demand and Supply', 60, 280);
  const image = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  try { return { text: await recognize(image, () => {}), imageBytes: image.size }; } finally { await stopOcr(); }
});
console.log(JSON.stringify({ elapsedMs: Date.now() - started, result }, null, 2));
await mkdir('qa-results', { recursive: true }); await writeFile('qa-results/real-ocr.json', JSON.stringify({ elapsedMs: Date.now() - started, result }, null, 2));
if (!result.text.replace(/\s/g, '').includes('수요') || !result.text.includes('Demand')) throw new Error('OCR failed to read the fixture');
await browser.close();
