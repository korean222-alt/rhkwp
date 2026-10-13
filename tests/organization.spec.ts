import { test, expect, type Page } from '@playwright/test';
const settings = { schemaVersion: 4, model: 'tiny', device: 'wasm', language: 'korean', autoStopMinutes: 0, snapshotMode: 'scene', ignoreBottom: 25, sceneThreshold: 14, interval: 10, width: 640, quality: .55, saveImages: true, ocr: false, ocrWidth: 1920, keywords: [] };
async function read(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('lecturelens-v1'); r.onsuccess = () => resolve(r.result); });
    const get = (name: string) => new Promise<any[]>(resolve => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); });
    const sessions = await get('sessions'), transcripts = await get('transcripts'), frames = await get('frames');
    const photos = await Promise.all(frames.map(async f => { const b = await createImageBitmap(f.image); const width = b.width; b.close(); const { image: _image, ...meta } = f; return { ...meta, width, bytes: f.image.size }; }));
    db.close(); return { sessions, transcripts, photos };
  });
}
async function seed(page: Page, audio = false) {
  await page.evaluate(async ({ settings, audio }) => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('lecturelens-v1'); r.onsuccess = () => resolve(r.result); });
    const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
    const ctx = canvas.getContext('2d')!, pixels = ctx.createImageData(1280, 720);
    let n = 123;
    for (let i = 0; i < pixels.data.length; i += 4) { n = (1664525 * n + 1013904223) >>> 0; pixels.data[i] = n & 255; pixels.data[i + 1] = n >>> 8 & 255; pixels.data[i + 2] = n >>> 16 & 255; pixels.data[i + 3] = 255; }
    ctx.putImageData(pixels, 0, 0); const image = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/jpeg', .9));
    const tx = db.transaction(['sessions', 'transcripts', 'frames', 'chunks'], 'readwrite');
    const count = audio ? 1 : 2;
    for (let i = 1; i <= count; i++) {
      const id = `s${i}`, name = audio ? '진행률 테스트' : `기존 강의 ${i}`;
      tx.objectStore('sessions').put({ id, name, createdAt: i, updatedAt: i, duration: 60, status: audio ? 'interrupted' : 'complete', source: 'screen', settings, bytes: audio ? 60 * 64000 : image.size, showTimeline: false });
      if (!audio) {
        tx.objectStore('transcripts').put({ id: `t${i}`, sessionId: id, start: 12, end: 20, text: `직접 수정한 강의 ${i} 자막` });
        tx.objectStore('frames').put({ id: `f${i}`, sessionId: id, sceneId: `f${i}`, sec: 12, type: 'scene', image, ocr: '', ocrStatus: 'off' });
      } else for (let j = 0; j < 2; j++) tx.objectStore('chunks').put({ id: `c${j}`, sessionId: id, start: j * 30, duration: 30, status: 'pending', samples: new Float32Array(16000 * 30).fill(.01) });
    }
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); }); db.close(); window.dispatchEvent(new Event('lens:changed'));
  }, { settings, audio });
}
test('folder bulk add → independent lecture names → image savings keep original timestamps and captions', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await seed(page); await page.getByRole('button', { name: '내 강의', exact: true }).click();
  await expect(page.getByRole('button', { name: '기존 강의 1 강의 열기' })).toBeVisible(); const original = await read(page);
  await page.getByRole('textbox', { name: '새 폴더 이름' }).fill('경제학'); await page.getByRole('button', { name: '폴더 만들기' }).click();
  await expect(page.getByRole('button', { name: '기존 강의 넣기' })).toBeVisible();
  await page.getByRole('button', { name: '기존 강의 넣기' }).click(); await page.getByRole('checkbox', { name: '옮길 강의 기존 강의 1' }).check(); await page.getByRole('checkbox', { name: '옮길 강의 기존 강의 2' }).check(); await page.getByRole('button', { name: '선택한 2개 강의 넣기' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByRole('button', { name: '기존 강의 1 강의 열기' })).toBeVisible();
  for (let i = 1; i <= 2; i++) { await page.getByRole('button', { name: `기존 강의 ${i} 이름 변경` }).click(); await page.getByRole('textbox', { name: `기존 강의 ${i} 새 이름` }).fill(`강의 ${i}`); await page.getByRole('button', { name: '이름 저장', exact: true }).click(); await expect(page.getByRole('button', { name: `강의 ${i} 강의 열기` })).toBeVisible(); }
  const grouped = await read(page); expect(grouped.sessions.every(s => s.folderId === grouped.sessions[0].folderId)).toBe(true); expect(grouped.transcripts).toEqual(original.transcripts); expect(grouped.photos).toEqual(original.photos);
  await page.getByRole('button', { name: '이 폴더에 새 강의' }).click(); await expect(page.getByRole('combobox', { name: '새 강의 저장 폴더' })).toHaveValue(grouped.sessions[0].folderId);
  await page.getByRole('button', { name: '내 강의', exact: true }).click(); await page.getByRole('button', { name: '강의 1 강의 열기' }).click();
  await page.getByRole('button', { name: '기존 사진 용량 줄이기' }).click(); await expect(page.getByRole('dialog')).toContainText('되돌릴 수 없으므로'); expect((await read(page)).photos).toEqual(original.photos);
  await page.getByRole('button', { name: '사진 용량 줄이기', exact: true }).click(); await expect(page.getByRole('alert')).toContainText('절약했습니다');
  const after = await read(page); const photo = after.photos.find(f => f.sessionId === 's1')!; expect(photo.width).toBe(640); expect(photo.bytes).toBeLessThan(original.photos.find(f => f.sessionId === 's1')!.bytes); expect(photo.sec).toBe(12); expect(photo.id).toBe('f1'); expect(after.transcripts).toEqual(original.transcripts); expect(after.photos.find(f => f.sessionId === 's2')).toEqual(original.photos.find(f => f.sessionId === 's2'));
  await expect(page.getByRole('switch', { name: '타임라인', exact: true })).toHaveAttribute('aria-checked', 'false'); expect(after.sessions.find(s => s.id === 's1')!.bytes).toBe(photo.bytes);
  await page.getByRole('button', { name: '내 강의로', exact: true }).click(); await expect(page.getByRole('heading', { name: '경제학', exact: true })).toBeVisible(); await page.reload(); await page.getByRole('button', { name: '내 강의', exact: true }).click(); await expect(page.getByRole('button', { name: '강의 1 강의 열기' })).toBeVisible(); expect(errors).toEqual([]);
});
test('ASR progress reports committed audio, measured ETA and failed/source storage separately', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.route(/\/assets\/transcriber-[^/]+\.js/, route => route.fulfill({ contentType: 'application/javascript', body: `let n=0; self.onmessage=({data})=>{ self.postMessage({type:'inference-start'}); const k=n++; setTimeout(()=>self.postMessage({type:'result',device:'wasm',inferenceMs:120000,chunks:[{text:'실제 저장할 테스트 자막 '+k,timestamp:[0,30]}]}),k===0?800:5000); };` }));
  await page.goto('/'); await seed(page, true); await page.getByRole('button', { name: '내 강의', exact: true }).click(); await page.getByRole('button', { name: '진행률 테스트 강의 열기' }).click(); await page.getByRole('button', { name: '저장된 구간 다시 처리' }).click();
  await expect(page.getByRole('progressbar', { name: '진행률 테스트 자막 처리율' })).toHaveAttribute('value', '50'); await expect(page.locator('.progress-panel')).toContainText('남은 음성 30초'); await expect(page.locator('.progress-panel')).toContainText('처리 예상 약 2분'); await expect(page.locator('.progress-panel')).toContainText('임시 음성 1.8 MB');
  await page.screenshot({ path: 'test-results/work-progress-desktop.png', fullPage: true }); await page.setViewportSize({ width: 390, height: 844 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('.progress-panel')).toContainText('자막 정리 완료', { timeout: 12000 }); await expect(page.locator('.progress-panel')).toContainText('임시 음성 0 KB'); expect(errors).toEqual([]);
});
test('two captures choose one folder, rename while live and keep separate default-size photos', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lens-consent', '1'); let n = 0;
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: async () => {
      const id = ++n, canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1080; const ctx = canvas.getContext('2d')!; ctx.fillStyle = id === 1 ? '#ddd' : '#bbb'; ctx.fillRect(0, 0, 1920, 1080); ctx.fillStyle = '#124'; ctx.font = '72px sans-serif'; ctx.fillText('Lecture '+id,50,130);
      const video = canvas.captureStream(3), track = video.getVideoTracks()[0], original = track.getSettings.bind(track); Object.defineProperty(track,'getSettings',{value:()=>({...original(),displaySurface:'browser',deviceId:'group-tab-'+id})});
      const audio = new AudioContext(), destination = audio.createMediaStreamDestination(), tone = audio.createOscillator(); tone.frequency.value = id === 1 ? 440 : 880; tone.connect(destination); tone.start(); await audio.resume(); return new MediaStream([...video.getVideoTracks(), ...destination.stream.getAudioTracks()]);
    } });
  });
  await page.route(/\/assets\/transcriber-[^/]+\.js/, route => route.fulfill({ contentType: 'application/javascript', body: `self.onmessage=({data})=>self.postMessage({type:'result',device:'wasm',inferenceMs:1000,chunks:[{text:'분리해 저장한 정상 자막입니다.',timestamp:[0,data.audio.length/16000]}]});` }));
  await page.goto('/'); await page.getByRole('button', { name: '내 강의', exact: true }).click(); await page.getByRole('textbox', { name: '새 폴더 이름' }).fill('동시 강의 과목'); await page.getByRole('button', { name: '폴더 만들기' }).click(); await page.getByRole('button', { name: '이 폴더에 새 강의' }).click();
  await page.getByRole('textbox', { name: '강의 이름', exact: true }).fill('강의 1'); await page.getByRole('button', { name: '화면 녹화 시작' }).click(); await expect(page.getByRole('button', { name: '다른 탭 강의 추가' })).toBeEnabled();
  await page.getByRole('textbox', { name: '추가 강의 이름' }).fill('강의 2'); await page.getByRole('button', { name: '다른 탭 강의 추가' }).click(); await expect(page.locator('.capture-panel')).toHaveCount(2);
  const a = page.getByRole('region', { name: '강의 1 녹화', exact: true }); await a.getByRole('button', { name: '이름 변경', exact: true }).click(); await a.getByRole('textbox', { name: '강의 1 새 이름' }).fill('강의 1 · 시장'); await a.getByRole('button', { name: '이름 저장', exact: true }).click();
  await expect(page.getByRole('region', { name: '강의 1 · 시장 녹화', exact: true })).toBeVisible(); await page.waitForTimeout(5500);
  const data = await read(page); expect(data.sessions).toHaveLength(2); expect(data.sessions.every(s => s.folderId === data.sessions[0].folderId && s.folderId)).toBe(true); expect(data.sessions.map(s => s.name)).toContain('강의 1 · 시장'); expect(data.photos.every(f => f.width === 640)).toBe(true); expect(data.photos).toHaveLength(2); expect(data.sessions.every(s => s.settings.quality === .55)).toBe(true);
  const renamed = page.getByRole('region', { name: '강의 1 · 시장 녹화', exact: true });
  await renamed.getByRole('combobox', { name: '강의 1 · 시장 녹화 폴더' }).selectOption('');
  await expect.poll(async () => (await read(page)).sessions.find(s => s.name === '강의 1 · 시장').folderId).toBeUndefined();
  expect((await read(page)).sessions.find(s => s.name === '강의 2').folderId).toBe(data.sessions[0].folderId);
  await renamed.getByRole('combobox', { name: '강의 1 · 시장 녹화 폴더' }).selectOption(data.sessions[0].folderId);
  await renamed.getByText('녹화 중 촬영 설정 변경', { exact: true }).click(); await renamed.getByLabel('이미지 가로 크기', { exact: true }).selectOption('1920'); await expect(renamed.getByLabel('이미지 가로 크기', { exact: true })).toBeEnabled(); await renamed.getByRole('button', { name: /장면 저장/ }).click();
  await expect.poll(async () => (await read(page)).photos.some(f => f.width === 1920)).toBe(true);
  expect((await read(page)).photos.filter(f => f.sessionId === data.sessions.find(s => s.name === '강의 2').id).every(f => f.width === 640)).toBe(true);
  await page.getByRole('button', { name: '모두 종료·저장' }).click(); await expect.poll(async () => (await read(page)).sessions.every(s => s.status === 'complete')).toBe(true); await page.getByRole('button', { name: '내 강의', exact: true }).click(); await expect(page.getByRole('heading', { name: '동시 강의 과목', exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: '강의 2 강의 열기' })).toBeVisible();
});
