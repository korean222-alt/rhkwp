import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
const settings = { schemaVersion: 4, model: 'tiny', device: 'auto', language: 'korean', autoStopMinutes: 0, snapshotMode: 'scene', ignoreBottom: 25, sceneThreshold: 14, interval: 10, width: 960, quality: .7, saveImages: true, ocr: false, ocrWidth: 1920, keywords: ['여기'] };
async function readDatabase(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('lecturelens-v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const get = <T>(name: string) => new Promise<T[]>((resolve, reject) => { const r = database.transaction(name).objectStore(name).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const result: Record<string, unknown[]> = {};
    for (const name of ['folders', 'sessions', 'transcripts', 'frames', 'chunks']) {
      const rows = await get<Record<string, unknown>>(name);
      result[name] = await Promise.all(rows.map(async r => {
        const out = { ...r };
        for (const key of ['image', 'ocrImage', 'samples']) {
          const binary = r[key]; if (!binary) continue;
          const bytes = binary instanceof Blob ? await binary.arrayBuffer() : (binary as Float32Array).buffer as ArrayBuffer;
          out[key] = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
        }
        return out;
      }));
    }
    database.close(); return result;
  });
}
async function goSettings(page: Page) { await page.getByRole('button', { name: '설정', exact: true }).click(); await expect(page.getByRole('heading', { name: '내 데이터 가져가기' })).toBeVisible(); }
async function backup(page: Page, path: string) {
  await goSettings(page); await page.evaluate(() => { (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = undefined; });
  const pending = page.waitForEvent('download'); await page.getByRole('button', { name: '전체 백업 ZIP 받기' }).click();
  const file = await pending; await file.saveAs(path); await expect(page.getByRole('status')).toContainText('저장 완료'); return path;
}
async function restore(page: Page, path: string) {
  await page.getByLabel('백업 ZIP 선택', { exact: true }).setInputFiles(path);
  await expect(page.getByRole('heading', { name: '복원할 백업' })).toBeVisible();
  await page.getByRole('button', { name: '선택한 백업 복원' }).click();
  await expect(page.getByRole('status')).toContainText('복원 완료');
}
test('whole backup → another profile → repeat → replace → erase, including nested folders and PCM', async ({ page, browser, baseURL }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await page.getByRole('button', { name: '예시 강의 둘러보기' }).click();
  await page.getByRole('button', { name: '00:00:46 자막 수정' }).click(); await page.getByRole('textbox', { name: '자막 수정', exact: true }).fill('전체 백업으로 옮긴 시장 균형 자막'); await page.getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('switch', { name: '타임라인', exact: true }).click();
  await page.getByRole('button', { name: '내 강의로', exact: true }).click();
  await page.getByRole('textbox', { name: '새 폴더 이름' }).fill('2026년 2학기'); await page.getByRole('button', { name: '폴더 만들기' }).click();
  await expect(page.getByRole('combobox', { name: '폴더 보기' })).not.toHaveValue('*');
  await page.getByRole('textbox', { name: '새 폴더 이름' }).fill('경제학'); await page.getByRole('button', { name: '폴더 만들기' }).click();
  await expect(page.getByRole('combobox', { name: '폴더 보기' }).locator('option')).toContainText(['모든 강의', '미분류', '2026년 2학기', '2026년 2학기 / 경제학']);
  const child = await page.getByRole('combobox', { name: '폴더 보기' }).inputValue();
  await page.getByRole('combobox', { name: '폴더 보기' }).selectOption('*');
  await page.getByRole('combobox', { name: '경제학 첫걸음 · 수요와 공급 폴더' }).selectOption(child);
  await page.evaluate(async ({ child, settings }) => {
    const database = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('lecturelens-v1'); r.onsuccess = () => resolve(r.result); });
    const tx = database.transaction(['sessions', 'chunks'], 'readwrite');
    const samples = Float32Array.from({ length: 16000 }, (_, i) => .1 * Math.sin(i / 9));
    tx.objectStore('sessions').put({ id: 'pending-lecture', name: '미처리 테스트', folderId: child, createdAt: 100, updatedAt: 100, status: 'interrupted', source: 'file', duration: 1, bytes: samples.byteLength, settings, warning: '테스트 실패 구간' });
    tx.objectStore('chunks').put({ id: 'pending-audio', sessionId: 'pending-lecture', start: 0, duration: 1, samples, status: 'error', error: '테스트 실패' });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); database.close();
    localStorage.setItem('lens-ai-key', 'BACKUP-MUST-NOT-CONTAIN-THIS-FAKE-KEY'); sessionStorage.setItem('lens-ai-key', 'FAKE-SESSION-KEY'); localStorage.setItem('unrelated-setting', 'keep'); window.dispatchEvent(new Event('lens:changed'));
  }, { child, settings });
  await expect(page.getByRole('button', { name: '미처리 테스트 강의 열기' })).toBeVisible();
  await page.getByRole('textbox', { name: '강의와 자막 전체 검색' }).fill('시장 균형');
  await page.locator('.search-result').filter({ hasText: '전체 백업으로 옮긴' }).click();
  await expect(page.locator('.search-focus')).toContainText('전체 백업으로 옮긴 시장 균형 자막');
  const original = await readDatabase(page), path = await backup(page, 'test-results/portable-backup.zip');
  const entries = unzipSync(new Uint8Array(await readFile(path)));
  const manifest = JSON.parse(strFromU8(entries['manifest.json']));
  expect(manifest.folders).toHaveLength(2); expect(manifest.sessions).toHaveLength(2); expect(manifest.chunks[0].samples).toMatch(/\.f32$/);
  expect(strFromU8(entries['manifest.json'])).not.toContain('KEY');
  const target = await browser.newContext(); const other = await target.newPage(); other.on('pageerror', e => errors.push(e.message));
  try {
    await other.goto(baseURL!); await goSettings(other); await restore(other, path);
    expect(await readDatabase(other)).toEqual(original); expect(await other.evaluate(() => localStorage.getItem('lens-ai-key'))).toBeNull();
    await restore(other, path); await expect(other.getByRole('status')).toContainText('기존 2개 유지'); expect(await readDatabase(other)).toEqual(original);
    await other.getByRole('button', { name: '내 강의', exact: true }).click();
    await other.getByRole('button', { name: '경제학 첫걸음 · 수요와 공급 강의 열기' }).click();
    await expect(other.getByRole('switch', { name: '타임라인', exact: true })).toHaveAttribute('aria-checked', 'false');
    await other.getByRole('button', { name: '00:00:46 자막 수정' }).click(); await other.getByRole('textbox', { name: '자막 수정', exact: true }).fill('교체 전 내용'); await other.getByRole('button', { name: '저장', exact: true }).click();
    await goSettings(other); await other.getByLabel('백업 ZIP 선택', { exact: true }).setInputFiles(path); await other.getByRole('checkbox', { name: '현재 폴더와 강의 자료를 백업 내용으로 모두 교체' }).check();
    await expect(other.getByRole('button', { name: '선택한 백업 복원' })).toBeDisabled(); await other.getByRole('textbox', { name: '교체 복원 확인' }).fill('복원'); await other.getByRole('button', { name: '선택한 백업 복원' }).click(); await expect(other.getByRole('status')).toContainText('복원 완료'); expect(await readDatabase(other)).toEqual(original);
    await other.screenshot({ path: 'test-results/backup-desktop.png', fullPage: true });
    await other.setViewportSize({ width: 390, height: 844 }); await other.screenshot({ path: 'test-results/backup-mobile.png', fullPage: true }); expect(await other.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await other.evaluate(async () => {
      localStorage.setItem('lens-ai-key', 'ERASE-FAKE-KEY'); sessionStorage.setItem('lens-ai-key', 'ERASE-SESSION'); localStorage.setItem('unrelated-setting', 'keep');
      const cache = await caches.open('transformers-cache'); await cache.put('/fake-model', new Response('test model'));
      const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('keyval-store', 1); r.onupgradeneeded = () => r.result.createObjectStore('keyval'); r.onsuccess = () => resolve(r.result); });
      const tx = db.transaction('keyval', 'readwrite'); tx.objectStore('keyval').put('model', 'lecturelens-image-text-v1/kor.traineddata'); tx.objectStore('keyval').put('unrelated', 'other-cache'); await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); }); db.close();
    });
    await other.getByRole('button', { name: '내 데이터 전체 삭제' }).click(); await expect(other.getByRole('button', { name: '모두 삭제', exact: true })).toBeDisabled();
    await other.getByRole('textbox', { name: '전체 삭제 확인' }).fill('삭제'); await other.getByRole('button', { name: '모두 삭제', exact: true }).click(); await expect(other.getByRole('heading', { name: '강의는 흐르고,' })).toBeVisible();
    expect(await readDatabase(other)).toEqual({ folders: [], sessions: [], transcripts: [], frames: [], chunks: [] });
    expect(await other.evaluate(async () => ({ key: localStorage.getItem('lens-ai-key'), sessionKey: sessionStorage.getItem('lens-ai-key'), cache: await caches.has('transformers-cache'), other: localStorage.getItem('unrelated-setting') }))).toEqual({ key: null, sessionKey: null, cache: false, other: 'keep' });
    expect(await other.evaluate(async () => {
      const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('keyval-store'); r.onsuccess = () => resolve(r.result); });
      const get = (key: string) => new Promise(resolve => { const r = db.transaction('keyval').objectStore('keyval').get(key); r.onsuccess = () => resolve(r.result); });
      const result = { own: await get('lecturelens-image-text-v1/kor.traineddata'), other: await get('other-cache') }; db.close(); return result;
    })).toEqual({ own: undefined, other: 'unrelated' });
    expect(await readDatabase(page)).toEqual(original); expect(errors).toEqual([]);
  } finally { await target.close(); }
});
test('corrupt and malicious ZIPs fail without changing existing lecture data; collision is atomic', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: '예시 강의 둘러보기' }).click();
  await expect(page.getByRole('heading', { name: '경제학 첫걸음 · 수요와 공급' })).toBeVisible();
  const original = await readDatabase(page), path = await backup(page, 'test-results/validation-backup.zip');
  const entries = unzipSync(new Uint8Array(await readFile(path))), first = Object.keys(entries).find(n => n !== 'manifest.json')!;
  const corrupt = { ...entries, [first]: entries[first].slice() }; corrupt[first][5] ^= 1;
  await page.getByLabel('백업 ZIP 선택', { exact: true }).setInputFiles({ name: 'corrupt.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync(corrupt, { level: 0 })) });
  await page.getByRole('button', { name: '선택한 백업 복원' }).click(); await expect(page.getByRole('alert')).toContainText('무결성'); expect(await readDatabase(page)).toEqual(original);
  const manifest = JSON.parse(strFromU8(entries['manifest.json'])); const oldId = manifest.sessions[0].id; manifest.sessions[0].id = 'new-conflicting-session';
  for (const name of ['transcripts', 'frames', 'chunks']) for (const row of manifest[name]) if (row.sessionId === oldId) row.sessionId = 'new-conflicting-session';
  manifest.folders = [{ id: 'should-roll-back', name: '저장되면 안 되는 폴더', createdAt: 1 }];
  await page.getByLabel('백업 ZIP 선택', { exact: true }).setInputFiles({ name: 'collision.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync({ ...entries, 'manifest.json': strToU8(JSON.stringify(manifest)) }, { level: 0 })) });
  await page.getByRole('button', { name: '선택한 백업 복원' }).click(); await expect(page.getByRole('alert')).toContainText('ID가 충돌'); expect(await readDatabase(page)).toEqual(original);
  await page.getByRole('checkbox', { name: '현재 폴더와 강의 자료를 백업 내용으로 모두 교체' }).check(); await page.getByRole('textbox', { name: '교체 복원 확인' }).fill('복원');
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) {
      if (this.name === 'sessions') throw new DOMException('테스트 저장 공간 부족', 'QuotaExceededError');
      return key === undefined ? original.call(this, value) : original.call(this, value, key);
    };
  });
  await page.getByRole('button', { name: '선택한 백업 복원' }).click(); await expect(page.getByRole('alert')).toContainText('테스트 저장 공간 부족'); expect(await readDatabase(page)).toEqual(original);
  await page.getByLabel('백업 ZIP 선택', { exact: true }).setInputFiles({ name: 'traversal.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync({ ...entries, '../escape.txt': strToU8('bad') }, { level: 0 })) }); await expect(page.getByRole('alert')).toContainText('허용되지 않는 파일'); expect(await readDatabase(page)).toEqual(original);
});
test('backup refuses concurrent work in another app tab', async ({ page }) => {
  await page.goto('/'); await goSettings(page); await page.evaluate(() => {
    void navigator.locks.request('lecturelens-processing', () => new Promise(() => {}));
    (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = undefined;
  });
  await page.getByRole('button', { name: '전체 백업 ZIP 받기' }).click(); await expect(page.getByRole('alert')).toContainText('다른 LectureLens 탭에서 음성을 처리');
});
test('existing version 1 database upgrades without losing lecture records', async ({ page }) => {
  await page.goto('/favicon.svg'); await page.evaluate(async settings => {
    const db = await new Promise<IDBDatabase>(resolve => {
      const r = indexedDB.open('lecturelens-v1', 1); r.onupgradeneeded = () => {
        r.result.createObjectStore('sessions', { keyPath: 'id' });
        for (const name of ['chunks', 'frames', 'transcripts']) r.result.createObjectStore(name, { keyPath: 'id' }).createIndex('sessionId', 'sessionId');
      }; r.onsuccess = () => resolve(r.result);
    });
    const tx = db.transaction('sessions', 'readwrite'); tx.objectStore('sessions').put({ id: 'legacy', name: '기존 강의 유지', createdAt: 1, updatedAt: 1, status: 'complete', duration: 0, settings, source: 'screen', bytes: 0 }); await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); }); db.close();
  }, settings);
  await page.goto('/'); await page.getByRole('button', { name: '내 강의', exact: true }).click(); await expect(page.getByRole('button', { name: '기존 강의 유지 강의 열기' })).toBeVisible(); expect((await readDatabase(page)).folders).toEqual([]);
});
