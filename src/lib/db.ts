import { openDB, type DBSchema } from 'idb';
import type { Session, AudioChunk, Frame, Transcript } from '../types';

interface Schema extends DBSchema {
  sessions: { key: string; value: Session };
  chunks: { key: string; value: AudioChunk; indexes: { sessionId: string } };
  frames: { key: string; value: Frame; indexes: { sessionId: string } };
  transcripts: { key: string; value: Transcript; indexes: { sessionId: string } };
}
const database = openDB<Schema>('lecturelens-v1', 1, {
  upgrade(db) {
    db.createObjectStore('sessions', { keyPath: 'id' });
    for (const name of ['chunks', 'frames', 'transcripts'] as const) {
      const s = db.createObjectStore(name, { keyPath: 'id' });
      s.createIndex('sessionId', 'sessionId');
    }
  },
});
const broadcast = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('lecturelens-data') : undefined;
if (broadcast) broadcast.onmessage = () => window.dispatchEvent(new Event('lens:changed'));
export const changed = () => { window.dispatchEvent(new Event('lens:changed')); broadcast?.postMessage('changed'); };
export async function listSessions() { return (await (await database).getAll('sessions')).sort((a, b) => b.createdAt - a.createdAt); }
export async function putSession(session: Session) { await (await database).put('sessions', session); changed(); }
export async function getSession(id: string) { return (await database).get('sessions', id); }
export async function patchSession(id: string, patch: Partial<Session>) {
  const tx = (await database).transaction('sessions', 'readwrite');
  const s = await tx.store.get(id);
  if (s) await tx.store.put({ ...s, ...patch, updatedAt: Date.now() });
  await tx.done; changed();
}
export async function saveChunk(chunk: AudioChunk) {
  const tx = (await database).transaction(['chunks', 'sessions'], 'readwrite');
  await tx.objectStore('chunks').put(chunk);
  const s = await tx.objectStore('sessions').get(chunk.sessionId);
  if (s) await tx.objectStore('sessions').put({ ...s, duration: Math.max(s.duration, chunk.start + chunk.duration), bytes: s.bytes + chunk.samples.byteLength, updatedAt: Date.now() });
  await tx.done; changed();
}
export async function chunkKeys(id: string) { return (await database).getAllKeysFromIndex('chunks', 'sessionId', id); }
export async function pendingChunks(id: string, seconds = 30) {
  // Cursor bounds memory: never materialize the whole lecture's PCM.
  const db = await database; const out: AudioChunk[] = [];
  let duration = 0;
  let c = await db.transaction('chunks').store.index('sessionId').openCursor(IDBKeyRange.only(id));
  while (c && duration < seconds) {
    if (c.value.status === 'pending') { out.push(c.value); duration += c.value.duration; }
    c = await c.continue();
  }
  return out.sort((a, b) => a.start - b.start);
}
export async function chunkStats(id: string) {
  let pending = 0, errors = 0, done = 0;
  let c = await (await database).transaction('chunks').store.index('sessionId').openCursor(IDBKeyRange.only(id));
  while (c) { if (c.value.status === 'pending') pending++; else if (c.value.status === 'error') errors++; else done++; c = await c.continue(); }
  return { pending, errors, done };
}
export async function finishChunks(chunks: AudioChunk[], rows: Transcript[]) {
  const tx = (await database).transaction(['chunks', 'transcripts', 'sessions'], 'readwrite');
  let released = 0;
  for (const row of rows) await tx.objectStore('transcripts').put(row);
  for (const c of chunks) {
    released += c.samples.byteLength;
    await tx.objectStore('chunks').put({ ...c, status: 'done', samples: new Float32Array(0), error: undefined });
  }
  const s = await tx.objectStore('sessions').get(chunks[0].sessionId);
  if (s) await tx.objectStore('sessions').put({ ...s, bytes: Math.max(0, s.bytes - released), updatedAt: Date.now() });
  await tx.done; changed();
}
export async function failChunks(chunks: AudioChunk[], message: string) {
  const tx = (await database).transaction('chunks', 'readwrite');
  for (const c of chunks) await tx.store.put({ ...c, status: 'error', error: message });
  await tx.done; changed();
}
export async function retryErrors(id: string) {
  const tx = (await database).transaction(['chunks', 'frames'], 'readwrite');
  for (const name of ['chunks', 'frames'] as const) {
    let c = await tx.objectStore(name).index('sessionId').openCursor(IDBKeyRange.only(id));
    while (c) {
      const v = c.value;
      if ('samples' in v && v.status === 'error') await c.update({ ...v, status: 'pending', error: undefined });
      if ('ocrStatus' in v && v.ocrStatus === 'error' && (v.image || v.ocrImage)) await c.update({ ...v, ocrStatus: 'pending' });
      c = await c.continue();
    }
  }
  await tx.done; changed();
}
export async function saveFrame(frame: Frame) {
  const tx = (await database).transaction(['frames', 'sessions'], 'readwrite');
  await tx.objectStore('frames').put(frame);
  const s = await tx.objectStore('sessions').get(frame.sessionId);
  if (s) await tx.objectStore('sessions').put({ ...s, bytes: s.bytes + (frame.image?.size ?? 0) + (frame.ocrImage?.size ?? 0), duration: Math.max(s.duration, frame.sec), updatedAt: Date.now() });
  await tx.done; changed();
}
export async function updateFrame(frame: Frame, releaseImage = false) {
  const tx = (await database).transaction(['frames', 'sessions'], 'readwrite');
  const old = await tx.objectStore('frames').get(frame.id);
  const finished = frame.ocrStatus === 'done' || frame.ocrStatus === 'off';
  await tx.objectStore('frames').put({ ...frame, image: releaseImage ? undefined : frame.image, ocrImage: finished ? undefined : frame.ocrImage });
  const released = (releaseImage ? old?.image?.size ?? 0 : 0) + (finished ? old?.ocrImage?.size ?? 0 : 0);
  if (released) {
    const s = await tx.objectStore('sessions').get(frame.sessionId);
    if (s) await tx.objectStore('sessions').put({ ...s, bytes: Math.max(0, s.bytes - released) });
  }
  await tx.done; changed();
}
export async function frames(id: string) { return (await (await database).getAllFromIndex('frames', 'sessionId', id)).sort((a, b) => a.sec - b.sec); }
export async function frameMeta(id: string) {
  const out: Omit<Frame, 'image' | 'ocrImage'>[] = [];
  let c = await (await database).transaction('frames').store.index('sessionId').openCursor(IDBKeyRange.only(id));
  while (c) { const { image: _image, ocrImage: _ocrImage, ...meta } = c.value; out.push(meta); c = await c.continue(); }
  return out.sort((a, b) => a.sec - b.sec);
}
export async function getFrame(id: string) { return (await database).get('frames', id); }
export async function nextOcr(id: string) {
  let c = await (await database).transaction('frames').store.index('sessionId').openCursor(IDBKeyRange.only(id));
  while (c) { if (c.value.ocrStatus === 'pending') return c.value; c = await c.continue(); }
}
export async function transcripts(id: string) { return (await (await database).getAllFromIndex('transcripts', 'sessionId', id)).sort((a, b) => a.start - b.start); }
export async function editTranscript(row: Transcript) { await (await database).put('transcripts', row); changed(); }
export async function deleteSession(id: string) {
  const tx = (await database).transaction(['sessions', 'chunks', 'frames', 'transcripts'], 'readwrite');
  await tx.objectStore('sessions').delete(id);
  for (const name of ['chunks', 'frames', 'transcripts'] as const) {
    let c = await tx.objectStore(name).index('sessionId').openCursor(IDBKeyRange.only(id));
    while (c) { await c.delete(); c = await c.continue(); }
  }
  await tx.done; changed();
}
export async function assertStorage() {
  const estimate = await navigator.storage?.estimate();
  if (estimate?.quota && estimate.quota - (estimate.usage ?? 0) < 200 * 1048576) throw new Error('브라우저 저장 공간이 200MB 미만입니다. 이전 강의를 내보내고 삭제한 뒤 다시 시작하세요.');
  await navigator.storage?.persist().catch(() => false);
}
