import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
// Only this temporary test browser auto-selects its own fixture tabs.
// Normal app users must select every shared tab in the browser chooser.
const browser = await chromium.launch({ channel: 'chrome', headless: false, ignoreDefaultArgs: ['--mute-audio'], args: ['--auto-accept-this-tab-capture', '--window-position=-2400,0'] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } }), page = await context.newPage();
  await context.route('**/native-lecture-*', route => route.fulfill({ contentType: 'text/html', headers: { 'Cross-Origin-Opener-Policy': 'same-origin' }, body: `<!doctype html><title>Native lecture</title><h1>Native lecture</h1><button id="share">Share this lecture</button><p id="state"></p><script>
  document.querySelector('#share').onclick = async () => { try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'browser', frameRate: 5 }, audio: { suppressLocalAudioPlayback: true, echoCancellation: false, noiseSuppression: false, autoGainControl: false }, preferCurrentTab: true, selfBrowserSurface: 'include', systemAudio: 'exclude', monitorTypeSurfaces: 'exclude', surfaceSwitching: 'exclude' });
    const audio = new AudioContext(), source = audio.createOscillator(), gain = audio.createGain(); source.frequency.value = location.pathname.endsWith('1') ? 440 : 880; gain.gain.value = .025; source.connect(gain); gain.connect(audio.destination); source.start(); await audio.resume(); window.toneContext = audio;
    window.opener.deliverCapture(stream); document.querySelector('#state').textContent = JSON.stringify({ audio: stream.getAudioTracks().map(t => t.getSettings()), video: stream.getVideoTracks().map(t => t.getSettings()) });
  } catch(e) { document.querySelector('#state').textContent = String(e); } };
  </script>` }));
  await page.addInitScript(() => {
    localStorage.setItem('lens-consent', '1'); localStorage.setItem('lens-settings', JSON.stringify({ schemaVersion: 3, snapshotMode: 'manual', language: 'korean' }));
    let number = 0;
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: () => new Promise(resolve => {
      window.deliverCapture = resolve; window.open('/native-lecture-' + (++number), '_blank');
    }) });
  });
  await page.route(/\/assets\/transcriber-[^/]+\.js/, route => route.fulfill({ contentType: 'application/javascript', body: "self.onmessage=({data})=>self.postMessage({type:'result',chunks:[{text:'탭에서 녹음한 정상 시험 자막입니다.',timestamp:[0,data.audio.length/16000]}],device:'wasm'});" }));
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(process.env.LENS_TEST_URL || 'http://127.0.0.1:5175/');
  for (let n = 1; n <= 2; n++) {
    const popup = page.waitForEvent('popup');
    if (n === 1) { await page.getByLabel('강의 이름', { exact: true }).fill('네이티브 강의 A'); await page.getByRole('button', { name: '화면 녹화 시작' }).click(); }
    else { await page.getByLabel('추가 강의 이름').fill('네이티브 강의 B'); await page.getByRole('button', { name: '다른 탭 강의 추가' }).click(); }
    const child = await popup; await child.bringToFront(); await child.locator('#share').click();
    await child.waitForFunction(() => document.querySelector('#state').textContent.length > 0, undefined, { timeout: 20000 });
    const metadata = JSON.parse(await child.locator('#state').textContent());
    assert.equal(metadata.video[0].displaySurface, 'browser'); assert.equal(metadata.audio.length, 1); assert.equal(metadata.audio[0].suppressLocalAudioPlayback, true);
    console.log('Native tab', n, 'has isolated audio and local playback suppression.');
    await page.bringToFront(); await page.waitForFunction(n => document.querySelectorAll('.capture-panel').length === n && !document.querySelector('.parallel-add button').disabled, n, { timeout: 20000 });
  }
  await page.waitForTimeout(6500);
  const result = await page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('lecturelens-v1'); r.onsuccess = () => resolve(r.result); });
    const read = name => new Promise(resolve => { const r = db.transaction(name).objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); });
    const sessions = await read('sessions'), chunks = await read('chunks'); db.close();
    return sessions.map(s => { const a = chunks.find(c => c.sessionId === s.id && c.samples.length >= 4096)?.samples;
      const power = f => { let re=0,im=0; if(a) for(let i=0;i<4096;i++){re+=a[i]*Math.cos(2*Math.PI*f*i/16000);im+=a[i]*Math.sin(2*Math.PI*f*i/16000);}return re*re+im*im; };
      return { name:s.name, status:s.status, low:power(440), high:power(880), samples:chunks.filter(c=>c.sessionId===s.id).reduce((n,c)=>n+c.samples.length,0) }; });
  });
  console.log(JSON.stringify(result));
  assert.equal(result.length, 2); const a=result.find(s=>s.name.endsWith('A')),b=result.find(s=>s.name.endsWith('B'));
  assert(a.low > a.high * 100 && a.low > 1); assert(b.high > b.low * 100 && b.high > 1);
  await page.getByRole('region', { name: '네이티브 강의 A 녹화', exact: true }).getByRole('button', { name: '작은 상태 창' }).click();
  await page.waitForFunction(() => !!window.documentPictureInPicture.window?.document.querySelector('.mini-lecture-select'));
  await page.evaluate(() => {
    const pip = window.documentPictureInPicture.window, select = pip.document.querySelector('select');
    select.value = select.options[1].value; select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => window.documentPictureInPicture.window.document.querySelector('select').selectedOptions[0].textContent === '네이티브 강의 B');
  await page.evaluate(() => [...window.documentPictureInPicture.window.document.querySelectorAll('button')].find(b => b.textContent.includes('일시 정지')).click());
  const cardA = page.getByRole('region', { name: '네이티브 강의 A 녹화', exact: true });
  const cardB = page.getByRole('region', { name: '네이티브 강의 B 녹화', exact: true });
  await cardB.getByRole('button', { name: '계속 녹화' }).waitFor();
  const clockB = await cardB.locator('.capture-clock').textContent(), clockA = await cardA.locator('.capture-clock').textContent();
  await page.waitForTimeout(1500);
  assert.equal(await cardB.locator('.capture-clock').textContent(), clockB); assert.notEqual(await cardA.locator('.capture-clock').textContent(), clockA);
  await page.evaluate(() => [...window.documentPictureInPicture.window.document.querySelectorAll('button')].find(b => b.textContent === '계속').click());
  await cardB.getByRole('button', { name: '일시 정지', exact: true }).waitFor();
  await page.evaluate(() => window.documentPictureInPicture.window.close());
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await page.screenshot({ path: '../lecturelens-native-tabs.png', fullPage: true });
  await page.getByRole('button', { name: '모두 종료·저장' }).click();
  await page.waitForFunction(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('lecturelens-v1'); r.onsuccess = () => resolve(r.result); });
    const sessions = await new Promise(resolve => { const r = db.transaction('sessions').objectStore('sessions').getAll(); r.onsuccess = () => resolve(r.result); }); db.close();
    return sessions.length === 2 && sessions.every(s => s.status === 'complete');
  }, undefined, { timeout: 20000 });
  assert.deepEqual(errors, []);
  await mkdir('qa-results', { recursive: true });
  await writeFile('qa-results/native-tabs.json', JSON.stringify({ result, errors, miniSelection: 'B paused independently', completed: 2, transcription: 'mocked' }, null, 2));
  console.log('Native Chrome tab isolation, mini-window selection and independent completion passed.');
} finally { await browser.close(); }
