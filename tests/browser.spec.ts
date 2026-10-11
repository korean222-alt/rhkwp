import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { realBrowser } from './real-browser';
test('demo → edit → frame query → ZIP → refresh → delete', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await expect(page.getByRole('heading', { name: '강의는 흐르고,' })).toBeVisible();
  await page.screenshot({ path: 'test-results/home.png', fullPage: true });
  await page.getByRole('button', { name: '예시 강의 둘러보기' }).click();
  await expect(page.getByRole('heading', { name: '경제학 첫걸음 · 수요와 공급' })).toBeVisible();
  await page.getByRole('button', { name: '00:00:46 자막 수정' }).click();
  await page.getByRole('textbox', { name: '자막 수정', exact: true }).fill('이 그래프를 보시면 시장의 균형이 나타납니다.');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByText('이 그래프를 보시면 시장의 균형이 나타납니다.', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '조회할 시각' }).fill('00:00:46');
  await page.getByRole('button', { name: '시점 화면 보기' }).click();
  await expect(page.getByRole('heading', { name: '00:00:45의 화면' })).toBeVisible();
  await expect(page.getByRole('img', { name: '00:00:45 스냅샷' })).toBeVisible();
  await page.getByRole('button', { name: '닫기', exact: true }).click();
  await page.getByRole('tab', { name: '통합 노트' }).click();
  await expect(page.locator('.combined-note')).toContainText('시장 균형');
  // Turn off only the native save dialog to exercise the portable ZIP fallback.
  await page.evaluate(() => { (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = undefined; });
  const dl = page.waitForEvent('download'); await page.getByRole('button', { name: '전체 ZIP 다운로드' }).click();
  const file = await dl; expect(file.suggestedFilename()).toContain('.zip');
  await file.saveAs('test-results/demo.zip');
  await page.reload(); await page.getByRole('button', { name: '내 강의', exact: false }).first().click();
  await page.getByRole('button', { name: /경제학 첫걸음/ }).click();
  await expect(page.getByText('이 그래프를 보시면 시장의 균형이 나타납니다.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '이 강의 삭제' }).click(); await page.getByRole('button', { name: '강의 삭제', exact: true }).click();
  await expect(page.getByRole('heading', { name: '아직 저장된 강의가 없어요' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('lecture data survives Chrome closing and reopening with the same profile', async ({ baseURL }) => {
  const profile = await mkdtemp(join(tmpdir(), 'lecturelens-restart-'));
  let context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true });
  try {
    const page = context.pages()[0]; await page.goto(baseURL!);
    await page.getByRole('button', { name: '예시 강의 둘러보기' }).click();
    await expect(page.getByRole('heading', { name: '경제학 첫걸음 · 수요와 공급' })).toBeVisible();
    await page.getByRole('button', { name: '00:00:46 자막 수정' }).click();
    await page.getByRole('textbox', { name: '자막 수정', exact: true }).fill('브라우저를 다시 열어도 남는 자막입니다.');
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await expect(page.getByText('브라우저를 다시 열어도 남는 자막입니다.', { exact: true })).toBeVisible();
    await context.close();
    context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true });
    const reopened = context.pages()[0]; await reopened.goto(baseURL!);
    await reopened.getByRole('button', { name: '내 강의', exact: false }).first().click();
    await reopened.getByRole('button', { name: /경제학 첫걸음/ }).click();
    await expect(reopened.getByText('브라우저를 다시 열어도 남는 자막입니다.', { exact: true })).toBeVisible();
  } finally {
    await context.close();
    const target = resolve(profile), allowed = resolve(tmpdir()) + sep + 'lecturelens-restart-';
    if (!target.startsWith(allowed)) throw new Error('Unexpected restart test profile path');
    await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
test('responsive settings and analysis consent', async ({ page }) => {
  await page.addInitScript(() => { if (!localStorage.getItem('lens-settings')) localStorage.setItem('lens-settings', JSON.stringify({ interval: 10, language: 'auto', width: 640 })); });
  await page.goto('/'); await page.getByRole('button', { name: '설정', exact: true }).click();
  await expect(page.getByLabel('강의 언어', { exact: true })).toHaveValue('korean');
  await expect(page.getByLabel('자동 촬영', { exact: true })).toHaveValue('scene');
  await expect(page.getByLabel('자막 영역 감지 제외', { exact: true })).toHaveValue('25');
  await expect(page.getByLabel('주기 스냅샷 간격', { exact: true })).toHaveCount(0);
  await page.getByLabel('자동 촬영', { exact: true }).selectOption('interval');
  await expect(page.getByLabel('주기 스냅샷 간격', { exact: true })).toHaveValue('10');
  await page.getByLabel('자동 촬영', { exact: true }).selectOption('manual');
  await page.getByRole('button', { name: /base 정확도/ }).click();
  await page.reload(); await page.getByRole('button', { name: '설정', exact: true }).click();
  await expect(page.getByRole('button', { name: /base 정확도/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('자동 촬영', { exact: true })).toHaveValue('manual');
  await page.getByRole('button', { name: '시작하기', exact: true }).click(); await page.getByRole('button', { name: '예시 강의 둘러보기' }).click();
  await page.getByRole('tab', { name: 'AI 분석' }).click();
  await expect(page.getByRole('button', { name: '분석 시작', exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
});

for (const mode of ['scene', 'manual'] as const) test(`snapshot ${mode}: subtitles do not trigger photos; manual capture works`, async ({ page }) => {
  await page.addInitScript(mode => {
    localStorage.setItem('lens-consent', '1');
    localStorage.setItem('lens-settings', JSON.stringify({ schemaVersion: 2, ocr: false, snapshotMode: mode }));
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: async () => {
      const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#fafbf6'; ctx.fillRect(0, 0, 1280, 720);
      ctx.fillStyle = '#234c32'; ctx.font = '36px sans-serif'; ctx.fillText('Stable lecture slide', 50, 100);
      let caption = 0;
      setInterval(() => { ctx.fillStyle = '#222'; ctx.fillRect(0, 600, 1280, 120); ctx.fillStyle = 'white'; ctx.fillText(`Changing subtitle ${caption++}`, 120, 660); }, 700);
      (window as unknown as { changeSlide: () => void }).changeSlide = () => { ctx.fillStyle = '#345'; ctx.fillRect(0, 0, 1280, 540); };
      const video = canvas.captureStream(2), audio = new AudioContext();
      const destination = audio.createMediaStreamDestination(), silence = audio.createConstantSource();
      silence.offset.value = 0; silence.connect(destination); silence.start(); await audio.resume();
      return new MediaStream([...video.getVideoTracks(), ...destination.stream.getAudioTracks()]);
    } });
  }, mode);
  const count = () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('lecturelens-v1'); r.onsuccess = () => resolve(r.result); });
    const rows = await new Promise<{ type: string }[]>(resolve => { const r = db.transaction('frames').objectStore('frames').getAll(); r.onsuccess = () => resolve(r.result); });
    db.close(); return rows.map(r => r.type);
  });
  await page.goto('/'); await page.getByRole('button', { name: '화면 녹화 시작' }).click();
  await expect(page.locator('.capture-panel')).toBeVisible(); await page.waitForTimeout(12000);
  expect(await count()).toEqual(mode === 'scene' ? ['scene'] : []);
  await page.evaluate(() => (window as unknown as { changeSlide: () => void }).changeSlide());
  if (mode === 'scene') await expect.poll(async () => (await count()).length).toBe(2);
  else { await page.waitForTimeout(2500); expect(await count()).toEqual([]); }
  await page.keyboard.press('F9'); await expect.poll(async () => (await count()).filter(t => t === 'manual').length).toBe(1);
  await page.getByRole('button', { name: '종료하고 정리하기' }).click();
  await expect(page.getByRole('button', { name: '전체 ZIP 다운로드' })).toBeEnabled();
});
test('screen + silent audio worklet → pause → manual snapshot → finish', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lens-consent', '1');
    localStorage.setItem('lens-settings', JSON.stringify({ ocr: false }));
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: async () => {
      const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#fafbf6'; ctx.fillRect(0, 0, 1280, 720); ctx.fillStyle = '#234c32'; ctx.font = '32px sans-serif'; ctx.fillText('Synthetic capture fixture', 50, 100);
      const video = canvas.captureStream(2); const audio = new AudioContext();
      const destination = audio.createMediaStreamDestination(), silence = audio.createConstantSource(); silence.offset.value = 0; silence.connect(destination); silence.start(); await audio.resume();
      return new MediaStream([...video.getVideoTracks(), ...destination.stream.getAudioTracks()]);
    } });
  });
  await page.goto('/'); await page.getByRole('button', { name: '화면 녹화 시작' }).click();
  await expect(page.getByText('강의를 캡처하고 있어요', { exact: true })).toBeVisible();
  await page.waitForTimeout(6200);
  await page.getByRole('button', { name: '일시 정지', exact: true }).click();
  const clock = await page.locator('.capture-clock').textContent(); await page.waitForTimeout(1200);
  expect(await page.locator('.capture-clock').textContent()).toBe(clock);
  await page.getByRole('button', { name: '계속 녹화' }).click();
  await page.keyboard.press('F9'); await page.waitForTimeout(400);
  await page.getByRole('button', { name: '종료하고 정리하기' }).click();
  await expect(page.getByRole('button', { name: '전체 ZIP 다운로드' })).toBeEnabled({ timeout: 30000 });
  await page.getByRole('tab', { name: /장면/ }).click();
  await expect(page.getByText('수동 저장', { exact: true })).toBeVisible();
});
test('missing shared audio has a visible warning', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lens-consent', '1'); localStorage.setItem('lens-settings', JSON.stringify({ ocr: false }));
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: async () => {
      const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 540;
      canvas.getContext('2d')!.fillRect(0, 0, 960, 540); return canvas.captureStream(1);
    } });
  });
  await page.goto('/'); await page.getByRole('button', { name: '화면 녹화 시작' }).click();
  await expect(page.getByText('소리가 공유되지 않았습니다.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '종료하고 정리하기' }).click();
});

test('rejected transcription keeps source audio and offers retry after refresh', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('lens-consent', '1'); localStorage.setItem('lens-settings', JSON.stringify({ schemaVersion: 2, ocr: false, language: 'korean' })); });
  await page.route(/\/(?:assets\/transcriber-[^/]+\.js|src\/workers\/transcriber\.ts)(?:\?|$)/, route => route.fulfill({
    contentType: 'application/javascript', body: "self.onmessage = () => self.postMessage({ type: 'error', message: '반복 오류로 인식 결과를 확정하지 않았습니다. 원음은 보관됩니다.' });",
  }));
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser'); await page.getByRole('button', { name: '파일 가져오기' }).click();
  await (await chooser).setFiles('tests/fixtures/korean.wav');
  await expect(page.getByRole('button', { name: '저장된 구간 다시 처리' })).toBeVisible({ timeout: 30000 });
  const saved = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('lecturelens-v1'); r.onsuccess = () => resolve(r.result); });
    const read = (name: string) => new Promise<unknown[]>(resolve => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); });
    const chunks = await read('chunks') as { status: string; samples: Float32Array }[], rows = await read('transcripts'), sessions = await read('sessions') as { status: string }[];
    db.close(); return { states: chunks.map(c => c.status), samples: chunks.reduce((n, c) => n + c.samples.length, 0), transcripts: rows.length, status: sessions[0].status };
  });
  expect(saved.states.every(s => s === 'error')).toBe(true); expect(saved.samples).toBeGreaterThan(16000 * 13);
  expect(saved.transcripts).toBe(0); expect(saved.status).toBe('interrupted');
  await page.reload(); await page.getByRole('button', { name: '내 강의', exact: false }).first().click();
  await page.getByRole('button', { name: /korean/ }).click();
  await expect(page.getByText('반복 오류로 인식 결과를 확정하지 않았습니다. 원음은 보관됩니다.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '저장된 구간 다시 처리' })).toBeVisible();
});
test('background tab saves audio and static scenes; mini window controls capture', async ({ baseURL }) => {
  test.setTimeout(120000);
  const browser = await realBrowser(), { context, page } = browser;
  try {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('lens-consent', '1');
    localStorage.setItem('lens-settings', JSON.stringify({ ocr: false, interval: 5 }));
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: async () => {
      const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#fafbf6'; ctx.fillRect(0, 0, 1280, 720);
      ctx.fillStyle = '#234c32'; ctx.font = '36px sans-serif'; ctx.fillText('Static slide in background', 50, 100);
      const video = canvas.captureStream(2), audio = new AudioContext();
      const destination = audio.createMediaStreamDestination(), silence = audio.createConstantSource();
      silence.offset.value = 0; silence.connect(destination); silence.start(); await audio.resume();
      return new MediaStream([...video.getVideoTracks(), ...destination.stream.getAudioTracks()]);
    } });
  });
  await page.goto(baseURL!); await page.getByRole('button', { name: '화면 녹화 시작' }).click();
  await expect(page.getByText('강의를 캡처하고 있어요', { exact: true })).toBeVisible();
  await expect(page.getByText('이 브라우저에서는 백그라운드', { exact: false })).toHaveCount(0);
  const other = await context.newPage(); await other.goto('about:blank'); await other.bringToFront();
  expect(await page.evaluate(() => document.hidden)).toBe(true);
  console.log('Real Chrome: app tab is hidden.');
  await page.waitForTimeout(65000);
  const stored = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('lecturelens-v1'); r.onsuccess = () => resolve(r.result); });
    const read = (name: string) => new Promise<unknown[]>(resolve => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); });
    const sessions = await read('sessions') as { duration: number }[], frames = await read('frames') as { sec: number }[]; db.close();
    return { duration: sessions[0].duration, frames: frames.length, frameTimes: frames.map(f => f.sec).sort((a,b) => a-b) };
  });
  console.log('Hidden-tab persistence:', stored);
  expect(stored.duration).toBeGreaterThanOrEqual(60); expect(stored.frames).toBe(1);
  await page.bringToFront(); await page.getByRole('button', { name: '작은 상태 창' }).click();
  await page.waitForFunction(() => !!(window as unknown as { documentPictureInPicture: { window?: Window } }).documentPictureInPicture.window?.document.querySelector('.mini-clock'));
  await page.evaluate(() => {
    const pip = (window as unknown as { documentPictureInPicture: { window: Window } }).documentPictureInPicture.window;
    [...pip.document.querySelectorAll('button')].find(b => b.textContent?.includes('일시 정지'))!.click();
  });
  await expect(page.getByRole('button', { name: '계속 녹화' })).toBeVisible();
  await page.evaluate(() => (window as unknown as { documentPictureInPicture: { window: Window } }).documentPictureInPicture.window.close());
  await expect(page.locator('.capture-panel')).toBeVisible();
  await page.getByRole('button', { name: '계속 녹화' }).click(); await page.getByRole('button', { name: '종료하고 정리하기' }).click();
  await expect(page.getByRole('button', { name: '전체 ZIP 다운로드' })).toBeEnabled({ timeout: 30000 });
  expect(errors).toEqual([]); await other.close();
  } finally { await browser.close(); }
});
test('BYOK sends only to Anthropic and completes an OCR tool loop', async ({ page }) => {
  const bodies: Record<string, unknown>[] = []; let requests = 0;
  await page.route('https://api.anthropic.com/**', async route => {
    const req = route.request();
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'content-type': 'application/json' };
    if (req.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
    expect(req.headers()['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(req.headers()['x-api-key']).toBe('test-key-not-real'); bodies.push(req.postDataJSON()); requests++;
    const content = requests === 1 ? [{ type: 'tool_use', id: 'toolu_test', name: 'get_ocr', input: { time: '00:00:46' } }] : [{ type: 'text', text: '[00:00:45] 시장 균형은 수요 곡선과 공급 곡선의 교점입니다.' }];
    await route.fulfill({ status: 200, headers, body: JSON.stringify({ id: `msg_${requests}`, type: 'message', role: 'assistant', model: 'test-model', content, stop_reason: requests === 1 ? 'tool_use' : 'end_turn', stop_sequence: null, usage: { input_tokens: 200, output_tokens: 40 } }) });
  });
  await page.goto('/'); await page.getByRole('button', { name: '예시 강의 둘러보기' }).click(); await page.getByRole('tab', { name: 'AI 분석' }).click();
  await page.getByLabel('Claude API 키', { exact: true }).fill('test-key-not-real'); await page.getByLabel('모델 ID', { exact: true }).fill('test-model');
  await page.getByLabel('전송할 자료와 범위를 확인했습니다.').check(); await page.getByRole('button', { name: '분석 시작', exact: true }).click();
  await expect(page.locator('.answer')).toContainText('시장 균형은 수요 곡선과 공급 곡선의 교점입니다.');
  expect(requests).toBe(2); expect(JSON.stringify(bodies[1])).toContain('두 곡선의 교점');
  expect(JSON.stringify(bodies)).not.toContain('base64');
});
