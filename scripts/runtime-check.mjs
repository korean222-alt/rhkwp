import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
page.on('console', m => { if (m.type() === 'error') console.log('BROWSER:', m.text().slice(0, 600)); });
page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
const production = process.argv.includes('--production');
await page.goto(production ? 'http://127.0.0.1:5175/' : 'http://127.0.0.1:5173/');
const workerUrl = production ? '/assets/' + (await readdir('dist/assets')).find(f => f.startsWith('transcriber-')) : '/src/workers/transcriber.ts';
const mixed = process.argv.includes('--mixed');
const bytes = [...await readFile(mixed ? 'tests/fixtures/mixed.wav' : 'tests/fixtures/korean.wav')];
const started = Date.now();
const result = await page.evaluate(async ({ bytes, workerUrl, mixed }) => {
  const context = new AudioContext();
  const decoded = await context.decodeAudioData(Uint8Array.from(bytes).buffer);
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
  const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
  const audio = (await offline.startRendering()).getChannelData(0).slice();
  await context.close();
  const worker = new Worker(workerUrl, { type: 'module' });
  const settings = { model: mixed ? 'base' : 'tiny', device: 'wasm', language: mixed ? 'auto' : 'korean' };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Model test timed out')); }, 10 * 60000);
    worker.onerror = e => { clearTimeout(timer); reject(new Error(e.message)); };
    worker.onmessage = ({ data }) => {
      if (data.type === 'progress') return;
      clearTimeout(timer); worker.terminate(); resolve({ ...data, duration: decoded.duration });
    };
    worker.postMessage({ type: 'transcribe', settings, audio }, [audio.buffer]);
  });
}, { bytes, workerUrl, mixed });
console.log(JSON.stringify({ test: 'real-korean-asr', elapsedMs: Date.now() - started, result }, null, 2));
await mkdir('qa-results', { recursive: true });
await writeFile(`qa-results/${mixed ? 'mixed' : 'real'}-asr.json`, JSON.stringify({ elapsedMs: Date.now() - started, result }, null, 2));
if (result.type !== 'result' || !result.chunks?.length) throw new Error('Whisper inference failed');
await browser.close();
