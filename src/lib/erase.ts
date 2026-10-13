import * as db from './db';
import { withMaintenance } from './maintenance';
export async function eraseLocalData() {
  return withMaintenance(async () => {
    await db.clearData();
    for (const storage of [localStorage, sessionStorage]) for (const key of Object.keys(storage)) if (key.startsWith('lens-')) storage.removeItem(key);
    const errors: string[] = [];
    try {
      if ('caches' in window) for (const name of await caches.keys()) if (name === 'transformers-cache' || name.startsWith('lecturelens-')) await caches.delete(name);
    } catch { errors.push('음성 모델 캐시'); }
    // Tesseract's idb-keyval store also hosts only language weights, keyed by
    // our cachePath. Delete our entries, never an unrelated site's database.
    try {
      const databases = await indexedDB.databases();
      if (databases.some(d => d.name === 'keyval-store')) {
        const cache = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('keyval-store'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        try {
          if (cache.objectStoreNames.contains('keyval')) await new Promise<void>((resolve, reject) => {
            const tx = cache.transaction('keyval', 'readwrite'), store = tx.objectStore('keyval');
            const cursor = store.openCursor(); cursor.onsuccess = () => { const c = cursor.result; if (!c) return; if (String(c.key).startsWith('lecturelens-image-text-v1/')) c.delete(); c.continue(); };
            tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
          });
        } finally { cache.close(); }
      }
    } catch { errors.push('글자 인식 모델 캐시'); }
    // Clear keys and loaded model memory in other tabs as well.
    const channel = new BroadcastChannel('lecturelens-erased'); channel.postMessage('erase'); channel.close();
    return errors;
  });
}
