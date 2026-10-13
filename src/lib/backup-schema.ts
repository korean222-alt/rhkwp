import { z } from 'zod';
// An archive is untrusted input. Whitelist fields instead of restoring arbitrary
// localStorage entries, API keys, HTML, URLs or executable files.
const id = z.string().min(1).max(200), text = z.string().max(100000);
const sec = z.number().finite().min(0).max(864000);
const timestamp = z.number().finite().min(0).max(8640000000000000);
const settings = z.object({
  schemaVersion: z.union([z.literal(3), z.literal(4)]), model: z.enum(['tiny', 'base', 'small', 'large-v3-turbo']),
  device: z.enum(['auto', 'wasm']), language: z.enum(['auto', 'korean', 'english']),
  autoStopMinutes: z.number().int().min(0).max(120), snapshotMode: z.enum(['scene', 'interval', 'manual']),
  ignoreBottom: z.number().min(0).max(40), sceneThreshold: z.number().min(5).max(45),
  interval: z.number().min(5).max(60), width: z.number().min(640).max(1920), quality: z.number().min(.4).max(.9),
  saveImages: z.boolean(), ocr: z.boolean(), ocrWidth: z.number().min(960).max(2560), keywords: z.array(z.string().max(200)).max(500),
}).strict();
const folder = z.object({ id, name: z.string().min(1).max(100), parentId: id.optional(), createdAt: timestamp }).strict();
const session = z.object({
  id, name: z.string().min(1).max(100), createdAt: timestamp, updatedAt: timestamp,
  status: z.enum(['recording', 'importing', 'interrupted', 'processing', 'complete']),
  duration: sec, settings, source: z.enum(['screen', 'file', 'demo']), bytes: z.number().finite().min(0),
  warning: text.optional(), showTimeline: z.boolean().optional(), folderId: id.optional(),
  expectedDuration: sec.optional(), asrRate: z.number().finite().positive().max(3600).optional(), imagesOptimized: z.boolean().optional(),
}).strict();
const transcript = z.object({ id, sessionId: id, start: sec, end: sec, text }).strict();
const binary = z.string().regex(/^data\/[0-9]+\.(jpg|png|webp|f32)$/);
const frame = z.object({ id, sessionId: id, sec, sceneId: id, type: z.enum(['scene', 'periodic', 'manual']),
  ocr: text, ocrStatus: z.enum(['pending', 'done', 'error', 'off']), image: binary.optional(), ocrImage: binary.optional() }).strict();
const chunk = z.object({ id, sessionId: id, start: sec, duration: z.number().finite().min(0).max(30),
  status: z.enum(['pending', 'done', 'error']), error: text.optional(), samples: binary.optional() }).strict();
const attachment = z.object({ path: binary, bytes: z.number().int().min(1).max(32 * 1048576),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), mime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/x-float32-le']) }).strict();
export const backupSchema = z.object({
  format: z.literal('lecturelens-backup'), version: z.literal(1), appVersion: z.string().max(30), createdAt: timestamp,
  settings, folders: z.array(folder).max(2000), sessions: z.array(session).max(10000),
  transcripts: z.array(transcript).max(100000), frames: z.array(frame).max(20000), chunks: z.array(chunk).max(20000),
  attachments: z.array(attachment).max(20000),
}).strict();
export type BackupManifest = z.infer<typeof backupSchema>;
export function validateManifest(input: unknown): BackupManifest {
  const parsed = backupSchema.safeParse(input);
  if (!parsed.success) throw new Error('백업 형식 또는 버전이 올바르지 않습니다. LectureLens의 전체 백업 ZIP을 선택하세요.');
  const m = parsed.data;
  const unique = (rows: { id: string }[]) => { const ids = new Set(rows.map(r => r.id)); if (ids.size !== rows.length) throw new Error('백업 안에 중복 ID가 있습니다.'); return ids; };
  const folderIds = unique(m.folders), sessionIds = unique(m.sessions); unique(m.transcripts); unique(m.frames); unique(m.chunks);
  const folders = new Map(m.folders.map(f => [f.id, f]));
  for (const folder of m.folders) {
    const seen = new Set<string>(); let current: typeof folder | undefined = folder;
    while (current) {
      if (seen.has(current.id)) throw new Error('폴더가 자기 자신을 포함하는 잘못된 백업입니다.');
      seen.add(current.id);
      if (current.parentId && !folderIds.has(current.parentId)) throw new Error('백업에 상위 폴더가 없습니다.');
      current = current.parentId ? folders.get(current.parentId) : undefined;
    }
  }
  for (const s of m.sessions) if (s.folderId && !folderIds.has(s.folderId)) throw new Error('강의의 폴더 정보가 없습니다.');
  for (const row of [...m.transcripts, ...m.frames, ...m.chunks]) if (!sessionIds.has(row.sessionId)) throw new Error('자료에 연결된 강의가 없습니다.');
  for (const row of m.transcripts) if (row.end < row.start) throw new Error('자막 시각이 올바르지 않습니다.');
  const attachments = new Map(m.attachments.map(a => [a.path, a]));
  if (attachments.size !== m.attachments.length) throw new Error('중복된 첨부 파일입니다.');
  const used = new Set<string>();
  const use = (path: string | undefined, audio = false) => {
    if (!path) return;
    const a = attachments.get(path);
    if (!a || (audio ? a.mime !== 'application/x-float32-le' : !a.mime.startsWith('image/'))) throw new Error('첨부 파일 종류가 올바르지 않습니다.');
    used.add(path);
  };
  for (const f of m.frames) { use(f.image); use(f.ocrImage); }
  for (const c of m.chunks) {
    use(c.samples, true);
    const bytes = c.samples ? attachments.get(c.samples)!.bytes : 0;
    if (bytes % 4 || bytes > 16000 * 30 * 4 || (c.status !== 'done' && Math.abs(bytes / 64000 - c.duration) > .01)) throw new Error('오디오 길이 또는 샘플 크기가 올바르지 않습니다.');
  }
  if (used.size !== attachments.size) throw new Error('백업에 사용되지 않는 첨부 파일이 있습니다.');
  return m;
}
