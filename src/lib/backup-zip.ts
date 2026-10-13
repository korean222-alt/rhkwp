import { Zip, ZipPassThrough } from 'fflate';
import { download } from './download';
export const MAX_BACKUP_BYTES = 1024 * 1048576;
export const MAX_ENTRY_BYTES = 32 * 1048576;
const utf8 = new TextDecoder('utf-8', { fatal: true });
export type ZipEntry = { name: string; offset: number; size: number; crc: number };
export async function sha256(data: Uint8Array<ArrayBuffer>) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(hash, v => v.toString(16).padStart(2, '0')).join('');
}
const table = new Uint32Array(256).map((_, n) => {
  let value = n; for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
export function crc32(data: Uint8Array) {
  let c = 0xffffffff; for (const v of data) c = table[(c ^ v) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export async function zipIndex(file: File) {
  if (file.size > MAX_BACKUP_BYTES) throw new Error('한 번에 복원할 수 있는 전체 백업은 1GB까지입니다.');
  if (file.size < 22) throw new Error('ZIP 파일이 손상되었습니다.');
  const tailStart = Math.max(0, file.size - 65557), tail = new DataView(await file.slice(tailStart).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50 && i + 22 + tail.getUint16(i + 20, true) === tail.byteLength) { eocd = i; break; }
  if (eocd < 0 || tail.getUint16(eocd + 4, true) || tail.getUint16(eocd + 6, true)) throw new Error('지원하지 않거나 손상된 ZIP입니다.');
  const count = tail.getUint16(eocd + 10, true), length = tail.getUint32(eocd + 12, true), start = tail.getUint32(eocd + 16, true);
  if (count > 20001 || count !== tail.getUint16(eocd + 8, true) || length > 4 * 1048576 || start + length !== tailStart + eocd) throw new Error('ZIP 목록이 올바르지 않습니다.');
  const directory = new Uint8Array(await file.slice(start, start + length).arrayBuffer()), view = new DataView(directory.buffer);
  const entries = new Map<string, ZipEntry>(); let p = 0, total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > directory.length || view.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP 목록이 손상되었습니다.');
    const flags = view.getUint16(p + 8, true), method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 24, true), compressed = view.getUint32(p + 20, true), crc = view.getUint32(p + 16, true);
    const nameLength = view.getUint16(p + 28, true), extraLength = view.getUint16(p + 30, true), commentLength = view.getUint16(p + 32, true), offset = view.getUint32(p + 42, true);
    if (flags & ~0x808 || method !== 0 || compressed !== size || size > MAX_ENTRY_BYTES || view.getUint16(p + 34, true)) throw new Error('앱에서 받은 원본 전체 백업 ZIP을 사용하세요. 재압축·암호화 ZIP은 지원하지 않습니다.');
    if (p + 46 + nameLength + extraLength + commentLength > directory.length) throw new Error('ZIP 파일명이 손상되었습니다.');
    const name = utf8.decode(directory.subarray(p + 46, p + 46 + nameLength));
    if (name !== 'manifest.json' && !/^data\/[0-9]+\.(jpg|png|webp|f32)$/.test(name)) throw new Error('LectureLens 전체 백업에 허용되지 않는 파일이 있습니다.');
    if (entries.has(name) || offset + 30 > start) throw new Error('중복되거나 손상된 ZIP 파일입니다.');
    const header = new DataView(await file.slice(offset, offset + 30).arrayBuffer());
    const localNameLength = header.getUint16(26, true), localExtraLength = header.getUint16(28, true);
    if (header.getUint32(0, true) !== 0x04034b50 || header.getUint16(6, true) !== flags || header.getUint16(8, true) !== 0) throw new Error('ZIP 헤더가 올바르지 않습니다.');
    if (utf8.decode(await file.slice(offset + 30, offset + 30 + localNameLength).arrayBuffer()) !== name) throw new Error('ZIP 파일명이 서로 다릅니다.');
    const dataOffset = offset + 30 + localNameLength + localExtraLength;
    if (dataOffset + size > start) throw new Error('ZIP 첨부 파일이 잘렸습니다.');
    entries.set(name, { name, offset: dataOffset, size, crc }); total += size;
    p += 46 + nameLength + extraLength + commentLength;
  }
  if (p !== directory.length || total > MAX_BACKUP_BYTES) throw new Error('ZIP 크기 또는 목록이 올바르지 않습니다.');
  const ordered = [...entries.values()].sort((a, b) => a.offset - b.offset);
  for (let i = 1; i < ordered.length; i++) if (ordered[i - 1].offset + ordered[i - 1].size > ordered[i].offset) throw new Error('첨부 파일 영역이 겹칩니다.');
  return entries;
}
export async function readEntry(file: File, entry: ZipEntry) {
  const bytes = new Uint8Array(await file.slice(entry.offset, entry.offset + entry.size).arrayBuffer());
  if (crc32(bytes) !== entry.crc) throw new Error('ZIP 내용이 손상되었습니다. 백업을 다시 선택하세요.');
  return bytes;
}
type FileWindow = Window & { showSaveFilePicker?: (o: object) => Promise<{ createWritable(): Promise<WritableStream<Uint8Array>> }> };
export async function createBackupWriter() {
  const name = `LectureLens-backup-${new Date().toISOString().slice(0, 10)}.zip`;
  const picker = (window as FileWindow).showSaveFilePicker;
  const writer = picker ? (await (await picker({ suggestedName: name, types: [{ description: 'LectureLens 전체 백업', accept: { 'application/zip': ['.zip'] } }] })).createWritable()).getWriter() : undefined;
  const buffers: Uint8Array<ArrayBuffer>[] = []; let total = 0, failure: Error | undefined, queue = Promise.resolve();
  const zip = new Zip((err, data) => {
    if (err) { failure = err; return; }
    total += data.length;
    if (total > MAX_BACKUP_BYTES || (!writer && total > 180 * 1048576)) { failure = new Error(writer ? '백업은 1GB까지 지원합니다. 큰 강의는 개별 자료 ZIP도 함께 보관하세요.' : '백업이 180MB를 넘습니다. PC Chrome/Edge에서 파일 직접 저장을 사용하세요.'); return; }
    if (writer) queue = queue.then(() => writer.write(data)).catch(e => { failure = e; });
    else buffers.push(new Uint8Array(data));
  });
  return {
    async add(path: string, bytes: Uint8Array) {
      if (bytes.length > MAX_ENTRY_BYTES) throw new Error('첨부 파일 하나는 32MB까지 지원합니다.');
      const f = new ZipPassThrough(path); zip.add(f); f.push(bytes, true);
      await queue; if (failure) throw failure;
    },
    async finish() { zip.end(); await queue; if (failure) throw failure; if (writer) await writer.close(); else download(new Blob(buffers, { type: 'application/zip' }), name); },
    async abort() { zip.terminate(); await writer?.abort().catch(() => {}); },
  };
}
