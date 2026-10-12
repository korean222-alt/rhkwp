import { test, expect, type Page } from '@playwright/test';

const workerRoute = /\/(?:assets\/transcriber-[^/]+\.js|src\/workers\/transcriber\.ts)(?:\?|$)/;
const workerBody = `self.onmessage = ({ data }) => {
  const a = data.audio; let lr = 0, li = 0, hr = 0, hi = 0;
  for (let i = 0; i < Math.min(a.length, 16000); i++) { lr += a[i] * Math.cos(2 * Math.PI * 440 * i / 16000); li += a[i] * Math.sin(2 * Math.PI * 440 * i / 16000); hr += a[i] * Math.cos(2 * Math.PI * 880 * i / 16000); hi += a[i] * Math.sin(2 * Math.PI * 880 * i / 16000); }
  const key = lr * lr + li * li > hr * hr + hi * hi ? 'A' : 'B';
  self.postMessage({ type: 'result', chunks: [{ text: '강의 ' + key + '의 분리된 자막입니다.', timestamp: [0, a.length / 16000] }], device: 'wasm' });
};`;

async function setup(page: Page, silentFirst = false) {
  await page.addInitScript(silentFirst => {
    localStorage.setItem('lens-consent', '1'); localStorage.setItem('lens-settings', JSON.stringify({ schemaVersion: 3, model: 'tiny', language: 'korean', snapshotMode: 'manual', autoStopMinutes: 0 }));
    let number = 0;
    const fixture = window as unknown as { captureMode: string; captureStreams: MediaStream[]; displayRequests: unknown[] };
    fixture.captureMode = 'valid'; fixture.captureStreams = []; fixture.displayRequests = [];
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: async (options: unknown) => {
      fixture.displayRequests.push(options);
      if (fixture.captureMode === 'cancel') throw new DOMException('Cancelled', 'NotAllowedError');
      const n = number++, canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 540;
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = n % 2 ? '#ffeedd' : '#ddeecc'; ctx.fillRect(0, 0, 960, 540);
      ctx.fillStyle = '#234'; ctx.font = '36px sans-serif'; ctx.fillText('Lecture ' + n, 40, 100);
      const video = canvas.captureStream(5), track = video.getVideoTracks()[0];
      const original = track.getSettings.bind(track);
      Object.defineProperty(track, 'getSettings', { value: () => ({ ...original(), displaySurface: fixture.captureMode === 'window' ? 'window' : 'browser', deviceId: fixture.captureMode === 'duplicate' ? 'tab-0' : 'tab-' + n }) });
      const audio = new AudioContext(), source = audio.createOscillator(), volume = audio.createGain(), destination = audio.createMediaStreamDestination();
      source.frequency.value = n % 2 ? 880 : 440; volume.gain.value = silentFirst && n === 0 ? 0 : .025;
      source.connect(volume); volume.connect(destination); source.start(); await audio.resume();
      const stream = new MediaStream([...video.getVideoTracks(), ...destination.stream.getAudioTracks()]); fixture.captureStreams.push(stream);
      return stream;
    } });
  }, silentFirst);
  await page.route(workerRoute, route => route.fulfill({ contentType: 'application/javascript', body: workerBody }));
  await page.goto('/');
}
async function first(page: Page) { await page.getByLabel('강의 이름', { exact: true }).fill('강의 A'); await page.getByRole('button', { name: '화면 녹화 시작' }).click(); await expect(page.locator('.capture-panel')).toHaveCount(1); await expect(page.getByRole('button', { name: '다른 탭 강의 추가' })).toBeEnabled(); }
async function add(page: Page, name: string) { await page.getByLabel('추가 강의 이름').fill(name); await page.getByRole('button', { name: '다른 탭 강의 추가' }).click(); }
async function saved(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('lecturelens-v1'); r.onsuccess = () => resolve(r.result); });
    const read = (name: string) => new Promise<unknown[]>(resolve => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); });
    const sessions = await read('sessions') as { id: string; name: string; status: string; duration: number; settings: { autoStopMinutes: number } }[], chunks = await read('chunks') as { sessionId: string; samples: Float32Array; status: string }[], rows = await read('transcripts') as { sessionId: string; text: string }[], frames = await read('frames') as { sessionId: string; type: string }[];
    db.close();
    return sessions.map(s => {
      const pcm = chunks.find(c => c.sessionId === s.id && c.samples.length >= 4096)?.samples;
      const power = (f: number) => { let re = 0, im = 0; if (pcm) for (let i = 0; i < 4096; i++) { re += pcm[i] * Math.cos(2 * Math.PI * f * i / 16000); im += pcm[i] * Math.sin(2 * Math.PI * f * i / 16000); } return re * re + im * im; };
      return { ...s, low: power(440), high: power(880), samples: chunks.filter(c => c.sessionId === s.id).reduce((n, c) => n + c.samples.length, 0), texts: rows.filter(r => r.sessionId === s.id).map(r => r.text), frames: frames.filter(f => f.sessionId === s.id).map(f => f.type) };
    });
  });
}
test('isolated audio → separate lectures; pause, snapshot, stop do not affect the other', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await setup(page); await first(page); await add(page, '강의 B'); await expect(page.locator('.capture-panel')).toHaveCount(2);
  await page.waitForTimeout(6500);
  const data = await saved(page), a = data.find(s => s.name === '강의 A')!, b = data.find(s => s.name === '강의 B')!;
  expect(a.low).toBeGreaterThan(a.high * 100); expect(b.high).toBeGreaterThan(b.low * 100);
  const cardA = page.getByRole('region', { name: '강의 A 녹화', exact: true }), cardB = page.getByRole('region', { name: '강의 B 녹화', exact: true });
  await cardA.getByRole('button', { name: '일시 정지', exact: true }).click();
  const clockA = await cardA.locator('.capture-clock').textContent(), beforeB = await cardB.locator('.capture-clock').textContent();
  await page.waitForTimeout(1500); expect(await cardA.locator('.capture-clock').textContent()).toBe(clockA); expect(await cardB.locator('.capture-clock').textContent()).not.toBe(beforeB);
  await cardB.getByRole('button', { name: /장면 저장/ }).click();
  await cardA.getByRole('button', { name: '종료하고 정리하기' }).click(); await expect(page.locator('.capture-panel')).toHaveCount(1);
  await expect.poll(async () => (await saved(page)).find(s => s.name === '강의 A')!.status).toBe('complete');
  expect((await saved(page)).find(s => s.name === '강의 B')!.status).toBe('recording');
  await page.keyboard.press('F9'); await expect.poll(async () => (await saved(page)).find(s => s.name === '강의 B')!.frames.length).toBe(2);
  await cardB.getByRole('button', { name: '종료하고 정리하기' }).click();
  await expect.poll(async () => (await saved(page)).every(s => s.status === 'complete')).toBe(true);
  const done = await saved(page);
  expect(done.find(s => s.name === '강의 A')!.texts).toEqual(['강의 A의 분리된 자막입니다.']);
  expect(done.find(s => s.name === '강의 B')!.texts).toEqual(['강의 B의 분리된 자막입니다.']);
  expect(done.find(s => s.name === '강의 A')!.frames).toEqual([]); expect(done.every(s => s.samples === 0)).toBe(true);
  const requests = await page.evaluate(() => (window as unknown as { displayRequests: Record<string, unknown>[] }).displayRequests);
  expect(requests).toHaveLength(2); expect(requests[1]).toMatchObject({ systemAudio: 'exclude', surfaceSwitching: 'exclude', audio: { suppressLocalAudioPlayback: true } });
  expect(errors).toEqual([]);
});
test('cancel, window and duplicate selections preserve existing capture; four-tab limit and stop all', async ({ page }) => {
  await setup(page); await first(page);
  for (const mode of ['cancel', 'window', 'duplicate']) {
    await page.evaluate(mode => { (window as unknown as { captureMode: string }).captureMode = mode; }, mode);
    await add(page, '취소할 강의'); await expect(page.getByRole('alert')).toBeVisible(); await expect(page.getByRole('button', { name: '다른 탭 강의 추가' })).toBeEnabled();
    expect(await saved(page)).toHaveLength(1); await expect(page.locator('.capture-panel')).toHaveCount(1);
  }
  await page.evaluate(() => { (window as unknown as { captureMode: string }).captureMode = 'valid'; });
  for (const name of ['강의 B', '강의 C', '강의 D']) { await add(page, name); await expect(page.getByRole('button', { name: '다른 탭 강의 추가' })).toHaveText('다른 탭 강의 추가'); }
  await expect(page.locator('.capture-panel')).toHaveCount(4); await expect(page.getByRole('button', { name: '다른 탭 강의 추가' })).toBeDisabled();
  await page.waitForTimeout(1600); await page.getByRole('button', { name: '모두 종료·저장' }).click();
  await expect(page.locator('.capture-panel')).toHaveCount(0); await expect.poll(async () => (await saved(page)).every(s => s.status === 'complete')).toBe(true);
  expect(await saved(page)).toHaveLength(4);
  expect(await page.evaluate(async () => (await navigator.locks.query()).held?.some(l => l.name === 'lecturelens-capture'))).toBe(false);
});
test('silence auto-stop applies only to its own lecture', async ({ page }) => {
  test.setTimeout(120000); await setup(page, true); await first(page); await add(page, '강의 B');
  const cardA = page.getByRole('region', { name: '강의 A 녹화', exact: true });
  await cardA.getByText('녹화 중 촬영 설정 변경', { exact: true }).click();
  await cardA.getByRole('switch', { name: '무음 자동 종료·저장', exact: true }).check();
  await cardA.getByLabel('무음 자동 종료 시간 (분)', { exact: true }).fill('1');
  await expect(page.locator('.capture-panel')).toHaveCount(1, { timeout: 75000 });
  await expect.poll(async () => (await saved(page)).find(s => s.name === '강의 A')!.status, { timeout: 10000 }).toBe('complete');
  const rows = await saved(page);
  expect(rows.find(s => s.name === '강의 A')!.status).toBe('complete'); expect(rows.find(s => s.name === '강의 B')!.status).toBe('recording');
  expect(rows.find(s => s.name === '강의 B')!.settings.autoStopMinutes).toBe(0);
  await page.getByRole('button', { name: '종료하고 정리하기' }).click();
});
test('a rejected lecture does not block another lecture transcription', async ({ page }) => {
  await setup(page);
  await page.route(workerRoute, route => route.fulfill({ contentType: 'application/javascript', body: workerBody.replace("'강의 ' + key + '의 분리된 자막입니다.'", "key === 'A' ? '야'.repeat(400) : '강의 B의 분리된 자막입니다.'") }));
  await first(page); await add(page, '강의 B'); await page.waitForTimeout(6500);
  await page.getByRole('button', { name: '모두 종료·저장' }).click();
  await expect.poll(async () => (await saved(page)).find(s => s.name === '강의 B')!.status).toBe('complete');
  const rows = await saved(page), a = rows.find(s => s.name === '강의 A')!, b = rows.find(s => s.name === '강의 B')!;
  expect(a.status).toBe('interrupted'); expect(a.samples).toBeGreaterThan(16000 * 5); expect(a.texts).toEqual([]);
  expect(b.texts).toEqual(['강의 B의 분리된 자막입니다.']); expect(b.samples).toBe(0);
});
