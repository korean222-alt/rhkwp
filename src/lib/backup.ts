import { strToU8 } from 'fflate';
import * as db from './db';
import type { AudioChunk, Frame, Settings } from '../types';
import { normalizeSettings } from './settings';
import { withMaintenance } from './maintenance';
import { validateManifest, type BackupManifest } from './backup-schema';
import { createBackupWriter, readEntry, sha256, zipIndex, type ZipEntry } from './backup-zip';
export type BackupPreview = { file: File; manifest: BackupManifest; entries: Map<string, ZipEntry> };
export async function exportBackup(settings: Settings, progress: (message: string) => void) {
  // Request the native file picker before awaiting storage/locks (user activation).
  const writer = await createBackupWriter();
  try {
    await withMaintenance(async () => {
      const manifest: BackupManifest = { format: 'lecturelens-backup', version: 1, appVersion: '1.4.0', createdAt: Date.now(),
        settings: normalizeSettings(settings), folders: await db.listFolders(), sessions: [], transcripts: [], frames: [], chunks: [], attachments: [] };
      let next = 0;
      const attach = async (data: Uint8Array<ArrayBuffer>, mime: BackupManifest['attachments'][number]['mime']) => {
        const ext = mime === 'application/x-float32-le' ? 'f32' : mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp';
        const path = `data/${++next}.${ext}`;
        manifest.attachments.push({ path, bytes: data.length, mime, sha256: await sha256(data) }); await writer.add(path, data); return path;
      };
      const image = async (blob: Blob | undefined) => {
        if (!blob) return undefined;
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) throw new Error('지원하지 않는 저장 이미지 형식입니다.');
        return attach(new Uint8Array(await blob.arrayBuffer()), blob.type as 'image/jpeg' | 'image/png' | 'image/webp');
      };
      for (const session of await db.listSessions()) {
        progress(`${session.name} 백업 중…`);
        manifest.sessions.push({ ...session, settings: normalizeSettings(session.settings) });
        manifest.transcripts.push(...await db.transcripts(session.id));
        for (const meta of await db.frameMeta(session.id)) {
          const f = await db.getFrame(meta.id); if (!f) continue;
          manifest.frames.push({ ...meta, image: await image(f.image), ocrImage: await image(f.ocrImage) });
        }
        // Fetch PCM one chunk at a time; do not load a whole unfinished lecture.
        for (const key of await db.allChunkKeys(session.id)) {
          const c = await db.getChunk(key); if (!c) continue;
          const { samples, ...metadata } = c;
          const bytes = new Uint8Array(samples.length * 4); const view = new DataView(bytes.buffer);
          for (let i = 0; i < samples.length; i++) view.setFloat32(i * 4, samples[i], true);
          manifest.chunks.push({ ...metadata, samples: samples.length ? await attach(bytes, 'application/x-float32-le') : undefined });
        }
      }
      validateManifest(manifest);
      await writer.add('manifest.json', strToU8(JSON.stringify(manifest)));
      await writer.finish(); progress('전체 백업 ZIP 저장 완료');
    });
  } catch (e) { await writer.abort(); throw e; }
}
export async function inspectBackup(file: File): Promise<BackupPreview> {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if ((memory && memory <= 4 || /Android|iPhone|iPad/i.test(navigator.userAgent)) && file.size > 180 * 1048576) throw new Error('이 기기에서는 180MB 이하의 백업을 복원하세요. 큰 백업은 PC에서 복원할 수 있습니다.');
  const entries = await zipIndex(file), entry = entries.get('manifest.json');
  if (!entry || entry.size > 16 * 1048576) throw new Error('복원 정보가 없습니다. 강의별 자료 ZIP이 아닌 「전체 백업 ZIP」을 선택하세요.');
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readEntry(file, entry))); }
  catch { throw new Error('백업 복원 정보가 손상되었습니다.'); }
  const manifest = validateManifest(raw);
  if (entries.size !== manifest.attachments.length + 1) throw new Error('백업 첨부 목록과 ZIP 파일 목록이 다릅니다.');
  for (const a of manifest.attachments) if (entries.get(a.path)?.size !== a.bytes) throw new Error('백업 첨부 파일이 없거나 크기가 다릅니다.');
  return { file, manifest, entries };
}
function validateImage(bytes: Uint8Array, mime: string) {
  const jpeg = bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v);
  const webp = new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP';
  if (!(mime === 'image/jpeg' ? jpeg : mime === 'image/png' ? png : webp)) throw new Error('이미지 첨부 내용과 파일 형식이 다릅니다.');
}
export async function restoreBackup(preview: BackupPreview, replace: boolean, progress: (message: string) => void) {
  return withMaintenance(async () => {
    const { file, manifest: m, entries } = preview;
    const current = await db.listSessions(), existing = new Set(current.map(s => s.id));
    const selected = new Set(m.sessions.filter(s => replace || !existing.has(s.id)).map(s => s.id));
    const neededPaths = new Set<string>();
    for (const f of m.frames) if (selected.has(f.sessionId)) { if (f.image) neededPaths.add(f.image); if (f.ocrImage) neededPaths.add(f.ocrImage); }
    for (const c of m.chunks) if (selected.has(c.sessionId) && c.samples) neededPaths.add(c.samples);
    const blobs = new Map<string, Blob>(), audio = new Map<string, Float32Array>();
    const estimate = await navigator.storage?.estimate();
    const needed = m.attachments.filter(a => neededPaths.has(a.path)).reduce((n, a) => n + a.bytes, 0) + 20 * 1048576;
    if (estimate?.quota && estimate.quota - (estimate.usage ?? 0) < needed) throw new Error('복원에 필요한 브라우저 저장 공간이 부족합니다. 현재 자료를 백업한 뒤 공간을 확보하세요.');
    for (let i = 0; i < m.attachments.length; i++) {
      const a = m.attachments[i]; progress(`첨부 파일 확인 ${i + 1}/${m.attachments.length}`);
      const bytes = await readEntry(file, entries.get(a.path)!);
      if (await sha256(bytes) !== a.sha256) throw new Error('첨부 파일 무결성 확인에 실패했습니다. 기존 자료는 변경하지 않았습니다.');
      if (a.mime === 'application/x-float32-le') {
        const samples = new Float32Array(bytes.length / 4), view = new DataView(bytes.buffer);
        for (let j = 0; j < samples.length; j++) {
          const sample = view.getFloat32(j * 4, true); if (!Number.isFinite(sample) || Math.abs(sample) > 16) throw new Error('오디오 샘플이 손상되었습니다.'); samples[j] = sample;
        }
        if (neededPaths.has(a.path)) audio.set(a.path, samples);
      } else { validateImage(bytes, a.mime); if (neededPaths.has(a.path)) blobs.set(a.path, new Blob([bytes], { type: a.mime })); }
    }
    const folderMap = new Map((replace ? [] : await db.listFolders()).map(f => [f.id, f]));
    for (const f of m.folders) if (!folderMap.has(f.id)) folderMap.set(f.id, f);
    validateManifest({ ...m, folders: [...folderMap.values()] });
    progress('확인한 자료를 복원하고 있어요…');
    // No awaits for file I/O inside this transaction. Any write/quota/collision
    // failure rolls back ALL stores, including a requested replacement.
    const tx = (await db.database).transaction(['folders', 'sessions', 'transcripts', 'frames', 'chunks'], 'readwrite');
    const done = tx.done; void done.catch(() => {});
    try {
      if (replace) for (const name of ['folders', 'sessions', 'transcripts', 'frames', 'chunks'] as const) await tx.objectStore(name).clear();
      for (const f of folderMap.values()) await tx.objectStore('folders').put(f);
      const sizes = new Map<string, number>();
      for (const row of m.transcripts) if (selected.has(row.sessionId)) {
        if (await tx.objectStore('transcripts').get(row.id)) throw new Error('기존 다른 강의와 자막 ID가 충돌합니다. 새 브라우저에서 복원하세요.');
        await tx.objectStore('transcripts').put(row);
      }
      for (const row of m.frames) if (selected.has(row.sessionId)) {
        if (await tx.objectStore('frames').get(row.id)) throw new Error('기존 다른 강의와 이미지 ID가 충돌합니다.');
        const f: Frame = { ...row, image: row.image ? blobs.get(row.image) : undefined, ocrImage: row.ocrImage ? blobs.get(row.ocrImage) : undefined };
        sizes.set(f.sessionId, (sizes.get(f.sessionId) || 0) + (f.image?.size || 0) + (f.ocrImage?.size || 0)); await tx.objectStore('frames').put(f);
      }
      for (const row of m.chunks) if (selected.has(row.sessionId)) {
        if (await tx.objectStore('chunks').get(row.id)) throw new Error('기존 다른 강의와 오디오 ID가 충돌합니다.');
        const c: AudioChunk = { ...row, samples: row.samples ? audio.get(row.samples)! : new Float32Array(0) };
        sizes.set(c.sessionId, (sizes.get(c.sessionId) || 0) + c.samples.byteLength); await tx.objectStore('chunks').put(c);
      }
      for (const s of m.sessions) if (selected.has(s.id)) {
        await tx.objectStore('sessions').put({ ...s, settings: normalizeSettings(s.settings), bytes: sizes.get(s.id) || 0,
          ...(['recording', 'importing', 'processing'].includes(s.status) ? { status: 'interrupted' as const, warning: '백업 시 진행 중이던 강의입니다. 저장된 구간 다시 처리로 이어갈 수 있습니다. 원래 강의의 화면 공유는 다시 선택해야 합니다.' } : {}) });
      }
      await done;
    } catch (e) { try { tx.abort(); } catch { /* already aborted */ } await done.catch(() => {}); throw e; }
    db.changed(); return { imported: selected.size, skipped: m.sessions.length - selected.size, settings: normalizeSettings(m.settings) };
  });
}
