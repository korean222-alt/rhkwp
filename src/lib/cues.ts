import type { Frame, Transcript } from '../types';
import { selectFrame } from './scenes';
import { time } from './time';
export const frameFile = (index: number) => `frames/${(index + 1).toString().padStart(4, '0')}.jpg`;
export function combined(name: string, rows: Transcript[], frames: Pick<Frame, 'id' | 'sec' | 'ocr' | 'sceneId' | 'type'>[], keywords: string[], imageIds: Set<string>) {
  const lines = [`# ${name.replace(/[\r\n]/g, ' ')}`, '', '> 자막과 OCR은 자동 생성됩니다. 중요한 내용은 원문을 확인하세요.', ''];
  let lastScene = '';
  for (const row of rows) {
    lines.push(`[${time(row.start)}] ${row.text}`, '');
    if (!keywords.some(k => k.trim() && row.text.includes(k))) continue;
    const frame = selectFrame(frames, row.start);
    if (!frame || frame.sceneId === lastScene) continue;
    const scene = frames.findLast(f => f.sceneId === frame.sceneId && f.sec <= frame.sec && !!f.ocr);
    const ocr = scene?.ocr || frame.ocr;
    lines.push(`> 화면 단서 · ${time(frame.sec)}`);
    if (ocr) lines.push(...ocr.split('\n').map(line => `> ${line}`));
    if (imageIds.has(frame.id)) lines.push(`> [이 시점의 화면](${frameFile(frames.findIndex(f => f.id === frame.id))})`);
    if (!ocr && !imageIds.has(frame.id)) lines.push('> 저장된 화면 정보가 없습니다.');
    lines.push(''); lastScene = frame.sceneId;
  }
  if (!rows.length) lines.push('아직 생성된 자막이 없습니다.');
  return lines.join('\n');
}
