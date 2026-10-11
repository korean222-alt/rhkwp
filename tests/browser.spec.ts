import { test, expect } from '@playwright/test';
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
test('responsive settings and analysis consent', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: '설정', exact: true }).click();
  await page.getByRole('button', { name: /base 정확도/ }).click();
  await page.reload(); await page.getByRole('button', { name: '설정', exact: true }).click();
  await expect(page.getByRole('button', { name: /base 정확도/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '시작하기', exact: true }).click(); await page.getByRole('button', { name: '예시 강의 둘러보기' }).click();
  await page.getByRole('tab', { name: 'AI 분석' }).click();
  await expect(page.getByRole('button', { name: '분석 시작', exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
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
  expect(stored.duration).toBeGreaterThanOrEqual(60); expect(stored.frames).toBeGreaterThanOrEqual(11);
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
