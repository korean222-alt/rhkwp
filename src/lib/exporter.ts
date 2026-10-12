import { Zip, ZipPassThrough, strToU8 } from 'fflate';
import * as db from './db';
import { combined, frameFile } from './cues';
import { time } from './time';
import { plain, srt } from './transcript';
export { plain, srt } from './transcript';
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function safeName(name: string) { return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 80) || 'lecture'; }
type FileWindow = Window & { showSaveFilePicker?: (o: object) => Promise<{ createWritable(): Promise<WritableStream<Uint8Array>> }> };
export async function exportZip(id: string, onProgress: (p: number) => void) {
  const session = await db.getSession(id); if (!session) throw new Error('강의 자료를 찾을 수 없습니다.');
  const root = safeName(session.name);
  // Invoke the picker while the user's click still grants activation.
  const picker = (window as FileWindow).showSaveFilePicker;
  let writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
  if (picker) {
    const handle = await picker({ suggestedName: `${root}.zip`, types: [{ description: '강의 자료 ZIP', accept: { 'application/zip': ['.zip'] } }] });
    writer = (await handle.createWritable()).getWriter();
  }
  const chunks: Uint8Array<ArrayBuffer>[] = []; let bytes = 0;
  let writeQueue = Promise.resolve(); let failure: Error | undefined;
  const zip = new Zip((err, data) => {
    if (err) { failure = err; return; }
    bytes += data.byteLength;
    if (writer) writeQueue = writeQueue.then(() => writer!.write(data)).catch(e => { failure = e; });
    else {
      if (bytes > 180 * 1048576) { failure = new Error('ZIP이 180MB를 넘습니다. PC Chrome/Edge에서 파일에 직접 저장하세요.'); return; }
      chunks.push(new Uint8Array(data));
    }
  });
  const add = (path: string, data: Uint8Array) => { const file = new ZipPassThrough(`${root}/${path}`); zip.add(file); file.push(data, true); };
  try {
    const rows = await db.transcripts(id); const metas = await db.frameMeta(id); const images = new Set<string>();
    const scenes = [];
    for (let i = 0; i < metas.length; i++) {
      const frame = await db.getFrame(metas[i].id);
      if (frame?.image) { add(frameFile(i), new Uint8Array(await frame.image.arrayBuffer())); images.add(frame.id); }
      scenes.push({ sec: metas[i].sec, time: time(metas[i].sec), file: frame?.image ? frameFile(i) : null, type: metas[i].type, scene_id: metas[i].sceneId });
      onProgress(Math.round((i + 1) / Math.max(metas.length, 1) * 90));
      await writeQueue; if (failure) throw failure;
    }
    add('transcript.txt', strToU8(plain(rows, session.showTimeline !== false))); add('transcript.srt', strToU8(srt(rows)));
    add('combined.md', strToU8(combined(session.name, rows, metas, session.settings.keywords, images, session.showTimeline !== false)));
    add('scenes.json', strToU8(JSON.stringify(scenes, null, 2)));
    add('meta.json', strToU8(JSON.stringify({ app: 'LectureLens', version: '1.2.0', show_timeline: session.showTimeline !== false, recorded_at: new Date(session.createdAt).toISOString(), duration_sec: session.duration, source: session.source, settings: session.settings, status: session.status, storage_bytes: session.bytes, exported_at: new Date().toISOString() }, null, 2)));
    zip.end(); await writeQueue; if (failure) throw failure;
    if (writer) await writer.close(); else download(new Blob(chunks, { type: 'application/zip' }), `${root}.zip`);
    onProgress(100);
  } catch (e) { zip.terminate(); await writer?.abort().catch(() => {}); throw e; }
}
