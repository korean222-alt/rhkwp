import * as db from './db';
import { withMaintenance } from './maintenance';
export async function compactImages(id: string, progress: (n: number) => void) {
  return withMaintenance(async () => {
    const s = await db.getSession(id);
    if (!s || ['recording', 'importing', 'processing'].includes(s.status)) throw new Error('진행 중인 작업을 마친 뒤 사진 용량을 줄이세요.');
    if (s.imagesOptimized) return { saved: 0, count: 0 };
    const updates: { id: string; image: Blob }[] = [];
    const metas = await db.frameMeta(id);
    for (let i = 0; i < metas.length; i++) {
      const frame = await db.getFrame(metas[i].id);
      if (frame?.image) {
        const bitmap = await createImageBitmap(frame.image);
        try {
          const width = Math.min(640, bitmap.width), height = Math.max(1, Math.round(width * bitmap.height / bitmap.width));
          const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
          canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
          const image = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('사진을 변환하지 못했습니다. 기존 사진은 유지됩니다.')), 'image/jpeg', .55));
          if (image.size < frame.image.size) updates.push({ id: frame.id, image });
        } finally { bitmap.close(); }
      }
      progress(Math.round((i + 1) / Math.max(1, metas.length) * 90));
    }
    const tx = (await db.database).transaction(['frames', 'sessions'], 'readwrite');
    const done = tx.done; void done.catch(() => {}); let saved = 0;
    try {
      for (const update of updates) {
        const frame = await tx.objectStore('frames').get(update.id); if (!frame) throw new Error('변환할 사진을 찾을 수 없습니다.');
        saved += (frame.image?.size || 0) - update.image.size;
        await tx.objectStore('frames').put({ ...frame, image: update.image });
      }
      await tx.objectStore('sessions').put({ ...s, bytes: Math.max(0, s.bytes - saved), imagesOptimized: true, updatedAt: Date.now() });
      await done;
    } catch (e) { try { tx.abort(); } catch { /* already aborted */ } await done.catch(() => {}); throw e; }
    progress(100); db.changed(); return { saved, count: updates.length };
  });
}
