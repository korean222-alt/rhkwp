import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';

async function stored(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('lecturelens-v1'); r.onsuccess = () => resolve(r.result); });
    const read = (name: string) => new Promise<any[]>(resolve => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); });
    const sessions = (await read('sessions')).sort((a, b) => a.createdAt - b.createdAt), frames = await read('frames'), transcripts = await read('transcripts');
    db.close(); return { sessions, frames: frames.map(f => ({ type: f.type, bytes: f.image?.size, ocrImage: !!f.ocrImage, ocr: f.ocr, ocrStatus: f.ocrStatus })), transcripts };
  });
}
function silentWav(seconds = 4) {
  const length = seconds * 16000 * 2, b = Buffer.alloc(length + 44);
  b.write('RIFF'); b.writeUInt32LE(length + 36, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(length, 40); return b;
}
test('live snapshot settings change without stopping audio or creating OCR images', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lens-consent', '1');
    localStorage.setItem('lens-settings', JSON.stringify({ schemaVersion: 2, ocr: true, snapshotMode: 'scene' }));
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: async () => {
      const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
      canvas.getContext('2d')!.fillRect(0, 0, 1280, 720);
      const video = canvas.captureStream(1), audio = new AudioContext(), dest = audio.createMediaStreamDestination(), silent = audio.createConstantSource();
      silent.offset.value = 0; silent.connect(dest); silent.start(); await audio.resume();
      return new MediaStream([...video.getVideoTracks(), ...dest.stream.getAudioTracks()]);
    } });
  });
  await page.goto('/'); await page.getByRole('button', { name: '화면 녹화 시작' }).click();
  await expect.poll(async () => (await stored(page)).frames.length).toBe(1);
  await page.getByText('녹화 중 촬영 설정 변경', { exact: true }).click();
  await page.getByLabel('자동 촬영', { exact: true }).selectOption('manual');
  await expect(page.getByLabel('자동 촬영', { exact: true })).toBeEnabled();
  await page.getByLabel('이미지 가로 크기', { exact: true }).selectOption('640');
  await expect(page.getByLabel('이미지 가로 크기', { exact: true })).toBeEnabled();
  await page.waitForTimeout(5500); expect((await stored(page)).frames.length).toBe(1);
  await page.getByRole('button', { name: '장면 저장', exact: false }).click();
  await expect.poll(async () => (await stored(page)).frames.length).toBe(2);
  await page.getByLabel('자동 촬영', { exact: true }).selectOption('interval');
  await expect(page.getByLabel('주기 스냅샷 간격', { exact: true })).toBeEnabled();
  await page.getByLabel('주기 스냅샷 간격', { exact: true }).selectOption('5');
  await expect.poll(async () => (await stored(page)).frames.some(f => f.type === 'periodic'), { timeout: 12000 }).toBe(true);
  const data = await stored(page);
  expect(data.sessions[0].duration).toBeGreaterThanOrEqual(5);
  expect(data.sessions[0].settings.width).toBe(640); expect(data.sessions[0].settings.interval).toBe(5);
  expect(data.frames.every(f => f.bytes > 0 && !f.ocrImage && !f.ocr && f.ocrStatus === 'off')).toBe(true);
  const width = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('lecturelens-v1'); r.onsuccess = () => resolve(r.result); });
    const frames = await new Promise<any[]>(resolve => { const r = db.transaction('frames').objectStore('frames').getAll(); r.onsuccess = () => resolve(r.result); }); db.close();
    const bitmap = await createImageBitmap(frames.find(f => f.type === 'manual').image); const w = bitmap.width; bitmap.close(); return w;
  });
  expect(width).toBe(640);
  await page.getByRole('button', { name: '종료하고 정리하기' }).click();
  await expect(page.getByRole('button', { name: '전체 ZIP 다운로드' })).toBeEnabled();
});

test('multiple files automatically produce separate completed lectures in order', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('lens-consent', '1'));
  await page.goto('/');
  await page.getByLabel('강의 파일 선택', { exact: true }).setInputFiles([
    { name: '1강의.wav', mimeType: 'audio/wav', buffer: silentWav() },
    { name: '2강의.wav', mimeType: 'audio/wav', buffer: silentWav() },
    { name: '3강의.wav', mimeType: 'audio/wav', buffer: silentWav() },
  ]);
  await expect.poll(async () => (await stored(page)).sessions.filter(s => s.status === 'complete').length, { timeout: 35000 }).toBe(3);
  const data = await stored(page); expect(data.sessions.map(s => s.name)).toEqual(['1강의', '2강의', '3강의']);
  expect(data.sessions.every(s => s.duration >= 3.8 && s.duration <= 4.2)).toBe(true);
  await expect(page.locator('.queue-banner')).toHaveCount(0);
});

test('canceling the file queue keeps the current lecture and never starts the next one', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('lens-consent', '1'));
  await page.goto('/'); await page.getByLabel('강의 파일 선택', { exact: true }).setInputFiles([
    { name: '현재강의.wav', mimeType: 'audio/wav', buffer: silentWav(8) },
    { name: '다음강의.wav', mimeType: 'audio/wav', buffer: silentWav() },
  ]);
  await expect(page.locator('.capture-panel')).toBeVisible();
  await page.getByRole('button', { name: '다음 파일 처리 취소' }).click();
  await expect.poll(async () => (await stored(page)).sessions[0]?.status, { timeout: 20000 }).toBe('complete');
  await page.waitForTimeout(1500); expect((await stored(page)).sessions.length).toBe(1);
});

test('original screenshot → real bilingual OCR → edited TXT, no saved input or result', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const userUploads: string[] = []; page.on('request', r => { if (r.method() !== 'GET' && !r.url().startsWith('http://127.0.0.1')) userUploads.push(r.url()); });
  await page.goto('/'); await page.getByRole('button', { name: '이미지 → TXT', exact: true }).click();
  const bytes = await readFile('tests/fixtures/ocr-screen.png');
  await page.getByLabel('글자 읽을 이미지 선택', { exact: true }).setInputFiles({ name: '선명한-스크린샷.png', mimeType: 'image/png', buffer: Buffer.from(bytes) });
  await expect(page.getByLabel('읽은 글자 수정', { exact: true })).toBeEnabled({ timeout: 110000 });
  const text = await page.getByLabel('읽은 글자 수정', { exact: true }).inputValue();
  expect(text.replace(/\s/g, '')).toContain('수요와공급'); expect(text).toContain('Demand and Supply');
  await page.getByLabel('읽은 글자 수정', { exact: true }).fill(text + '\n확인하고 수정한 문장입니다.');
  const promise = page.waitForEvent('download'); await page.getByRole('button', { name: 'TXT 다운로드', exact: true }).click();
  const dl = await promise; await dl.saveAs('test-results/image-text.txt');
  expect(await readFile('test-results/image-text.txt', 'utf8')).toContain('확인하고 수정한 문장입니다.');
  expect((await stored(page)).sessions).toHaveLength(0); expect((await stored(page)).frames).toHaveLength(0);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('확인하고 수정한');
  expect(userUploads).toEqual([]);
  await page.screenshot({ path: '../lecturelens-image-text.png', fullPage: true });
  await page.getByRole('button', { name: '시작하기', exact: true }).click();
  await page.getByRole('button', { name: '이미지 → TXT', exact: true }).click();
  await expect(page.getByLabel('읽은 글자 수정', { exact: true })).toHaveValue('');
  await expect(page.getByAltText('이번에 넣은 원본 이미지')).toHaveCount(0);
  // Paste while focus still belongs to the sidebar, then cancel initialization.
  await page.evaluate(bytes => {
    const transfer = new DataTransfer(); transfer.items.add(new File([Uint8Array.from(bytes)], '붙여넣기.png', { type: 'image/png' }));
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, [...bytes]);
  await expect(page.getByAltText('이번에 넣은 원본 이미지')).toBeVisible();
  await page.getByRole('button', { name: '이미지·결과 지우기' }).click();
  await expect(page.getByLabel('읽은 글자 수정', { exact: true })).toHaveValue('');
  await expect(page.getByAltText('이번에 넣은 원본 이미지')).toHaveCount(0);
  await page.waitForTimeout(1500);
  await page.getByLabel('글자 읽을 이미지 선택', { exact: true }).setInputFiles({ name: '깨진.png', mimeType: 'image/png', buffer: Buffer.from('broken') });
  await expect(page.getByRole('alert')).toContainText('이미지를 열 수 없습니다.');
  expect(errors).toEqual([]);
});

test('timeline-free ZIP keeps SRT and machine-readable scene times', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: '예시 강의 둘러보기' }).click();
  await page.getByRole('switch', { name: '타임라인', exact: true }).click();
  await page.evaluate(() => { (window as any).showSaveFilePicker = undefined; });
  const promise = page.waitForEvent('download'); await page.getByRole('button', { name: '전체 ZIP 다운로드' }).click();
  const dl = await promise; await dl.saveAs('test-results/timeline-off.zip');
  const files = unzipSync(await readFile('test-results/timeline-off.zip'));
  const content = (name: string) => strFromU8(files[Object.keys(files).find(k => k.endsWith('/' + name))!]);
  expect(content('transcript.txt')).not.toMatch(/\[00:/); expect(content('combined.md')).not.toMatch(/\[00:/);
  expect(content('transcript.srt')).toContain(' --> ');
  expect(JSON.parse(content('scenes.json'))[0].sec).toBe(0);
  expect(JSON.parse(content('meta.json')).show_timeline).toBe(false);
});
