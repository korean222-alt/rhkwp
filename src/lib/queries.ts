import * as db from './db';
import { selectFrame } from './scenes';
import { parseTime, time } from './time';
export async function getFrameAt(id: string, timestamp: string | number) {
  const meta = selectFrame(await db.frameMeta(id), parseTime(timestamp));
  return meta ? db.getFrame(meta.id) : undefined;
}
export async function listScenes(id: string, start = 0, end = Infinity) {
  return (await db.frameMeta(id)).filter(f => f.sec >= start && f.sec <= end && f.type !== 'periodic').map(f => ({ sec: f.sec, time: time(f.sec), type: f.type }));
}
export async function getTranscript(id: string, start = 0, end = Infinity) {
  return (await db.transcripts(id)).filter(t => t.end >= start && t.start <= end).map(t => ({ start: t.start, end: t.end, text: t.text }));
}
export async function resizeImage(blob: Blob, maxWidth = 1024) {
  const bmp = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(bmp.width, Math.max(160, maxWidth));
    canvas.height = Math.round(bmp.height * canvas.width / bmp.width);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('이미지를 변환하지 못했습니다.')), 'image/jpeg', 0.7));
  } finally { bmp.close(); }
}
